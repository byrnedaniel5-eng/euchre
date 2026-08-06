/* Drawing renderer.
 *
 * Strokes are kept out of the game state entirely — a state broadcast per
 * finger movement would be enormous. Points are batched on a short interval
 * and pushed as their own small message; the server relays them to the other
 * players and replays the whole board to anyone who reconnects.
 *
 * All coordinates are 0..1 of the board, so a drawing made on a small phone
 * arrives correctly on a big one. */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const COLORS = ['#161616', '#e23b3b', '#e08a1e', '#e8c93a', '#3fa653', '#2f7fd0', '#8a4fc4', '#8a5a3c'];
  const STARS = { easy: '★', medium: '★★', hard: '★★★' };
  const BATCH_MS = 45;

  let state = null;
  let ctx = null;
  let canvas = null;
  let g2 = null;
  let strokes = []; // everything drawn this turn, in board coordinates
  let live = null; // the stroke currently under the finger
  let pending = []; // points not yet sent
  let flushTimer = null;
  let colour = COLORS[0];
  let width = 7;
  let erasing = false;
  let clockTimer = null;

  // ------------------------------------------------------------ the canvas

  function setupCanvas() {
    if (canvas) return;
    canvas = $('board');
    g2 = canvas.getContext('2d');

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    };
    new ResizeObserver(resize).observe(canvas);
    resize();

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return [(p.clientX - r.left) / r.width, (p.clientY - r.top) / r.height];
    };
    const canDraw = () => state?.youAreDrawing && state.phase === 'drawing';

    const start = (e) => {
      if (!canDraw()) return;
      e.preventDefault();
      live = {
        id: Math.random().toString(36).slice(2),
        color: erasing ? '#ffffff' : colour,
        width: erasing ? Math.max(14, width * 3) : width,
        erase: erasing,
        points: [pos(e)],
      };
      strokes.push(live);
      pending = [live.points[0]];
      redraw();
    };
    const move = (e) => {
      if (!live) return;
      e.preventDefault();
      const p = pos(e);
      const last = live.points[live.points.length - 1];
      // Skip micro-movements: fewer points, same line, far less traffic.
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.004) return;
      live.points.push(p);
      pending.push(p);
      if (!flushTimer) flushTimer = setTimeout(flush, BATCH_MS);
      redraw();
    };
    const end = () => {
      if (!live) return;
      flush();
      live = null;
    };

    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('touchstart', (e) => canDraw() && e.preventDefault(), { passive: false });
    canvas.addEventListener('touchmove', (e) => canDraw() && e.preventDefault(), { passive: false });
  }

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!live || !pending.length) return;
    ctx.act({
      kind: 'stroke',
      stroke: { id: live.id, color: live.color, width: live.width, erase: live.erase,
                points: pending },
    });
    // Keep the last point so the next batch joins on rather than gapping.
    pending = [pending[pending.length - 1]];
  }

  function drawStroke(s) {
    if (!s.points.length) return;
    const r = canvas.getBoundingClientRect();
    g2.lineCap = 'round';
    g2.lineJoin = 'round';
    g2.strokeStyle = s.erase ? '#ffffff' : s.color;
    g2.lineWidth = s.width;
    g2.beginPath();
    s.points.forEach(([x, y], i) => {
      const px = x * r.width;
      const py = y * r.height;
      if (i === 0) g2.moveTo(px, py);
      else g2.lineTo(px, py);
    });
    if (s.points.length === 1) {
      const [x, y] = s.points[0];
      g2.lineTo(x * r.width + 0.01, y * r.height);
    }
    g2.stroke();
  }

  function redraw() {
    if (!g2) return;
    const r = canvas.getBoundingClientRect();
    g2.clearRect(0, 0, r.width, r.height);
    g2.fillStyle = '#ffffff';
    g2.fillRect(0, 0, r.width, r.height);
    for (const s of strokes) drawStroke(s);
  }

  /**
   * Merge an incoming batch into the stroke it belongs to, so a line drawn on
   * the other phone appears as one continuous stroke rather than fragments.
   */
  function mergeStroke(s) {
    const existing = strokes.find((x) => x.id === s.id);
    if (existing) existing.points.push(...s.points);
    else strokes.push({ ...s, points: s.points.slice() });
  }

  // ---------------------------------------------------------------- render

  // Which turn the strokes we are holding belong to. Set by ink messages, not
  // by state, so that a board replayed after a reconnect is recognised as
  // current rather than wiped as leftovers from the previous turn.
  let strokesTurn = null;

  function render(s, c) {
    state = s;
    ctx = c;
    setupCanvas();

    // A new turn means a blank board — but only if what we are holding really
    // is from an older turn. Locking your phone drops the socket, and the
    // rejoin replays the board before the first state arrives; clearing on
    // "state.turn !== null" wiped it every time.
    if (strokesTurn !== null && s.turn !== strokesTurn) {
      strokesTurn = s.turn;
      strokes = [];
      live = null;
      pending = [];
      $('guess-feed').innerHTML = '';
      redraw();
    } else if (strokesTurn === null) {
      strokesTurn = s.turn;
    }

    $('draw-turn').textContent = `${s.turn}/${s.totalTurns}`;
    renderScores();
    renderClock();

    const drawing = s.phase === 'drawing';
    const choosing = s.phase === 'choosing';

    // The word: shown to the drawer, masked for everyone else.
    const wordEl = $('draw-word');
    if (s.word && (s.youAreDrawing || s.phase === 'reveal' || s.phase === 'gameOver')) {
      wordEl.textContent = s.word;
      wordEl.className = 'draw-word revealed';
    } else if (drawing) {
      wordEl.textContent = s.wordPattern || '';
      wordEl.className = 'draw-word masked';
    }
    const starEl = $('draw-stars');
    if (s.tier && (drawing || s.phase === 'reveal')) {
      starEl.textContent = STARS[s.tier];
      starEl.className = `draw-stars tier-${s.tier}`;
    } else {
      starEl.textContent = '';
      starEl.className = 'draw-stars';
    }
    if (!s.word && !drawing) {
      wordEl.textContent = '';
      wordEl.className = 'draw-word';
    }

    $('choose-panel').hidden = !(choosing && s.youAreDrawing);
    if (choosing && s.youAreDrawing && s.choices) {
      $('choose-words').innerHTML = s.choices.map((w, i) => {
        const tier = (s.choiceTiers || [])[i] || 'easy';
        const bonus = { easy: 0, medium: 15, hard: 35 }[tier];
        return `<button class="word-btn tier-${tier}" data-w="${ctx.escapeHtml(w)}">
          <span class="wb-word">${ctx.escapeHtml(w)}</span>
          <span class="wb-meta"><i>${STARS[tier]}</i>${bonus ? ` +${bonus} to you` : ''}</span>
        </button>`;
      }).join('');
    }

    const note = $('watch-note');
    if (choosing && !s.youAreDrawing) {
      note.hidden = false;
      note.textContent = `${s.names[s.drawer]} is picking a word…`;
    } else if (drawing && !s.youAreDrawing && s.youSolved) {
      note.hidden = false;
      note.textContent = 'You got it — sit tight.';
    } else {
      note.hidden = true;
    }

    $('tools').hidden = !(drawing && s.youAreDrawing);
    $('guess-area').hidden = !(drawing && !s.youAreDrawing && !s.youSolved);
    if (!$('guess-area').hidden) $('guess-input').disabled = false;

    renderOverlay();
  }

  function renderScores() {
    $('draw-scores').innerHTML = state.names.slice(0, state.humans).map((n, i) => {
      const solved = state.solved?.some((x) => x.seat === i);
      return `<div class="ds${i === state.drawer ? ' drawing' : ''}${solved ? ' solved' : ''}">
        <b>${ctx.escapeHtml(i === ctx.seat ? 'You' : n)}</b>
        <span>${state.scores[i]}</span>
      </div>`;
    }).join('');
  }

  // Points fall away every second, so show what a guess is worth right now
  // rather than only revealing it once the turn is over.
  const MIN_POINTS = 20;
  const MAX_POINTS = 100;
  const worthAt = (left, total) => (left <= 0 ? 0
    : MIN_POINTS + Math.round((MAX_POINTS - MIN_POINTS) * Math.min(1, left / total)));

  function renderClock() {
    clearInterval(clockTimer);
    const el = $('draw-clock');
    const worth = $('draw-worth');
    const pill = $('clock-pill');
    if (state.phase !== 'drawing' && state.phase !== 'choosing') {
      el.textContent = '–';
      worth.textContent = '';
      pill.className = 'clock';
      return;
    }
    const total = state.drawSeconds || 80;
    const mult = state.tierMultiplier || 1;
    const drawing = state.phase === 'drawing';
    const tick = () => {
      const left = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
      el.textContent = left;
      worth.textContent = drawing && !state.youAreDrawing && !state.youSolved
        ? `${Math.round(worthAt(left, total) * mult)} pts` : '';
      pill.className = 'clock' + (left <= 10 ? ' urgent' : '');
    };
    tick();
    clockTimer = setInterval(tick, 250);
  }

  function renderOverlay() {
    const ov = $('overlay');

    if (state.phase === 'gameOver') {
      const best = Math.max(...state.scores.slice(0, state.humans));
      const iWon = state.scores[ctx.seat] === best;
      ov.hidden = false;
      $('ov-title').textContent = iWon ? 'You win!' : 'Good game';
      $('ov-body').textContent = state.names.slice(0, state.humans)
        .map((n, i) => `${i === ctx.seat ? 'You' : n}: ${state.scores[i]}`).join(' · ');
      $('ov-tricks').textContent = '';
      $('ov-btn').disabled = false;
      $('ov-btn').textContent = 'Play again';
      $('ov-btn').onclick = () => ctx.act({ kind: 'newGame' });
      return;
    }

    if (state.phase === 'reveal' && state.revealed) {
      const r = state.revealed;
      ov.hidden = false;
      const mine = r.solved.find((x) => x.seat === ctx.seat);
      const iDrew = r.drawer === ctx.seat;
      $('ov-title').textContent = r.solved.length
        ? (mine ? `You got it! +${mine.points}`
          : iDrew ? (r.drawerBonus ? `They got it — +${r.drawerBonus}` : 'They got it')
          : 'Time!')
        : 'Nobody got it';
      $('ov-body').textContent = `The word was “${r.word}”.`;
      const lines = r.solved.map((x) =>
        `${x.seat === ctx.seat ? 'You' : state.names[x.seat]} +${x.points} with ${x.secondsLeft}s left`);
      if (r.drawerBonus) {
        lines.push(`${r.drawer === ctx.seat ? 'You' : state.names[r.drawer]} ` +
                   `+${r.drawerBonus} for a ${STARS[r.tier]} word`);
      }
      $('ov-tricks').textContent = lines.join(' · ');

      const ready = state.ready || [];
      const iAmReady = ready.includes(ctx.seat);
      const others = Array.from({ length: state.humans }, (_, i) => i)
        .filter((i) => i !== ctx.seat && !ready.includes(i));
      const waitText = others.length === 1
        ? `Waiting for ${state.names[others[0]]}…`
        : `Waiting for ${others.length} others…`;

      const btn = $('ov-btn');
      btn.disabled = iAmReady;
      btn.textContent = iAmReady ? (others.length ? waitText : 'Next…') : 'Next turn';
      btn.onclick = () => {
        btn.disabled = true;
        btn.textContent = others.length ? waitText : 'Next…';
        ctx.act({ kind: 'nextTurn' });
      };
      return;
    }

    ov.hidden = true;
  }

  // ------------------------------------------------------------- controls

  $('choose-words').onclick = (e) => {
    const w = e.target.closest('[data-w]')?.dataset.w;
    if (w) ctx.act({ kind: 'choose', word: w });
  };

  $('swatches').innerHTML = COLORS
    .map((c, i) => `<button class="swatch${i === 0 ? ' on' : ''}" data-c="${c}" style="background:${c}"></button>`)
    .join('');
  $('swatches').onclick = (e) => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (!c) return;
    colour = c;
    erasing = false;
    $('tool-erase').classList.remove('on');
    for (const b of $('swatches').children) b.classList.toggle('on', b.dataset.c === c);
  };

  for (const id of ['tool-thin', 'tool-mid', 'tool-fat']) {
    $(id).onclick = () => {
      width = Number($(id).dataset.w);
      for (const b of document.querySelectorAll('.size-btn')) b.classList.toggle('on', b.id === id);
    };
  }
  $('tool-erase').onclick = () => {
    erasing = !erasing;
    $('tool-erase').classList.toggle('on', erasing);
  };
  $('tool-undo').onclick = () => {
    strokes.pop();
    redraw();
    ctx.act({ kind: 'undo' });
  };
  $('tool-clear').onclick = () => {
    strokes = [];
    redraw();
    ctx.act({ kind: 'clear' });
  };

  $('guess-form').onsubmit = (e) => {
    e.preventDefault();
    const text = $('guess-input').value.trim();
    if (!text) return;
    $('guess-input').value = '';
    ctx.act({ kind: 'guess', text });
  };

  function addGuess(entry) {
    const el = document.createElement('div');
    el.className = 'gmsg' + (entry.near ? ' near' : '');
    el.innerHTML = `<b>${ctx.escapeHtml(entry.name)}</b> ${ctx.escapeHtml(entry.text)}` +
      (entry.near ? ' <i>so close</i>' : '');
    const feed = $('guess-feed');
    feed.appendChild(el);
    while (feed.children.length > 30) feed.removeChild(feed.firstChild);
    feed.scrollTop = feed.scrollHeight;
  }

  // ------------------------------------------------------------- messages

  function handleMessage(msg) {
    if (msg.type === 'ink') {
      // A replay for a turn we have already moved past is stale; ignore it.
      if (msg.turn != null && strokesTurn != null && msg.turn < strokesTurn) return;
      if (msg.turn != null) strokesTurn = msg.turn;
      if (msg.op === 'add') mergeStroke(msg.stroke);
      else if (msg.op === 'clear') strokes = [];
      else if (msg.op === 'replace') strokes = (msg.strokes || []).map((s) => ({ ...s }));
      redraw();
    } else if (msg.type === 'guess') {
      addGuess(msg.entry);
    }
  }

  window.registerGame('draw', {
    root: 'game-draw',
    usesCards: false,
    render,
    handleMessage,
    reset() {
      strokes = [];
      live = null;
      pending = [];
      strokesTurn = null;
      clearInterval(clockTimer);
      $('guess-feed').innerHTML = '';
      redraw();
    },
  });
})();
