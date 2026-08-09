/* Lava Run renderer.
 *
 * This is the only game that runs its own clock. The server hands out a seed
 * and a start time; everything else — the course, the physics, the collision —
 * happens here at the phone's own frame rate, using the shared module in
 * runner-level.js so every device produces an identical course.
 *
 * Because the camera position is purely a function of elapsed time, every
 * player shares one camera. That makes drawing your opponent trivial and
 * meaningful: their reported x,y is in the same world, on the same screen.
 */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const R = globalThis.RunnerLevel;
  const POS_EVERY_MS = 100;

  let state = null;
  let ctx = null;
  let canvas = null;
  let g2 = null;
  let raf = null;

  let level = null;
  let me = null;
  let seedInPlay = null;
  let held = false;
  let lastFrame = 0;
  let lastPos = 0;
  let reportedDeath = false;
  const ghosts = new Map(); // seat -> {x, y, alive}

  // ------------------------------------------------------------------ view

  /** Letterboxed so a taller phone cannot see further ahead. */
  function layout() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(rect.width * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    const scale = Math.min(rect.width / R.VIEW.w, rect.height / R.VIEW.h);
    return {
      dpr,
      scale,
      w: rect.width,
      h: rect.height,
      offX: (rect.width - R.VIEW.w * scale) / 2,
      offY: (rect.height - R.VIEW.h * scale) / 2,
    };
  }

  function draw(viewX, edgeX, t) {
    const L = layout();
    g2.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    g2.clearRect(0, 0, L.w, L.h);

    // World to screen. y is up in world units, down in canvas ones.
    const sx = (x) => L.offX + (x - viewX) * L.scale;
    const sy = (y) => L.offY + (R.VIEW.h - R.VIEW.floor - y) * L.scale;

    // Sky, then lava glowing along the bottom.
    const sky = g2.createLinearGradient(0, L.offY, 0, L.offY + R.VIEW.h * L.scale);
    sky.addColorStop(0, '#1b1030');
    sky.addColorStop(1, '#4a1524');
    g2.fillStyle = sky;
    g2.fillRect(L.offX, L.offY, R.VIEW.w * L.scale, R.VIEW.h * L.scale);

    const lavaTop = sy(R.PHYS.lavaY);
    const lava = g2.createLinearGradient(0, lavaTop - 18, 0, L.offY + R.VIEW.h * L.scale);
    lava.addColorStop(0, '#ff8a2b');
    lava.addColorStop(0.35, '#e23c14');
    lava.addColorStop(1, '#7a1206');
    g2.fillStyle = lava;
    g2.fillRect(L.offX, lavaTop, R.VIEW.w * L.scale, R.VIEW.h * L.scale);
    // A little churn on the surface so it reads as molten rather than a floor.
    g2.strokeStyle = 'rgba(255, 214, 130, 0.75)';
    g2.lineWidth = Math.max(1, L.scale * 0.12);
    g2.beginPath();
    for (let i = 0; i <= 40; i++) {
      const wx = viewX + (i / 40) * R.VIEW.w;
      const wob = Math.sin(wx * 0.7 + t * 3) * 0.14 + Math.sin(wx * 1.9 - t * 2) * 0.07;
      const px = sx(wx);
      const py = sy(R.PHYS.lavaY + wob);
      if (i === 0) g2.moveTo(px, py); else g2.lineTo(px, py);
    }
    g2.stroke();

    const seen = level.visible(viewX - 4, viewX + R.VIEW.w + 6);

    for (const p of seen.platforms) {
      const x = sx(p.x);
      const w = p.w * L.scale;
      const y = sy(p.y);
      const h = (p.y - R.PHYS.lavaY) * L.scale;
      g2.fillStyle = '#3b2f47';
      g2.fillRect(x, y, w, h);
      g2.fillStyle = '#6f5a7e';
      g2.fillRect(x, y, w, Math.max(3, L.scale * 0.28));
    }

    for (const hz of seen.hazards) {
      const x = sx(hz.x);
      const w = hz.w * L.scale;
      const yb = sy(hz.yBottom);
      g2.fillStyle = '#2a1830';
      g2.fillRect(x, L.offY, w, yb - L.offY);
      g2.fillStyle = '#ff6b3d';
      g2.fillRect(x, yb - Math.max(2, L.scale * 0.3), w, Math.max(2, L.scale * 0.3));
    }

    // The wall of lava at your heels. It sits a fixed distance back and no
    // longer kills: with one speed everywhere nobody can fall behind, so an
    // edge that killed could only ever be a clock that ended everyone at the
    // same moment. It is pressure, and the thing that kills you is a mistake.
    const edge = sx(edgeX);
    const wall = g2.createLinearGradient(edge - L.scale * 2, 0, edge + L.scale * 3.5, 0);
    wall.addColorStop(0, 'rgba(255, 120, 40, 0.95)');
    wall.addColorStop(0.45, 'rgba(226, 60, 20, 0.55)');
    wall.addColorStop(1, 'rgba(226, 60, 20, 0)');
    g2.fillStyle = wall;
    g2.fillRect(L.offX, L.offY, Math.max(0, edge + L.scale * 3.5 - L.offX), R.VIEW.h * L.scale);

    // Everyone else, then you on top.
    for (const [seat, gh] of ghosts) {
      if (seat === ctx.seat) continue;
      drawRunner(sx(gh.x), sy(gh.y), L.scale, gh.alive ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.14)');
      if (gh.alive) {
        g2.fillStyle = 'rgba(255,255,255,0.6)';
        g2.font = `${Math.max(9, L.scale * 0.6)}px system-ui, sans-serif`;
        g2.textAlign = 'center';
        g2.fillText(state.names[seat] || '', sx(gh.x), sy(gh.y) + L.scale * 1.6);
      }
    }
    if (me) drawRunner(sx(me.x), sy(me.y), L.scale, me.dead ? '#8a8a8a' : '#ffd45e');
  }

  function drawRunner(x, yFeet, scale, colour) {
    const h = R.PHYS.height * scale;
    const w = h * 0.62;
    g2.fillStyle = colour;
    g2.beginPath();
    g2.roundRect(x - w / 2, yFeet - h, w, h, w * 0.35);
    g2.fill();
  }

  // ------------------------------------------------------------------ loop

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!state || !level) return;

    const t = (Date.now() - state.startAt) / 1000;
    const running = state.phase === 'running' && t >= 0;

    if (running && me && !me.dead) {
      // Fixed steps, capped: a backgrounded tab must not teleport you.
      let dt = Math.min(0.1, (now - lastFrame) / 1000 || 0);
      const stepSize = 1 / 240;
      while (dt > 0) {
        const s = Math.min(stepSize, dt);
        R.step(me, level, { down: held }, s, t);
        dt -= s;
        if (me.dead) break;
      }
      if (me.dead && !reportedDeath) {
        reportedDeath = true;
        ctx.act({ kind: 'died', seconds: t, distance: me.x, cause: me.cause });
      }
      if (now - lastPos > POS_EVERY_MS) {
        lastPos = now;
        ctx.act({ kind: 'pos', x: me.x, y: me.y, alive: !me.dead });
      }
    }
    lastFrame = now;

    // The view follows the runner, so how far you can see ahead never changes.
    // Pinning it to the closing edge instead meant that running well pushed you
    // to the right of the screen and left you less time to react.
    const here = me ? me.x : R.PHYS.startX;
    const viewX = here - R.VIEW.playerX;
    draw(viewX, here - R.PHYS.tideLag, Math.max(0, t));
    renderHud(t);
  }

  function renderHud(t) {
    const showing = state.phase === 'countdown' || state.phase === 'running';
    $('run-round').textContent = `${state.round}/${state.rounds}`;
    $('run-time').textContent = showing && t > 0 ? `${t.toFixed(1)}s` : '—';
    const cd = $('run-countdown');
    if (state.phase === 'countdown') {
      const left = Math.ceil(-t);
      cd.hidden = false;
      cd.textContent = left > 0 ? String(left) : 'GO';
    } else {
      cd.hidden = true;
    }
    $('run-status').textContent = me && me.dead
      ? (state.phase === 'running' ? 'Out — watching the rest' : '')
      : '';
  }

  // --------------------------------------------------------------- render

  function render(s, c) {
    state = s;
    ctx = c;
    if (!canvas) setup();

    // A new round means a new course.
    if (s.seed !== seedInPlay) {
      seedInPlay = s.seed;
      level = R.makeLevel(s.seed);
      me = R.newPlayer(level);
      reportedDeath = false;
      held = false;
      ghosts.clear();
      lastFrame = performance.now();
    }

    $('run-scores').innerHTML = s.names.slice(0, s.humans).map((n, i) => {
      const out = s.alive && s.alive[i] === false;
      return `<div class="ds${out ? '' : ' drawing'}">
        <b>${ctx.escapeHtml(i === ctx.seat ? 'You' : n)}</b>
        <span>${s.wins[i]}</span>
      </div>`;
    }).join('');

    renderOverlay();
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function setup() {
    canvas = $('run-canvas');
    g2 = canvas.getContext('2d');
    const down = (e) => { e.preventDefault(); held = true; };
    const up = () => { held = false; };
    canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    // Holding the screen must not also scroll or select anything.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function renderOverlay() {
    const ov = $('overlay');

    const solo = state.humans === 1;

    if (state.phase === 'gameOver') {
      const best = Math.max(...state.wins.slice(0, state.humans));
      ov.hidden = false;
      $('ov-title').textContent = solo
        ? `Best run ${state.bestSeconds[ctx.seat].toFixed(1)}s`
        : (state.wins[ctx.seat] === best ? 'You win!' : 'Good run');
      $('ov-body').textContent = solo
        ? `${state.rounds} round${state.rounds === 1 ? '' : 's'} done`
        : state.names.slice(0, state.humans)
            .map((n, i) => `${i === ctx.seat ? 'You' : n}: ${state.wins[i]}`).join(' · ');
      $('ov-tricks').textContent = solo ? ''
        : state.names.slice(0, state.humans)
            .map((n, i) => `best ${state.bestSeconds[i].toFixed(1)}s`).join(' · ');
      $('ov-btn').hidden = false;
      $('ov-btn').disabled = false;
      $('ov-btn').textContent = 'Play again';
      $('ov-btn').onclick = () => ctx.act({ kind: 'newGame' });
      return;
    }

    if (state.phase === 'results' && state.revealed) {
      const r = state.revealed;
      const mine = r.results.find((x) => x.seat === ctx.seat);
      ov.hidden = false;
      // Alone there is nobody to have beaten, so report the run itself.
      const best = state.bestSeconds[ctx.seat] || 0;
      $('ov-title').textContent = solo
        ? `${mine ? mine.seconds.toFixed(1) : '0.0'}s`
        : (r.winners.includes(ctx.seat)
            ? `You lasted longest — ${mine.seconds.toFixed(1)}s`
            : `${r.winners.map((s) => state.names[s]).join(' & ')} lasted longest`);
      $('ov-body').textContent = mine
        ? `You ${CAUSE[mine.cause] || 'went out'} at ${mine.seconds.toFixed(1)}s`
        : '';
      $('ov-tricks').textContent = solo
        ? (best > 0 ? `Best so far ${best.toFixed(1)}s` : '')
        : r.results
            .slice()
            .sort((a, b) => b.seconds - a.seconds)
            .map((x) => `${x.seat === ctx.seat ? 'You' : state.names[x.seat]} ${x.seconds.toFixed(1)}s`)
            .join(' · ');

      const ready = state.ready || [];
      const iAmReady = ready.includes(ctx.seat);
      const waiting = Array.from({ length: state.humans }, (_, i) => i)
        .filter((i) => i !== ctx.seat && !ready.includes(i));
      const waitText = waiting.length === 1
        ? `Waiting for ${state.names[waiting[0]]}…`
        : `Waiting for ${waiting.length} others…`;

      const btn = $('ov-btn');
      btn.hidden = false;
      btn.disabled = iAmReady;
      btn.textContent = iAmReady ? (waiting.length ? waitText : 'Next…')
        : (state.round >= state.rounds ? 'See the result' : 'Next round');
      btn.onclick = () => {
        btn.disabled = true;
        btn.textContent = waiting.length ? waitText : 'Next…';
        ctx.act({ kind: 'nextRound' });
      };
      return;
    }

    ov.hidden = true;
  }

  const CAUSE = {
    lava: 'fell in the lava',
    ceiling: 'hit the rock',
    survived: 'were still going',
  };

  function handleMessage(msg) {
    if (msg.type !== 'runners') return;
    ghosts.set(msg.seat, { x: msg.x, y: msg.y, alive: msg.alive });
  }

  // A window on the live simulation, for the browser tests. Reading it cannot
  // change anything; it exists because a headless run otherwise has no way to
  // see why a runner is or is not falling.
  window.__runner = {
    get me() { return me; },
    get level() { return level; },
    get held() { return held; },
  };

  window.registerGame('runner', {
    root: 'game-runner',
    usesCards: false,
    render,
    handleMessage,
    reset() {
      cancelAnimationFrame(raf);
      raf = null;
      state = null;
      level = null;
      me = null;
      seedInPlay = null;
      held = false;
      ghosts.clear();
    },
  });
})();
