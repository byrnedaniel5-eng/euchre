// Bot player: bidding, discarding and card play.
//
// Tuned to play like a solid club player — it counts trump, tracks what has
// been played, leads properly, ducks when its partner is winning, and ruffs
// with the cheapest card that does the job. It will not make wild calls and it
// will not throw away a bower to win a trick a nine would have taken.
//
// The PROFILE thresholds are the difficulty dial. Lower `order` / `call` makes
// the bots bid more loosely; raising them makes them passive.

import {
  effectiveSuit,
  isRightBower,
  isLeftBower,
  legalPlays,
  winningPlayIndex,
  cardPower,
  trumpStrength,
  higherCardsInSuit,
  rankOf,
  suitOf,
  SUITS,
  SAME_COLOR,
  RANK_VALUE,
} from './cards.js';
import { partnerOf, teamOf } from './euchre.js';

export const PROFILE = {
  // Expected tricks the bot wants from its own hand before it will bid.
  // A hand needs 3 of 5 tricks and a partner is worth roughly one.
  order: 2.45, // round 1: order the upcard up
  call: 2.30, // round 2: name a suit
  dealerLastCall: 2.05, // round 2, dealer, last chance before a throw-in
  alone: 3.60, // go it alone
};

/** Per-seat profile override, used by the tuning harness. Seats default to PROFILE. */
export const seatProfiles = [null, null, null, null];
const profileFor = (seat) => seatProfiles[seat] || PROFILE;

// ---------------------------------------------------------------- evaluation

/** Rough expected-trick contribution of one card, given the trump suit. */
function cardValue(card, hand, trump) {
  const es = effectiveSuit(card, trump);
  if (es === trump) {
    if (isRightBower(card, trump)) return 1.5;
    if (isLeftBower(card, trump)) return 1.1;
    switch (rankOf(card)) {
      case 'A': return 0.9;
      case 'K': return 0.6;
      case 'Q': return 0.4;
      default: return 0.25; // ten, nine — still a trump, still beats off-suit
    }
  }
  const suitLen = hand.filter((c) => effectiveSuit(c, trump) === es).length;
  switch (rankOf(card)) {
    case 'A': return 0.6;
    case 'K': return suitLen >= 2 ? 0.2 : 0.1; // guarded king is worth more
    case 'Q': return suitLen >= 3 ? 0.05 : 0;
    default: return 0;
  }
}

/** Expected tricks from a five-card hand if `trump` were trump. */
export function evaluateHand(hand, trump) {
  let score = 0;
  for (const c of hand) score += cardValue(c, hand, trump);

  const trumpCount = hand.filter((c) => effectiveSuit(c, trump) === trump).length;

  // Voids are only worth something if you have trump to ruff with.
  const voids = SUITS.filter(
    (s) => s !== trump && !hand.some((c) => effectiveSuit(c, trump) === s)
  ).length;
  if (trumpCount >= 3) score += 0.3 * voids;
  else if (trumpCount === 2) score += 0.15 * voids;

  // Five cards of one suit that is not trump is worth nothing; a big trump
  // holding, on the other hand, snowballs.
  if (trumpCount >= 4) score += 0.3;

  return score;
}

/** Best five of six cards, by the value they'd have with `trump` as trump. */
function bestFive(sixCards, trump) {
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < sixCards.length; i++) {
    const five = sixCards.filter((_, j) => j !== i);
    const s = evaluateHand(five, trump);
    if (s > bestScore) {
      bestScore = s;
      best = five;
    }
  }
  return { hand: best, score: bestScore };
}

// ------------------------------------------------------------------- bidding

export function botBid1(game, seat) {
  const P = profileFor(seat);
  const hand = game.hands[seat];
  const trump = suitOf(game.upcard);
  const dealer = game.dealer;

  let score;
  if (seat === dealer) {
    // The upcard is ours for free — evaluate the best five of six.
    score = bestFive(hand.concat(game.upcard), trump).score;
  } else {
    score = evaluateHand(hand, trump);
    if (teamOf(dealer) === teamOf(seat)) score += 0.30; // partner gains a trump
    else score -= 0.35; // an opponent gains a known trump
  }

  if (score < P.order) return { order: false };

  const alone =
    score >= P.alone &&
    hand.filter((c) => effectiveSuit(c, trump) === trump).length >= 3 &&
    hand.some((c) => isRightBower(c, trump) || isLeftBower(c, trump));

  return { order: true, alone };
}

export function botBid2(game, seat) {
  const P = profileFor(seat);
  const hand = game.hands[seat];
  const isDealer = seat === game.dealer;
  const threshold = isDealer ? P.dealerLastCall : P.call;

  let best = null;
  for (const suit of SUITS) {
    if (suit === game.turnedDownSuit) continue;
    let score = evaluateHand(hand, suit);
    // Calling "next" — the suit of the same colour as the turned-down card —
    // is stronger than crossing, because the other bower is often buried.
    if (suit === SAME_COLOR[game.turnedDownSuit]) score += 0.20;
    else score -= 0.05;
    if (!best || score > best.score) best = { suit, score };
  }

  if (!best || best.score < threshold) return { suit: null };

  const alone =
    best.score >= P.alone &&
    hand.filter((c) => effectiveSuit(c, best.suit) === best.suit).length >= 3;

  return { suit: best.suit, alone };
}

// ------------------------------------------------------------------ discard

export function botDiscard(game, seat) {
  const hand = game.hands[seat];
  const trump = game.trump;
  const nonTrump = hand.filter((c) => effectiveSuit(c, trump) !== trump);

  // All trump (or all but one) — just pitch the weakest trump.
  if (nonTrump.length === 0) {
    return hand.slice().sort((a, b) => trumpStrength(a, trump) - trumpStrength(b, trump))[0];
  }

  const lenOf = (s) => hand.filter((c) => effectiveSuit(c, trump) === s).length;

  // Prefer to create a void: a singleton that is not an ace is the ideal pitch.
  const singletons = nonTrump.filter(
    (c) => lenOf(effectiveSuit(c, trump)) === 1 && rankOf(c) !== 'A'
  );
  if (singletons.length) {
    return singletons.sort((a, b) => RANK_VALUE[rankOf(a)] - RANK_VALUE[rankOf(b)])[0];
  }

  // Otherwise the lowest non-ace off-suit card; aces are kept as winners.
  const keepable = nonTrump.filter((c) => rankOf(c) !== 'A');
  const pool = keepable.length ? keepable : nonTrump;
  return pool.sort((a, b) => {
    const d = RANK_VALUE[rankOf(a)] - RANK_VALUE[rankOf(b)];
    if (d !== 0) return d;
    return lenOf(effectiveSuit(a, trump)) - lenOf(effectiveSuit(b, trump));
  })[0];
}

// --------------------------------------------------------------------- play

/** Cards this bot knows are out of circulation. */
function seenCards(game, seat) {
  const seen = new Set(game.playedCards);
  for (const c of game.hands[seat]) seen.add(c);
  for (const p of game.trick) seen.add(p.card);
  // A turned-down upcard is dead and everyone saw it. An upcard that was
  // ordered up is live in the dealer's hand, so it stays unseen.
  if (game.turnedDownSuit) seen.add(game.upcard);
  return seen;
}

/** True if no unseen card can beat `card` in its own suit. */
function isBoss(card, trump, seen) {
  return higherCardsInSuit(card, trump).every((c) => seen.has(c));
}

/** How willing the bot is to throw a card away. Higher = keep it. */
function keepValue(card, hand, trump, seen) {
  const es = effectiveSuit(card, trump);
  if (es === trump) return 100 + trumpStrength(card, trump);
  let v = RANK_VALUE[rankOf(card)];
  if (isBoss(card, trump, seen)) v += 12; // a boss card is a trick
  const len = hand.filter((c) => effectiveSuit(c, trump) === es).length;
  if (len === 1 && rankOf(card) !== 'A') v -= 3; // pitching it makes a void
  return v;
}

const lowestBy = (cards, fn) => cards.slice().sort((a, b) => fn(a) - fn(b))[0];
const highestBy = (cards, fn) => cards.slice().sort((a, b) => fn(b) - fn(a))[0];

export function botPlay(game, seat) {
  const trump = game.trump;
  const hand = game.hands[seat];
  const legal = legalPlays(hand, trump, game.ledSuit);
  if (legal.length === 1) return legal[0];

  const seen = seenCards(game, seat);
  const myTrump = hand.filter((c) => effectiveSuit(c, trump) === trump);

  // ------------------------------------------------------------- leading
  if (game.trick.length === 0) {
    const offSuit = hand.filter((c) => effectiveSuit(c, trump) !== trump);
    const makerIsUs = game.maker !== null && teamOf(game.maker) === teamOf(seat);

    // Our side called it: draw their trump out so our winners are safe.
    if (makerIsUs && myTrump.length >= 2) {
      const bossTrump = myTrump.filter((c) => isBoss(c, trump, seen));
      if (bossTrump.length) return highestBy(bossTrump, (c) => trumpStrength(c, trump));
      return highestBy(myTrump, (c) => trumpStrength(c, trump));
    }

    // Cash a certain winner while we can.
    const bossOff = offSuit.filter((c) => isBoss(c, trump, seen));
    if (bossOff.length) return highestBy(bossOff, (c) => RANK_VALUE[rankOf(c)]);

    const bossTrump = myTrump.filter((c) => isBoss(c, trump, seen));
    if (bossTrump.length) return highestBy(bossTrump, (c) => trumpStrength(c, trump));

    if (offSuit.length === 0) return highestBy(myTrump, (c) => trumpStrength(c, trump));

    // Defending with nothing sure: lead low from our shortest side suit and
    // keep the trump for ruffing.
    const lenOf = (s) => hand.filter((c) => effectiveSuit(c, trump) === s).length;
    return lowestBy(
      offSuit,
      (c) => lenOf(effectiveSuit(c, trump)) * 10 + RANK_VALUE[rankOf(c)]
    );
  }

  // ------------------------------------------------------------ following
  const wi = winningPlayIndex(game.trick, trump, game.ledSuit);
  const winning = game.trick[wi];
  const bestPower = cardPower(winning.card, trump, game.ledSuit);
  const partnerSeat = partnerOf(seat);
  const partnerWinning = winning.seat === partnerSeat;
  const isLast = game.trick.length === game.playersInTrick() - 1;
  const partnerSafe = isBoss(winning.card, trump, seen);

  const canFollow = hand.some((c) => effectiveSuit(c, trump) === game.ledSuit);

  const beaters = legal.filter((c) => cardPower(c, trump, game.ledSuit) > bestPower);

  if (partnerWinning && (isLast || partnerSafe)) {
    // The trick is ours. Throw the least useful thing we hold.
    return lowestBy(legal, (c) => keepValue(c, hand, trump, seen));
  }

  if (canFollow) {
    if (beaters.length) return lowestBy(beaters, (c) => cardPower(c, trump, game.ledSuit));
    return lowestBy(legal, (c) => cardPower(c, trump, game.ledSuit));
  }

  // Void in the led suit — ruff, or pitch.
  const usefulTrump = beaters.filter((c) => effectiveSuit(c, trump) === trump);
  if (usefulTrump.length) {
    // Don't burn trump ruffing a trick the partner already has locked up,
    // unless there is still an opponent to play behind us and we can spare it.
    if (partnerWinning && !(myTrump.length >= 2 || game.tricksPlayed >= 2)) {
      return lowestBy(legal, (c) => keepValue(c, hand, trump, seen));
    }
    return lowestBy(usefulTrump, (c) => trumpStrength(c, trump));
  }

  return lowestBy(legal, (c) => keepValue(c, hand, trump, seen));
}

/** Single entry point: make whatever move the current phase calls for. */
export function botAct(game, seat) {
  switch (game.phase) {
    case 'bid1':
      return game.bid1(seat, botBid1(game, seat));
    case 'bid2':
      return game.bid2(seat, botBid2(game, seat));
    case 'discard':
      return game.discard(seat, botDiscard(game, seat));
    case 'play':
      return game.playCard(seat, botPlay(game, seat));
    default:
      throw new Error(`bot cannot act in phase ${game.phase}`);
  }
}
