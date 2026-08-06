// Plays every difficulty level against every other and prints the win-rate
// grid. The point is to prove the ladder is real: a setting that does not
// change how often you win is just a label.
//
//   node server/ladder.js [gamesPerPair]

import { EuchreGame } from './games/euchre/engine.js';
import { botAct, SKILLS } from './games/euchre/bot.js';

const GAMES = Number(process.argv[2]) || 3000;
const LEVELS = Object.keys(SKILLS);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One game; team 0 plays skillA, team 1 plays skillB. Returns winning team. */
function playGame(rng, skillA, skillB) {
  const g = new EuchreGame({ rng });
  const skillFor = (seat) => (seat % 2 === 0 ? skillA : skillB);
  let steps = 0;
  while (g.phase !== 'gameOver') {
    if (++steps > 5000) throw new Error('stuck');
    if (g.phase === 'trickComplete') { g.finishTrick(); continue; }
    if (g.phase === 'handOver') { g.nextHand(); continue; }
    botAct(g, g.turn, skillFor(g.turn));
  }
  return g.score[0] > g.score[1] ? 0 : 1;
}

/** Win rate of `a` against `b`, with the seats swapped half the time. */
function match(a, b, games) {
  let wins = 0;
  for (let i = 0; i < games; i++) {
    const aIsTeam0 = i % 2 === 0;
    const winner = aIsTeam0
      ? playGame(mulberry32(i * 104729 + 7), SKILLS[a], SKILLS[b])
      : playGame(mulberry32(i * 104729 + 7), SKILLS[b], SKILLS[a]);
    if (winner === (aIsTeam0 ? 0 : 1)) wins++;
  }
  return wins / games;
}

const se = (p, n) => Math.sqrt((p * (1 - p)) / n);
const margin = 1.96 * se(0.5, GAMES) * 100;

console.log(`${GAMES} games per pairing, ±${margin.toFixed(1)}pp at 95%\n`);

const grid = {};
for (const a of LEVELS) {
  grid[a] = {};
  for (const b of LEVELS) {
    if (a === b) { grid[a][b] = null; continue; }
    if (grid[b]?.[a] != null) { grid[a][b] = 1 - grid[b][a]; continue; }
    grid[a][b] = match(a, b, GAMES);
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('', 9) + LEVELS.map((l) => pad(l, 9)).join(''));
for (const a of LEVELS) {
  const row = LEVELS.map((b) =>
    pad(grid[a][b] == null ? '—' : `${(grid[a][b] * 100).toFixed(1)}%`, 9));
  console.log(pad(a, 9) + row.join(''));
}

// Each level must beat the one below it by more than the noise floor.
console.log('\nladder check (each level vs the one below):');
let failures = 0;
for (let i = 1; i < LEVELS.length; i++) {
  const higher = LEVELS[i];
  const lower = LEVELS[i - 1];
  const rate = grid[higher][lower] * 100;
  const beats = rate > 50 + margin;
  console.log(`  ${beats ? 'ok  ' : 'FAIL'}  ${pad(higher, 7)} beats ${pad(lower, 7)} ` +
    `${rate.toFixed(1)}%  (needs > ${(50 + margin).toFixed(1)}%)`);
  if (!beats) failures++;
}

// And the ends should be far apart, or the range is not worth offering.
const top = LEVELS[LEVELS.length - 1];
const bottom = LEVELS[0];
const spread = grid[top][bottom] * 100;
console.log(`\n  ${top} beats ${bottom} ${spread.toFixed(1)}%`);
if (spread < 65) {
  failures++;
  console.log('  FAIL  the range between the easiest and hardest is too narrow');
}

console.log(failures === 0 ? '\nLADDER OK' : `\n${failures} PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
