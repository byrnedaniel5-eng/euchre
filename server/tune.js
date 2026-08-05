// Bot tuning harness. Sits team {0,2} on a candidate profile and team {1,3} on
// the baseline, plays a lot of games, and reports the candidate's win rate.
// Seats are swapped halfway so deal position cannot flatter either side.
//
//   node server/tune.js

import { EuchreGame } from './euchre.js';
import { botAct, PROFILE, seatProfiles } from './bot.js';

const BASE = { ...PROFILE };
const GAMES = 4000;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playGame(rng) {
  const g = new EuchreGame({ rng });
  let steps = 0;
  while (g.phase !== 'gameOver') {
    if (++steps > 5000) throw new Error('stuck');
    if (g.phase === 'trickComplete') { g.finishTrick(); continue; }
    if (g.phase === 'handOver') { g.nextHand(); continue; }
    botAct(g, g.turn);
  }
  return g.score[0] > g.score[1] ? 0 : 1;
}

/** Win rate of `candidate` against the baseline, colour-balanced. */
function match(candidate, games = GAMES) {
  let wins = 0;
  for (let i = 0; i < games; i++) {
    const candidateOnTeam0 = i % 2 === 0;
    if (candidateOnTeam0) {
      seatProfiles[0] = seatProfiles[2] = candidate;
      seatProfiles[1] = seatProfiles[3] = BASE;
    } else {
      seatProfiles[0] = seatProfiles[2] = BASE;
      seatProfiles[1] = seatProfiles[3] = candidate;
    }
    const winningTeam = playGame(mulberry32(i * 104729 + 7));
    const candidateTeam = candidateOnTeam0 ? 0 : 1;
    if (winningTeam === candidateTeam) wins++;
  }
  seatProfiles.fill(null);
  return wins / games;
}

// Standard error on a proportion, for reading the noise floor.
const se = (p, n) => Math.sqrt((p * (1 - p)) / n);

console.log(`baseline: ${JSON.stringify(BASE)}`);
console.log(`${GAMES} games per candidate, ±${(1.96 * se(0.5, GAMES) * 100).toFixed(1)}pp at 95%\n`);

const sweeps = JSON.parse(process.env.SWEEPS || 'null') || {
  alone: [3.00, 3.20, 3.40, 3.60, 3.80, 4.00, 4.40],
  order: [1.85, 2.00, 2.15, 2.30, 2.45],
  call: [2.05, 2.20, 2.30, 2.45, 2.60],
  dealerLastCall: [1.75, 1.90, 2.05, 2.20],
};

for (const [key, values] of Object.entries(sweeps)) {
  console.log(`--- ${key} ---`);
  const rows = [];
  for (const v of values) {
    const rate = match({ ...BASE, [key]: v });
    rows.push({ v, rate });
    const bar = '█'.repeat(Math.max(0, Math.round((rate - 0.42) * 200)));
    console.log(
      `  ${String(v).padEnd(6)} ${(rate * 100).toFixed(1)}%  ${bar}` +
      (v === BASE[key] ? '   <- current' : '')
    );
  }
  const best = rows.reduce((a, b) => (b.rate > a.rate ? b : a));
  console.log(`  best: ${best.v} at ${(best.rate * 100).toFixed(1)}%\n`);
}
