// Trivia engine. Everyone answers the same question at the same time, so —
// unlike the drawing game — the roles are symmetric and there is no scoring
// asymmetry to reason about. Fastest correct answer wins the question.
//
// Phases:
//   'spinning' - the wheel is turning; the category is already decided
//   'question' - the question is up and the clock is running
//   'reveal'   - answer shown and scored
//   'gameOver' - every question asked

import { CATEGORIES, categoryById } from './questions.js';

export const SPIN_MS = 2600;
export const QUESTION_SECONDS = 20;
export const MIN_POINTS = 20;
export const MAX_POINTS = 100;
export const FIRST_BONUS = 30;

/** A correct answer with `left` of `total` seconds still on the clock. */
export function pointsFor(left, total) {
  if (left <= 0) return 0;
  const share = Math.max(0, Math.min(1, left / total));
  return MIN_POINTS + Math.round((MAX_POINTS - MIN_POINTS) * share);
}

export class TriviaGame {
  constructor({
    names = [], playerCount = 2, questionCount = 10, rng = Math.random,
    questionSeconds = QUESTION_SECONDS, spinMs = SPIN_MS,
  } = {}) {
    this.names = names;
    this.playerCount = playerCount;
    this.rng = rng;
    this.questionSeconds = questionSeconds;
    this.spinMs = spinMs;
    this.scores = new Array(playerCount).fill(0);
    this.streaks = new Array(playerCount).fill(0);
    this.correctCounts = new Array(playerCount).fill(0);
    this.questionCount = questionCount;
    this.index = 0;
    this.log = [];
    this.startSpin();
  }

  pushLog(text) {
    this.log.push(text);
    if (this.log.length > 60) this.log.shift();
  }

  seats() {
    return Array.from({ length: this.playerCount }, (_, i) => i);
  }

  // ------------------------------------------------------------ the wheel

  /**
   * The category is chosen here, not by the animation. The client is told
   * which segment to land on and spins to it, so both phones show the same
   * result no matter how their animations drift.
   */
  startSpin() {
    this.index += 1;
    this.question = null;
    this.answers = [];
    this.spunCategory = CATEGORIES[Math.floor(this.rng() * CATEGORIES.length)].id;
    this.spinNonce = Math.floor(this.rng() * 1e9); // makes every spin animate
    this.deadline = Date.now() + this.spinMs;
    this.phase = 'spinning';
    this.pushLog(`--- Q${this.index}: ${categoryById(this.spunCategory).name} ---`);
  }

  /** Called once the wheel has stopped and a question has been fetched. */
  beginQuestion(question) {
    if (this.phase !== 'spinning') return;
    this.question = question;
    this.deadline = Date.now() + this.questionSeconds * 1000;
    this.phase = 'question';
  }

  secondsLeft() {
    return Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
  }

  // ------------------------------------------------------------ answering

  answer(seat, choice) {
    if (this.phase !== 'question') throw new Error('no question is open');
    if (this.answers.some((a) => a.seat === seat)) throw new Error('you already answered');
    const n = Number(choice);
    if (!Number.isInteger(n) || n < 0 || n >= this.question.options.length) {
      throw new Error('not one of the options');
    }

    const left = this.secondsLeft();
    const correct = n === this.question.answer;
    const first = correct && !this.answers.some((a) => a.correct);
    let points = 0;
    if (correct) {
      points = pointsFor(left, this.questionSeconds);
      // Being fastest is the point of the game, so it is worth something on
      // top of the clock — otherwise two quick answers score nearly the same.
      if (first) points += FIRST_BONUS;
      this.scores[seat] += points;
      this.correctCounts[seat] += 1;
      this.streaks[seat] += 1;
    } else {
      this.streaks[seat] = 0;
    }
    this.answers.push({ seat, choice: n, correct, first, points, secondsLeft: left });
    this.pushLog(`${this.names[seat]} ${correct ? `+${points}` : 'wrong'}`);

    if (this.answers.length === this.playerCount) this.endQuestion('everyone answered');
    return { correct, first, points };
  }

  endQuestion(reason = 'time') {
    if (this.phase === 'reveal' || this.phase === 'gameOver') return;
    this.phase = 'reveal';
    this.revealed = {
      question: this.question,
      answers: this.answers.slice(),
      reason,
      // Whoever got there first, if anyone did.
      fastest: this.answers.find((a) => a.first)?.seat ?? null,
    };
  }

  nextQuestion() {
    if (this.phase !== 'reveal') throw new Error('question is not over');
    if (this.index >= this.questionCount) {
      this.phase = 'gameOver';
      const best = Math.max(...this.scores);
      const winners = this.scores
        .map((s, i) => (s === best ? this.names[i] : null))
        .filter(Boolean);
      this.pushLog(`*** ${winners.join(' & ')} win with ${best} ***`);
      return;
    }
    this.startSpin();
  }

  // ------------------------------------------------------------------ view

  viewFor(seat) {
    const mine = this.answers.find((a) => a.seat === seat) || null;
    const revealing = this.phase === 'reveal' || this.phase === 'gameOver';
    return {
      phase: this.phase,
      game: 'trivia',
      names: this.names,
      scores: this.scores,
      streaks: this.streaks,
      correctCounts: this.correctCounts,
      index: this.index,
      questionCount: this.questionCount,
      categories: CATEGORIES,
      category: this.spunCategory,
      spinNonce: this.spinNonce,
      spinMs: this.spinMs,
      deadline: this.deadline,
      secondsLeft: this.secondsLeft(),
      questionSeconds: this.questionSeconds,
      // The correct index is withheld until the reveal, so a determined
      // player cannot read it out of the socket mid-question.
      question: this.question ? {
        text: this.question.text,
        options: this.question.options,
        difficulty: this.question.difficulty,
        bundled: !!this.question.bundled,
        answer: revealing ? this.question.answer : null,
      } : null,
      yourAnswer: mine ? mine.choice : null,
      // Who has locked in, without giving away what they picked.
      answered: this.answers.map((a) => a.seat),
      revealed: revealing ? this.revealed : null,
      worthNow: this.phase === 'question'
        ? pointsFor(this.secondsLeft(), this.questionSeconds)
        : 0,
      log: this.log.slice(-12),
      you: { seat },
    };
  }
}
