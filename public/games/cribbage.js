/* Cribbage renderer.
 *
 * Cards are the same markup euchre uses, so the card style and suit colours
 * chosen in the menu apply here too. Across the top, two peg lanes to 121
 * with a front and a back peg each, as on a real board. In the middle, the
 * starter and the crib on one side and the cards played since the count was
 * last zero on the other.
 *
 * Throwing to the crib and playing a card are both pick, then confirm: a
 * card in the crib cannot come back.
 */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const RED = { H: true, D: true };
  const value = (c) => Math.min(10, 'A23456789TJQK'.indexOf(c[0]) + 1);

  let state = null;
  let ctx = null;
  let picked = [];
  let seenPeg = 0;

  function card(c, extra = '') {
    const r = c[0] === 'T' ? '10' : c[0];
    const s = c[1];
    const court = 'AKQJ'.includes(c[0]);
    const corner = `<span class="cr">${r}</span><span class="cs">${SYM[s]}</span>`;
    return `<div class="card${RED[s] ? ' red' : ''}${court ? ' court' : ''} ${extra}" data-card="${c}" data-suit="${s}">
      <span class="corner tl">${corner}</span><span class="mid"><span class="r">${r}</span><span class="s">${SYM[s]}</span></span><span class="corner br">${corner}</span></div>`;
  }
  const back = (extra = '') => `<div class="card back ${extra}"></div>`;

  function render(s, c) {
    state = s;
    ctx = c;
    const me = c.seat;
    const them = 1 - me;
    const nm = (i) => (i === me ? 'You' : s.names[i]);
    picked = picked.filter((x) => s.yourHand.includes(x));
    if (s.phase === 'play' && picked.length > 1) picked = picked.slice(-1);
    if (s.phase !== 'discard' && s.phase !== 'play') picked = [];

    // Peg lanes.
    $('cb-board').innerHTML = [me, them].map((i) => {
      const pct = (v) => `${(v / s.target) * 100}%`;
      return `<div class="cb-lane${i === me ? ' mine' : ''}">
        <span class="cb-who">${ctx.escapeHtml(nm(i))}</span>
        <div class="cb-track">
          ${[30, 60, 90].map((m) => `<i class="cb-mark" style="left:${pct(m)}"></i>`).join('')}
          <b class="cb-peg back" style="left:${pct(s.backPegs[i])}"></b>
          <b class="cb-peg" style="left:${pct(s.scores[i])}"></b>
        </div>
        <span class="cb-score">${s.scores[i]}</span>
      </div>`;
    }).join('');

    // Their hand, face down, and whose crib it is.
    $('cb-them').innerHTML = `<span>${ctx.escapeHtml(s.names[them])}${s.dealer === them ? ' · dealer' : ''}${
      s.saidGo?.[them] ? ' · <b>go</b>' : ''}</span><div class="cb-backs">${back().repeat(s.theirCardsLeft)}</div>`;

    $('cb-starter').innerHTML = s.starter
      ? `<span>Starter</span>${card(s.starter)}`
      : `<span>Starter</span>${back('dim')}`;
    $('cb-crib').innerHTML = `<span>${s.dealer === me ? 'Your' : `${ctx.escapeHtml(s.names[s.dealer])}'s`} crib</span>
      <div class="cb-cribcards">${s.cribSize ? back().repeat(Math.min(4, s.cribSize)) : back('dim')}</div>`;

    const inPlay = s.phase === 'play';
    $('cb-count').innerHTML = inPlay || s.pile.length ? `<b>${s.count}</b><span>count</span>` : '';
    $('cb-pile').innerHTML = s.pile.map((x) => {
      const who = s.played.slice().reverse().find((p) => p.card === x)?.seat;
      return card(x, who === me ? 'mine' : 'theirs');
    }).join('');

    // At the show the table has nothing left to say; the counts take its place.
    const showing = !!s.show;
    document.querySelector('.cb-table').hidden = showing;
    $('cb-them').hidden = showing;

    // The latest peg, said out loud.
    const peg = s.lastPeg;
    const shout = $('cb-shout');
    if (showing) shout.hidden = true;
    if (peg && peg.n !== seenPeg && !showing) {
      shout.hidden = false;
      shout.textContent = `${nm(peg.seat)}: ${peg.why} for ${peg.points}`;
      shout.className = `cb-shout ${peg.seat === me ? 'mine' : 'theirs'}`;
      clearTimeout(render.t);
      render.t = setTimeout(() => { shout.hidden = true; }, 2600);
    }
    if (peg) seenPeg = peg.n;

    renderShow();

    // Your hand.
    const live = new Set(s.canPlay);
    $('cb-hand').innerHTML = s.phase === 'show' ? '' : s.yourHand.map((x) => {
      const cls = [];
      if (picked.includes(x)) cls.push('picked');
      if (inPlay && (!s.yourTurn || !live.has(x))) cls.push('dead');
      return card(x, cls.join(' '));
    }).join('');

    // The one button, and the line above it.
    const go = $('cb-go');
    go.hidden = true;
    go.disabled = false;
    let hint = '';
    if (s.phase === 'discard') {
      if (s.youThrew) hint = s.theyThrew ? '' : `Waiting for ${s.names[them]} to throw…`;
      else {
        hint = `Pick two for ${s.dealer === me ? 'your' : `${s.names[s.dealer]}'s`} crib.`;
        go.hidden = false;
        go.disabled = picked.length !== 2;
        go.textContent = picked.length === 2 ? 'Throw to the crib' : `Pick ${2 - picked.length} more`;
      }
    } else if (inPlay) {
      if (s.yourTurn) {
        hint = picked.length ? `Tap it again, or press play.` : 'Your play.';
        go.hidden = !picked.length;
        if (picked.length) go.textContent = `Play it — count ${s.count + value(picked[0])}`;
      } else {
        hint = s.yourHand.length ? `${s.names[them]} to play…` : 'You are out of cards.';
      }
    } else if (s.phase === 'show') {
      const ready = s.ready.includes(me);
      go.hidden = false;
      go.disabled = ready;
      go.textContent = ready ? 'Waiting…' : 'Next hand';
    }
    $('cb-hint').textContent = hint;

    renderOverlay();
  }

  const LABEL = { fifteen: 'fifteen', pair: 'pair', run: 'run', flush: 'flush', nobs: 'his nob' };

  function renderShow() {
    const s = state;
    const box = $('cb-show');
    box.hidden = !s.show;
    if (!s.show) return;
    const me = ctx.seat;
    const part = (p, title) => {
      const items = p.items.length
        ? p.items.map((i) => `<li><span>${LABEL[i.kind]}${i.kind === 'run' ? ` of ${i.points}` : ''}</span><b>${i.points}</b></li>`).join('')
        : '<li><span>nineteen — nothing</span><b>0</b></li>';
      return `<div class="cb-part"><div class="cb-part-head"><b>${title}</b><span>${p.total}</span></div>
        <div class="cb-part-cards">${p.cards.map((x) => card(x)).join('')}<span class="plus">+</span>${card(s.starter, 'starter')}</div>
        <ul>${items}</ul></div>`;
    };
    const whose = (seat, what) => (seat === me ? `Your ${what}` : `${ctx.escapeHtml(s.names[seat])}'s ${what}`);
    box.innerHTML = part(s.show.pone, whose(s.show.pone.seat, 'hand')) +
      part(s.show.dealer, whose(s.show.dealer.seat, 'hand')) +
      part(s.show.crib, whose(s.show.crib.seat, 'crib'));
  }

  function renderOverlay() {
    const s = state;
    const ov = $('overlay');
    if (s.phase !== 'gameOver') { ov.hidden = true; return; }
    ov.hidden = false;
    const won = s.winner === ctx.seat;
    const loser = 1 - s.winner;
    $('ov-title').textContent = won ? 'You pegged out!' : `${s.names[s.winner]} pegged out`;
    $('ov-body').textContent = `${s.scores[s.winner]} – ${s.scores[loser]}` +
      (s.scores[loser] < 91 ? ' · a skunk!' : '');
    $('ov-tricks').textContent = `${s.hand} hand${s.hand === 1 ? '' : 's'}.`;
    $('ov-btn').hidden = false;
    $('ov-btn').disabled = false;
    $('ov-btn').textContent = 'Play again';
    $('ov-btn').onclick = () => ctx.act({ kind: 'newGame' });
  }

  $('cb-hand').addEventListener('click', (e) => {
    const c = e.target.closest('[data-card]')?.dataset.card;
    if (!c || !state) return;
    if (state.phase === 'discard' && !state.youThrew) {
      picked = picked.includes(c) ? picked.filter((x) => x !== c) : [...picked, c].slice(-2);
      return render(state, ctx);
    }
    if (state.phase === 'play' && state.yourTurn && state.canPlay.includes(c)) {
      if (picked[0] === c) {
        picked = [];
        return ctx.act({ kind: 'play', card: c });
      }
      picked = [c];
      return render(state, ctx);
    }
    if (state.phase === 'play' && state.yourTurn) ctx.toast('That would take the count past 31.');
  });

  $('cb-go').onclick = () => {
    if (state.phase === 'discard' && picked.length === 2) {
      ctx.act({ kind: 'discard', cards: picked });
      picked = [];
    } else if (state.phase === 'play' && picked.length) {
      ctx.act({ kind: 'play', card: picked[0] });
      picked = [];
    } else if (state.phase === 'show') {
      ctx.act({ kind: 'next' });
    }
  };

  window.registerGame('cribbage', {
    root: 'game-cribbage',
    usesCards: true,
    render,
    reset() {
      state = null;
      picked = [];
      seenPeg = 0;
    },
  });
})();
