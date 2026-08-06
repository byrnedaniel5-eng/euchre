// Rules soak test: play thousands of full bot-vs-bot games and assert the
// invariants that matter. Run with `node server/selftest.js`.

import { EuchreGame, teamOf, partnerOf, WINNING_SCORE } from './games/euchre/engine.js';
import { botAct, evaluateHand } from './games/euchre/bot.js';
import {
  makeDeck, effectiveSuit, legalPlays, cardPower, winningPlayIndex, suitOf,
} from './games/euchre/cards.js';

let failures = 0;
function assert(cond, msg, ctx) {
  if (!cond) {
    failures++;
    if (failures <= 10) console.error('FAIL:', msg, ctx ? JSON.stringify(ctx) : '');
  }
}

// Deterministic RNG so a failure is reproducible.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------- unit-ish checks

function checkCardLogic() {
  // Left bower follows trump, not its printed suit.
  assert(effectiveSuit('JD', 'H') === 'H', 'JD is a heart when hearts are trump');
  assert(effectiveSuit('JH', 'H') === 'H', 'JH is a heart when hearts are trump');
  assert(effectiveSuit('JD', 'S') === 'D', 'JD is a diamond when spades are trump');

  // Right beats left beats ace of trump.
  assert(cardPower('JS', 'S', 'S') > cardPower('JC', 'S', 'S'), 'right > left');
  assert(cardPower('JC', 'S', 'S') > cardPower('AS', 'S', 'S'), 'left > ace of trump');
  assert(cardPower('9S', 'S', 'H') > cardPower('AH', 'S', 'H'), 'any trump > ace of led suit');
  assert(cardPower('AH', 'S', 'H') > cardPower('AD', 'S', 'H'), 'led suit > off suit');

  // You must follow with the left bower when trump is led.
  const hand = ['JD', 'AC', '9C'];
  const legal = legalPlays(hand, 'H', 'H');
  assert(legal.length === 1 && legal[0] === 'JD', 'left bower must follow a trump lead', legal);

  // And you must NOT be forced to play it when its printed suit is led.
  const legal2 = legalPlays(['JD', 'AC', '9C'], 'H', 'D');
  assert(legal2.length === 3, 'left bower does not follow its printed suit', legal2);

  // A trick led with the left bower is a trump trick.
  const plays = [{ seat: 0, card: 'JD' }, { seat: 1, card: 'AD' }];
  assert(winningPlayIndex(plays, 'H', 'H') === 0, 'left bower led wins over ace of diamonds');

  // Hand evaluation is ordered sensibly.
  const monster = evaluateHand(['JS', 'JC', 'AS', 'KS', 'AH'], 'S');
  const trash = evaluateHand(['9D', 'TD', 'QC', '9H', 'TH'], 'S');
  assert(monster > 4 && trash < 1, 'evaluator ranks a monster over trash', { monster, trash });
}

// -------------------------------------------------------- full-game soak

function playGame(rng, stats) {
  const g = new EuchreGame({ names: ['A', 'B', 'C', 'D'], rng });
  let steps = 0;

  while (g.phase !== 'gameOver') {
    if (++steps > 5000) throw new Error('game did not terminate');

    if (g.phase === 'trickComplete') {
      // Every card in the trick came from a distinct active seat.
      const seats = new Set(g.trick.map((p) => p.seat));
      assert(seats.size === g.playersInTrick(), 'trick has one card per active player');
      assert(!seats.has(g.sittingOut), 'the sitting-out seat never plays');
      g.finishTrick();
      continue;
    }
    if (g.phase === 'handOver') {
      const s = g.lastHandSummary;
      const total = s.tricksWon.reduce((a, b) => a + b, 0);
      assert(total === 5, 'five tricks were taken', s.tricksWon);
      stats.hands++;
      stats.points[s.reason] = (stats.points[s.reason] || 0) + 1;
      if (s.alone) {
        stats.loners++;
        stats.lonerPoints += s.scoringTeam === s.makerTeam ? s.points : -s.points;
        if (s.makerTricks === 5) stats.lonerMarch++;
        else if (s.makerTricks >= 3) stats.lonerMade++;
        else stats.lonerEuchred++;
      } else {
        stats.solo++;
        stats.soloPoints += s.scoringTeam === s.makerTeam ? s.points : -s.points;
      }
      g.nextHand();
      continue;
    }

    // Bidding / discard / play — always someone's turn, never the sat-out seat.
    assert(g.turn !== g.sittingOut || g.phase === 'discard', 'turn is an active seat', {
      phase: g.phase, turn: g.turn, out: g.sittingOut,
    });

    if (g.phase === 'play') {
      // Hand sizes stay consistent: everyone still in has the same count.
      const active = [0, 1, 2, 3].filter((s) => s !== g.sittingOut);
      const counts = new Set(
        active.map((s) => g.hands[s].length + (g.trick.some((p) => p.seat === s) ? 1 : 0))
      );
      assert(counts.size === 1, 'active hands stay level', [...counts]);
    }

    const before = g.hands.map((h) => h.length);
    botAct(g, g.turn);
    // Nobody's hand grows except the dealer taking the upcard.
    g.hands.forEach((h, s) => {
      assert(h.length <= before[s] || s === g.dealer, 'hands only shrink', { s });
    });
  }

  const [a, b] = g.score;
  assert(Math.max(a, b) >= WINNING_SCORE, 'game ended at the target score', g.score);
  assert(a < WINNING_SCORE || b < WINNING_SCORE, 'only one side reaches ten', g.score);
  stats.games++;
  stats.winMargin += Math.abs(a - b);
  stats.teamWins[a > b ? 0 : 1]++;
  stats.handsPerGame.push(g.handNumber);
  return g;
}

// A deck check: every hand deals 24 distinct cards.
function checkDeal(rng) {
  const g = new EuchreGame({ rng });
  const all = [...g.hands.flat(), g.upcard, ...g.kitty];
  assert(all.length === 24, 'a deal accounts for all 24 cards', all.length);
  assert(new Set(all).size === 24, 'no duplicate cards in a deal');
  assert(g.hands.every((h) => h.length === 5), 'everyone gets five cards');
  assert(g.turn === (g.dealer + 1) % 4, 'bidding starts left of the dealer');
}

// ------------------------------------------------------------------- run

console.log('card logic…');
checkCardLogic();

console.log('deals…');
for (let i = 0; i < 500; i++) checkDeal(mulberry32(i + 1));

const N = 2000;
console.log(`playing ${N} full games…`);
const stats = {
  games: 0, hands: 0, loners: 0, winMargin: 0,
  lonerMarch: 0, lonerMade: 0, lonerEuchred: 0, lonerPoints: 0,
  solo: 0, soloPoints: 0,
  teamWins: [0, 0], points: {}, handsPerGame: [],
};
for (let i = 0; i < N; i++) {
  try {
    playGame(mulberry32(i * 7919 + 13), stats);
  } catch (err) {
    failures++;
    console.error(`game ${i} threw:`, err.message);
    if (failures > 5) break;
  }
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log('\n--- results ---');
console.log(`games            ${stats.games}`);
console.log(`hands            ${stats.hands}`);
console.log(`hands per game   ${avg(stats.handsPerGame).toFixed(1)}`);
console.log(`team 0 / team 1  ${stats.teamWins[0]} / ${stats.teamWins[1]}`);
console.log(`avg win margin   ${(stats.winMargin / stats.games).toFixed(2)}`);
console.log(`loners called    ${stats.loners} (${(100 * stats.loners / stats.hands).toFixed(1)}% of hands)`);
console.log(`  marched        ${stats.lonerMarch} (${(100 * stats.lonerMarch / stats.loners).toFixed(0)}%)`);
console.log(`  made 3-4       ${stats.lonerMade} (${(100 * stats.lonerMade / stats.loners).toFixed(0)}%)`);
console.log(`  euchred        ${stats.lonerEuchred} (${(100 * stats.lonerEuchred / stats.loners).toFixed(0)}%)`);
console.log(`  net pts/loner  ${(stats.lonerPoints / stats.loners).toFixed(2)}`);
console.log(`net pts/partner call ${(stats.soloPoints / stats.solo).toFixed(2)}`);
console.log('hand outcomes   ', stats.points);

// Sanity band: euchres should happen, but makers should win most hands.
const made = (stats.points['made it'] || 0) + (stats.points['took all five'] || 0) +
             (stats.points['marched alone'] || 0);
const euchred = stats.points['euchred!'] || 0;
const euchreRate = euchred / stats.hands;
assert(euchreRate > 0.05 && euchreRate < 0.35, `euchre rate is plausible (${euchreRate.toFixed(3)})`);
assert(made > euchred * 2, 'makers make it more often than not');
assert(Math.abs(stats.teamWins[0] - stats.teamWins[1]) < N * 0.12, 'no seat-position bias',
  stats.teamWins);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
