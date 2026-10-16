// Yahtzee scoring, as the box has it.
//
// Upper section: the sum of one face. 63 or more across the six earns 35.
// Lower section: three and four of a kind (all dice), full house 25, small
// straight 30, large straight 40, Yahtzee 50, chance (all dice).
//
// A second Yahtzee, when the Yahtzee box already holds 50, is worth 100 more,
// and then the joker rule: it must go in its own upper box if that is open;
// failing that, any lower box at full value; failing that, any upper box for
// nothing.

export const UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
export const LOWER = ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'];
export const CATEGORIES = [...UPPER, ...LOWER];
export const LABELS = {
  ones: 'Ones', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes',
  threeKind: '3 of a kind', fourKind: '4 of a kind', fullHouse: 'Full house',
  smallStraight: 'Small straight', largeStraight: 'Large straight', yahtzee: 'Yahtzee', chance: 'Chance',
};
export const UPPER_BONUS_AT = 63;
export const UPPER_BONUS = 35;
export const YAHTZEE_BONUS = 100;

const counts = (dice) => {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
};
const sum = (dice) => dice.reduce((a, b) => a + b, 0);
const run = (dice, n) => {
  const has = new Set(dice);
  for (let start = 1; start + n - 1 <= 6; start++) {
    let ok = true;
    for (let k = 0; k < n; k++) if (!has.has(start + k)) { ok = false; break; }
    if (ok) return true;
  }
  return false;
};

export const isYahtzee = (dice) => dice.every((d) => d === dice[0]);

/** What the dice are worth in a box, ignoring the joker rule. */
export function rawScore(cat, dice) {
  const c = counts(dice);
  const i = UPPER.indexOf(cat);
  if (i >= 0) return c[i + 1] * (i + 1);
  switch (cat) {
    case 'threeKind': return c.some((n) => n >= 3) ? sum(dice) : 0;
    case 'fourKind': return c.some((n) => n >= 4) ? sum(dice) : 0;
    case 'fullHouse': return c.includes(3) && c.includes(2) ? 25 : 0;
    case 'smallStraight': return run(dice, 4) ? 30 : 0;
    case 'largeStraight': return run(dice, 5) ? 40 : 0;
    case 'yahtzee': return isYahtzee(dice) ? 50 : 0;
    case 'chance': return sum(dice);
    default: throw new Error(`no such box ${cat}`);
  }
}

/**
 * Where these dice may go on this sheet, and what each box would score.
 * The joker rule narrows the choice; it never widens it beyond open boxes.
 */
export function options(sheet, dice) {
  const open = CATEGORIES.filter((c) => sheet[c] === null);
  const joker = isYahtzee(dice) && sheet.yahtzee !== null;
  if (!joker) return Object.fromEntries(open.map((c) => [c, rawScore(c, dice)]));

  const own = UPPER[dice[0] - 1];
  if (sheet[own] === null) return { [own]: rawScore(own, dice) };
  const lower = LOWER.filter((c) => sheet[c] === null);
  if (lower.length) {
    const full = { fullHouse: 25, smallStraight: 30, largeStraight: 40 };
    return Object.fromEntries(lower.map((c) => [c, full[c] ?? rawScore(c, dice)]));
  }
  return Object.fromEntries(open.map((c) => [c, 0]));
}

export const newSheet = () => ({ ...Object.fromEntries(CATEGORIES.map((c) => [c, null])), bonusYahtzees: 0 });

export function totals(sheet) {
  const upper = UPPER.reduce((a, c) => a + (sheet[c] ?? 0), 0);
  const bonus = upper >= UPPER_BONUS_AT ? UPPER_BONUS : 0;
  const lower = LOWER.reduce((a, c) => a + (sheet[c] ?? 0), 0);
  const yBonus = sheet.bonusYahtzees * YAHTZEE_BONUS;
  return { upper, bonus, lower, yBonus, total: upper + bonus + lower + yBonus };
}

export const filled = (sheet) => CATEGORIES.every((c) => sheet[c] !== null);
