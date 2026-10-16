// The Yahtzee bot.
//
// Every box has a typical value — what it averages over a game of decent
// play. Scoring a box is worth what you put in it, less that typical value:
// a 3 in Ones is fine, a 3 in Chance is a waste. Upper boxes get a push
// towards the 63 bonus when they reach three of a face.
//
// Between rolls it tries all 32 ways of holding the dice, rerolls the rest
// a few dozen times, and keeps whichever hold leads to the best box on
// average. Sharp simulates more and never fumbles; casual is quicker and now
// and then keeps the wrong dice.

import { options, UPPER, isYahtzee } from './rules.js';

const TYPICAL = {
  ones: 2.1, twos: 5.3, threes: 8.6, fours: 12.2, fives: 15.7, sixes: 19.2,
  threeKind: 21.7, fourKind: 13.1, fullHouse: 22.6, smallStraight: 29.5,
  largeStraight: 32.7, yahtzee: 16.9, chance: 22.0,
};

export const SKILLS = {
  casual: { key: 'casual', label: 'Casual', sims: 18, slip: 0.15 },
  sharp: { key: 'sharp', label: 'Sharp', sims: 70, slip: 0 },
};
export const DEFAULT_SKILL = SKILLS.casual;
export const skillByKey = (k) => SKILLS[k] || DEFAULT_SKILL;

function value(sheet, cat, points, dice) {
  let v = points - TYPICAL[cat];
  const i = UPPER.indexOf(cat);
  if (i >= 0 && points >= (i + 1) * 3) v += 6; // on pace for the bonus
  if (cat === 'yahtzee' && points === 50) v += 30;
  if (isYahtzee(dice) && sheet.yahtzee === 50) v += 100;
  return v;
}

/** The best box for these dice, and how good it is. */
export function bestBox(sheet, dice) {
  let best = null;
  for (const [cat, pts] of Object.entries(options(sheet, dice))) {
    const v = value(sheet, cat, pts, dice);
    if (!best || v > best.v) best = { cat, v };
  }
  return best;
}

/** Which dice to hold, given rolls still to come. */
export function chooseHold(sheet, dice, rollsLeft, skill = DEFAULT_SKILL, rng = Math.random) {
  if (rng() < skill.slip) return [0, 1, 2, 3, 4].map(() => rng() < 0.5);
  let best = null;
  for (let mask = 0; mask < 32; mask++) {
    const held = [0, 1, 2, 3, 4].map((i) => !!(mask & (1 << i)));
    let total = 0;
    for (let s = 0; s < skill.sims; s++) {
      let d = dice.map((x, i) => (held[i] ? x : 1 + Math.floor(rng() * 6)));
      // One more reroll to come: a cheap stand-in — keep what matches the
      // most common face and roll the rest.
      if (rollsLeft > 1) {
        const c = [0, 0, 0, 0, 0, 0, 0];
        for (const x of d) c[x]++;
        const face = c.indexOf(Math.max(...c));
        d = d.map((x) => (x === face ? x : 1 + Math.floor(rng() * 6)));
      }
      total += bestBox(sheet, d).v;
    }
    const avg = total / skill.sims;
    if (!best || avg > best.avg) best = { held, avg };
  }
  return best.held;
}

/** A whole decision: roll again (with these held), or score a box. */
export function decide(game, seat, skill = DEFAULT_SKILL, rng = Math.random) {
  const sheet = game.sheets[seat];
  if (game.rollsLeft === 3) return { kind: 'roll' };
  const now = bestBox(sheet, game.dice);
  if (game.rollsLeft === 0) return { kind: 'score', cat: now.cat };
  // Stop early on something that cannot be bettered.
  if (now.v >= 25 || (now.cat === 'largeStraight') || (now.cat === 'yahtzee')) {
    return { kind: 'score', cat: now.cat };
  }
  const held = chooseHold(sheet, game.dice, game.rollsLeft, skill, rng);
  if (held.every(Boolean)) return { kind: 'score', cat: now.cat };
  return { kind: 'roll', held };
}
