/* Connect Four renderer.
 *
 * The board is rebuilt from the state each time; the only thing animated is
 * the newest disc, which falls from the top to where it landed. Tapping
 * anywhere in a column drops into it — aiming at the exact empty slot on a
 * phone would be fiddly for no reason.
 */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let state = null;
  let ctx = null;
  let animated = 0; // the move number whose disc has already fallen

  const colour = (seat) => (seat === state.first ? 'red' : 'yellow');

  function render(s, c) {
    state = s;
    ctx = c;
    const me = c.seat;
    const them = 1 - me;
    const name = (seat) => (seat === me ? 'You' : s.names[seat]);

    $('c4-you').className = `c4-chip ${colour(me)}${s.turn === me && s.phase === 'playing' ? ' on' : ''}`;
    $('c4-you').innerHTML = `<i></i><b>${c.escapeHtml(name(me))}</b>`;
    $('c4-them').className = `c4-chip ${colour(them)}${s.turn === them && s.phase === 'playing' ? ' on' : ''}`;
    $('c4-them').innerHTML = `<i></i><b>${c.escapeHtml(name(them))}</b>`;
    $('c4-turn').textContent = s.phase === 'gameOver'
      ? (s.winner === null ? 'Draw' : `${name(s.winner)} won`)
      : s.yourTurn ? 'Your move' : `${s.names[s.turn]}…`;

    // Columns, so a tap anywhere in one is a drop into it. Row 0 is the
    // bottom, which in the DOM means building each column top-down.
    const line = new Set(s.line || []);
    const last = s.lastMove;
    const cols = [];
    for (let col = 0; col < s.cols; col++) {
      const cells = [];
      for (let row = s.rows - 1; row >= 0; row--) {
        const cell = row * s.cols + col;
        const v = s.board[cell];
        let cls = 'c4-cell';
        if (v !== -1) cls += ` ${colour(v)}`;
        if (line.has(cell)) cls += ' win';
        let style = '';
        if (last && last.cell === cell && last.n !== animated) {
          cls += ' drop';
          style = ` style="--fall:${s.rows - row}"`;
        }
        cells.push(`<div class="${cls}"${style}><i></i></div>`);
      }
      const full = s.board[(s.rows - 1) * s.cols + col] !== -1;
      cols.push(`<div class="c4-col${s.yourTurn && !full ? ' live' : ''}" data-col="${col}">${cells.join('')}</div>`);
    }
    $('c4-board').innerHTML = cols.join('');
    if (last) animated = last.n;

    $('c4-hint').textContent = s.phase === 'gameOver'
      ? ''
      : s.yourTurn ? 'Tap a column to drop a disc.' : '';

    renderOverlay();
  }

  function renderOverlay() {
    const ov = $('overlay');
    if (state.phase !== 'gameOver') { ov.hidden = true; return; }
    // Let the winning line be seen before the card covers it.
    if (!renderOverlay.shownFor || renderOverlay.shownFor !== state.lastMove?.n) {
      renderOverlay.shownFor = state.lastMove?.n;
      ov.hidden = true;
      clearTimeout(renderOverlay.t);
      renderOverlay.t = setTimeout(() => { if (state.phase === 'gameOver') showOverlay(); }, 1400);
      return;
    }
    showOverlay();
  }

  function showOverlay() {
    const s = state;
    const won = s.winner === ctx.seat;
    $('overlay').hidden = false;
    $('ov-title').textContent = s.winner === null ? 'A draw' : won ? 'Four in a row!' : `${s.names[s.winner]} wins`;
    $('ov-body').textContent = s.winner === null
      ? 'Forty-two discs and nobody got four.'
      : won ? 'Nicely done.' : 'They got there first.';
    $('ov-tricks').textContent = 'Whoever went second starts the next one.';
    $('ov-btn').hidden = false;
    $('ov-btn').disabled = false;
    $('ov-btn').textContent = 'Play again';
    $('ov-btn').onclick = () => ctx.act({ kind: 'newGame' });
    // The shell adds the all-time line; it needs telling once we are visible.
    window.dispatchEvent(new Event('overlay-shown'));
  }

  $('c4-board').onclick = (e) => {
    const col = e.target.closest('[data-col]')?.dataset.col;
    if (col === undefined || !state?.yourTurn) return;
    ctx.act({ kind: 'drop', col: Number(col) });
  };

  window.registerGame('connect4', {
    root: 'game-connect4',
    usesCards: false,
    render,
    reset() {
      state = null;
      animated = 0;
      renderOverlay.shownFor = null;
      clearTimeout(renderOverlay.t);
    },
  });
})();
