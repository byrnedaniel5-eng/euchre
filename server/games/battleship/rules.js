// Battleships: the board, the fleet, and what happens when you fire.
//
// Everything here is pure. The engine owns whose turn it is and who has been
// knocked out; this file only knows about a ten-by-ten grid with some ships on
// it, which makes the fiddly part — is this placement legal, is that ship sunk
// — testable without a game around it.
//
// A cell is a single index 0..99, row-major. Two coordinates are convenient for
// people and a nuisance for everything else.

export const SIZE = 10;
export const CELLS = SIZE * SIZE;

export const idx = (x, y) => y * SIZE + x;
export const xy = (i) => ({ x: i % SIZE, y: Math.floor(i / SIZE) });
export const inGrid = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

/** The standard fleet, biggest first — placement is easiest in that order. */
export const FLEET = [
  { key: 'carrier', name: 'Carrier', size: 5 },
  { key: 'battleship', name: 'Battleship', size: 4 },
  { key: 'cruiser', name: 'Cruiser', size: 3 },
  { key: 'submarine', name: 'Submarine', size: 3 },
  { key: 'destroyer', name: 'Destroyer', size: 2 },
];

export const FLEET_CELLS = FLEET.reduce((n, s) => n + s.size, 0); // 17

const BY_KEY = new Map(FLEET.map((s) => [s.key, s]));
export const shipByKey = (key) => BY_KEY.get(key) || null;

/** Neighbouring cells, orthogonally, clipped to the grid. */
export function neighbours(i) {
  const { x, y } = xy(i);
  const out = [];
  if (x > 0) out.push(idx(x - 1, y));
  if (x < SIZE - 1) out.push(idx(x + 1, y));
  if (y > 0) out.push(idx(x, y - 1));
  if (y < SIZE - 1) out.push(idx(x, y + 1));
  return out;
}

/**
 * The cells a placement would occupy, or null if it runs off the edge.
 * `dir` is 'h' (rightwards) or 'v' (downwards).
 */
export function shipCells({ key, x, y, dir }) {
  const ship = shipByKey(key);
  if (!ship) return null;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (dir !== 'h' && dir !== 'v') return null;
  const cells = [];
  for (let n = 0; n < ship.size; n++) {
    const cx = dir === 'h' ? x + n : x;
    const cy = dir === 'v' ? y + n : y;
    if (!inGrid(cx, cy)) return null;
    cells.push(idx(cx, cy));
  }
  return cells;
}

export const newBoard = () => ({
  placements: [],
  incoming: new Array(CELLS).fill(null), // null | 'miss' | 'hit'
});

/** cell index -> ship key, for whatever is currently placed. */
export function occupancy(board, { ignore = null } = {}) {
  const map = new Map();
  for (const p of board.placements) {
    if (p.key === ignore) continue;
    for (const c of shipCells(p) || []) map.set(c, p.key);
  }
  return map;
}

/**
 * Why this placement is not allowed, or null if it is. Ships may sit alongside
 * each other — that is the standard game, and forbidding it makes a ten-by-ten
 * board feel much smaller than it is.
 */
export function placementError(board, spot) {
  const ship = shipByKey(spot.key);
  if (!ship) return 'no such ship';
  const cells = shipCells(spot);
  if (!cells) return `the ${ship.name} does not fit there`;
  const taken = occupancy(board, { ignore: spot.key });
  if (cells.some((c) => taken.has(c))) return `the ${ship.name} would overlap another ship`;
  return null;
}

/** Place or move a ship. Throws if it will not go there. */
export function place(board, spot) {
  const err = placementError(board, spot);
  if (err) throw new Error(err);
  board.placements = board.placements.filter((p) => p.key !== spot.key);
  board.placements.push({ key: spot.key, x: spot.x, y: spot.y, dir: spot.dir });
  return board;
}

export const unplace = (board, key) => {
  board.placements = board.placements.filter((p) => p.key !== key);
  return board;
};

export const fleetComplete = (board) => board.placements.length === FLEET.length;

/**
 * A whole fleet, dropped at random. Rejection sampling: the board is empty
 * enough that a legal spot is found within a handful of tries, and the cap only
 * exists so a future change to the fleet cannot hang the server.
 */
export function randomFleet(rng = Math.random) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const board = newBoard();
    let ok = true;
    for (const ship of FLEET) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const dir = rng() < 0.5 ? 'h' : 'v';
        const span = ship.size;
        const x = Math.floor(rng() * (dir === 'h' ? SIZE - span + 1 : SIZE));
        const y = Math.floor(rng() * (dir === 'v' ? SIZE - span + 1 : SIZE));
        const spot = { key: ship.key, x, y, dir };
        if (!placementError(board, spot)) {
          place(board, spot);
          placed = true;
        }
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return board.placements;
  }
  throw new Error('could not lay out a fleet'); // unreachable with this fleet
}

// ------------------------------------------------------------------- shooting

export const isSunk = (board, placement) =>
  (shipCells(placement) || []).every((c) => board.incoming[c] === 'hit');

/** Every sunk ship, with the cells it occupied — safe to show, they are all hits. */
export const sunkShips = (board) =>
  board.placements
    .filter((p) => isSunk(board, p))
    .map((p) => ({ key: p.key, name: shipByKey(p.key).name, cells: shipCells(p) }));

export const shipsLeft = (board) =>
  board.placements.filter((p) => !isSunk(board, p)).length;

export const fleetDestroyed = (board) =>
  fleetComplete(board) && board.placements.every((p) => isSunk(board, p));

/**
 * Fire at one cell of a board. Returns what the shot did; the caller decides
 * what that means for the turn.
 */
export function fireAt(board, cell) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) throw new Error('not a square');
  if (board.incoming[cell]) throw new Error('that square has already been fired at');

  const hitShip = board.placements.find((p) => (shipCells(p) || []).includes(cell));
  board.incoming[cell] = hitShip ? 'hit' : 'miss';

  return {
    cell,
    result: hitShip ? 'hit' : 'miss',
    // Named only when this shot finished it off, which is what a player is told.
    sunk: hitShip && isSunk(board, hitShip) ? shipByKey(hitShip.key).name : null,
    sunkKey: hitShip && isSunk(board, hitShip) ? hitShip.key : null,
    destroyed: fleetDestroyed(board),
  };
}
