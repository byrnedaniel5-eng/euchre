// The computer opponent.
//
// It is handed a *knowledge* object, not a board. That is deliberate: the
// server has every ship position to hand, so the only reliable way to promise
// the bot does not cheat is to make cheating impossible — it is never given
// anything a person sitting opposite could not work out for themselves.
//
// The play is the standard one. While a hit is unaccounted for, chase it: along
// the line if two hits line up, around it otherwise. Otherwise hunt, either on
// the odd/even lattice (no ship can hide from it, and it halves the search) or
// by counting how many ways each remaining ship could still lie across a
// square, which is stronger and is what the sharper setting uses.

import { SIZE, CELLS, idx, xy, neighbours, shipByKey } from './rules.js';

export const SKILLS = {
  casual: { key: 'casual', label: 'Casual', density: false, slip: 0.18 },
  sharp: { key: 'sharp', label: 'Sharp', density: true, slip: 0 },
};
export const DEFAULT_SKILL = SKILLS.casual;
export const skillByKey = (k) => SKILLS[k] || DEFAULT_SKILL;

/**
 * What anyone watching the board can see: the shots, which squares belong to
 * ships already sunk, and therefore which ships are still out there.
 */
export function knowledgeOf(board, { sunkShips }) {
  const sunk = sunkShips(board);
  const sunkCells = new Set(sunk.flatMap((s) => s.cells));
  const sunkKeys = new Set(sunk.map((s) => s.key));
  return {
    incoming: board.incoming,
    sunkCells,
    remaining: board.placements.map((p) => p.key).filter((k) => !sunkKeys.has(k)),
  };
}

const untried = (k, i) => k.incoming[i] === null;

/** Hits that no sunk ship accounts for — something is still floating there. */
export const liveHits = (k) => {
  const out = [];
  for (let i = 0; i < CELLS; i++) {
    if (k.incoming[i] === 'hit' && !k.sunkCells.has(i)) out.push(i);
  }
  return out;
};

/**
 * Where to shoot to finish off a ship we have already found. Returns [] when
 * there is nothing outstanding.
 */
function chase(k) {
  const hits = liveHits(k);
  if (!hits.length) return [];
  const hitSet = new Set(hits);
  const ends = [];

  // Two hits in a row tell you the orientation, so stop guessing at the sides
  // and push at both ends of the line.
  for (const h of hits) {
    const { x, y } = xy(h);
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= SIZE || ny >= SIZE || !hitSet.has(idx(nx, ny))) continue;
      // Walk to each end of the run and take the square past it.
      for (const sign of [-1, 1]) {
        let cx = sign < 0 ? x : nx;
        let cy = sign < 0 ? y : ny;
        while (cx + dx * sign >= 0 && cy + dy * sign >= 0 &&
               cx + dx * sign < SIZE && cy + dy * sign < SIZE &&
               hitSet.has(idx(cx + dx * sign, cy + dy * sign))) {
          cx += dx * sign;
          cy += dy * sign;
        }
        const ex = cx + dx * sign;
        const ey = cy + dy * sign;
        if (ex >= 0 && ey >= 0 && ex < SIZE && ey < SIZE && untried(k, idx(ex, ey))) {
          ends.push(idx(ex, ey));
        }
      }
    }
  }
  if (ends.length) return ends;

  // A lone hit: try all four sides.
  return hits.flatMap((h) => neighbours(h).filter((n) => untried(k, n)));
}

/**
 * How many ways each remaining ship could still be lying across each square.
 * The busiest square is the best guess — this is what makes the sharp bot find
 * a fleet in about forty shots rather than sixty.
 */
function density(k) {
  const score = new Array(CELLS).fill(0);
  const blocked = (i) => k.incoming[i] === 'miss' || k.sunkCells.has(i);
  for (const key of k.remaining) {
    const size = shipByKey(key)?.size;
    if (!size) continue;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const ex = x + dx * (size - 1);
          const ey = y + dy * (size - 1);
          if (ex >= SIZE || ey >= SIZE) continue;
          const cells = [];
          let fits = true;
          for (let n = 0; n < size; n++) {
            const c = idx(x + dx * n, y + dy * n);
            if (blocked(c)) { fits = false; break; }
            cells.push(c);
          }
          if (!fits) continue;
          for (const c of cells) score[c]++;
        }
      }
    }
  }
  return score;
}

/** The odd/even lattice: the smallest ship is two long, so it cannot slip through. */
const onLattice = (i) => {
  const { x, y } = xy(i);
  return (x + y) % 2 === 0;
};

const pickBest = (cands, score, rng) => {
  let best = -1;
  let bestCells = [];
  for (const c of cands) {
    const s = score ? score[c] : 0;
    if (s > best) { best = s; bestCells = [c]; } else if (s === best) bestCells.push(c);
  }
  return bestCells[Math.floor(rng() * bestCells.length)];
};

/** The square this bot fires at next. */
export function chooseShot(knowledge, skill = DEFAULT_SKILL, rng = Math.random) {
  const k = knowledge;
  const open = [];
  for (let i = 0; i < CELLS; i++) if (untried(k, i)) open.push(i);
  if (!open.length) throw new Error('nowhere left to fire');

  // Even a good player sometimes shoots where they meant not to. Without this
  // the casual bot is not casual, it is just the sharp one with a smaller brain.
  if (skill.slip && rng() < skill.slip) return open[Math.floor(rng() * open.length)];

  const chasing = chase(k).filter((c) => untried(k, c));
  if (chasing.length) {
    return skill.density
      ? pickBest(chasing, density(k), rng)
      : chasing[Math.floor(rng() * chasing.length)];
  }

  if (skill.density) return pickBest(open, density(k), rng);

  const lattice = open.filter(onLattice);
  return (lattice.length ? lattice : open)[Math.floor(rng() * (lattice.length || open.length))];
}
