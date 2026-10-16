/* Codenames Duet renderer.
 *
 * Every word carries a strip along its foot showing what it is on *your* side
 * of the key — green for one of your agents, black for an assassin, nothing
 * for a bystander. That is the half of the key card you are holding; the
 * other half is on your partner's phone and never on yours until it is over.
 *
 * Guessing is tap, then tap again. One stray thumb on an assassin ends the
 * game for both of you, which is too much to hang on a single touch.
 */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let state = null;
  let ctx = null;
  let aim = null;          // card lined up but not yet guessed
  let number = 1;          // the clue number being chosen
  let flashed = 0;         // the reveal already flashed
  let peek = false;        // overlay dismissed to look at the board

  const me = () => ctx.seat;
  const partner = () => state.names[1 - me()];

  function canTap(i) {
    const s = state;
    if (s.found[i]) return false;
    if (s.phase === 'guess') return s.giver !== me() && !s.neutral[1][i];
    if (s.phase === 'suddenDeath') return s.theirAgentsLeft > 0;
    return false;
  }

  function render(s, c) {
    state = s;
    ctx = c;
    const over = s.phase === 'gameOver';
    const giving = s.phase === 'clue' && s.giver === me();
    const guessing = s.phase === 'guess' && s.giver !== me();

    if (aim !== null && !canTap(aim)) aim = null;
    if (!over) peek = false;

    $('cn-turns').textContent = s.phase === 'suddenDeath' ? 'Sudden death'
      : `${s.turnsLeft} turn${s.turnsLeft === 1 ? '' : 's'}`;
    $('cn-found').textContent = `${s.agentsFound}/${s.agentsTotal}`;
    $('cn-status').textContent = over
      ? (s.result.won ? 'Mission complete' : 'Mission failed')
      : s.phase === 'suddenDeath' ? 'No more clues'
      : giving ? 'Your clue'
      : s.phase === 'clue' ? `${partner()} is thinking…`
      : guessing ? 'Your guess'
      : `${partner()} is guessing…`;

    // The clue, big, for both of you while it is live.
    const clue = $('cn-clue');
    clue.hidden = !s.clue;
    if (s.clue) {
      clue.innerHTML = `<b>${c.escapeHtml(s.clue.word.toUpperCase())}</b><i>${s.clue.number}</i>
        <span>${s.clue.by === me() ? 'your clue' : `from ${c.escapeHtml(partner())}`}${
        s.guessesThisTurn ? ` · ${s.guessesThisTurn} guessed` : ''}</span>`;
    }

    const fresh = s.lastReveal && s.lastReveal.n !== flashed ? s.lastReveal.card : -1;
    if (s.lastReveal) flashed = s.lastReveal.n;

    $('cn-grid').innerHTML = s.words.map((w, i) => {
      const cls = ['cn-card'];
      const mine = s.yourKey[i];
      const theirs = s.theirKey?.[i];
      if (s.found[i]) cls.push('found');
      // Out of play once both sides have shown it to be a bystander.
      else if (s.neutral[0][i] && s.neutral[1][i]) cls.push('dead');
      else if (guessing && s.neutral[1][i]) cls.push('spent');
      if (over && s.result.card === i) cls.push(s.result.reason === 'assassin' ? 'boom' : 'miss');
      if (canTap(i)) cls.push('live');
      if (aim === i) cls.push('aim');
      if (fresh === i) cls.push('flash');
      const tokens = [
        s.neutral[0][i] ? `<em class="tok mine" title="Bystander on your side"></em>` : '',
        s.neutral[1][i] ? `<em class="tok theirs" title="Bystander on ${c.escapeHtml(partner())}'s side"></em>` : '',
      ].join('');
      const bar = over
        ? `<span class="kb two"><i class="k-${mine}"></i><i class="k-${theirs}"></i></span>`
        : `<span class="kb"><i class="k-${mine}"></i></span>`;
      const len = w.length;
      return `<button class="${cls.join(' ')}" data-card="${i}" style="--len:${len}">
        <span class="w">${c.escapeHtml(w)}</span>${tokens}${bar}</button>`;
    }).join('');

    $('cn-legend').innerHTML = over
      ? '<span><i class="k-A"></i>agent</span><span><i class="k-X"></i>assassin</span><span>left: you · right: them</span>'
      : `<span><i class="k-A"></i>your agent · ${s.yourAgentsLeft} left</span><span><i class="k-X"></i>your assassin</span>`;

    // Giving a clue.
    $('cn-give').hidden = !giving;
    if (giving) {
      $('cn-num').innerHTML = Array.from({ length: 10 }, (_, n) =>
        `<button type="button" data-n="${n}"${n === number ? ' class="on"' : ''}>${n}</button>`).join('');
    }

    // Guessing, or waiting.
    const act = $('cn-act');
    act.hidden = giving || (over && !peek);
    const stop = $('cn-stop');
    stop.hidden = true;
    let hint = '';
    if (over) {
      stop.hidden = false;
      stop.disabled = false;
      stop.textContent = 'Play again';
      hint = s.result.won ? 'Every agent home.' : 'Both keys are showing now.';
    } else if (guessing) {
      stop.hidden = false;
      stop.textContent = 'End turn';
      stop.disabled = s.guessesThisTurn === 0;
      hint = aim !== null
        ? `Tap ${s.words[aim].toUpperCase()} again to guess it.`
        : 'Tap a word, then tap it again to guess.';
    } else if (s.phase === 'suddenDeath') {
      hint = s.theirAgentsLeft > 0
        ? `Find ${partner()}'s last ${s.theirAgentsLeft}. Any miss loses — talk it through.`
        : `You have found all of ${partner()}'s. Their tap.`;
    } else if (s.phase === 'guess') {
      hint = 'Your partner is guessing. No hints by face — well, try not to.';
    } else {
      hint = `${partner()} is working out a clue for their agents.`;
    }
    $('cn-hint').textContent = hint;

    renderOverlay();
  }

  function renderOverlay() {
    const ov = $('overlay');
    if (state.phase !== 'gameOver' || peek) { ov.hidden = true; return; }
    const r = state.result;
    ov.hidden = false;
    $('ov-title').textContent = r.won ? 'Mission complete' : 'Mission failed';
    $('ov-body').textContent = r.won
      ? `All fifteen agents found, ${state.turnsTotal - state.turnsLeft} turns used.`
      : r.reason === 'assassin'
        ? `${state.words[r.card].toUpperCase()} was an assassin. ${state.agentsFound} of 15 found.`
        : `${state.words[r.card].toUpperCase()} was not an agent. ${state.agentsFound} of 15 found.`;
    $('ov-tricks').innerHTML = '<button id="cn-peek" class="ghost">See both keys</button>';
    $('cn-peek').onclick = () => { peek = true; render(state, ctx); };
    $('ov-btn').hidden = false;
    $('ov-btn').disabled = false;
    $('ov-btn').textContent = 'Play again';
    $('ov-btn').onclick = () => ctx.act({ kind: 'newGame' });
  }

  $('cn-grid').onclick = (e) => {
    const i = Number(e.target.closest('[data-card]')?.dataset.card);
    if (Number.isNaN(i) || !state || !canTap(i)) return;
    if (aim === i) {
      aim = null;
      ctx.act({ kind: 'guess', card: i });
      return;
    }
    aim = i;
    render(state, ctx);
  };

  $('cn-num').onclick = (e) => {
    const n = e.target.closest('[data-n]')?.dataset.n;
    if (n === undefined) return;
    number = Number(n);
    render(state, ctx);
  };

  $('cn-give').onsubmit = (e) => {
    e.preventDefault();
    const word = $('cn-word').value.trim();
    if (!word) return ctx.toast('Type a one-word clue.');
    if (/\s/.test(word)) return ctx.toast('One word only.');
    ctx.act({ kind: 'clue', word, number });
    $('cn-word').value = '';
    $('cn-word').blur();
  };

  $('cn-stop').onclick = () => {
    if (state.phase === 'gameOver') ctx.act({ kind: 'newGame' });
    else ctx.act({ kind: 'stop' });
  };

  window.registerGame('codenames', {
    root: 'game-codenames',
    usesCards: false,
    render,
    reset() {
      state = null;
      aim = null;
      number = 1;
      flashed = 0;
      peek = false;
    },
  });
})();
