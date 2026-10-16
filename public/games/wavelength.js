/* Wavelength renderer.
 *
 * A half-dial drawn in SVG. The target bands exist only on the psychic's
 * phone until the reveal — the server does not send them anywhere else — and
 * your own needle follows your thumb. Moves go up a few times a second so a
 * phone that locks mid-guess comes back to where it was, and so the psychic
 * can watch.
 */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CX = 100;
  const CY = 104;
  const R = 92;

  let state = null;
  let ctx = null;
  let mine = null;         // my dial, held locally while dragging
  let dragging = false;
  let lastSent = 0;
  let sendTimer = null;
  let watching = {};       // other guessers' live dials, psychic only
  let round = 0;

  const pt = (v, r = R) => {
    const a = Math.PI * (1 - v / 100);
    return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
  };
  const f = (n) => n.toFixed(2);

  function wedge(from, to, r = R) {
    from = Math.max(0, from);
    to = Math.min(100, to);
    const [x1, y1] = pt(from, r);
    const [x2, y2] = pt(to, r);
    return `<path d="M${CX},${CY} L${f(x1)},${f(y1)} A${r},${r} 0 0 1 ${f(x2)},${f(y2)} Z"`;
  }

  function needle(v, cls, label = '') {
    const [x, y] = pt(v, R - 4);
    const [lx, ly] = pt(v, R + 0.5);
    return `<g class="wl-needle ${cls}">
      <line x1="${CX}" y1="${CY}" x2="${f(x)}" y2="${f(y)}"/>
      <circle cx="${CX}" cy="${CY}" r="5"/>
      ${label ? `<text x="${f(lx)}" y="${f(ly - 3)}">${label}</text>` : ''}
    </g>`;
  }

  function drawDial() {
    const s = state;
    const parts = [];
    // The face.
    parts.push(`<path class="wl-face" d="M${CX - R},${CY} A${R},${R} 0 0 1 ${CX + R},${CY} Z"/>`);
    // The target, where this phone is allowed to know it.
    if (s.target !== null) {
      const cls = ['b2', 'b3', 'b4'];
      [...s.bands].reverse().forEach((b, i) => {
        parts.push(`${wedge(s.target - b.within, s.target + b.within)} class="wl-band ${cls[i]}"/>`);
      });
      const [tx, ty] = pt(s.target, R * 0.55);
      parts.push(`<text class="wl-band-label" x="${f(tx)}" y="${f(ty)}">4</text>`);
    }
    // Ticks round the rim.
    for (let v = 0; v <= 100; v += 10) {
      const [a, b] = pt(v, R);
      const [c, d] = pt(v, R - (v % 50 === 0 ? 7 : 4));
      parts.push(`<line class="wl-tick" x1="${f(a)}" y1="${f(b)}" x2="${f(c)}" y2="${f(d)}"/>`);
    }

    const open = s.phase === 'reveal' || s.phase === 'gameOver';
    if (open) {
      s.dials.forEach((d, seat) => {
        if (d === null || seat === s.psychic) return;
        const me = seat === ctx.seat;
        parts.push(needle(d, me ? 'me' : 'other', me ? '' : ctx.escapeHtml(s.names[seat][0] || '?')));
      });
    } else if (s.youArePsychic) {
      for (const [seat, v] of Object.entries(watching)) {
        parts.push(needle(v, 'other live', ctx.escapeHtml(s.names[seat][0] || '?')));
      }
    } else if (s.phase === 'guess' && mine !== null) {
      parts.push(needle(mine, s.locked[ctx.seat] ? 'me locked' : 'me'));
    }
    $('wl-dial').innerHTML = parts.join('');
  }

  function render(s, c) {
    state = s;
    ctx = c;
    if (s.round !== round) {
      round = s.round;
      watching = {};
      mine = null;
    }
    // The server's copy wins unless a thumb is on the dial right now.
    if (!dragging && s.dials[c.seat] !== null && s.dials[c.seat] !== undefined) mine = s.dials[c.seat];
    if (s.phase === 'guess' && mine === null && !s.youArePsychic) mine = 50;

    const psychicName = s.youArePsychic ? 'You' : s.names[s.psychic];
    $('wl-round').textContent = `${s.round}/${s.totalRounds}`;
    $('wl-score').textContent = s.coop ? `${s.team} pts` : `${s.scores[c.seat]} pts`;
    $('wl-status').textContent =
      s.phase === 'clue' ? (s.youArePsychic ? 'You are the psychic' : `${psychicName} has the target`)
      : s.phase === 'guess' ? (s.youArePsychic ? 'Watch them guess' : 'Turn the dial')
      : s.phase === 'reveal' ? 'The reveal'
      : 'All done';

    // Scores strip only matters when it is everyone for themselves.
    $('wl-scores').hidden = s.coop;
    if (!s.coop) {
      $('wl-scores').innerHTML = s.names.map((n, i) => `
        <div class="ds${i === s.psychic ? ' drawing' : ''}">
          <b>${c.escapeHtml(i === c.seat ? 'You' : n)}</b><span>${s.scores[i]}</span>
        </div>`).join('');
    }

    $('wl-left').textContent = s.spectrum[0];
    $('wl-right').textContent = s.spectrum[1];
    $('wl-clue').innerHTML = s.clue
      ? `<span>${s.youArePsychic ? 'Your clue' : `${c.escapeHtml(psychicName)} says`}</span><b>“${c.escapeHtml(s.clue)}”</b>`
      : s.youArePsychic && s.phase === 'clue'
        ? '<span>Give a clue that lands on the</span><b>4</b>'
        : `<span>Waiting for</span><b>${c.escapeHtml(psychicName)}'s clue</b>`;

    drawDial();

    // Writing the clue.
    const giving = s.phase === 'clue' && s.youArePsychic;
    $('wl-give').hidden = !giving;
    if (giving) {
      $('wl-skip').disabled = s.skipsLeft <= 0;
      $('wl-skip').textContent = s.skipsLeft > 0 ? `New card (${s.skipsLeft})` : 'No skips left';
    }

    // Points after the reveal.
    const pts = $('wl-points');
    pts.hidden = !(s.phase === 'reveal' || s.phase === 'gameOver') || !s.roundPoints;
    if (!pts.hidden) {
      pts.innerHTML = s.coop
        ? `<b>${s.roundPoints[1 - s.psychic]}</b><span>point${s.roundPoints[1 - s.psychic] === 1 ? '' : 's'} together</span>`
        : s.names.map((n, i) => `<div><span>${c.escapeHtml(i === c.seat ? 'You' : n)}${
          i === s.psychic ? ' (psychic)' : ''}</span><b>+${s.roundPoints[i]}</b></div>`).join('');
    }

    // The one big button, whatever it means right now.
    const go = $('wl-go');
    go.hidden = true;
    let hint = '';
    if (s.phase === 'clue') {
      hint = s.youArePsychic
        ? 'Only you can see the target. Your clue can be anything — a word, a name, a thing.'
        : `${psychicName} is thinking of a clue…`;
    } else if (s.phase === 'guess') {
      if (s.youArePsychic) {
        const waiting = s.names.filter((_, i) => i !== s.psychic && !s.locked[i]);
        hint = `Waiting on ${waiting.join(', ')}. Poker face.`;
      } else if (s.locked[c.seat]) {
        hint = 'Locked in. Waiting on the others…';
      } else {
        hint = 'Drag the needle, then lock it in.';
        go.hidden = false;
        go.disabled = false;
        go.textContent = 'Lock it in';
      }
    } else if (s.phase === 'reveal') {
      const ready = s.ready.includes(c.seat);
      go.hidden = false;
      go.disabled = ready;
      go.textContent = ready ? 'Waiting…' : (s.round >= s.totalRounds ? 'See the result' : 'Next round');
    }
    $('wl-hint').textContent = hint;

    renderOverlay();
  }

  function renderOverlay() {
    const s = state;
    const ov = $('overlay');
    if (s.phase !== 'gameOver') { ov.hidden = true; return; }
    ov.hidden = false;
    if (s.coop) {
      const pct = Math.round((s.team / s.maxTeam) * 100);
      $('ov-title').textContent = `${pct}% in sync`;
      $('ov-body').textContent =
        pct >= 80 ? 'Basically one brain.'
        : pct >= 60 ? 'Very much on the same wavelength.'
        : pct >= 40 ? 'Mostly tuned in.'
        : 'Some static on the line.';
      $('ov-tricks').textContent = `${s.team} of ${s.maxTeam} points over ${s.totalRounds} rounds`;
    } else {
      const best = Math.max(...s.scores);
      const winners = s.scores.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
      const youWon = winners.includes(ctx.seat);
      $('ov-title').textContent = winners.length > 1 ? 'A tie at the top'
        : youWon ? 'You read them best' : `${s.names[winners[0]]} wins`;
      $('ov-body').textContent = s.names.map((n, i) => `${i === ctx.seat ? 'You' : n} ${s.scores[i]}`).join(' · ');
      $('ov-tricks').textContent = '';
    }
    $('ov-btn').hidden = false;
    $('ov-btn').disabled = false;
    $('ov-btn').textContent = 'Play again';
    $('ov-btn').onclick = () => ctx.act({ kind: 'newGame' });
  }

  // -------------------------------------------------------------- dragging

  function valueAt(e) {
    const box = $('wl-dial').getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 200;
    const y = ((e.clientY - box.top) / box.height) * 112;
    let a = Math.atan2(CY - y, x - CX);
    // Below the centre line, snap to whichever end is nearer.
    if (a < 0) a = x < CX ? Math.PI : 0;
    return Math.max(0, Math.min(100, (1 - a / Math.PI) * 100));
  }

  const canDrag = () => state?.phase === 'guess' && !state.youArePsychic && !state.locked[ctx.seat];

  function push() {
    clearTimeout(sendTimer);
    const now = Date.now();
    if (now - lastSent > 120) {
      lastSent = now;
      ctx.act({ kind: 'dial', value: mine });
    } else {
      sendTimer = setTimeout(push, 120 - (now - lastSent));
    }
  }

  $('wl-dial').addEventListener('pointerdown', (e) => {
    if (!canDrag()) return;
    dragging = true;
    $('wl-dial').setPointerCapture(e.pointerId);
    mine = valueAt(e);
    drawDial();
    push();
  });
  $('wl-dial').addEventListener('pointermove', (e) => {
    if (!dragging) return;
    mine = valueAt(e);
    drawDial();
    push();
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    push();
  };
  $('wl-dial').addEventListener('pointerup', release);
  $('wl-dial').addEventListener('pointercancel', release);

  $('wl-go').onclick = () => {
    if (state.phase === 'guess') {
      clearTimeout(sendTimer);
      ctx.act({ kind: 'lock', value: mine });
    } else if (state.phase === 'reveal') {
      ctx.act({ kind: 'next' });
    }
  };

  $('wl-give').onsubmit = (e) => {
    e.preventDefault();
    const text = $('wl-text').value.trim();
    if (!text) return ctx.toast('Write a clue first.');
    ctx.act({ kind: 'clue', text });
    $('wl-text').value = '';
    $('wl-text').blur();
  };
  $('wl-skip').onclick = () => ctx.act({ kind: 'skip' });

  window.registerGame('wavelength', {
    root: 'game-wavelength',
    usesCards: false,
    render,
    handleMessage(msg) {
      if (msg.type !== 'wl-dial' || !state || msg.round !== state.round) return;
      watching[msg.seat] = msg.value;
      drawDial();
    },
    reset() {
      state = null;
      mine = null;
      dragging = false;
      watching = {};
      round = 0;
      clearTimeout(sendTimer);
    },
  });
})();
