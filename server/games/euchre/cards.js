// Card primitives for euchre.
// A card is a 2-char string: rank + suit, e.g. "JH", "9S", "TD".

export const SUITS = ['S', 'H', 'D', 'C'];
export const RANKS = ['9', 'T', 'J', 'Q', 'K', 'A'];

export const RANK_VALUE = { '9': 0, T: 1, J: 2, Q: 3, K: 4, A: 5 };
export const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };

// The other suit of the same colour — this is where the left bower lives.
export const SAME_COLOR = { S: 'C', C: 'S', H: 'D', D: 'H' };

export const rankOf = (card) => card[0];
export const suitOf = (card) => card[1];

export function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

export function shuffle(deck, rng = Math.random) {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export const isRightBower = (card, trump) => card === 'J' + trump;
export const isLeftBower = (card, trump) =>
  rankOf(card) === 'J' && suitOf(card) === SAME_COLOR[trump];

// The suit a card counts as *for following suit*. The left bower is trump.
export function effectiveSuit(card, trump) {
  if (trump && isLeftBower(card, trump)) return trump;
  return suitOf(card);
}

// Comparable strength of a card within a trick.
// Trump beats led suit beats everything else.
export function cardPower(card, trump, ledSuit) {
  const es = effectiveSuit(card, trump);
  if (trump && es === trump) {
    if (isRightBower(card, trump)) return 1000;
    if (isLeftBower(card, trump)) return 900;
    return 800 + RANK_VALUE[rankOf(card)];
  }
  if (es === ledSuit) return 100 + RANK_VALUE[rankOf(card)];
  return RANK_VALUE[rankOf(card)];
}

// Strength of a card considered purely as a trump card (0 if not trump).
export function trumpStrength(card, trump) {
  if (!trump || effectiveSuit(card, trump) !== trump) return 0;
  if (isRightBower(card, trump)) return 8;
  if (isLeftBower(card, trump)) return 7;
  return 1 + RANK_VALUE[rankOf(card)];
}

// Index of the winning play in a list of {seat, card}.
export function winningPlayIndex(plays, trump, ledSuit) {
  let best = 0;
  let bestPower = -1;
  plays.forEach((p, i) => {
    const power = cardPower(p.card, trump, ledSuit);
    if (power > bestPower) {
      bestPower = power;
      best = i;
    }
  });
  return best;
}

// Every card that outranks `card` in its own suit, given trump.
// Used by the bot to work out whether a card is the boss of its suit.
export function higherCardsInSuit(card, trump) {
  const es = effectiveSuit(card, trump);
  const mine = cardPower(card, trump, es);
  const out = [];
  for (const c of makeDeck()) {
    if (c === card) continue;
    if (effectiveSuit(c, trump) !== es) continue;
    if (cardPower(c, trump, es) > mine) out.push(c);
  }
  return out;
}

export function legalPlays(hand, trump, ledSuit) {
  if (!ledSuit) return hand.slice();
  const following = hand.filter((c) => effectiveSuit(c, trump) === ledSuit);
  return following.length ? following : hand.slice();
}

// Sort a hand for display: trump first (strongest left), then by suit.
export function sortHand(hand, trump) {
  const suitOrder = { S: 0, H: 1, C: 2, D: 3 };
  return hand.slice().sort((a, b) => {
    const at = trump && effectiveSuit(a, trump) === trump;
    const bt = trump && effectiveSuit(b, trump) === trump;
    if (at !== bt) return at ? -1 : 1;
    if (at && bt) return trumpStrength(b, trump) - trumpStrength(a, trump);
    const sa = suitOrder[suitOf(a)];
    const sb = suitOrder[suitOf(b)];
    if (sa !== sb) return sa - sb;
    return RANK_VALUE[rankOf(b)] - RANK_VALUE[rankOf(a)];
  });
}
