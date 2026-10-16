// Cribbage counting: the hand and crib at the show, and the pegging during
// the play. A card is rank + suit, e.g. "5H", "TD", "JS", "AC".

export const RANKS = 'A23456789TJQK';
export const SUITS = 'SHDC';
export const rankNum = (c) => RANKS.indexOf(c[0]) + 1;     // A=1 .. K=13, for runs
export const value = (c) => Math.min(10, rankNum(c));       // for fifteens and the count
export const suitOf = (c) => c[1];

export function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  return d;
}

export function shuffle(deck, rng = Math.random) {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function subsets(cards) {
  const out = [];
  for (let mask = 1; mask < 1 << cards.length; mask++) {
    out.push(cards.filter((_, i) => mask & (1 << i)));
  }
  return out;
}

/**
 * Count a hand of four with the starter, as said aloud at the show. Returns
 * every scoring item so it can be read out: fifteens, pairs, runs, flush,
 * one for his nob.
 */
export function countHand(hand, starter, { crib = false } = {}) {
  const all = [...hand, starter];
  const items = [];

  for (const s of subsets(all)) {
    if (s.length >= 2 && s.reduce((a, c) => a + value(c), 0) === 15) {
      items.push({ kind: 'fifteen', cards: s, points: 2 });
    }
  }

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (all[i][0] === all[j][0]) items.push({ kind: 'pair', cards: [all[i], all[j]], points: 2 });
    }
  }

  // The longest run only: a run of four is not also two runs of three. Each
  // duplicated rank inside it doubles the run.
  const byRank = new Map();
  for (const c of all) byRank.set(rankNum(c), [...(byRank.get(rankNum(c)) || []), c]);
  let best = null;
  for (let start = 1; start <= 13; start++) {
    let len = 0;
    while (byRank.has(start + len)) len++;
    if (len >= 3 && (!best || len > best.len)) best = { start, len };
  }
  if (best) {
    let runs = [[]];
    for (let r = best.start; r < best.start + best.len; r++) {
      runs = runs.flatMap((run) => byRank.get(r).map((c) => [...run, c]));
    }
    for (const run of runs) items.push({ kind: 'run', cards: run, points: best.len });
  }

  const suit = suitOf(hand[0]);
  if (hand.every((c) => suitOf(c) === suit)) {
    if (suitOf(starter) === suit) items.push({ kind: 'flush', cards: all, points: 5 });
    else if (!crib) items.push({ kind: 'flush', cards: hand.slice(), points: 4 });
  }

  const nob = hand.find((c) => c[0] === 'J' && suitOf(c) === suitOf(starter));
  if (nob) items.push({ kind: 'nobs', cards: [nob], points: 1 });

  return { items, total: items.reduce((a, i) => a + i.points, 0) };
}

/**
 * What a card just played scores during the play, given the cards played since
 * the count last went back to zero (this card last).
 */
export function pegPoints(pile) {
  const items = [];
  const count = pile.reduce((a, c) => a + value(c), 0);
  if (count === 15) items.push({ kind: 'fifteen', points: 2 });
  if (count === 31) items.push({ kind: 'thirty-one', points: 2 });

  let same = 1;
  for (let i = pile.length - 2; i >= 0 && pile[i][0] === pile[pile.length - 1][0]; i--) same++;
  if (same >= 2) items.push({ kind: same === 2 ? 'pair' : same === 3 ? 'pair royal' : 'double pair royal', points: [0, 0, 2, 6, 12][same] });

  // A run is the last k cards, in any order, being k consecutive ranks.
  for (let k = pile.length; k >= 3; k--) {
    const ranks = pile.slice(-k).map(rankNum).sort((a, b) => a - b);
    if (ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1)) {
      items.push({ kind: 'run', length: k, points: k });
      break;
    }
  }
  return { items, total: items.reduce((a, i) => a + i.points, 0) };
}
