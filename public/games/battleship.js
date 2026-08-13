/* Battleships renderer.
 *
 * Two jobs that barely overlap: laying a fleet out, and shooting at somebody
 * else's. They get a pane each rather than one clever pane that changes
 * meaning, because on a phone the difference between "tap to place a ship" and
 * "tap to fire a shell" needs to be obvious without reading anything.
 *
 * Every grid is rebuilt from the state on each render. A hundred divs is
 * nothing, and it means there is no local model of the board that can drift
 * away from the server's after a reconnect — the only thing kept on this side
 * is what the player has aimed at but not yet fired.
 */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  let state = null;
  let ctx = null;

  // Local intent only: nothing here is a fact about the game.
  let selected = null;   // ship key being placed
  let dir = 'h';
  let target = null;     // whose board we are looking at
  let aim = null;        // cell we have lined up but not fired at
  let lastNonce = null;
  let advanceOnPlace = false; // move the highlight along after this drop only

  const SIZE = () => state?.size || 10;
  const col = (x) => String.fromCharCode(65 + x);
  const label = (cell) => `${col(cell % SIZE())}${Math.floor(cell / SIZE()) + 1}`;

  // ---------------------------------------------------------------- grids

  /**
   * Build a labelled grid. `classesFor(cell)` decides how each square looks;
   * the letters and numbers down the sides are there because half of playing
   * this game is saying "B4" out loud to somebody on a video call.
   */
  function buildGrid(el, classesFor, { labels = true } = {}) {
    const n = SIZE();
    const parts = [];
    if (labels) {
      parts.push('<i class="bs-lab"></i>');
      for (let x = 0; x < n; x++) parts.push(`<i class="bs-lab">${col(x)}</i>`);
    }
    for (let y = 0; y < n; y++) {
      if (labels) parts.push(`<i class="bs-lab">${y + 1}</i>`);
      for (let x = 0; x < n; x++) {
        const cell = y * n + x;
        parts.push(`<b class="bs-c ${classesFor(cell)}" data-cell="${cell}"></b>`);
      }
    }
    el.style.setProperty('--cols', labels ? n + 1 : n);
    el.innerHTML = parts.join('');
  }

  /** The marks anyone may see on a board: shots, and the outlines of the sunk. */
  function damageClasses(board, cell) {
    const mark = board.incoming[cell];
    const sunk = board.sunk.some((s) => s.cells.includes(cell));
    if (sunk) return 'sunk';
    if (mark === 'hit') return 'hit';
    if (mark === 'miss') return 'miss';
    return '';
  }

  const shipAt = (placements, cell) =>
    (placements || []).find((p) => p.cells.includes(cell)) || null;

  // -------------------------------------------------------------- placing

  function renderPlacing() {
    const mine = state.boards[ctx.seat];
    const placed = new Map((state.yourFleet || []).map((p) => [p.key, p]));

    // Dropping a ship moves the highlight to the next one, so a fleet goes down
    // in five taps. Only on the drop, though: this used to run on every render,
    // which meant picking a placed ship back up bounced the highlight straight
    // off it again and Rotate appeared to do nothing.
    const firstFree = state.fleet.find((s) => !placed.has(s.key))?.key;
    if (!selected) selected = firstFree || state.fleet[0].key;
    else if (advanceOnPlace && placed.has(selected)) {
      advanceOnPlace = false;
      selected = firstFree || selected;
    }

    buildGrid($('bs-own-grid'), (cell) => {
      const ship = shipAt(state.yourFleet, cell);
      if (!ship) return '';
      return `ship${ship.key === selected ? ' picked' : ''}`;
    });

    $('bs-tray').innerHTML = state.fleet.map((s) => {
      const on = placed.has(s.key);
      return `<button class="bs-ship${on ? ' placed' : ''}${
        s.key === selected ? ' picked' : ''}" data-ship="${s.key}">
        <span class="bs-ship-name">${s.name}</span>
        <span class="bs-pips">${'▪'.repeat(s.size)}</span>
      </button>`;
    }).join('');

    const done = placed.size === state.fleet.length;
    const ready = state.youReady;
    $('bs-ready').disabled = !done || ready;
    $('bs-ready').textContent = ready ? 'Waiting for the others…' : 'Ready';
    for (const id of ['bs-rotate', 'bs-random', 'bs-clear']) $(id).disabled = ready;
    $('bs-rotate').textContent = dir === 'h' ? 'Rotate ⭢' : 'Rotate ⭣';

    const waiting = state.names
      .map((n, i) => ({ n, i }))
      .filter(({ i }) => i < state.humans && i !== ctx.seat && !state.placingReady[i])
      .map(({ n }) => n);

    // Rotate and the next tap both act on the highlighted ship, and placing one
    // moves the highlight along. Say which ship that is, or the buttons look
    // like they are doing nothing.
    const picked = state.fleet.find((s) => s.key === selected)?.name;
    $('bs-place-hint').textContent = ready
      ? (waiting.length ? `Waiting for ${waiting.join(', ')}…` : 'Starting…')
      : done
        ? 'All five at sea. Tap one on the grid to pick it up again.'
        : placed.has(selected)
          ? `Tap the grid to move the ${picked}, or Rotate to turn it.`
          : `Tap the grid to drop the ${picked}.`;
  }

  function placeAt(cell) {
    if (state.youReady || !selected) return;
    advanceOnPlace = true;
    const n = SIZE();
    ctx.act({ kind: 'place', ship: selected, x: cell % n, y: Math.floor(cell / n), dir });
  }

  $('bs-own-grid').onclick = (e) => {
    const cell = Number(e.target.closest('[data-cell]')?.dataset.cell);
    if (Number.isNaN(cell)) return;
    // Tapping a ship you have already put down picks it up rather than trying
    // to drop another one on top of it.
    const ship = shipAt(state.yourFleet, cell);
    if (ship && ship.key !== selected) {
      selected = ship.key;
      dir = ship.dir;
      advanceOnPlace = false;
      renderPlacing();
      return;
    }
    placeAt(cell);
  };

  $('bs-tray').onclick = (e) => {
    const key = e.target.closest('[data-ship]')?.dataset.ship;
    if (!key) return;
    selected = key;
    advanceOnPlace = false;
    renderPlacing();
  };

  $('bs-rotate').onclick = () => {
    dir = dir === 'h' ? 'v' : 'h';
    // Turning a ship that is already down should turn it where it stands.
    const ship = (state.yourFleet || []).find((p) => p.key === selected);
    if (ship) ctx.act({ kind: 'place', ship: selected, x: ship.x, y: ship.y, dir });
    else renderPlacing();
  };
  $('bs-random').onclick = () => ctx.act({ kind: 'randomise' });
  $('bs-clear').onclick = () => ctx.act({ kind: 'clearShips' });
  $('bs-ready').onclick = () => {
    $('bs-ready').disabled = true;
    ctx.act({ kind: 'confirm' });
  };

  // -------------------------------------------------------------- playing

  function renderPlaying() {
    const targets = state.alive
      .map((a, i) => (a && i !== ctx.seat ? i : -1)).filter((i) => i >= 0);
    if (target === null || !targets.includes(target)) target = targets[0] ?? null;

    $('bs-tabs').hidden = targets.length < 2;
    $('bs-tabs').innerHTML = targets.map((s) => `
      <button data-target="${s}"${s === target ? ' class="on"' : ''}>
        ${ctx.escapeHtml(state.names[s])} <i>${state.boards[s].left}</i>
      </button>`).join('');

    const board = target !== null ? state.boards[target] : null;
    const shot = state.lastShot;
    buildGrid($('bs-enemy-grid'), (cell) => {
      let cls = board ? damageClasses(board, cell) : '';
      if (cell === aim && board && !board.incoming[cell]) cls += ' aim';
      if (shot && shot.at === target && shot.cell === cell) cls += ' recent';
      return cls.trim();
    });

    const mine = state.boards[ctx.seat];
    buildGrid($('bs-mini-grid'), (cell) => {
      const dmg = damageClasses(mine, cell);
      const ship = shipAt(mine.placements, cell);
      return `${ship ? 'ship ' : ''}${dmg}${
        shot && shot.at === ctx.seat && shot.cell === cell ? ' recent' : ''}`;
    }, { labels: false });

    renderStatus();
  }

  function renderStatus() {
    const shot = state.lastShot;
    const banner = $('bs-shout');
    const yours = state.yourTurn;
    const out = !state.youAlive;

    // What just happened, in the words you would use out loud.
    if (shot && state.phase !== 'gameOver') {
      const who = shot.by === ctx.seat ? 'You' : state.names[shot.by];
      const at = shot.at === ctx.seat ? 'you' : state.names[shot.at];
      const verb = shot.by === ctx.seat ? 'hit' : 'hits';
      banner.className = 'bs-shout ' + shot.result + (shot.sunk ? ' sank' : '');
      banner.textContent = shot.eliminated
        ? `${who} destroyed ${at === 'you' ? 'your' : at + "'s"} fleet!`
        : shot.sunk
          ? `${who} sank ${shot.at === ctx.seat ? 'your' : 'the'} ${shot.sunk}!`
          : shot.result === 'hit'
            ? `${who} ${verb} ${at} at ${label(shot.cell)}`
            : `${who} missed at ${label(shot.cell)}`;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }

    const fire = $('bs-fire');
    fire.hidden = out;
    fire.disabled = !yours || aim === null;
    fire.textContent = aim !== null ? `Fire at ${label(aim)}` : 'Fire';

    $('bs-play-hint').textContent = out
      ? 'Your fleet is gone — watching it out.'
      // The banner above is already saying what just happened; a second line
      // of commentary underneath the grid only competes with it.
      : state.phase === 'shotResult'
        ? ''
        : yours
          ? (aim === null ? 'Tap a square, then fire.' : 'Tap the same square again to fire.')
          : `${state.names[state.turn]} is taking aim…`;
  }

  $('bs-tabs').onclick = (e) => {
    const t = e.target.closest('[data-target]')?.dataset.target;
    if (t === undefined) return;
    target = Number(t);
    aim = null;
    renderPlaying();
  };

  $('bs-enemy-grid').onclick = (e) => {
    const cell = Number(e.target.closest('[data-cell]')?.dataset.cell);
    if (Number.isNaN(cell) || !state.yourTurn || target === null) return;
    if (state.boards[target].incoming[cell]) return ctx.toast('Already fired at that square.');
    // Tap once to line it up, again to let it go — the button is for people who
    // would rather not risk a second tap landing somewhere else.
    if (aim === cell) return fire();
    aim = cell;
    renderPlaying();
  };

  function fire() {
    if (aim === null || !state.yourTurn) return;
    const cell = aim;
    aim = null;
    ctx.act({ kind: 'fire', target, cell });
  }
  $('bs-fire').onclick = fire;

  // --------------------------------------------------------------- render

  function render(s, c) {
    state = s;
    ctx = c;

    const placing = s.phase === 'placing';
    $('bs-place').hidden = !placing;
    $('bs-play').hidden = placing;

    // A fresh shot clears whatever we had lined up, so the aim marker never
    // outlives the turn it belonged to.
    if (s.lastShot && s.lastShot.nonce !== lastNonce) {
      lastNonce = s.lastShot.nonce;
      if (s.lastShot.by === c.seat) aim = null;
    }

    $('bs-phase').textContent = placing ? 'Setup' : `${s.boards[c.seat].left} afloat`;
    $('bs-turn').textContent = placing
      ? 'Hide your fleet'
      : s.phase === 'gameOver' ? 'All over'
      : s.turn === c.seat ? 'Your shot' : `${s.names[s.turn]}'s shot`;

    $('bs-fleets').innerHTML = s.names.slice(0, s.players).map((n, i) => `
      <div class="ds${i === s.turn && !placing ? ' drawing' : ''}${
        s.alive[i] ? '' : ' out'}">
        <b>${ctx.escapeHtml(i === c.seat ? 'You' : n)}</b>
        <span>${placing ? (s.placingReady[i] ? '✓' : '…') : `${s.boards[i].left}⛴`}</span>
      </div>`).join('');

    if (placing) renderPlacing(); else renderPlaying();
    renderOverlay();
  }

  function renderOverlay() {
    const ov = $('overlay');
    if (state.phase !== 'gameOver') { ov.hidden = true; return; }

    const won = state.winner === ctx.seat;
    ov.hidden = false;
    $('ov-title').textContent = won ? 'Fleet supreme!' : `${state.names[state.winner]} wins`;
    $('ov-body').textContent = won
      ? 'Every enemy ship is on the bottom.'
      : 'Your fleet is on the bottom.';
    $('ov-tricks').textContent = state.names.slice(0, state.players).map((n, i) => {
      const fired = state.shotsFired[i];
      const pct = fired ? Math.round((state.shotsHit[i] / fired) * 100) : 0;
      return `${i === ctx.seat ? 'You' : n} ${state.shotsHit[i]}/${fired} (${pct}%)`;
    }).join(' · ');
    $('ov-btn').hidden = false;
    $('ov-btn').disabled = false;
    $('ov-btn').textContent = 'Play again';
    $('ov-btn').onclick = () => ctx.act({ kind: 'newGame' });
  }

  window.registerGame('battleship', {
    root: 'game-battleship',
    usesCards: false,
    render,
    reset() {
      state = null;
      selected = null;
      advanceOnPlace = false;
      dir = 'h';
      target = null;
      aim = null;
      lastNonce = null;
    },
  });
})();
