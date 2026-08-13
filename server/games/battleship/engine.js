// Battleships engine.
//
// Two to four fleets, one grid each, taking it in turns to fire. The rules are
// the ones everybody already knows; the only decisions worth writing down are
// the ones a four-player table forces you to make.
//
// Shots on a board are public. With two players that is exactly the classic
// game — there is nobody else to hide them from — and with three or four it
// stops the table degenerating into everyone privately re-shooting the same
// squares. It also means a board's damage is one shared record rather than one
// per shooter, which is what keeps the state small enough to send every turn.
//
// Phases:
//   'placing'    - laying out fleets; nobody can see anyone else's
//   'playing'    - waiting for the player whose turn it is to fire
//   'shotResult' - the shot has landed and is being shown before the turn moves
//   'gameOver'   - one fleet left afloat

import {
  SIZE, FLEET, newBoard, place, unplace, randomFleet, fleetComplete,
  placementError, fireAt, sunkShips, shipsLeft, shipCells, xy,
} from './rules.js';

export const REVEAL_MS = 1500;

const column = (x) => String.fromCharCode(65 + x); // A..J
export const square = (cell) => {
  const { x, y } = xy(cell);
  return `${column(x)}${y + 1}`;
};

export class BattleshipGame {
  constructor({
    names = [], playerCount = 2, humanCount = playerCount,
    goAgain = false, revealMs = REVEAL_MS, rng = Math.random,
  } = {}) {
    this.names = names;
    this.playerCount = playerCount;
    this.humanCount = humanCount;
    this.goAgain = goAgain;
    this.revealMs = revealMs;
    this.rng = rng;

    this.boards = Array.from({ length: playerCount }, () => newBoard());
    this.alive = new Array(playerCount).fill(true);
    this.ready = new Array(playerCount).fill(false);
    this.shotsFired = new Array(playerCount).fill(0);
    this.shotsHit = new Array(playerCount).fill(0);
    this.lastShot = null;
    this.winner = null;
    this.log = [];

    // Bots lay out before anyone has had a chance to think, which is fine:
    // nobody can see it, and it keeps the placing phase about the people.
    for (let s = humanCount; s < playerCount; s++) {
      this.boards[s].placements = randomFleet(rng);
      this.ready[s] = true;
    }

    this.phase = 'placing';
    this.pushLog('--- Place your fleet ---');
    // A table of nothing but bots is already laid out. Only the tests do this,
    // but a phase nobody can ever leave is not worth leaving lying around.
    if (this.ready.every(Boolean)) this.begin();
  }

  pushLog(text) {
    this.log.push(text);
    if (this.log.length > 60) this.log.shift();
  }

  seats() {
    return Array.from({ length: this.playerCount }, (_, i) => i);
  }

  // ------------------------------------------------------------------ placing

  place(seat, spot) {
    if (this.phase !== 'placing') throw new Error('the fleets are already at sea');
    if (this.ready[seat]) throw new Error('you have already confirmed your fleet');
    place(this.boards[seat], spot);
  }

  unplace(seat, key) {
    if (this.phase !== 'placing') throw new Error('the fleets are already at sea');
    if (this.ready[seat]) throw new Error('you have already confirmed your fleet');
    unplace(this.boards[seat], key);
  }

  randomise(seat) {
    if (this.phase !== 'placing') throw new Error('the fleets are already at sea');
    if (this.ready[seat]) throw new Error('you have already confirmed your fleet');
    this.boards[seat].placements = randomFleet(this.rng);
  }

  clear(seat) {
    if (this.phase !== 'placing') throw new Error('the fleets are already at sea');
    if (this.ready[seat]) throw new Error('you have already confirmed your fleet');
    this.boards[seat].placements = [];
  }

  confirm(seat) {
    if (this.phase !== 'placing') throw new Error('the fleets are already at sea');
    if (!fleetComplete(this.boards[seat])) throw new Error('place all five ships first');
    this.ready[seat] = true;
    this.pushLog(`${this.names[seat]} is ready.`);
    if (this.ready.every(Boolean)) this.begin();
  }

  /** Everyone is laid out. Somebody has to go first, and it is drawn. */
  begin() {
    this.turn = Math.floor(this.rng() * this.playerCount);
    this.phase = 'playing';
    this.pushLog(`--- Open fire — ${this.names[this.turn]} starts ---`);
  }

  // ------------------------------------------------------------------ playing

  /** The seats this player is allowed to shoot at. */
  targetsFor(seat) {
    return this.seats().filter((s) => s !== seat && this.alive[s]);
  }

  fire(seat, target, cell) {
    if (this.phase !== 'playing') throw new Error('not ready to fire');
    if (seat !== this.turn) throw new Error('it is not your turn');
    if (!this.alive[seat]) throw new Error('your fleet is gone');
    if (target === seat) throw new Error('you cannot fire at your own fleet');
    if (!this.alive[target]) throw new Error('that fleet has already been sunk');

    const shot = fireAt(this.boards[target], cell);
    this.shotsFired[seat]++;
    if (shot.result === 'hit') this.shotsHit[seat]++;

    this.lastShot = {
      by: seat, at: target, cell: shot.cell, result: shot.result,
      sunk: shot.sunk, sunkKey: shot.sunkKey, eliminated: shot.destroyed,
      nonce: (this.lastShot?.nonce || 0) + 1,
    };

    const where = `${this.names[seat]} → ${this.names[target]} ${square(shot.cell)}`;
    if (shot.destroyed) this.pushLog(`${where}: sank the ${shot.sunk} — fleet destroyed!`);
    else if (shot.sunk) this.pushLog(`${where}: sank the ${shot.sunk}!`);
    else this.pushLog(`${where}: ${shot.result}`);

    if (shot.destroyed) this.alive[target] = false;

    // Hold the result on screen. Both players need a moment to see where the
    // shot went — this is the game's only feedback, and it is over in an instant
    // if the turn flips the same tick.
    this.phase = 'shotResult';
    return this.lastShot;
  }

  /** The reveal is over: hand on the turn, or end it. */
  afterShot() {
    if (this.phase !== 'shotResult') return;
    const standing = this.seats().filter((s) => this.alive[s]);
    if (standing.length <= 1) {
      this.winner = standing[0] ?? null;
      this.phase = 'gameOver';
      const acc = this.shotsFired[this.winner]
        ? Math.round((this.shotsHit[this.winner] / this.shotsFired[this.winner]) * 100) : 0;
      this.pushLog(`*** ${this.names[this.winner]} wins — ${this.shotsHit[this.winner]}` +
        `/${this.shotsFired[this.winner]} shots on target (${acc}%) ***`);
      return;
    }

    const last = this.lastShot;
    // A hit can buy you another shot, but only if there is still something to
    // shoot at — knocking the last fleet out never earns a turn against nobody.
    const keepsTurn = this.goAgain && last?.result === 'hit' &&
      this.alive[last.by] && this.targetsFor(last.by).length > 0;
    if (!keepsTurn) {
      let next = this.turn;
      do { next = (next + 1) % this.playerCount; } while (!this.alive[next]);
      this.turn = next;
    }
    this.phase = 'playing';
  }

  // -------------------------------------------------------------------- views

  boardView(boardSeat, viewer) {
    const board = this.boards[boardSeat];
    const mine = boardSeat === viewer;
    const open = this.phase === 'gameOver';
    return {
      seat: boardSeat,
      incoming: board.incoming.slice(),
      // A sunk ship's squares are all hits already, so its outline gives
      // nothing away — and being told what you sank is half the game.
      sunk: sunkShips(board).map((s) => ({ key: s.key, name: s.name, cells: s.cells })),
      left: shipsLeft(board),
      alive: this.alive[boardSeat],
      // The one thing that must never leak: where the ships actually are.
      placements: mine || open
        ? board.placements.map((p) => ({ ...p, cells: shipCells(p) }))
        : null,
    };
  }

  viewFor(seat) {
    return {
      phase: this.phase,
      game: 'battleship',
      names: this.names,
      players: this.playerCount,
      botCount: this.playerCount - this.humanCount,
      size: SIZE,
      fleet: FLEET,
      goAgain: this.goAgain,
      revealMs: this.revealMs,
      turn: this.turn ?? null,
      yourTurn: this.phase === 'playing' && this.turn === seat,
      alive: this.alive.slice(),
      youAlive: !!this.alive[seat],
      placingReady: this.ready.slice(),
      youReady: !!this.ready[seat],
      yourFleet: this.boards[seat].placements.map((p) => ({ ...p, cells: shipCells(p) })),
      targets: this.phase === 'playing' ? this.targetsFor(seat) : [],
      boards: this.seats().map((s) => this.boardView(s, seat)),
      shotsFired: this.shotsFired.slice(),
      shotsHit: this.shotsHit.slice(),
      lastShot: this.lastShot,
      winner: this.winner,
      log: this.log.slice(-12),
      you: { seat },
    };
  }
}

export { placementError, FLEET, SIZE };
