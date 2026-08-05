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
        if (!state) showJoinError(msg.message);
        else toast(msg.message);
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

  function doJoin(room) {
    const name = $('name').value.trim() || 'Player';
    store.set('name', name);
    pendingJoin = { room: room || null, name };
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

  /** Screen position of a seat, from this player's point of view. */
  function positionOf(seat) {
    return ['bottom', 'left', 'top', 'right'][(seat - mySeat + 4) % 4];
  }

  function cardEl(card, extraClass = '') {
    const el = document.createElement('div');
    el.className = `card ${RED[card[1]] ? 'red' : ''} ${extraClass}`.trim();
    el.innerHTML = `<span class="r">${card[0] === 'T' ? '10' : card[0]}</span>` +
                   `<span class="s">${SUIT_SYMBOL[card[1]]}</span>`;
    el.dataset.card = card;
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
      $('lobby-status').textContent = state.seated.filter(Boolean).length === 1
        ? 'You are in. Waiting for one more…'
        : 'Starting…';
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

    const badge = $('trump-badge');
    if (state.trump) {
      badge.hidden = false;
      const s = badge.querySelector('.t-suit');
      s.textContent = SUIT_SYMBOL[state.trump];
      s.className = 't-suit' + (RED[state.trump] ? ' red' : '');
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
      const otherSeat = 1 - mySeat;
      const theyAreReady = ready.includes(otherSeat);
      const otherName = state.names[otherSeat];

      $('ov-tricks').textContent = `Score: ${state.score[my]}–${state.score[1 - my]}` +
        (theyAreReady && !iAmReady ? ` · ${otherName} is ready` : '');

      const btn = $('ov-btn');
      btn.disabled = iAmReady;
      btn.textContent = iAmReady ? `Waiting for ${otherName}…` : 'Next hand';
      btn.onclick = () => {
        btn.disabled = true;
        btn.textContent = `Waiting for ${otherName}…`;
        act({ kind: 'nextHand' });
      };
      return;
    }

    ov.hidden = true;
  }

  function renderLog() {
    $('drawer-room').textContent = state.room || roomCode || '';
    const other = state.connected ? state.connected[1 - mySeat] : true;
    $('drawer-conn').textContent = other
      ? `${state.names[1 - mySeat]} is connected`
      : `${state.names[1 - mySeat]} is offline`;

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
