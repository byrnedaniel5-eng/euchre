/* Euchre client. The server owns the game; this file only renders state and
   sends intents. Anything the browser thinks it knows is disposable. */

(() => {
  'use strict';

  const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  const RED = { H: true, D: true };
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ persistence

  const store = {
    get(k, d = null) {
      try { return JSON.parse(localStorage.getItem('euchre.' + k)) ?? d; } catch { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('euchre.' + k, JSON.stringify(v)); } catch { /* private mode */ }
    },
  };

  let playerId = store.get('playerId');
  if (!playerId) {
    playerId = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now());
    store.set('playerId', playerId);
  }

  // -------------------------------------------------------------- app state

  let ws = null;
  let mySeat = null;
  let roomCode = null;
  let state = null;
  let retries = 0;
  let pendingJoin = null; // {room|null, name}

  // ------------------------------------------------------------- networking

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onopen = () => {
      retries = 0;
      $('conn-banner').hidden = true;
      if (pendingJoin) ws.send(JSON.stringify({ type: 'join', playerId, ...pendingJoin }));
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'joined') {
        mySeat = msg.seat;
        roomCode = msg.room;
        pendingJoin = { room: msg.room, name: pendingJoin?.name || 'Player' };
        store.set('lastRoom', { code: msg.room, at: Date.now() });
        history.replaceState(null, '', `?room=${msg.room}`);
        $('chat').innerHTML = '';
        (msg.chat || []).forEach(addChat);
      } else if (msg.type === 'state') {
        state = msg.state;
        render();
      } else if (msg.type === 'chat') {
        addChat(msg.entry);
        if ($('drawer').hidden) flashMenu();
      } else if (msg.type === 'error') {
        if (state) {
          toast(msg.message);
        } else {
          // The join itself failed — usually a stored room the server no
          // longer has. Forget it, or every refresh retries the same dead code.
          store.set('lastRoom', null);
          pendingJoin = null;
          history.replaceState(null, '', location.pathname);
          $('lobby').hidden = true;
          $('game').hidden = true;
          $('join').hidden = false;
          showJoinError(msg.message);
        }
      }
    };

    ws.onclose = () => {
      if (pendingJoin) {
        $('conn-banner').hidden = false;
        const wait = Math.min(1000 * 2 ** retries++, 10000);
        setTimeout(connect, wait);
      }
    };

    ws.onerror = () => ws.close();
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  const act = (action) => send({ type: 'action', action });

  // -------------------------------------------------------------- join flow

  function showJoinError(text) {
    const el = $('join-error');
    el.textContent = text;
    el.hidden = false;
  }

  // How many of the four seats are people; bots take the rest. Only matters
  // when creating a room — joining one inherits its size.
  let playerCount = store.get('playerCount', 2) || 2;

  const PLAYER_HINTS = {
    1: 'Just you and 3 bots. Your partner sits across from you.',
    2: 'Two people on opposite teams, each partnered by a bot.',
    3: 'Three people and 1 bot. The bot partners whoever joins second.',
    4: 'Four people, no bots.',
  };

  function renderPlayerChoice() {
    for (const b of $('opt-players').querySelectorAll('button')) {
      b.classList.toggle('on', Number(b.dataset.v) === playerCount);
    }
    $('players-hint').textContent = PLAYER_HINTS[playerCount];
  }

  $('opt-players').onclick = (e) => {
    const v = Number(e.target.closest('button')?.dataset.v);
    if (!v) return;
    playerCount = v;
    store.set('playerCount', v);
    renderPlayerChoice();
  };
  renderPlayerChoice();

  function doJoin(room) {
    const name = $('name').value.trim() || 'Player';
    store.set('name', name);
    pendingJoin = { room: room || null, name };
    if (!room) pendingJoin.players = playerCount;
    $('join-error').hidden = true;
    if (ws && ws.readyState === WebSocket.OPEN) send({ type: 'join', playerId, ...pendingJoin });
    else connect();
  }

  $('name').value = store.get('name', '') || '';
  $('create').onclick = () => doJoin(null);
  $('join-btn').onclick = () => {
    const code = $('code').value.trim().toUpperCase();
    if (code.length !== 4) return showJoinError('A game code is 4 characters.');
    doJoin(code);
  };
  $('code').oninput = (e) => { e.target.value = e.target.value.toUpperCase(); };
  $('code').onkeydown = (e) => { if (e.key === 'Enter') $('join-btn').click(); };
  $('name').onkeydown = (e) => { if (e.key === 'Enter') $('create').click(); };

  /**
   * Get out of a room for good. Rejoining is deliberately sticky — a refresh
   * or a lock screen must land you back in your seat — so leaving has to
   * clear every trace of it: the stored room, the URL, and the socket.
   */
  function leaveGame() {
    send({ type: 'leave' });
    pendingJoin = null; // must precede close(), or onclose reconnects us
    if (ws) ws.close();
    ws = null;
    state = null;
    mySeat = null;
    roomCode = null;
    store.set('lastRoom', null);
    history.replaceState(null, '', location.pathname);
    $('code').value = '';
    $('chat').innerHTML = '';
    for (const id of ['drawer', 'overlay', 'game', 'lobby']) $(id).hidden = true;
    $('conn-banner').hidden = true;
    $('join-error').hidden = true;
    $('join').hidden = false;
  }

  $('lobby-cancel').onclick = leaveGame;
  $('leave-game').onclick = () => {
    const mid = state && !['gameOver', 'lobby'].includes(state.phase);
    if (mid && !confirm('Leave this game? It will end for both of you.')) return;
    leaveGame();
  };

  $('copy-link').onclick = async () => {
    const url = `${location.origin}/?room=${roomCode}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Euchre', text: `Game code ${roomCode}`, url });
      else await navigator.clipboard.writeText(url);
      $('copy-link').textContent = 'Copied!';
      setTimeout(() => ($('copy-link').textContent = 'Copy invite link'), 1600);
    } catch { /* user dismissed the share sheet */ }
  };

  // ---------------------------------------------------------------- helpers

  const teamOf = (seat) => seat % 2;

  /** Seats occupied by people this game; the rest are bots. */
  const humanSeats = () => Array.from({ length: state?.humans ?? 2 }, (_, i) => i);
  const otherHumans = () => humanSeats().filter((s) => s !== mySeat);

  /** Screen position of a seat, from this player's point of view. */
  function positionOf(seat) {
    return ['bottom', 'left', 'top', 'right'][(seat - mySeat + 4) % 4];
  }

  // One markup shape carries every card style: corner indices, a centre rank
  // and a centre pip. Each theme in the stylesheet shows the parts it wants.
  function cardEl(card, extraClass = '') {
    const rank = card[0];
    const suit = card[1];
    const label = rank === 'T' ? '10' : rank;
    const sym = SUIT_SYMBOL[suit];
    const court = 'AKQJ'.includes(rank);

    const el = document.createElement('div');
    el.className = `card ${RED[suit] ? 'red' : ''} ${court ? 'court' : ''} ${extraClass}`
      .replace(/\s+/g, ' ').trim();
    el.dataset.card = card;
    el.dataset.suit = suit;
    const corner = `<span class="cr">${label}</span><span class="cs">${sym}</span>`;
    el.innerHTML =
      `<span class="corner tl">${corner}</span>` +
      `<span class="mid"><span class="r">${label}</span><span class="s">${sym}</span></span>` +
      `<span class="corner br">${corner}</span>`;
    return el;
  }

  function toast(text) {
    const b = $('conn-banner');
    b.textContent = text;
    b.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      b.hidden = true;
      b.textContent = 'Reconnecting…';
    }, 2200);
  }

  function flashMenu() {
    const btn = $('menu-btn');
    btn.style.color = 'var(--gold)';
    setTimeout(() => (btn.style.color = ''), 2500);
  }

  // ----------------------------------------------------------------- render

  function render() {
    if (!state) return;

    if (state.phase === 'lobby') {
      $('join').hidden = true;
      $('game').hidden = true;
      $('lobby').hidden = false;
      $('room-code').textContent = state.room;
      const inSoFar = state.seated.filter(Boolean).length;
      const total = state.humans ?? 2;
      const missing = total - inSoFar;
      document.querySelector('#lobby h2').textContent =
        missing === 1 ? 'Waiting for one more' : `Waiting for ${missing} more`;
      const here = humanSeats()
        .filter((s) => state.seated[s])
        .map((s) => state.names[s])
        .join(', ');
      $('lobby-status').textContent =
        missing > 0 ? `${inSoFar} of ${total} here — ${here}` : 'Starting…';
      return;
    }

    $('join').hidden = true;
    $('lobby').hidden = true;
    $('game').hidden = false;

    renderHud();
    renderSeats();
    renderCentre();
    renderHand();
    renderControls();
    renderOverlay();
    renderLog();
  }

  function renderHud() {
    const my = teamOf(mySeat);
    $('score-us').querySelector('.value').textContent = state.score[my];
    $('score-them').querySelector('.value').textContent = state.score[1 - my];

    // Tricks taken this hand, per team — three of these is the hand.
    const teamTricks = [0, 1].map((t) =>
      state.tricksWon.reduce((sum, n, seat) => sum + (teamOf(seat) === t ? n : 0), 0));
    $('score-us').querySelector('.tricks').textContent = '●'.repeat(teamTricks[my]);
    $('score-them').querySelector('.tricks').textContent = '●'.repeat(teamTricks[1 - my]);

    const badge = $('trump-badge');
    if (state.trump) {
      badge.hidden = false;
      const s = badge.querySelector('.t-suit');
      s.textContent = SUIT_SYMBOL[state.trump];
      s.className = 't-suit' + (RED[state.trump] ? ' red' : '');
      s.dataset.suit = state.trump;

      // Say out loud whose call this is — it is the whole story of the hand.
      const caller = badge.querySelector('.t-caller');
      if (state.maker === null || state.maker === undefined) {
        caller.textContent = '';
        caller.className = 't-caller';
      } else {
        const ours = teamOf(state.maker) === my;
        const who = state.maker === mySeat ? 'You' : state.names[state.maker];
        caller.textContent = `${who} called it${state.alone ? ' — alone' : ''}`;
        caller.className = 't-caller ' + (ours ? 'ours' : 'theirs');
      }
    } else {
      badge.hidden = true;
    }
  }

  function renderSeats() {
    for (let seat = 0; seat < 4; seat++) {
      const pos = positionOf(seat);
      const el = document.querySelector(`.seat.${pos}`);
      const tag = el.querySelector('.tag');
      const marks = el.querySelector('.marks');
      const backs = el.querySelector('.backs');
      const slot = document.querySelector(`#trick-area .tslot.${pos}`);

      const isMe = seat === mySeat;
      const isPartner = seat === (mySeat + 2) % 4;
      const out = state.sittingOut === seat;
      const pips = '●'.repeat(state.tricksWon[seat]);

      // Pill: identity only. Marks line: whatever is true this hand.
      const name = escapeHtml(isMe ? 'You' : state.names[seat]);
      tag.innerHTML = `<span>${name}</span>` +
        (seat === state.dealer ? '<span class="badge">D</span>' : '');
      tag.className = 'tag' +
        (seat === state.turn && !out ? ' active' : '') +
        (isPartner ? ' partner' : '') +
        (out ? ' dim' : '');

      const markBits = [];
      if (seat === state.maker) {
        markBits.push(`<span class="badge">${state.alone ? 'ALONE' : 'MAKER'}</span>`);
      }
      if (out) markBits.push('<span class="off">sitting out</span>');
      if (pips) markBits.push(`<span class="pips" title="tricks taken">${pips}</span>`);
      marks.innerHTML = markBits.join('');
      marks.className = 'marks' + (out ? ' dim' : '');

      if (backs) {
        const n = out ? 0 : state.handCounts[seat];
        backs.innerHTML = '<i></i>'.repeat(n);
      }

      const play = state.trick.find((p) => p.seat === seat);
      slot.innerHTML = '';
      if (play) {
        const won = state.trickWinner === seat;
        slot.appendChild(cardEl(play.card, won ? 'winner' : ''));
      }
    }
  }

  function renderCentre() {
    const area = $('upcard-area');
    if (state.upcard) {
      area.hidden = false;
      const holder = $('upcard');
      if (holder.dataset.card !== state.upcard) {
        holder.innerHTML = '';
        holder.appendChild(cardEl(state.upcard));
        holder.dataset.card = state.upcard;
      }
    } else {
      area.hidden = true;
      $('upcard').dataset.card = '';
    }

    const note = $('trick-note');
    if (state.trickWinner !== null && state.trickWinner !== undefined) {
      note.textContent = state.trickWinner === mySeat
        ? 'You take it'
        : `${state.names[state.trickWinner]} takes it`;
    } else if (state.phase === 'bid2' && state.turnedDownSuit) {
      note.textContent = `${SUIT_NAME[state.turnedDownSuit]} turned down`;
    } else {
      note.textContent = '';
    }
  }

  function renderHand() {
    const wrap = $('hand');
    const actions = state.you?.actions;
    const selectable = actions && (actions.type === 'play' || actions.type === 'discard');
    const allowed = selectable ? actions.cards : [];

    wrap.innerHTML = '';
    for (const card of state.you.hand) {
      const isTrump = state.trump && effectiveSuit(card, state.trump) === state.trump;
      const ok = allowed.includes(card);
      const el = cardEl(card, (isTrump ? 'trump-card ' : '') + (selectable ? (ok ? 'playable' : 'dead') : ''));
      if (selectable && ok) {
        el.onclick = () => {
          if (actions.type === 'play') act({ kind: 'play', card });
          else act({ kind: 'discard', card });
        };
      }
      wrap.appendChild(el);
    }
  }

  function effectiveSuit(card, trump) {
    const sameColor = { S: 'C', C: 'S', H: 'D', D: 'H' };
    if (card[0] === 'J' && card[1] === sameColor[trump]) return trump;
    return card[1];
  }

  function renderControls() {
    const actions = state.you?.actions;
    const panel = $('bid-panel');
    const prompt = $('prompt');
    const suits = $('bid-suits');
    const orderBtn = $('bid-order');
    const passBtn = $('bid-pass');

    suits.innerHTML = '';
    panel.hidden = true;
    prompt.className = 'prompt';

    // During the trick pause the gold note in the middle already says who won.
    if (state.phase === 'gameOver' || state.phase === 'handOver' ||
        state.phase === 'trickComplete') {
      prompt.textContent = '';
      return;
    }

    if (!actions) {
      const who = state.names[state.turn];
      prompt.className = 'prompt waiting';
      prompt.textContent = state.sittingOut === mySeat
        ? 'You are sitting this hand out'
        : `Waiting for ${who}…`;
      return;
    }

    if (actions.type === 'play') {
      prompt.textContent = 'Your turn — play a card';
      return;
    }

    if (actions.type === 'discard') {
      prompt.textContent = 'Pick a card to discard';
      return;
    }

    panel.hidden = false;
    $('alone').checked = false;

    if (actions.type === 'bid1') {
      prompt.textContent = actions.isDealer
        ? 'Take it up, or pass?'
        : `Order up ${SUIT_NAME[state.upcard[1]]}?`;
      orderBtn.hidden = false;
      orderBtn.textContent = actions.isDealer ? 'Pick it up' : 'Order it up';
      orderBtn.onclick = () => act({ kind: 'bid1', order: true, alone: $('alone').checked });
      passBtn.disabled = !actions.canPass;
      passBtn.onclick = () => act({ kind: 'bid1', order: false });
    } else {
      prompt.textContent = 'Name a trump suit';
      orderBtn.hidden = true;
      for (const s of actions.suits) {
        const b = document.createElement('button');
        b.className = RED[s] ? 'red' : '';
        b.dataset.suit = s;
        b.textContent = SUIT_SYMBOL[s];
        b.onclick = () => act({ kind: 'bid2', suit: s, alone: $('alone').checked });
        suits.appendChild(b);
      }
      passBtn.disabled = !actions.canPass;
      passBtn.onclick = () => act({ kind: 'bid2', suit: null });
    }
  }

  function renderOverlay() {
    const ov = $('overlay');
    const s = state.lastHandSummary;

    if (state.phase === 'gameOver') {
      const my = teamOf(mySeat);
      const won = state.score[my] > state.score[1 - my];
      ov.hidden = false;
      $('ov-title').textContent = won ? 'You win!' : 'They win';
      $('ov-body').textContent = `${state.score[my]}–${state.score[1 - my]}`;
      $('ov-tricks').textContent = '';
      $('ov-btn').disabled = false;
      $('ov-btn').textContent = 'Play again';
      $('ov-btn').onclick = () => act({ kind: 'newGame' });
      return;
    }

    if (state.phase === 'handOver' && s) {
      const my = teamOf(mySeat);
      const weMade = s.makerTeam === my;
      const weScored = s.scoringTeam === my;
      ov.hidden = false;

      let title;
      if (s.reason === 'euchred!') title = weScored ? 'Euchred them!' : 'Euchred';
      else if (s.points === 4) title = weScored ? 'Loner — four!' : 'Loner against you';
      else if (s.points === 2) title = weScored ? 'All five!' : 'They swept it';
      else title = weScored ? 'Made it' : 'They made it';

      const maker = s.maker === mySeat ? 'You' : state.names[s.maker];
      $('ov-title').textContent = title;
      $('ov-body').textContent =
        `${maker} called ${SUIT_NAME[s.trump]}${s.alone ? ' alone' : ''} and took ` +
        `${s.makerTricks} of 5. ${weScored ? 'You' : 'They'} score ${s.points}.`;

      // The next hand is dealt only when both of you have pressed, so take as
      // long as you like reading the result.
      const ready = state.ready || [];
      const iAmReady = ready.includes(mySeat);
      const others = otherHumans();
      const waitingOn = others.filter((s) => !ready.includes(s));
      const alsoReady = others.filter((s) => ready.includes(s));
      const waitingText = () => {
        if (!waitingOn.length) return 'Dealing…';
        if (waitingOn.length === 1) return `Waiting for ${state.names[waitingOn[0]]}…`;
        return `Waiting for ${waitingOn.length} others…`;
      };

      $('ov-tricks').textContent = `Score: ${state.score[my]}–${state.score[1 - my]}` +
        (alsoReady.length && !iAmReady
          ? ` · ${alsoReady.map((s) => state.names[s]).join(', ')} ready`
          : '');

      const btn = $('ov-btn');
      btn.disabled = iAmReady;
      btn.textContent = iAmReady ? waitingText() : 'Next hand';
      btn.onclick = () => {
        btn.disabled = true;
        btn.textContent = waitingText();
        act({ kind: 'nextHand' });
      };
      return;
    }

    ov.hidden = true;
  }

  function renderLog() {
    $('drawer-room').textContent = state.room || roomCode || '';
    const others = otherHumans();
    $('drawer-conn').textContent = others.length === 0
      ? 'solo against 3 bots'
      : others
          .map((s) => `${state.names[s]} ${state.connected?.[s] === false ? 'offline' : 'online'}`)
          .join(' · ');

    const log = $('log');
    log.innerHTML = (state.log || []).map((l) => `<div>${escapeHtml(l)}</div>`).join('');
    log.scrollTop = log.scrollHeight;
  }

  const escapeHtml = (s) =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------------ chat

  function addChat(entry) {
    const el = document.createElement('div');
    el.className = 'msg' + (entry.seat === mySeat ? ' mine' : '');
    el.innerHTML = `<span class="who">${escapeHtml(entry.from)}</span>${escapeHtml(entry.text)}`;
    const box = $('chat');
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  // ------------------------------------------------------- card appearance

  const LOOK = {
    cards: store.get('cardStyle', 'bold') || 'bold',
    suits: store.get('suitColors', 'classic') || 'classic',
  };

  function applyLook() {
    document.body.dataset.cards = LOOK.cards;
    document.body.dataset.suits = LOOK.suits;
    for (const [id, key] of [['opt-cards', 'cards'], ['opt-suits', 'suits']]) {
      for (const b of $(id).querySelectorAll('button')) {
        b.classList.toggle('on', b.dataset.v === LOOK[key]);
      }
    }
    // A live sample: one of each suit, a bower, and a ten.
    const preview = $('card-preview');
    preview.innerHTML = '';
    for (const c of ['JS', 'AH', 'TD', 'QC']) preview.appendChild(cardEl(c));
    if (state) renderHand();
  }

  $('opt-cards').onclick = (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (!v) return;
    LOOK.cards = v;
    store.set('cardStyle', v);
    applyLook();
  };
  $('opt-suits').onclick = (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (!v) return;
    LOOK.suits = v;
    store.set('suitColors', v);
    applyLook();
  };

  applyLook();

  $('menu-btn').onclick = () => {
    $('drawer').hidden = false;
    $('chat').scrollTop = $('chat').scrollHeight;
    $('log').scrollTop = $('log').scrollHeight;
  };
  $('drawer-close').onclick = () => ($('drawer').hidden = true);
  $('chat-form').onsubmit = (e) => {
    e.preventDefault();
    const text = $('chat-input').value.trim();
    if (!text) return;
    send({ type: 'chat', text });
    $('chat-input').value = '';
  };

  // --------------------------------------------------------------- start up

  // Phones suspend sockets when the screen locks; wake straight back up.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && pendingJoin && (!ws || ws.readyState > WebSocket.OPEN)) connect();
  });

  const urlRoom = new URLSearchParams(location.search).get('room');
  const last = store.get('lastRoom');
  const savedName = store.get('name', '');

  if (urlRoom) {
    $('code').value = urlRoom.toUpperCase();
    if (savedName) doJoin(urlRoom.toUpperCase());
  } else if (last && savedName && Date.now() - last.at < 12 * 60 * 60 * 1000) {
    doJoin(last.code);
  }
})();
