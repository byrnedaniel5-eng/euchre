// The cribbage bot.
//
// Discarding: try all fifteen ways to throw two, and for each, average what
// the four kept cards would count over every starter that could be cut. Add
// a rough value for what the two thrown cards bring to the crib — plus if it
// is the bot's crib, minus if not.
//
// Pegging: take points when they are there; otherwise avoid leaving a count
// of 5 or 21, where any ten-card makes 15 or 31 for the other side, and lead
// low so a fifteen is out of reach.

import { makeDeck, value, rankNum, countHand, pegPoints } from './rules.js';

export const SKILLS = {
  casual: { key: 'casual', label: 'Casual', pick: 3, slip: 0.15 },
  sharp: { key: 'sharp', label: 'Sharp', pick: 1, slip: 0 },
};
export const DEFAULT_SKILL = SKILLS.casual;
export const skillByKey = (k) => SKILLS[k] || DEFAULT_SKILL;

function cribGuess(a, b) {
  let v = 0;
  if (a[0] === b[0]) v += 2;
  if (value(a) + value(b) === 15) v += 2;
  if (Math.abs(rankNum(a) - rankNum(b)) <= 2) v += 1;
  for (const c of [a, b]) if (c[0] === '5') v += 1.5;
  return v;
}

export function chooseDiscard(hand, ownCrib, skill = DEFAULT_SKILL, rng = Math.random) {
  const unseen = makeDeck().filter((c) => !hand.includes(c));
  const choices = [];
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      const throwAway = [hand[i], hand[j]];
      const keep = hand.filter((_, k) => k !== i && k !== j);
      let total = 0;
      for (const s of unseen) total += countHand(keep, s).total;
      const v = total / unseen.length + (ownCrib ? 1 : -1) * cribGuess(...throwAway);
      choices.push({ throwAway, v });
    }
  }
  choices.sort((a, b) => b.v - a.v);
  const top = choices.slice(0, skill.pick);
  return top[Math.floor(rng() * top.length)].throwAway;
}

export function choosePlay(hand, pile, count, skill = DEFAULT_SKILL, rng = Math.random) {
  const legal = hand.filter((c) => count + value(c) <= 31);
  if (rng() < skill.slip) return legal[Math.floor(rng() * legal.length)];
  let best = null;
  for (const c of legal) {
    const after = count + value(c);
    let v = pegPoints([...pile, c]).total * 3;
    if (after === 5 || after === 21) v -= 2;
    if (pile.length === 0 && value(c) < 5) v += 1;      // a low lead cannot be made fifteen
    if (pile.length === 0 && c[0] === '5') v -= 2;
    if (after < 31 && after > 21) v += 0.5;             // squeeze towards a go
    v += value(c) * 0.05;                                // shed high cards when it costs nothing
    if (!best || v > best.v) best = { c, v };
  }
  return best.c;
}
