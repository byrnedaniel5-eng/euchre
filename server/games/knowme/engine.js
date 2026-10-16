// Know Me engine: how well do you know each other?
//
// Each round one player is the subject. They choose a question about
// themselves, then everyone answers at once: the subject truthfully, everyone
// else predicting. Points go to the guessers only. Everyone is the subject
// the same number of times, so the winner is simply whoever knows the others
// best — and, with two of you, paying the subject too would tie every game.
//
// Phases:
//   'pick'     - the subject is choosing (or writing) a question
//   'answer'   - everyone is answering, secretly
//   'judge'    - free-text only: the subject marks each guess
//   'reveal'   - everything shown; waiting for everyone
//   'gameOver' - every round played

import { QUESTIONS } from './questions.js';

export const POINTS = { right: 2, close: 1, wrong: 0 };
const SWAPS = 3;

const norm = (s) => String(s ?? '').trim().toLowerCase()
  .replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, '');

export class KnowMeGame {
  constructor({ names = [], playerCount = 2, roundsEach = 4, deck = 'everyone', rng = Math.random } = {}) {
    this.names = names;
    this.playerCount = playerCount;
    this.rng = rng;
    this.totalRounds = roundsEach * playerCount;
    this.round = 0;
    this.scores = new Array(playerCount).fill(0);
    this.pool = QUESTIONS
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => deck === 'couples' || !q.couple)
      .map(({ i }) => i);
    this.used = new Set();
    this.subject = Math.floor(rng() * playerCount);
    this.history = [];
    this.log = [];
    this.nextRound();
  }

  drawQuestion() {
    let options = this.pool.filter((i) => !this.used.has(i));
    if (!options.length) {
      this.used.clear();
      options = this.pool;
    }
    const i = options[Math.floor(this.rng() * options.length)];
    this.used.add(i);
    return { ...QUESTIONS[i] };
  }

  nextRound() {
    if (this.round > 0) this.subject = (this.subject + 1) % this.playerCount;
    this.round++;
    this.question = this.drawQuestion();
    this.swapsLeft = SWAPS;
    this.answers = new Array(this.playerCount).fill(null);
    this.marks = new Array(this.playerCount).fill(null);
    this.roundPoints = null;
    this.phase = 'pick';
  }

  swap(seat) {
    if (this.phase !== 'pick' || seat !== this.subject) throw new Error('only the subject picks the question');
    if (this.swapsLeft <= 0) throw new Error('no swaps left');
    this.swapsLeft--;
    this.question = this.drawQuestion();
  }

  /** The subject writes their own question, answered in free text. */
  custom(seat, q) {
    if (this.phase !== 'pick' || seat !== this.subject) throw new Error('only the subject picks the question');
    const text = String(q || '').trim().slice(0, 120);
    if (text.length < 4) throw new Error('write a question');
    this.question = { type: 'text', q: text, custom: true };
  }

  ask(seat) {
    if (this.phase !== 'pick' || seat !== this.subject) throw new Error('only the subject picks the question');
    this.phase = 'answer';
  }

  answer(seat, value) {
    if (this.phase !== 'answer') throw new Error('it is not time to answer');
    const q = this.question;
    let v;
    if (q.type === 'choice') {
      v = Number(value);
      if (!Number.isInteger(v) || v < 0 || v >= q.options.length) throw new Error('pick one of the options');
    } else if (q.type === 'scale') {
      v = Number(value);
      if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error('one to five');
    } else {
      v = String(value ?? '').trim().slice(0, 80);
      if (!v) throw new Error('write an answer');
    }
    this.answers[seat] = v;
    if (this.answers.every((a) => a !== null)) this.allIn();
  }

  guessers() {
    return Array.from({ length: this.playerCount }, (_, s) => s).filter((s) => s !== this.subject);
  }

  allIn() {
    const truth = this.answers[this.subject];
    const q = this.question;
    for (const s of this.guessers()) {
      const g = this.answers[s];
      if (q.type === 'choice') this.marks[s] = g === truth ? 'right' : 'wrong';
      else if (q.type === 'scale') {
        const d = Math.abs(g - truth);
        this.marks[s] = d === 0 ? 'right' : d === 1 ? 'close' : 'wrong';
      } else if (norm(g) === norm(truth)) {
        this.marks[s] = 'right';
      }
    }
    // Free text the machine could not settle goes to the one person who
    // knows the answer.
    if (this.guessers().some((s) => this.marks[s] === null)) {
      this.phase = 'judge';
      return;
    }
    this.score();
  }

  judge(seat, target, mark) {
    if (this.phase !== 'judge') throw new Error('nothing to judge');
    if (seat !== this.subject) throw new Error('only the subject knows');
    target = Number(target);
    if (!this.guessers().includes(target)) throw new Error('no such guess');
    if (!(mark in POINTS)) throw new Error('right, close or wrong');
    this.marks[target] = mark;
    if (this.guessers().every((s) => this.marks[s] !== null)) this.score();
  }

  score() {
    this.roundPoints = new Array(this.playerCount).fill(0);
    for (const s of this.guessers()) {
      this.roundPoints[s] = POINTS[this.marks[s]];
      this.scores[s] += this.roundPoints[s];
    }
    this.history.push({ subject: this.subject, question: this.question, answers: this.answers.slice(), marks: this.marks.slice() });
    const right = this.guessers().filter((s) => this.marks[s] === 'right').map((s) => this.names[s]);
    this.log.push(`${this.names[this.subject]}: ${this.question.q} — ${right.length ? `${right.join(', ')} knew` : 'nobody knew'}`);
    this.phase = 'reveal';
  }

  afterReveal() {
    if (this.phase !== 'reveal') throw new Error('nothing to move on from');
    if (this.round >= this.totalRounds) {
      this.phase = 'gameOver';
      const best = Math.max(...this.scores);
      this.log.push(`*** ${this.scores.map((v, i) => (v === best ? this.names[i] : null)).filter(Boolean).join(' & ')} know${this.scores.filter((v) => v === best).length > 1 ? '' : 's'} best ***`);
      return;
    }
    this.nextRound();
  }

  viewFor(seat) {
    const open = this.phase === 'reveal' || this.phase === 'gameOver';
    const subject = seat === this.subject;
    return {
      phase: this.phase,
      game: 'knowme',
      names: this.names,
      players: this.playerCount,
      round: this.round,
      totalRounds: this.totalRounds,
      subject: this.subject,
      youAreSubject: subject,
      question: this.question,
      swapsLeft: subject ? this.swapsLeft : null,
      yourAnswer: this.answers[seat],
      answered: this.answers.map((a) => a !== null),
      // Everyone's answers only when it is all out in the open — except the
      // subject while judging, who has to see the guesses to mark them.
      answers: open || (subject && this.phase === 'judge') ? this.answers.slice() : null,
      marks: open || (subject && this.phase === 'judge') ? this.marks.slice() : null,
      roundPoints: this.roundPoints,
      scores: this.scores.slice(),
      log: this.log.slice(-12),
    };
  }
}
