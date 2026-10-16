/* Dots and Boxes renderer.
 *
 * One SVG: paper, boxes, lines, dots, and on top a fat invisible stroke along
 * every undrawn line so a thumb can hit it. Lines are tap-to-aim, tap-again to
 * draw — giving away a box with a stray touch is exactly the mistake this
 * game punishes, so it should never be the app's fault.
 */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const INK = ['#e8414d', '#2f7fd9', '#e0a400', '#2fa35c'];
  const S = 100;  // box size in SVG units
  const P = 22;   // margin round the dots

  let state = null;
  let ctx = null;
  let aim = null;
  let seenMove = 0;

  function ends(e, rows, cols) {
    const H = (rows + 1) * cols;
    if (e < H) {
      const r = Math.floor(e / cols);
      const c = e % cols;
      return [P + c * S, P + r * S, P + (c + 1) * S, P + r * S];
    }
    const k = e - H;
    const r = Math.floor(k / (cols + 1));
    const c = k % (cols + 1);
    return [P + c * S, P + r * S, P + c * S, P + (r + 1) * S];
  }

  function render(s, c) {
    state = s;
    ctx = c;
    const { rows, cols } = s;
    const W = cols * S + 2 * P;
    const Ht = rows * S + 2 * P;
    if (aim !== null && (s.lines[aim] !== -1 || !s.yourTurn)) aim = null;
    const fresh = s.lastLine && s.lastLine.n !== seenMove ? s.lastLine : null;
    if (s.lastLine) seenMove = s.lastLine.n;

    const parts = [];
    parts.push(`<rect class="db-paper" x="0" y="0" width="${W}" height="${Ht}" rx="14"/>`);

    // Boxes, filled in the colour of whoever closed them, with their initial.
    s.owner.forEach((o, b) => {
      if (o === -1) return;
      const r = Math.floor(b / cols);
      const col = b % cols;
      const x = P + col * S;
      const y = P + r * S;
      const pop = fresh?.closed.includes(b) ? ' pop' : '';
      parts.push(`<g class="db-box${pop}">
        <rect x="${x + 6}" y="${y + 6}" width="${S - 12}" height="${S - 12}" rx="8" fill="${INK[o]}" fill-opacity="0.22"/>
        <text x="${x + S / 2}" y="${y + S / 2}" fill="${INK[o]}">${ctx.escapeHtml((s.names[o] || '?')[0].toUpperCase())}</text>
      </g>`);
    });

    // Drawn lines.
    s.lines.forEach((who, e) => {
      if (who === -1) return;
      const [x1, y1, x2, y2] = ends(e, rows, cols);
      const cls = fresh?.edge === e ? 'db-line fresh' : 'db-line';
      parts.push(`<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK[who]}"/>`);
    });

    // The line you have lined up.
    if (aim !== null) {
      const [x1, y1, x2, y2] = ends(aim, rows, cols);
      parts.push(`<line class="db-line aim" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK[c.seat] || INK[0]}"/>`);
    }

    // Dots.
    for (let r = 0; r <= rows; r++) {
      for (let col = 0; col <= cols; col++) {
        parts.push(`<circle class="db-dot" cx="${P + col * S}" cy="${P + r * S}" r="7"/>`);
      }
    }

    // Hit areas, last so they are on top.
    if (s.yourTurn) {
      s.lines.forEach((who, e) => {
        if (who !== -1) return;
        const [x1, y1, x2, y2] = ends(e, rows, cols);
        // Pulled in from the dots so a tap near a corner picks one line, not two.
        const dx = (x2 - x1) * 0.14;
        const dy = (y2 - y1) * 0.14;
        parts.push(`<line class="db-hit" data-edge="${e}" x1="${x1 + dx}" y1="${y1 + dy}" x2="${x2 - dx}" y2="${y2 - dy}"/>`);
      });
    }

    const svg = $('db-board');
    svg.setAttribute('viewBox', `0 0 ${W} ${Ht}`);
    svg.innerHTML = parts.join('');

    $('db-scores').innerHTML = s.names.map((n, i) => `
      <div class="ds${i === s.turn && s.phase === 'playing' ? ' drawing' : ''}" style="--ink:${INK[i]}">
        <b><i class="db-chip"></i>${ctx.escapeHtml(i === c.seat ? 'You' : n)}</b><span>${s.scores[i]}</span>
      </div>`).join('');

    const left = s.lines.filter((v) => v === -1).length;
    $('db-left').textContent = `${left} line${left === 1 ? '' : 's'}`;
    $('db-turn').textContent = s.phase === 'gameOver' ? 'All boxed up'
      : s.yourTurn ? (fresh?.seat === c.seat && fresh.closed.length ? 'Go again!' : 'Your line')
      : `${s.names[s.turn]}…`;
    $('db-hint').textContent = !s.yourTurn ? ''
      : aim !== null ? 'Tap the same line again to draw it.' : 'Tap a line, then tap it again to draw.';

    renderOverlay();
  }

  function renderOverlay() {
    const s = state;
    const ov = $('overlay');
    if (s.phase !== 'gameOver') { ov.hidden = true; return; }
    const best = Math.max(...s.scores);
    const top = s.scores.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    ov.hidden = false;
    $('ov-title').textContent = top.length > 1 ? 'A tie!' : top[0] === ctx.seat ? 'Most boxes!' : `${s.names[top[0]]} wins`;
    $('ov-body').textContent = s.names.map((n, i) => `${i === ctx.seat ? 'You' : n} ${s.scores[i]}`).join(' · ');
    $('ov-tricks').textContent = 'Who draws first moves round each game.';
    $('ov-btn').hidden = false;
    $('ov-btn').disabled = false;
    $('ov-btn').textContent = 'Play again';
    $('ov-btn').onclick = () => ctx.act({ kind: 'newGame' });
  }

  $('db-board').addEventListener('click', (e) => {
    const edge = e.target.closest('[data-edge]')?.dataset.edge;
    if (edge === undefined || !state?.yourTurn) return;
    const n = Number(edge);
    if (aim === n) {
      aim = null;
      ctx.act({ kind: 'line', edge: n });
      return;
    }
    aim = n;
    render(state, ctx);
  });

  window.registerGame('dots', {
    root: 'game-dots',
    usesCards: false,
    render,
    reset() {
      state = null;
      aim = null;
      seenMove = 0;
    },
  });
})();
