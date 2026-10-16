// Word Race: everyone gets the same hidden five-letter word and six guesses,
// on their own board, at the same time.
//
// While the round is on you can see how everybody else is doing — the colours
// of each of their rows, but never the letters — which is exactly the tension
// of comparing Wordle grids, only live. When everyone has solved it or run out
// of guesses, every board is shown in full.
//
// A solve scores 7 minus the guesses it took (one guess is 6, six is 1), and
// the first person to solve takes one more. Most points over the words wins.
//
// Phases:
//   'playing'  - everyone guessing
//   'reveal'   - the word and every board; waiting for everyone
//   'gameOver' - every word played

import { ANSWERS, VALID } from './words.js';

export const GUESSES = 6;

/**
 * Colour a guess against the answer. 'g' right place, 'y' in the word
 * elsewhere, '.' not in it. Repeated letters are only marked as often as the
 * answer has them — the greens first, then yellows left to right.
 */
export function mark(guess, answer) {
  const out = ['.', '.', '.', '.', '.'];
  const left = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) out[i] = 'g';
    else left[answer[i]] = (left[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (out[i] === 'g') continue;
    if (left[guess[i]] > 0) {
      out[i] = 'y';
      left[guess[i]]--;
    }
  }
  return out.join('');
}

export class WordRaceGame {
  constructor({ names = [], playerCount = 2, words = 3, rng = Math.random, now = () => Date.now(), used = new Set() } = {}) {
    this.names = names;
    this.playerCount = playerCount;
    this.totalWords = words;
    this.rng = rng;
    this.now = now;
    this.used = used; // shared across rematches in a room, so words do not repeat
    this.round = 0;
    this.scores = new Array(playerCount).fill(0);
    this.log = [];
    this.nextRound();
  }

  pickWord() {
    let pool = ANSWERS.filter((w) => !this.used.has(w));
    if (!pool.length) {
      this.used.clear();
      pool = ANSWERS;
    }
    const w = pool[Math.floor(this.rng() * pool.length)];
    this.used.add(w);
    return w;
  }

  nextRound() {
    this.round++;
    this.answer = this.pickWord();
    this.boards = Array.from({ length: this.playerCount }, () => []);
    this.solvedAt = new Array(this.playerCount).fill(null);
    this.startedAt = this.now();
    this.roundPoints = null;
    this.firstSolver = null;
    this.phase = 'playing';
  }

  done(seat) {
    return this.solvedAt[seat] !== null || this.boards[seat].length >= GUESSES;
  }

  guess(seat, word) {
    if (this.phase !== 'playing') throw new Error('the round is over');
    if (this.done(seat)) throw new Error('you are finished this round');
    const w = String(word || '').trim().toLowerCase();
    if (!/^[a-z]{5}$/.test(w)) throw new Error('five letters');
    if (!VALID.has(w)) throw new Error('not in the word list');
    const m = mark(w, this.answer);
    this.boards[seat].push({ word: w, marks: m });
    if (m === 'ggggg') {
      this.solvedAt[seat] = this.now() - this.startedAt;
      if (this.firstSolver === null) this.firstSolver = seat;
    }
    if (Array.from({ length: this.playerCount }, (_, s) => s).every((s) => this.done(s))) this.endRound();
  }

  endRound() {
    const pts = new Array(this.playerCount).fill(0);
    for (let s = 0; s < this.playerCount; s++) {
      if (this.solvedAt[s] !== null) pts[s] = GUESSES + 1 - this.boards[s].length;
    }
    if (this.firstSolver !== null) pts[this.firstSolver] += 1;
    pts.forEach((p, s) => { this.scores[s] += p; });
    this.roundPoints = pts;
    this.log.push(`${this.answer.toUpperCase()}: ${this.names.map((n, s) =>
      `${n} ${this.solvedAt[s] !== null ? `${this.boards[s].length}/6` : 'X'}`).join(', ')}`);
    this.phase = 'reveal';
  }

  afterReveal() {
    if (this.phase !== 'reveal') throw new Error('nothing to move on from');
    if (this.round >= this.totalWords) {
      this.phase = 'gameOver';
      const best = Math.max(...this.scores);
      this.log.push(`*** ${this.scores.map((v, i) => (v === best ? this.names[i] : null)).filter(Boolean).join(' & ')} win${this.scores.filter((v) => v === best).length > 1 ? '' : 's'} ***`);
      return;
    }
    this.nextRound();
  }

  winners() {
    const best = Math.max(...this.scores);
    return this.scores.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
  }

  viewFor(seat) {
    const open = this.phase !== 'playing';
    return {
      phase: this.phase,
      game: 'wordle',
      names: this.names,
      players: this.playerCount,
      round: this.round,
      totalWords: this.totalWords,
      guessesAllowed: GUESSES,
      // Your own board in full; everyone else's as colours only until the end.
      boards: this.boards.map((b, s) => (s === seat || open
        ? b.map((r) => ({ word: r.word, marks: r.marks }))
        : b.map((r) => ({ word: null, marks: r.marks })))),
      solvedAt: this.solvedAt.slice(),
      done: this.boards.map((_, s) => this.done(s)),
      firstSolver: this.firstSolver,
      answer: open ? this.answer : null,
      roundPoints: this.roundPoints,
      scores: this.scores.slice(),
      startedAt: this.startedAt,
      log: this.log.slice(-12),
    };
  }
}
