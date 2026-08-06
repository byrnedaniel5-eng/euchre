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
import { partnerOf, teamOf } from './engine.js';

// Difficulty is more than bid thresholds. A weak player also forgets what has
// been played, misjudges a hand, and now and then just plays the wrong card —
// so each level moves all four dials together.
//
//   order/call/dealerLastCall/alone
//              expected tricks needed from its own hand before it will bid
//   noise      random error added to its judgement of a hand, in tricks
//   mistakes   chance per turn of simply playing a random legal card
//   trackCards whether it remembers cards from earlier tricks
//   voids      whether it notes who failed to follow suit, and leads on it
export const SKILLS = {
  easy: {
    key: 'easy', label: 'Easy',
    order: 1.90, call: 2.00, dealerLastCall: 1.70, alone: 3.20,
    noise: 1.20, mistakes: 0.35, trackCards: false, voids: false,
  },
  casual: {
    key: 'casual', label: 'Casual',
    order: 2.20, call: 2.15, dealerLastCall: 1.90, alone: 3.40,
    noise: 0.60, mistakes: 0.15, trackCards: false, voids: false,
  },
  solid: {
    key: 'solid', label: 'Solid',
    order: 2.45, call: 2.30, dealerLastCall: 2.05, alone: 3.60,
    noise: 0, mistakes: 0, trackCards: true, voids: true,
  },
};

// There was a fourth tier above this that also read voids to steer its leads.
// Measured over 3000 games it won 49.8% against Solid — inside the noise. In a
// five-trick hand you learn who is void too late for it to pay. The reading is
// kept on in Solid because it is correct play and free, but it does not earn a
// difficulty step, and a setting that does not change your odds is a lie.

export const DEFAULT_SKILL = SKILLS.solid;
export const skillByKey = (key) => SKILLS[key] || DEFAULT_SKILL;

/** Kept for the tuning harness, which sweeps one parameter at a time. */
export const PROFILE = SKILLS.solid;

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

export function botBid1(game, seat, P = DEFAULT_SKILL) {
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
  score += misjudge(P);

  if (score < P.order) return { order: false };

  const alone =
    score >= P.alone &&
    hand.filter((c) => effectiveSuit(c, trump) === trump).length >= 3 &&
    hand.some((c) => isRightBower(c, trump) || isLeftBower(c, trump));

  return { order: true, alone };
}

export function botBid2(game, seat, P = DEFAULT_SKILL) {
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
  if (best) best.score += misjudge(P);

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

/** Random error in tricks, so weaker bots misjudge a hand rather than just bid tightly. */
const misjudge = (P) => (P.noise ? (Math.random() - 0.5) * P.noise : 0);

/**
 * Cards this bot knows are out of circulation. A bot without card memory only
 * sees its own hand and what is on the table right now — it has forgotten the
 * earlier tricks, which is exactly how a casual player plays.
 */
function seenCards(game, seat, P = DEFAULT_SKILL) {
  const seen = new Set(P.trackCards ? game.playedCards : []);
  for (const c of game.hands[seat]) seen.add(c);
  for (const p of game.trick) seen.add(p.card);
  // A turned-down upcard is dead and everyone saw it. An upcard that was
  // ordered up is live in the dealer's hand, so it stays unseen.
  if (game.turnedDownSuit) seen.add(game.upcard);
  return seen;
}

/**
 * Who has shown out of which suit. Failing to follow is public information,
 * and the strongest level uses it: leading a suit an opponent is void in just
 * hands them a ruff.
 */
function voidsBySeat(game) {
  const out = [new Set(), new Set(), new Set(), new Set()];
  const note = (plays, led) => {
    if (!led) return;
    for (const p of plays) {
      if (effectiveSuit(p.card, game.trump) !== led) out[p.seat].add(led);
    }
  };
  for (const t of game.history || []) note(t.plays, t.ledSuit);
  note(game.trick, game.ledSuit);
  return out;
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

export function botPlay(game, seat, P = DEFAULT_SKILL) {
  const trump = game.trump;
  const hand = game.hands[seat];
  const legal = legalPlays(hand, trump, game.ledSuit);
  if (legal.length === 1) return legal[0];

  // A weaker player simply gets it wrong sometimes.
  if (P.mistakes && Math.random() < P.mistakes) {
    return legal[Math.floor(Math.random() * legal.length)];
  }

  const seen = seenCards(game, seat, P);
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

    const voids = P.voids ? voidsBySeat(game) : null;
    const opponents = [0, 1, 2, 3].filter(
      (s) => teamOf(s) !== teamOf(seat) && s !== game.sittingOut);
    const ruffRisk = (card) => {
      if (!voids) return 0;
      const es = effectiveSuit(card, trump);
      return opponents.filter((s) => voids[s].has(es)).length;
    };

    // Cash a certain winner — unless an opponent has shown out of that suit,
    // in which case the "winner" just gets trumped.
    const bossOff = offSuit.filter((c) => isBoss(c, trump, seen) && ruffRisk(c) === 0);
    if (bossOff.length) return highestBy(bossOff, (c) => RANK_VALUE[rankOf(c)]);

    const bossTrump = myTrump.filter((c) => isBoss(c, trump, seen));
    if (bossTrump.length) return highestBy(bossTrump, (c) => trumpStrength(c, trump));

    if (offSuit.length === 0) return highestBy(myTrump, (c) => trumpStrength(c, trump));

    // Defending with nothing sure: lead low from our shortest side suit and
    // keep the trump for ruffing. Steer away from suits an opponent can ruff,
    // and towards one our partner can.
    const lenOf = (s) => hand.filter((c) => effectiveSuit(c, trump) === s).length;
    const partner = partnerOf(seat);
    return lowestBy(offSuit, (c) => {
      const es = effectiveSuit(c, trump);
      let score = lenOf(es) * 10 + RANK_VALUE[rankOf(c)];
      score += ruffRisk(c) * 22;
      if (voids && voids[partner].has(es) && partner !== game.sittingOut) score -= 12;
      return score;
    });
  }

  // ------------------------------------------------------------ following
  const wi = winningPlayIndex(game.trick, trump, game.ledSuit);
  const winning = game.trick[wi];
  const bestPower = cardPower(winning.card, trump, game.ledSuit);
  const partnerSeat = partnerOf(seat);
  const partnerWinning = winning.seat === partnerSeat;
  const isLast = game.trick.length === game.playersInTrick() - 1;

  // Who still has to play after us this trick.
  const toPlay = [];
  {
    let s = seat;
    for (let i = game.trick.length; i < game.playersInTrick() - 1; i++) {
      s = game.nextActive(s);
      toPlay.push(s);
    }
  }

  // A "boss" side-suit card is only boss if nobody behind can trump it. An
  // opponent who has already shown out of this suit certainly can.
  const winnerIsTrump = effectiveSuit(winning.card, trump) === trump;
  const knownVoids = P.voids ? voidsBySeat(game) : null;
  const ruffable = !!knownVoids && !winnerIsTrump && game.ledSuit !== trump &&
    toPlay.some((s) => teamOf(s) !== teamOf(seat) && knownVoids[s].has(game.ledSuit));

  const partnerSafe = isBoss(winning.card, trump, seen) && !ruffable;

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
    // unless there is still an opponent to play behind us and we can spare it —
    // or we know one of them is void and about to ruff it away from us.
    if (partnerWinning && !ruffable && !(myTrump.length >= 2 || game.tricksPlayed >= 2)) {
      return lowestBy(legal, (c) => keepValue(c, hand, trump, seen));
    }
    return lowestBy(usefulTrump, (c) => trumpStrength(c, trump));
  }

  return lowestBy(legal, (c) => keepValue(c, hand, trump, seen));
}

/** Single entry point: make whatever move the current phase calls for. */
export function botAct(game, seat, skill = DEFAULT_SKILL) {
  switch (game.phase) {
    case 'bid1':
      return game.bid1(seat, botBid1(game, seat, skill));
    case 'bid2':
      return game.bid2(seat, botBid2(game, seat, skill));
    case 'discard':
      return game.discard(seat, botDiscard(game, seat));
    case 'play':
      return game.playCard(seat, botPlay(game, seat, skill));
    default:
      throw new Error(`bot cannot act in phase ${game.phase}`);
  }
}
