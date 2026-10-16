/* Word Race renderer.
 *
 * Your board, a keyboard that remembers what each letter has shown, and
 * everyone else as little grids of colour. What you are typing lives here
 * until the server accepts it; a word it rejects stays on the row so you can
 * fix one letter rather than retype five.
 */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ROWS = ['qwertyuiop', 'asdfghjkl', '>zxcvbnm<']; // > enter, < delete
  const RANK = { '.': 1, y: 2, g: 3 };

  let state = null;
  let ctx = null;
  let typed = '';
  let seenRows = 0;   // my rows already flipped
  let round = 0;

  const mine = () => state.boards[ctx.seat];
  const finished = () => state.done[ctx.seat];

  function render(s, c) {
    state = s;
    ctx = c;
    if (s.round !== round) {
      round = s.round;
      typed = '';
      seenRows = 0;
    }
    const rows = mine();
    // Accepted: the row is now the server's, so clear what was typed.
    if (rows.length > seenRows && typed && rows[rows.length - 1].word === typed) typed = '';

    $('wr-round').textContent = `Word ${s.round}/${s.totalWords}`;
    $('wr-score').textContent = `${s.scores[c.seat]} pts`;
    $('wr-status').textContent = s.phase === 'playing'
      ? (s.solvedAt[c.seat] !== null ? 'Solved!' : finished() ? 'Out of guesses' : `Guess ${rows.length + 1} of 6`)
      : s.phase === 'reveal' ? 'Round over' : 'All done';

    renderOthers();
    renderBoard(rows);
    renderKeys(rows);

    const ans = $('wr-answer');
    ans.hidden = !s.answer;
    if (s.answer) {
      ans.innerHTML = `<b>${s.answer.toUpperCase()}</b>${s.roundPoints
        ? `<span>${s.names.map((n, i) => `${c.escapeHtml(i === c.seat ? 'You' : n)} +${s.roundPoints[i]}`).join(' · ')}</span>` : ''}`;
    }

    const next = $('wr-next');
    next.hidden = s.phase !== 'reveal';
    if (s.phase === 'reveal') {
      const ready = s.ready.includes(c.seat);
      next.disabled = ready;
      next.textContent = ready ? 'Waiting…' : s.round >= s.totalWords ? 'See the result' : 'Next word';
    }
    $('wr-keys').hidden = s.phase !== 'playing';

    renderOverlay();
  }

  function renderOthers() {
    const s = state;
    const open = s.phase !== 'playing';
    const others = s.names.map((n, i) => i).filter((i) => i !== ctx.seat);
    $('wr-others').hidden = others.length === 0;
    $('wr-others').innerHTML = others.map((i) => {
      const b = s.boards[i];
      const grid = Array.from({ length: 6 }, (_, r) => {
        const row = b[r];
        return `<div class="wr-mrow">${Array.from({ length: 5 }, (_, k) =>
          `<i class="${row ? `m-${row.marks[k] === '.' ? 'x' : row.marks[k]}` : ''}">${open && row ? row.word[k] : ''}</i>`).join('')}</div>`;
      }).join('');
      const tag = s.solvedAt[i] !== null ? `${b.length}/6 ✓` : s.done[i] ? 'X/6' : `${b.length}/6`;
      return `<div class="wr-other${open ? ' open' : ''}">
        <div class="wr-mini">${grid}</div>
        <span><b>${ctx.escapeHtml(s.names[i])}</b>${tag}${i === s.firstSolver ? ' ⚡' : ''}</span>
      </div>`;
    }).join('');
  }

  function renderBoard(rows) {
    const out = [];
    for (let r = 0; r < 6; r++) {
      const row = rows[r];
      let cls = 'wr-row';
      let cells;
      if (row) {
        const flip = r >= seenRows;
        cells = [...row.word].map((ch, k) =>
          `<i class="t m-${row.marks[k] === '.' ? 'x' : row.marks[k]}${flip ? ' flip' : ''}" style="--k:${k}">${ch}</i>`);
      } else if (r === rows.length && state.phase === 'playing' && !finished()) {
        cls += ' current';
        cells = Array.from({ length: 5 }, (_, k) => `<i class="t${typed[k] ? ' typed' : ''}">${typed[k] || ''}</i>`);
      } else {
        cells = Array.from({ length: 5 }, () => '<i class="t"></i>');
      }
      out.push(`<div class="${cls}">${cells.join('')}</div>`);
    }
    $('wr-board').innerHTML = out.join('');
    seenRows = rows.length;
  }

  function renderKeys(rows) {
    const best = {};
    for (const row of rows) {
      [...row.word].forEach((ch, k) => {
        const m = row.marks[k];
        if (!best[ch] || RANK[m] > RANK[best[ch]]) best[ch] = m;
      });
    }
    $('wr-keys').innerHTML = ROWS.map((r) => `<div class="wr-krow">${[...r].map((k) => {
      if (k === '>') return '<button class="wr-key wide" data-key="enter">Enter</button>';
      if (k === '<') return '<button class="wr-key wide" data-key="back" aria-label="Delete">⌫</button>';
      const m = best[k];
      return `<button class="wr-key${m ? ` m-${m === '.' ? 'x' : m}` : ''}" data-key="${k}">${k}</button>`;
    }).join('')}</div>`).join('');
  }

  function renderOverlay() {
    const s = state;
    const ov = $('overlay');
    if (s.phase !== 'gameOver') { ov.hidden = true; return; }
    ov.hidden = false;
    const best = Math.max(...s.scores);
    const top = s.scores.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    $('ov-title').textContent = s.players === 1 ? `${best} points`
      : top.length > 1 ? 'Dead heat' : top[0] === ctx.seat ? 'Fastest brain' : `${s.names[top[0]]} wins`;
    $('ov-body').textContent = s.names.map((n, i) => `${i === ctx.seat ? 'You' : n} ${s.scores[i]}`).join(' · ');
    $('ov-tricks').textContent = 'A solve scores 7 minus guesses; first to solve gets +1.';
    $('ov-btn').hidden = false;
    $('ov-btn').disabled = false;
    $('ov-btn').textContent = 'Play again';
    $('ov-btn').onclick = () => ctx.act({ kind: 'newGame' });
  }

  // ----------------------------------------------------------------- input

  function press(key) {
    if (!state || state.phase !== 'playing' || finished()) return;
    if (key === 'enter') {
      if (typed.length !== 5) return ctx.toast('Five letters.');
      ctx.act({ kind: 'guess', word: typed });
      return;
    }
    if (key === 'back') typed = typed.slice(0, -1);
    else if (/^[a-z]$/.test(key) && typed.length < 5) typed += key;
    renderBoard(mine());
  }

  $('wr-keys').addEventListener('click', (e) => {
    const k = e.target.closest('[data-key]')?.dataset.key;
    if (k) press(k);
  });

  // A laptop keyboard works too, but only while this game is on screen.
  document.addEventListener('keydown', (e) => {
    if ($('game-wordle').hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.key === 'Enter') press('enter');
    else if (e.key === 'Backspace') press('back');
    else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toLowerCase());
    else return;
    e.preventDefault();
  });

  $('wr-next').onclick = () => ctx.act({ kind: 'next' });

  window.registerGame('wordle', {
    root: 'game-wordle',
    usesCards: false,
    render,
    reset() {
      state = null;
      typed = '';
      seenRows = 0;
      round = 0;
    },
  });
})();
