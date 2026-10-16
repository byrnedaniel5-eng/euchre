// Cribbage engine, two players, six-card deal, first to 121.
//
// Each hand: deal six, both throw two into the dealer's crib, cut a starter
// (a jack is two for the dealer, "his heels"), then the play — alternate
// cards, the count never past 31, pegging fifteens, pairs, runs, 31 and the
// go — then the show: non-dealer counts first, then the dealer, then the
// crib. The game ends the instant somebody reaches 121, even mid-play, which
// is why counting order matters.
//
// Phases:
//   'discard'  - both choosing two for the crib
//   'play'     - pegging
//   'show'     - the counts laid out; waiting for both to move on
//   'gameOver' - somebody pegged out

import { makeDeck, shuffle, value, countHand, pegPoints } from './rules.js';

export const TARGET = 121;

export class CribbageGame {
  constructor({ names = [], dealer = 0, rng = Math.random } = {}) {
    this.names = names;
    this.rng = rng;
    this.scores = [0, 0];
    this.backPegs = [0, 0];  // where each front peg was before its last move
    this.dealer = dealer;
    this.hand = 0;
    this.winner = null;
    this.log = [];
    this.deal();
  }

  get pone() { return 1 - this.dealer; }

  deal() {
    this.hand++;
    const deck = shuffle(makeDeck(), this.rng);
    this.hands = [deck.slice(0, 6), deck.slice(6, 12)];
    this.deck = deck.slice(12);
    this.crib = [];
    this.thrown = [null, null];
    this.kept = [null, null];
    this.starter = null;
    this.inHand = [[], []];
    this.pile = [];        // cards since the count last went to zero
    this.played = [];      // every card played this hand, in order, with who
    this.count = 0;
    this.turn = null;
    this.lastPlayer = null;
    this.lastPeg = null;   // the latest scoring event, for the table to announce
    this.saidGo = [false, false];
    this.show = null;
    this.phase = 'discard';
    this.log.push(`--- Hand ${this.hand}: ${this.names[this.dealer]}'s crib ---`);
  }

  /** Peg points; true if that ended the game. */
  peg(seat, points, why) {
    if (!points || this.phase === 'gameOver') return false;
    this.backPegs[seat] = this.scores[seat];
    this.scores[seat] = Math.min(TARGET, this.scores[seat] + points);
    this.lastPeg = { seat, points, why, n: (this.lastPeg?.n || 0) + 1 };
    if (this.scores[seat] >= TARGET) {
      this.phase = 'gameOver';
      this.winner = seat;
      this.log.push(`*** ${this.names[seat]} pegs out ***`);
      return true;
    }
    return false;
  }

  discard(seat, cards) {
    if (this.phase !== 'discard') throw new Error('it is not time to discard');
    if (this.thrown[seat]) throw new Error('you have already thrown');
    if (!Array.isArray(cards) || cards.length !== 2 || cards[0] === cards[1]) throw new Error('throw two cards');
    const hand = this.hands[seat];
    if (!cards.every((c) => hand.includes(c))) throw new Error('those are not your cards');
    this.thrown[seat] = cards.slice();
    this.kept[seat] = hand.filter((c) => !cards.includes(c));
    if (this.thrown[0] && this.thrown[1]) this.cut();
  }

  cut() {
    this.crib = [...this.thrown[this.pone], ...this.thrown[this.dealer]];
    this.starter = this.deck[Math.floor(this.rng() * this.deck.length)];
    this.inHand = [this.kept[0].slice(), this.kept[1].slice()];
    this.phase = 'play';
    this.turn = this.pone;
    if (this.starter[0] === 'J') {
      this.log.push(`${this.names[this.dealer]}: two for his heels`);
      if (this.peg(this.dealer, 2, 'his heels')) return;
    }
  }

  canPlay(seat) {
    return this.inHand[seat].some((c) => this.count + value(c) <= 31);
  }

  play(seat, card) {
    if (this.phase !== 'play') throw new Error('it is not time to play');
    if (seat !== this.turn) throw new Error('not your turn');
    if (!this.inHand[seat].includes(card)) throw new Error('that is not in your hand');
    if (this.count + value(card) > 31) throw new Error('that would take the count past 31');

    this.inHand[seat] = this.inHand[seat].filter((c) => c !== card);
    this.pile.push(card);
    this.played.push({ card, seat });
    this.count += value(card);
    this.lastPlayer = seat;

    const { items, total } = pegPoints(this.pile);
    if (total) {
      const why = items.map((i) => (i.kind === 'run' ? `run of ${i.length}` : i.kind)).join(' and ');
      this.log.push(`${this.names[seat]}: ${why} for ${total}`);
      if (this.peg(seat, total, why)) return;
    }
    this.advance();
  }

  /** Who plays next, settling goes and resets as the rules say. */
  advance() {
    const p = this.lastPlayer;
    const o = 1 - p;
    const reset = () => {
      this.count = 0;
      this.pile = [];
      this.saidGo = [false, false];
    };

    if (this.count === 31) {
      reset();
      if (!this.inHand[0].length && !this.inHand[1].length) return this.endPlay();
      this.turn = this.inHand[o].length ? o : p;
      return;
    }
    if (this.canPlay(o)) {
      this.turn = o;
      return;
    }
    if (this.canPlay(p)) {
      // The other side cannot go on: they say go, and this player carries on.
      if (this.inHand[o].length) this.saidGo[o] = true;
      this.turn = p;
      return;
    }
    // Nobody can play: one for the go, or for the last card.
    const last = !this.inHand[0].length && !this.inHand[1].length;
    this.log.push(`${this.names[p]}: ${last ? 'last card' : 'go'} for 1`);
    if (this.peg(p, 1, last ? 'last card' : 'go')) return;
    if (last) return this.endPlay();
    reset();
    this.turn = this.inHand[o].length ? o : p;
  }

  endPlay() {
    // Pone, then dealer, then crib — stopping the moment anyone reaches 121.
    const pone = countHand(this.kept[this.pone], this.starter);
    const deal = countHand(this.kept[this.dealer], this.starter);
    const crib = countHand(this.crib, this.starter, { crib: true });
    this.show = {
      pone: { seat: this.pone, cards: this.kept[this.pone], ...pone },
      dealer: { seat: this.dealer, cards: this.kept[this.dealer], ...deal },
      crib: { seat: this.dealer, cards: this.crib, ...crib },
    };
    this.phase = 'show';
    this.turn = null;
    for (const [part, label] of [['pone', 'hand'], ['dealer', 'hand'], ['crib', 'crib']]) {
      const s = this.show[part];
      this.log.push(`${this.names[s.seat]}'s ${label}: ${s.total}`);
      if (this.peg(s.seat, s.total, label)) return;
    }
  }

  nextHand() {
    if (this.phase !== 'show') throw new Error('nothing to move on from');
    this.dealer = 1 - this.dealer;
    this.deal();
  }

  viewFor(seat) {
    const showing = this.show && (this.phase === 'show' || this.phase === 'gameOver');
    return {
      phase: this.phase,
      game: 'cribbage',
      names: this.names,
      hand: this.hand,
      dealer: this.dealer,
      scores: this.scores,
      backPegs: this.backPegs,
      target: TARGET,
      turn: this.turn,
      yourTurn: this.phase === 'play' && this.turn === seat,
      // Your cards only: six while discarding, then what is left to play.
      yourHand: this.phase === 'discard'
        ? (this.thrown[seat] ? this.kept[seat] : this.hands[seat])
        : this.inHand[seat],
      yourKept: this.kept[seat],
      youThrew: !!this.thrown[seat],
      theyThrew: !!this.thrown[1 - seat],
      theirCardsLeft: this.phase === 'discard' ? (this.thrown[1 - seat] ? 4 : 6) : this.inHand[1 - seat].length,
      cribSize: this.crib.length || (this.thrown[0] ? 2 : 0) + (this.thrown[1] ? 2 : 0),
      starter: this.starter,
      pile: this.pile,
      played: this.played,
      count: this.count,
      canPlay: this.phase === 'play' ? this.inHand[seat].filter((c) => this.count + value(c) <= 31) : [],
      saidGo: this.saidGo,
      lastPeg: this.lastPeg,
      show: showing ? this.show : null,
      winner: this.winner,
      log: this.log.slice(-14),
    };
  }
}
