// Euchre game engine. Pure state machine — no networking, no timers.
//
// Seats 0..3 sit clockwise. Teams are seats {0,2} and {1,3}.
// Team index of a seat is seat % 2.
//
// Phases:
//   'bid1'          - ordering up the turned card, starting left of dealer
//   'bid2'          - naming a suit after the upcard is turned down
//   'discard'       - dealer discards after picking up the upcard
//   'play'          - trick play
//   'trickComplete' - four (or three) cards down, winner decided, awaiting sweep
//   'handOver'      - hand scored, awaiting next deal
//   'gameOver'      - someone reached the target score

import {
  makeDeck,
  shuffle,
  effectiveSuit,
  legalPlays,
  winningPlayIndex,
  suitOf,
  SUIT_NAME,
} from './cards.js';

export const teamOf = (seat) => seat % 2;
export const partnerOf = (seat) => (seat + 2) % 4;

// If false, a hand where everyone passes twice is thrown in and redealt.
// Flip to true if you ever decide you want stick-the-dealer.
export const STICK_THE_DEALER = false;

export const WINNING_SCORE = 10;

export class EuchreGame {
  constructor({ names = ['P1', 'P2', 'P3', 'P4'], rng = Math.random } = {}) {
    this.names = names;
    this.rng = rng;
    this.score = [0, 0];
    this.dealer = Math.floor(rng() * 4);
    this.handNumber = 0;
    this.log = [];
    this.phase = 'handOver';
    this.lastHandSummary = null;
    this.startHand();
  }

  // ---------------------------------------------------------------- dealing

  startHand() {
    this.handNumber += 1;
    const deck = shuffle(makeDeck(), this.rng);
    this.hands = [[], [], [], []];
    // Deal 3-2 / 2-3 the way you would at a table. Purely cosmetic, but it
    // means a printed deal log looks like a real one.
    let idx = 0;
    const pattern = [3, 2, 3, 2, 2, 3, 2, 3];
    for (let i = 0; i < 8; i++) {
      const seat = (this.dealer + 1 + i) % 4;
      for (let n = 0; n < pattern[i]; n++) this.hands[seat].push(deck[idx++]);
    }
    this.upcard = deck[idx++];
    this.kitty = deck.slice(idx);

    this.trump = null;
    this.maker = null;
    this.alone = false;
    this.sittingOut = null;
    this.turnedDownSuit = null;
    this.discardedCard = null;

    this.trick = [];
    this.ledSuit = null;
    this.tricksPlayed = 0;
    this.tricksWon = [0, 0, 0, 0];
    this.lastTrick = null;
    this.trickWinner = null;
    this.playedCards = [];
    // Completed tricks this hand. Who failed to follow suit is public
    // information, and the strongest bots read it.
    this.history = [];

    this.passes = 0;
    this.phase = 'bid1';
    this.turn = (this.dealer + 1) % 4;
    this.pushLog(`--- Hand ${this.handNumber}: ${this.names[this.dealer]} deals ---`);
  }

  pushLog(text) {
    this.log.push(text);
    if (this.log.length > 60) this.log.shift();
  }

  // ---------------------------------------------------------------- helpers

  nextActive(seat) {
    let s = (seat + 1) % 4;
    if (s === this.sittingOut) s = (s + 1) % 4;
    return s;
  }

  playersInTrick() {
    return this.alone ? 3 : 4;
  }

  /** What the seat whose turn it is may legally do right now. */
  legalActions(seat) {
    if (seat !== this.turn) return null;
    switch (this.phase) {
      case 'bid1':
        return {
          type: 'bid1',
          upcard: this.upcard,
          canOrder: true,
          isDealer: seat === this.dealer,
          canPass: !(STICK_THE_DEALER && seat === this.dealer),
        };
      case 'bid2': {
        const suits = ['S', 'H', 'D', 'C'].filter((s) => s !== this.turnedDownSuit);
        const lastToBid = seat === this.dealer;
        return {
          type: 'bid2',
          suits,
          canPass: !(STICK_THE_DEALER && lastToBid),
        };
      }
      case 'discard':
        return { type: 'discard', cards: this.hands[seat].slice() };
      case 'play':
        return { type: 'play', cards: legalPlays(this.hands[seat], this.trump, this.ledSuit) };
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------- bidding

  /** Round 1: pass, or order up the turned card. */
  bid1(seat, { order, alone = false }) {
    if (this.phase !== 'bid1') throw new Error('not bidding');
    if (seat !== this.turn) throw new Error('not your turn');

    if (!order) {
      if (STICK_THE_DEALER && seat === this.dealer) throw new Error('dealer must call');
      this.passes += 1;
      this.pushLog(`${this.names[seat]} passes`);
      if (this.passes >= 4) {
        this.turnedDownSuit = suitOf(this.upcard);
        this.passes = 0;
        this.phase = 'bid2';
        this.turn = (this.dealer + 1) % 4;
        this.pushLog(`Upcard turned down (${SUIT_NAME[this.turnedDownSuit]})`);
      } else {
        this.turn = (this.turn + 1) % 4;
      }
      return;
    }

    this.trump = suitOf(this.upcard);
    this.maker = seat;
    this.setAlone(seat, alone);
    const verb = seat === this.dealer ? 'takes it up' : 'orders it up';
    this.pushLog(
      `${this.names[seat]} ${verb} — ${SUIT_NAME[this.trump]} is trump${alone ? ', going alone' : ''}`
    );

    // Dealer always takes the upcard into hand and throws one away, even when
    // the dealer is the partner sitting out a loner.
    this.hands[this.dealer].push(this.upcard);
    this.phase = 'discard';
    this.turn = this.dealer;
  }

  /** Round 2: pass, or name a suit other than the one turned down. */
  bid2(seat, { suit, alone = false }) {
    if (this.phase !== 'bid2') throw new Error('not bidding');
    if (seat !== this.turn) throw new Error('not your turn');

    if (!suit) {
      if (STICK_THE_DEALER && seat === this.dealer) throw new Error('dealer must call');
      this.passes += 1;
      this.pushLog(`${this.names[seat]} passes`);
      if (this.passes >= 4) {
        this.pushLog('Everyone passed — throwing the hand in');
        this.dealer = (this.dealer + 1) % 4;
        this.startHand();
      } else {
        this.turn = (this.turn + 1) % 4;
      }
      return;
    }

    if (suit === this.turnedDownSuit) throw new Error('cannot name the turned-down suit');
    this.trump = suit;
    this.maker = seat;
    this.setAlone(seat, alone);
    this.pushLog(
      `${this.names[seat]} calls ${SUIT_NAME[suit]}${alone ? ', going alone' : ''}`
    );
    this.beginPlay();
  }

  setAlone(seat, alone) {
    this.alone = !!alone;
    this.sittingOut = alone ? partnerOf(seat) : null;
    if (alone) this.pushLog(`${this.names[partnerOf(seat)]} sits this one out`);
  }

  discard(seat, card) {
    if (this.phase !== 'discard') throw new Error('not discarding');
    if (seat !== this.dealer) throw new Error('only the dealer discards');
    const hand = this.hands[seat];
    const i = hand.indexOf(card);
    if (i < 0) throw new Error('card not in hand');
    hand.splice(i, 1);
    this.discardedCard = card;
    this.beginPlay();
  }

  beginPlay() {
    let leader = (this.dealer + 1) % 4;
    if (leader === this.sittingOut) leader = (leader + 1) % 4;
    this.turn = leader;
    this.trick = [];
    this.ledSuit = null;
    this.phase = 'play';
  }

  // ------------------------------------------------------------------- play

  playCard(seat, card) {
    if (this.phase !== 'play') throw new Error('not in play');
    if (seat !== this.turn) throw new Error('not your turn');
    const hand = this.hands[seat];
    const legal = legalPlays(hand, this.trump, this.ledSuit);
    if (!legal.includes(card)) throw new Error('illegal card');

    hand.splice(hand.indexOf(card), 1);
    this.trick.push({ seat, card });
    this.playedCards.push(card);
    if (this.trick.length === 1) this.ledSuit = effectiveSuit(card, this.trump);

    if (this.trick.length === this.playersInTrick()) {
      const wi = winningPlayIndex(this.trick, this.trump, this.ledSuit);
      this.trickWinner = this.trick[wi].seat;
      this.phase = 'trickComplete';
    } else {
      this.turn = this.nextActive(seat);
    }
  }

  /** Sweep the completed trick away and either continue or score the hand. */
  finishTrick() {
    if (this.phase !== 'trickComplete') throw new Error('no trick to finish');
    const winner = this.trickWinner;
    this.tricksWon[winner] += 1;
    this.tricksPlayed += 1;
    this.lastTrick = { plays: this.trick, winner, ledSuit: this.ledSuit };
    this.history.push(this.lastTrick);
    this.pushLog(`${this.names[winner]} takes trick ${this.tricksPlayed}`);
    this.trick = [];
    this.ledSuit = null;
    this.turn = winner;

    if (this.tricksPlayed === 5) this.scoreHand();
    else this.phase = 'play';
  }

  scoreHand() {
    const makerTeam = teamOf(this.maker);
    const taken = [0, 1].map((t) =>
      this.tricksWon.reduce((sum, n, seat) => sum + (teamOf(seat) === t ? n : 0), 0)
    );
    const makerTricks = taken[makerTeam];

    let points = 0;
    let scoringTeam = makerTeam;
    let reason;

    if (makerTricks >= 3) {
      if (makerTricks === 5) {
        points = this.alone ? 4 : 2;
        reason = this.alone ? 'marched alone' : 'took all five';
      } else {
        points = 1;
        reason = 'made it';
      }
    } else {
      scoringTeam = 1 - makerTeam;
      points = 2;
      reason = 'euchred!';
    }

    this.score[scoringTeam] += points;
    const teamNames = (t) => `${this.names[t]} & ${this.names[t + 2]}`;
    this.pushLog(
      `${teamNames(makerTeam)} took ${makerTricks} — ${reason} ` +
        `(${teamNames(scoringTeam)} +${points})`
    );

    this.lastHandSummary = {
      makerTeam,
      maker: this.maker,
      alone: this.alone,
      trump: this.trump,
      makerTricks,
      scoringTeam,
      points,
      reason,
      tricksWon: this.tricksWon.slice(),
    };

    if (this.score[0] >= WINNING_SCORE || this.score[1] >= WINNING_SCORE) {
      this.phase = 'gameOver';
      const winner = this.score[0] >= WINNING_SCORE ? 0 : 1;
      this.pushLog(`*** ${teamNames(winner)} win ${this.score[winner]}–${this.score[1 - winner]} ***`);
    } else {
      this.phase = 'handOver';
    }
  }

  nextHand() {
    if (this.phase !== 'handOver') throw new Error('hand is not over');
    this.dealer = (this.dealer + 1) % 4;
    this.startHand();
  }

  // ------------------------------------------------------------------ views

  /** Public state plus one seat's private hand. `seat` may be null (spectator). */
  viewFor(seat) {
    return {
      phase: this.phase,
      turn: this.turn,
      dealer: this.dealer,
      names: this.names,
      score: this.score,
      handNumber: this.handNumber,
      trump: this.trump,
      maker: this.maker,
      alone: this.alone,
      sittingOut: this.sittingOut,
      upcard: this.phase === 'bid1' || this.phase === 'discard' ? this.upcard : null,
      turnedDownSuit: this.turnedDownSuit,
      trick: this.trick,
      ledSuit: this.ledSuit,
      trickWinner: this.phase === 'trickComplete' ? this.trickWinner : null,
      tricksWon: this.tricksWon,
      tricksPlayed: this.tricksPlayed,
      handCounts: this.hands.map((h) => h.length),
      lastHandSummary: this.phase === 'handOver' || this.phase === 'gameOver'
        ? this.lastHandSummary
        : null,
      log: this.log.slice(-12),
      you: seat == null ? null : {
        seat,
        hand: this.hands[seat],
        actions: this.legalActions(seat),
      },
    };
  }
}
