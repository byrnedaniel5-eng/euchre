/* Yahtzee renderer.
 *
 * Dice across the top, the score sheet below with a column per player. On
 * your turn your column fills with what each open box would score with the
 * dice as they lie; tap one to pick it, then confirm — a box is filled for
 * good, so it takes two taps.
 *
 * Holding a die is sent to the server as you tap it, so everyone else sees
 * which dice you are keeping; the roll carries the holds too, so a tap that
 * is still in flight cannot be lost.
 */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
  const LOWER = ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'];
  const LABEL = {
    ones: 'Ones', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes',
    threeKind: '3 of a kind', fourKind: '4 of a kind', fullHouse: 'Full house',
    smallStraight: 'Sm. straight', largeStraight: 'Lg. straight', yahtzee: 'Yahtzee', chance: 'Chance',
  };
  // Pip positions on a 3×3 grid, numbered 1..9 left to right, top to bottom.
  const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

  let state = null;
  let ctx = null;
  let held = [false, false, false, false, false];
  let picked = null;
  let seenRoll = 0;

  const face = (n) => `<span class="pips">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) =>
    `<i${PIPS[n]?.includes(p) ? ' class="on"' : ''}></i>`).join('')}</span>`;

  function render(s, c) {
    state = s;
    ctx = c;
    const mine = s.yourTurn;
    // The server's holds are the truth except while it is my turn to set them.
    if (!mine || s.rollNo !== seenRoll || s.rollsLeft === 3) held = s.held.slice();
    const rolled = s.rollNo !== seenRoll;
    seenRoll = s.rollNo;
    if (!mine || !(picked in s.options)) picked = null;

    const turnsDone = Math.min(...s.sheets.map((sh) => [...UPPER, ...LOWER].filter((k) => sh[k] !== null).length));
    $('yz-round').textContent = `Turn ${Math.min(13, turnsDone + 1)}/13`;
    $('yz-status').textContent = s.phase === 'gameOver' ? 'Final scores'
      : mine ? (s.rollsLeft === 3 ? 'Your roll' : s.rollsLeft === 0 ? 'Pick a box' : 'Hold, then roll')
      : `${s.names[s.turn]} is rolling`;

    // Dice.
    $('yz-dice').innerHTML = s.dice.map((d, i) => {
      const cls = ['yz-die'];
      if (!d) cls.push('blank');
      if (held[i]) cls.push('held');
      if (rolled && !held[i] && d) cls.push('tumble');
      if (mine && s.rollsLeft > 0 && s.rollsLeft < 3) cls.push('live');
      return `<button class="${cls.join(' ')}" data-die="${i}" style="--k:${i}">${d ? face(d) : ''}<em>held</em></button>`;
    }).join('');

    // Roll and score buttons.
    const roll = $('yz-roll');
    roll.hidden = !mine || s.rollsLeft === 0;
    roll.disabled = held.every(Boolean);
    roll.textContent = s.rollsLeft === 3 ? 'Roll' : `Roll again (${s.rollsLeft} left)`;
    const score = $('yz-score');
    score.hidden = !mine || picked === null;
    if (picked !== null) score.textContent = `Score ${s.options[picked]} in ${LABEL[picked]}`;

    renderSheet();
    renderOverlay();
  }

  function renderSheet() {
    const s = state;
    const me = ctx.seat;
    const cols = s.names.map((n, i) => i);
    const head = `<tr><th></th>${cols.map((i) =>
      `<th class="${i === s.turn && s.phase === 'playing' ? 'now' : ''}">${ctx.escapeHtml(i === me ? 'You' : n(i))}</th>`).join('')}</tr>`;
    function n(i) { return s.names[i].length > 6 ? `${s.names[i].slice(0, 5)}…` : s.names[i]; }

    const last = s.lastScore;
    const row = (cat) => `<tr data-row="${cat}"><td class="lbl">${LABEL[cat]}</td>${cols.map((i) => {
      const v = s.sheets[i][cat];
      if (v !== null) {
        const fresh = last && last.seat === i && last.cat === cat ? ' fresh' : '';
        return `<td class="got${v === 0 ? ' zero' : ''}${fresh}">${v}</td>`;
      }
      if (i === me && s.yourTurn && cat in s.options) {
        return `<td class="maybe${picked === cat ? ' picked' : ''}" data-cat="${cat}">${s.options[cat]}</td>`;
      }
      return '<td></td>';
    }).join('')}</tr>`;

    const sumRow = (label, fn, cls = '') => `<tr class="sum ${cls}"><td class="lbl">${label}</td>${cols.map((i) =>
      `<td>${fn(s.totals[i], s.sheets[i])}</td>`).join('')}</tr>`;

    $('yz-sheet').innerHTML = `<table>
      <thead>${head}</thead>
      <tbody>
        ${UPPER.map(row).join('')}
        ${sumRow('Bonus <i>63+</i>', (t) => (t.bonus ? '+35' : `<span class="prog">${t.upper}</span>`))}
        ${LOWER.map(row).join('')}
        ${sumRow('Yahtzee bonus', (t) => (t.yBonus ? `+${t.yBonus}` : ''))}
        ${sumRow('Total', (t) => t.total, 'total')}
      </tbody></table>`;
  }

  function renderOverlay() {
    const s = state;
    const ov = $('overlay');
    if (s.phase !== 'gameOver') { ov.hidden = true; return; }
    const t = s.totals.map((x) => x.total);
    const best = Math.max(...t);
    const top = t.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    ov.hidden = false;
    $('ov-title').textContent = top.length > 1 ? 'A tie!' : top[0] === ctx.seat ? 'You win!' : `${s.names[top[0]]} wins`;
    $('ov-body').textContent = s.names.map((n, i) => `${i === ctx.seat ? 'You' : n} ${t[i]}`).join(' · ');
    $('ov-tricks').textContent = '';
    $('ov-btn').hidden = false;
    $('ov-btn').disabled = false;
    $('ov-btn').textContent = 'Play again';
    $('ov-btn').onclick = () => ctx.act({ kind: 'newGame' });
  }

  $('yz-dice').addEventListener('click', (e) => {
    const i = e.target.closest('[data-die]')?.dataset.die;
    if (i === undefined || !state?.yourTurn || state.rollsLeft === 0 || state.rollsLeft === 3) return;
    const k = Number(i);
    held[k] = !held[k];
    ctx.act({ kind: 'hold', index: k, on: held[k] });
    render(state, ctx);
  });

  $('yz-roll').onclick = () => {
    picked = null;
    ctx.act({ kind: 'roll', held });
  };

  $('yz-sheet').addEventListener('click', (e) => {
    const cat = e.target.closest('[data-cat]')?.dataset.cat;
    if (!cat || !state?.yourTurn) return;
    picked = picked === cat ? null : cat;
    render(state, ctx);
  });

  $('yz-score').onclick = () => {
    if (!picked) return;
    ctx.act({ kind: 'score', cat: picked });
    picked = null;
  };

  window.registerGame('yahtzee', {
    root: 'game-yahtzee',
    usesCards: false,
    render,
    reset() {
      state = null;
      held = [false, false, false, false, false];
      picked = null;
      seenRoll = 0;
    },
  });
})();
