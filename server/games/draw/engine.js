// Drawing game engine. Pure state machine — no networking, no timers.
//
// One person draws a prompt, everyone else types guesses. Points go to the
// guesser and to the drawer, scaled by how much time was left, so a drawing
// that lands fast is worth more to both of you.
//
// Phases:
//   'choosing' - the drawer picks one of three prompts
//   'drawing'  - the clock runs; guesses come in
//   'reveal'   - the word is shown and the round is scored
//   'gameOver' - every turn has been taken

import { offerWords, matchesWord, isNearMiss } from './words.js';

export const CHOOSE_SECONDS = 15;
export const DRAW_SECONDS = 80;
export const TURNS_EACH = 3;

/** Points for landing a guess with `left` of `total` seconds remaining: 1–3. */
export function pointsFor(left, total) {
  if (left <= 0) return 0;
  const share = left / total;
  if (share > 0.66) return 3;
  if (share > 0.33) return 2;
  return 1;
}

export class DrawGame {
  constructor({
    names = [], playerCount = 2, turnsEach = TURNS_EACH, rng = Math.random,
    chooseSeconds = CHOOSE_SECONDS, drawSeconds = DRAW_SECONDS,
  } = {}) {
    this.names = names;
    this.playerCount = playerCount;
    this.rng = rng;
    // Shortened by the tests so a full game does not take twenty minutes.
    this.chooseSeconds = chooseSeconds;
    this.drawSeconds = drawSeconds;
    this.scores = new Array(playerCount).fill(0);
    this.totalTurns = playerCount * turnsEach;
    this.turn = 0;
    this.usedWords = new Set();
    this.log = [];
    this.drawer = -1;
    this.startTurn();
  }

  pushLog(text) {
    this.log.push(text);
    if (this.log.length > 60) this.log.shift();
  }

  // ------------------------------------------------------------------ turns

  startTurn() {
    this.turn += 1;
    this.drawer = (this.drawer + 1) % this.playerCount;
    this.choices = offerWords(this.usedWords, this.rng);
    this.word = null;
    this.strokes = [];
    this.guesses = [];
    this.solved = []; // {seat, points, secondsLeft}
    this.endsAt = null;
    this.deadline = Date.now() + this.chooseSeconds * 1000;
    this.phase = 'choosing';
    this.pushLog(`--- Turn ${this.turn} of ${this.totalTurns}: ${this.names[this.drawer]} draws ---`);
  }

  /** Everyone except the drawer is guessing this turn. */
  guessers() {
    return Array.from({ length: this.playerCount }, (_, i) => i)
      .filter((s) => s !== this.drawer);
  }

  chooseWord(seat, word) {
    if (this.phase !== 'choosing') throw new Error('not choosing a word');
    if (seat !== this.drawer) throw new Error('only the drawer picks the word');
    if (!this.choices.includes(word)) throw new Error('that word was not offered');
    this.word = word;
    this.usedWords.add(word);
    this.phase = 'drawing';
    this.deadline = Date.now() + this.drawSeconds * 1000;
  }

  /** Nobody chose in time — take the middle one and get on with it. */
  autoChooseWord() {
    if (this.phase !== 'choosing') return;
    this.chooseWord(this.drawer, this.choices[1]);
  }

  secondsLeft() {
    return Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
  }

  // --------------------------------------------------------------- drawing

  addStroke(seat, stroke) {
    if (this.phase !== 'drawing') throw new Error('not drawing yet');
    if (seat !== this.drawer) throw new Error('only the drawer can draw');
    if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length) return null;
    // Keep the board bounded: a phone can emit a lot of points in 80 seconds.
    if (this.strokes.length >= 4000) return null;
    const clean = {
      id: stroke.id,
      color: typeof stroke.color === 'string' ? stroke.color.slice(0, 24) : '#111',
      width: Math.min(40, Math.max(1, Number(stroke.width) || 4)),
      erase: !!stroke.erase,
      points: stroke.points
        .slice(0, 400)
        .map((p) => [clamp01(p[0]), clamp01(p[1])]),
    };
    this.strokes.push(clean);
    return clean;
  }

  clearBoard(seat) {
    if (seat !== this.drawer) throw new Error('only the drawer can clear');
    if (this.phase !== 'drawing') throw new Error('not drawing');
    this.strokes = [];
  }

  undoStroke(seat) {
    if (seat !== this.drawer) throw new Error('only the drawer can undo');
    if (this.phase !== 'drawing') throw new Error('not drawing');
    this.strokes.pop();
  }

  // --------------------------------------------------------------- guessing

  /** Returns {correct, near, points} — the caller decides what to broadcast. */
  guess(seat, text) {
    if (this.phase !== 'drawing') throw new Error('not guessing yet');
    if (seat === this.drawer) throw new Error('the drawer cannot guess');
    if (this.solved.some((s) => s.seat === seat)) throw new Error('you already got it');

    const clean = String(text || '').trim().slice(0, 60);
    if (!clean) return { correct: false, near: false, points: 0 };

    if (matchesWord(clean, this.word)) {
      const left = this.secondsLeft();
      const points = pointsFor(left, this.drawSeconds);
      this.solved.push({ seat, points, secondsLeft: left });
      this.scores[seat] += points;
      // The drawer earns whatever the fastest guesser earned, once.
      if (this.solved.length === 1) this.scores[this.drawer] += points;
      this.pushLog(`${this.names[seat]} got it with ${left}s left (+${points})`);
      if (this.solved.length === this.guessers().length) this.endTurn('everyone got it');
      return { correct: true, near: false, points };
    }

    const near = isNearMiss(clean, this.word);
    this.guesses.push({ seat, text: clean, near });
    if (this.guesses.length > 40) this.guesses.shift();
    return { correct: false, near, points: 0 };
  }

  // ----------------------------------------------------------------- ending

  endTurn(reason = 'time') {
    if (this.phase === 'reveal' || this.phase === 'gameOver') return;
    this.phase = 'reveal';
    this.revealed = {
      word: this.word,
      drawer: this.drawer,
      solved: this.solved.slice(),
      reason,
    };
    if (!this.solved.length) this.pushLog(`Nobody got "${this.word}"`);
  }

  nextTurn() {
    if (this.phase !== 'reveal') throw new Error('turn is not over');
    if (this.turn >= this.totalTurns) {
      this.phase = 'gameOver';
      const best = Math.max(...this.scores);
      const winners = this.scores
        .map((s, i) => (s === best ? this.names[i] : null))
        .filter(Boolean);
      this.pushLog(`*** ${winners.join(' & ')} win with ${best} ***`);
      return;
    }
    this.startTurn();
  }

  // ------------------------------------------------------------------ views

  viewFor(seat) {
    const isDrawer = seat === this.drawer;
    return {
      phase: this.phase,
      game: 'draw',
      names: this.names,
      scores: this.scores,
      turn: this.turn,
      totalTurns: this.totalTurns,
      drawer: this.drawer,
      youAreDrawing: isDrawer,
      deadline: this.deadline,
      secondsLeft: this.secondsLeft(),
      // Only the drawer sees the word or the choices while a turn is live.
      choices: this.phase === 'choosing' && isDrawer ? this.choices : null,
      word: isDrawer || this.phase === 'reveal' || this.phase === 'gameOver'
        ? this.word
        : null,
      wordLength: this.word ? this.word.replace(/[^a-z0-9]/gi, '').length : 0,
      wordPattern: this.word ? this.word.replace(/[a-z0-9]/gi, '·') : '',
      solved: this.solved,
      youSolved: this.solved.some((s) => s.seat === seat),
      guesses: this.guesses.slice(-12),
      revealed: this.phase === 'reveal' || this.phase === 'gameOver' ? this.revealed : null,
      strokeCount: this.strokes.length,
      log: this.log.slice(-12),
      you: { seat },
    };
  }
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));
}
