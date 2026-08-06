/* Euchre renderer. Draws server state; sends intents. Never decides a rule. */

(() => {
  'use strict';

  const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  const SAME_COLOR = { S: 'C', C: 'S', H: 'D', D: 'H' };
  const RED = { H: true, D: true };
  const $ = (id) => document.getElementById(id);

  const teamOf = (seat) => seat % 2;
  let state = null;
  let ctx = null;

  const humanSeats = () => Array.from({ length: state?.humans ?? 2 }, (_, i) => i);
  const otherHumans = () => humanSeats().filter((s) => s !== ctx.seat);

  /** Screen position of a seat, from this player's point of view. */
  const positionOf = (seat) => ['bottom', 'left', 'top', 'right'][(seat - ctx.seat + 4) % 4];

  function effectiveSuit(card, trump) {
    if (card[0] === 'J' && card[1] === SAME_COLOR[trump]) return trump;
    return card[1];
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

  // ------------------------------------------------------- card appearance

  const LOOK = {
    cards: ctxSafeGet('cardStyle', 'bold'),
    suits: ctxSafeGet('suitColors', 'classic'),
  };
  function ctxSafeGet(k, d) {
    try { return JSON.parse(localStorage.getItem('euchre.' + k)) || d; } catch { return d; }
  }
  function saveLook(k, v) {
    try { localStorage.setItem('euchre.' + k, JSON.stringify(v)); } catch { /* private mode */ }
  }

  function applyLook() {
    document.body.dataset.cards = LOOK.cards;
    document.body.dataset.suits = LOOK.suits;
    for (const [id, key] of [['opt-cards', 'cards'], ['opt-suits', 'suits']]) {
      for (const b of $(id).querySelectorAll('button')) {
        b.classList.toggle('on', b.dataset.v === LOOK[key]);
      }
    }
    const preview = $('card-preview');
    preview.innerHTML = '';
    for (const c of ['JS', 'AH', 'TD', 'QC']) preview.appendChild(cardEl(c));
    if (state) renderHand();
  }

  $('opt-cards').onclick = (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (!v) return;
    LOOK.cards = v;
    saveLook('cardStyle', v);
    applyLook();
  };
  $('opt-suits').onclick = (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (!v) return;
    LOOK.suits = v;
    saveLook('suitColors', v);
    applyLook();
  };
  applyLook();

  // ----------------------------------------------------------------- render

  function render(s, c) {
    state = s;
    ctx = c;
    renderHud();
    renderSeats();
    renderCentre();
    renderHand();
    renderControls();
    renderOverlay();
  }

  function renderHud() {
    const my = teamOf(ctx.seat);
    $('score-us').querySelector('.value').textContent = state.score[my];
    $('score-them').querySelector('.value').textContent = state.score[1 - my];

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

      const caller = badge.querySelector('.t-caller');
      if (state.maker === null || state.maker === undefined) {
        caller.textContent = '';
        caller.className = 't-caller';
      } else {
        const ours = teamOf(state.maker) === my;
        const who = state.maker === ctx.seat ? 'You' : state.names[state.maker];
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
      const el = document.querySelector(`#game-euchre .seat.${pos}`);
      const tag = el.querySelector('.tag');
      const marks = el.querySelector('.marks');
      const backs = el.querySelector('.backs');
      const slot = document.querySelector(`#trick-area .tslot.${pos}`);

      const isMe = seat === ctx.seat;
      const isPartner = seat === (ctx.seat + 2) % 4;
      const out = state.sittingOut === seat;
      const pips = '●'.repeat(state.tricksWon[seat]);

      const name = ctx.escapeHtml(isMe ? 'You' : state.names[seat]);
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

      if (backs) backs.innerHTML = '<i></i>'.repeat(out ? 0 : state.handCounts[seat]);

      const play = state.trick.find((p) => p.seat === seat);
      slot.innerHTML = '';
      if (play) slot.appendChild(cardEl(play.card, state.trickWinner === seat ? 'winner' : ''));
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
      note.textContent = state.trickWinner === ctx.seat
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
      const el = cardEl(card, (isTrump ? 'trump-card ' : '') +
        (selectable ? (ok ? 'playable' : 'dead') : ''));
      if (selectable && ok) {
        el.onclick = () => ctx.act({ kind: actions.type === 'play' ? 'play' : 'discard', card });
      }
      wrap.appendChild(el);
    }
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

    if (['gameOver', 'handOver', 'trickComplete'].includes(state.phase)) {
      prompt.textContent = '';
      return;
    }

    if (!actions) {
      prompt.className = 'prompt waiting';
      prompt.textContent = state.sittingOut === ctx.seat
        ? 'You are sitting this hand out'
        : `Waiting for ${state.names[state.turn]}…`;
      return;
    }

    if (actions.type === 'play') { prompt.textContent = 'Your turn — play a card'; return; }
    if (actions.type === 'discard') { prompt.textContent = 'Pick a card to discard'; return; }

    panel.hidden = false;
    $('alone').checked = false;

    if (actions.type === 'bid1') {
      prompt.textContent = actions.isDealer
        ? 'Take it up, or pass?'
        : `Order up ${SUIT_NAME[state.upcard[1]]}?`;
      orderBtn.hidden = false;
      orderBtn.textContent = actions.isDealer ? 'Pick it up' : 'Order it up';
      orderBtn.onclick = () => ctx.act({ kind: 'bid1', order: true, alone: $('alone').checked });
      passBtn.disabled = !actions.canPass;
      passBtn.onclick = () => ctx.act({ kind: 'bid1', order: false });
    } else {
      prompt.textContent = 'Name a trump suit';
      orderBtn.hidden = true;
      for (const s of actions.suits) {
        const b = document.createElement('button');
        b.className = RED[s] ? 'red' : '';
        b.dataset.suit = s;
        b.textContent = SUIT_SYMBOL[s];
        b.onclick = () => ctx.act({ kind: 'bid2', suit: s, alone: $('alone').checked });
        suits.appendChild(b);
      }
      passBtn.disabled = !actions.canPass;
      passBtn.onclick = () => ctx.act({ kind: 'bid2', suit: null });
    }
  }

  function renderOverlay() {
    const ov = $('overlay');
    const s = state.lastHandSummary;
    const my = teamOf(ctx.seat);

    if (state.phase === 'gameOver') {
      const won = state.score[my] > state.score[1 - my];
      ov.hidden = false;
      $('ov-title').textContent = won ? 'You win!' : 'They win';
      $('ov-body').textContent = `${state.score[my]}–${state.score[1 - my]}`;
      $('ov-tricks').textContent = '';
      $('ov-btn').disabled = false;
      $('ov-btn').textContent = 'Play again';
      $('ov-btn').onclick = () => ctx.act({ kind: 'newGame' });
      return;
    }

    if (state.phase === 'handOver' && s) {
      const weScored = s.scoringTeam === my;
      ov.hidden = false;

      let title;
      if (s.reason === 'euchred!') title = weScored ? 'Euchred them!' : 'Euchred';
      else if (s.points === 4) title = weScored ? 'Loner — four!' : 'Loner against you';
      else if (s.points === 2) title = weScored ? 'All five!' : 'They swept it';
      else title = weScored ? 'Made it' : 'They made it';

      const maker = s.maker === ctx.seat ? 'You' : state.names[s.maker];
      $('ov-title').textContent = title;
      $('ov-body').textContent =
        `${maker} called ${SUIT_NAME[s.trump]}${s.alone ? ' alone' : ''} and took ` +
        `${s.makerTricks} of 5. ${weScored ? 'You' : 'They'} score ${s.points}.`;

      const ready = state.ready || [];
      const iAmReady = ready.includes(ctx.seat);
      const others = otherHumans();
      const waitingOn = others.filter((x) => !ready.includes(x));
      const alsoReady = others.filter((x) => ready.includes(x));
      const waitingText = () => {
        if (!waitingOn.length) return 'Dealing…';
        if (waitingOn.length === 1) return `Waiting for ${state.names[waitingOn[0]]}…`;
        return `Waiting for ${waitingOn.length} others…`;
      };

      $('ov-tricks').textContent = `Score: ${state.score[my]}–${state.score[1 - my]}` +
        (alsoReady.length && !iAmReady
          ? ` · ${alsoReady.map((x) => state.names[x]).join(', ')} ready` : '');

      const btn = $('ov-btn');
      btn.disabled = iAmReady;
      btn.textContent = iAmReady ? waitingText() : 'Next hand';
      btn.onclick = () => {
        btn.disabled = true;
        btn.textContent = waitingText();
        ctx.act({ kind: 'nextHand' });
      };
      return;
    }

    ov.hidden = true;
  }

  window.registerGame('euchre', {
    root: 'game-euchre',
    usesCards: true,
    render,
    reset() { state = null; },
  });
})();
