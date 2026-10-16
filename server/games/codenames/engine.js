// Codenames Duet engine.
//
// Twenty-five words, one key card with two sides. Each of you sees only your
// own side: nine words are your agents, three are assassins, the rest are
// bystanders. You take turns giving a one-word clue that points your partner
// at *your* agents; they tap words until they miss. Find all fifteen agents
// between you before the turns run out. Touch an assassin and it is over.
//
// The two sides overlap the way the real key card does, so a word can be an
// agent for one of you and an assassin for the other:
//
//   you \ them   agent  bystander  assassin
//   agent          3        5         1
//   bystander      5        7         1
//   assassin       1        1         1
//
// Phases:
//   'clue'        - the clue giver is typing a clue
//   'guess'       - the other player is tapping words
//   'suddenDeath' - turns are gone; any wrong tap loses, no more clues
//   'gameOver'    - won or lost

import { WORDS } from './words.js';

export const AGENTS = 15;

const PAIRS = [
  ['A', 'A', 3], ['A', 'N', 5], ['A', 'X', 1],
  ['N', 'A', 5], ['N', 'N', 7], ['N', 'X', 1],
  ['X', 'A', 1], ['X', 'N', 1], ['X', 'X', 1],
];

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A fresh key: per seat, 'A' agent, 'N' bystander, 'X' assassin. */
export function dealKey(rng = Math.random) {
  const pairs = shuffle(PAIRS.flatMap(([a, b, n]) => Array.from({ length: n }, () => [a, b])), rng);
  return [pairs.map((p) => p[0]), pairs.map((p) => p[1])];
}

/** Normalise a clue or a word for comparison. */
const norm = (w) => String(w || '').trim().toLowerCase().replace(/[^a-z]/g, '');

export class CodenamesGame {
  constructor({ names = [], turns = 9, rng = Math.random, words = null } = {}) {
    this.names = names;
    this.words = words || shuffle(WORDS, rng).slice(0, 25);
    this.key = dealKey(rng);
    this.turnsTotal = turns;
    this.turnsLeft = turns;
    // Per card: which agent was found (the seat whose key it was), and which
    // sides have shown it to be a bystander.
    this.found = new Array(25).fill(false);
    this.neutral = [new Array(25).fill(false), new Array(25).fill(false)];
    this.giver = Math.floor(rng() * 2);
    this.clue = null;
    this.guessesThisTurn = 0;
    this.phase = 'clue';
    this.result = null; // { won, reason, card? }
    this.lastReveal = null;
    this.history = [];
    this.log = [`--- ${names[this.giver]} gives the first clue ---`];
  }

  get guesser() { return 1 - this.giver; }

  /** How many of this seat's agents are still out there. */
  agentsLeftFor(seat) {
    return this.key[seat].filter((k, i) => k === 'A' && !this.found[i]).length;
  }

  get agentsFound() { return this.found.filter(Boolean).length; }

  giveClue(seat, word, number) {
    if (this.phase !== 'clue') throw new Error('it is not time for a clue');
    if (seat !== this.giver) throw new Error('it is not your clue');
    const w = norm(word);
    if (!w) throw new Error('a clue needs a word');
    if (w.length > 24) throw new Error('that clue is too long');
    const n = Number(number);
    if (!Number.isInteger(n) || n < 0 || n > 9) throw new Error('the number is 0 to 9');
    // A clue that is one of the words still in play would give the game away.
    const live = this.words.filter((_, i) => !this.found[i]).map(norm);
    if (live.includes(w)) throw new Error('you cannot use a word that is on the board');
    // Sharing a stem gives it away too (PEN for PENGUIN, SNOWMAN for SNOW),
    // but a word merely hidden inside another is fine: ART with HEART is a
    // clue, not a cheat.
    if (live.some((x) => Math.min(x.length, w.length) >= 3 && (x.startsWith(w) || w.startsWith(x)))) {
      throw new Error('too close to a word on the board');
    }
    this.clue = { word: String(word).trim().slice(0, 24), number: n, by: seat };
    this.guessesThisTurn = 0;
    this.phase = 'guess';
    this.log.push(`${this.names[seat]}: ${this.clue.word.toUpperCase()} ${n}`);
  }

  guess(seat, card) {
    card = Number(card);
    if (!Number.isInteger(card) || card < 0 || card >= 25) throw new Error('no such card');
    if (this.phase === 'suddenDeath') return this.suddenGuess(seat, card);
    if (this.phase !== 'guess') throw new Error('it is not time to guess');
    if (seat !== this.guesser) throw new Error('it is not your guess');
    if (this.found[card]) throw new Error('that one is already found');
    if (this.neutral[this.giver][card]) throw new Error('your partner already showed that is a bystander');

    const what = this.key[this.giver][card];
    this.guessesThisTurn++;
    this.lastReveal = { card, what, by: seat, side: this.giver, n: (this.lastReveal?.n || 0) + 1 };

    if (what === 'X') return this.lose('assassin', card);
    if (what === 'A') {
      this.found[card] = true;
      this.log.push(`${this.names[seat]} found ${this.words[card].toUpperCase()}`);
      if (this.agentsFound === AGENTS) return this.win();
      // Everything this clue could point at is found: the turn ends itself.
      if (this.agentsLeftFor(this.giver) === 0) return this.endTurn('all found');
      return;
    }
    this.neutral[this.giver][card] = true;
    this.log.push(`${this.names[seat]} hit a bystander: ${this.words[card].toUpperCase()}`);
    this.endTurn('bystander');
  }

  stop(seat) {
    if (this.phase !== 'guess') throw new Error('nothing to stop');
    if (seat !== this.guesser) throw new Error('it is not your guess');
    if (this.guessesThisTurn === 0) throw new Error('make at least one guess first');
    this.endTurn('stopped');
  }

  endTurn(reason) {
    this.history.push({ clue: this.clue, guesses: this.guessesThisTurn, reason });
    this.turnsLeft--;
    this.clue = null;
    if (this.turnsLeft <= 0) {
      this.phase = 'suddenDeath';
      this.log.push('--- Out of turns: sudden death ---');
      return;
    }
    // Whoever still has agents for the other to find gives the clue. If one of
    // you is finished, the other gives every clue from here.
    const next = this.guesser;
    this.giver = this.agentsLeftFor(next) > 0 ? next : this.giver;
    this.phase = 'clue';
  }

  /**
   * No more clues. Either of you may tap a word you think is an agent on your
   * *partner's* side — the one you have been guessing for. Any miss loses.
   */
  suddenGuess(seat, card) {
    const side = 1 - seat;
    if (this.found[card]) throw new Error('that one is already found');
    if (this.agentsLeftFor(side) === 0) throw new Error('you have found all of theirs — it is their tap');
    const what = this.key[side][card];
    this.lastReveal = { card, what, by: seat, side, n: (this.lastReveal?.n || 0) + 1 };
    if (what !== 'A') return this.lose(what === 'X' ? 'assassin' : 'sudden death', card);
    this.found[card] = true;
    if (this.agentsFound === AGENTS) this.win();
  }

  win() {
    this.phase = 'gameOver';
    this.result = { won: true };
    this.log.push(`*** All fifteen found with ${this.turnsLeft} turn${this.turnsLeft === 1 ? '' : 's'} to spare ***`);
  }

  lose(reason, card) {
    this.phase = 'gameOver';
    this.result = { won: false, reason, card };
    this.log.push(reason === 'assassin'
      ? `*** ${this.words[card].toUpperCase()} was an assassin ***`
      : `*** ${this.words[card].toUpperCase()} was not an agent ***`);
  }

  viewFor(seat) {
    const over = this.phase === 'gameOver';
    return {
      phase: this.phase,
      game: 'codenames',
      names: this.names,
      words: this.words,
      // Your side of the key only — until it is over, when both are shown.
      yourKey: this.key[seat],
      theirKey: over ? this.key[1 - seat] : null,
      found: this.found,
      neutral: [this.neutral[seat], this.neutral[1 - seat]], // [yours, theirs]
      giver: this.giver,
      clue: this.clue,
      guessesThisTurn: this.guessesThisTurn,
      turnsLeft: this.turnsLeft,
      turnsTotal: this.turnsTotal,
      agentsFound: this.agentsFound,
      agentsTotal: AGENTS,
      yourAgentsLeft: this.agentsLeftFor(seat),
      theirAgentsLeft: this.agentsLeftFor(1 - seat),
      lastReveal: this.lastReveal,
      history: this.history,
      result: this.result,
      log: this.log.slice(-14),
    };
  }
}
