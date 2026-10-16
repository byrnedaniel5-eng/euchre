// Yahtzee engine. One to four players take whole turns in order: up to three
// rolls, holding whatever dice they like between them, then a score in one
// box. Thirteen turns each fills the sheet. The server rolls every die, and
// everyone watches every roll.
//
// Phases:
//   'playing'  - whoever's turn it is is rolling or scoring
//   'gameOver' - every sheet full

import { newSheet, options, totals, filled, isYahtzee, LABELS } from './rules.js';

export class YahtzeeGame {
  constructor({ names = [], playerCount = 2, first = 0, rng = Math.random } = {}) {
    this.names = names;
    this.playerCount = playerCount;
    this.rng = rng;
    this.sheets = Array.from({ length: playerCount }, () => newSheet());
    this.turn = first;
    this.phase = 'playing';
    this.rollNo = 0;
    this.lastScore = null;
    this.log = [`--- ${names[first]} rolls first ---`];
    this.startTurn();
  }

  startTurn() {
    this.dice = [0, 0, 0, 0, 0];
    this.held = [false, false, false, false, false];
    this.rollsLeft = 3;
  }

  die() {
    return 1 + Math.floor(this.rng() * 6);
  }

  roll(seat, held) {
    if (this.phase !== 'playing') throw new Error('the game is over');
    if (seat !== this.turn) throw new Error('not your turn');
    if (this.rollsLeft <= 0) throw new Error('no rolls left — score it');
    if (this.rollsLeft < 3 && Array.isArray(held)) {
      this.held = [0, 1, 2, 3, 4].map((i) => !!held[i]);
    } else if (this.rollsLeft === 3) {
      this.held = [false, false, false, false, false];
    }
    if (this.held.every(Boolean)) throw new Error('you are holding everything — score it');
    this.dice = this.dice.map((d, i) => (this.held[i] ? d : this.die()));
    this.rollsLeft--;
    this.rollNo++;
  }

  /** Hold or release one die, between rolls. Public, so others see it too. */
  hold(seat, index, on) {
    if (seat !== this.turn || this.phase !== 'playing') throw new Error('not your turn');
    if (this.rollsLeft === 3) throw new Error('roll first');
    if (this.rollsLeft === 0) throw new Error('no rolls left to hold for');
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i > 4) throw new Error('no such die');
    this.held[i] = !!on;
  }

  options(seat = this.turn) {
    return this.rollsLeft === 3 ? {} : options(this.sheets[seat], this.dice);
  }

  score(seat, cat) {
    if (this.phase !== 'playing') throw new Error('the game is over');
    if (seat !== this.turn) throw new Error('not your turn');
    if (this.rollsLeft === 3) throw new Error('roll first');
    const opts = this.options(seat);
    if (!(cat in opts)) throw new Error('you cannot score that box now');
    const sheet = this.sheets[seat];
    // The hundred-point bonus is for a Yahtzee when the box already holds 50.
    const bonus = isYahtzee(this.dice) && sheet.yahtzee === 50;
    if (bonus) sheet.bonusYahtzees++;
    sheet[cat] = opts[cat];
    this.lastScore = { seat, cat, points: opts[cat], bonus, dice: this.dice.slice(), n: (this.lastScore?.n || 0) + 1 };
    this.log.push(`${this.names[seat]}: ${LABELS[cat]} for ${opts[cat]}${bonus ? ' and a Yahtzee bonus' : ''}`);

    if (this.sheets.every(filled)) {
      this.phase = 'gameOver';
      const t = this.sheets.map((s) => totals(s).total);
      const best = Math.max(...t);
      this.log.push(`*** ${this.names.filter((_, i) => t[i] === best).join(' & ')} win with ${best} ***`);
      return;
    }
    this.turn = (this.turn + 1) % this.playerCount;
    this.startTurn();
  }

  winners() {
    const t = this.sheets.map((s) => totals(s).total);
    const best = Math.max(...t);
    return t.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
  }

  viewFor(seat) {
    return {
      phase: this.phase,
      game: 'yahtzee',
      names: this.names,
      players: this.playerCount,
      turn: this.turn,
      yourTurn: this.phase === 'playing' && this.turn === seat,
      dice: this.dice,
      held: this.held,
      rollsLeft: this.rollsLeft,
      rollNo: this.rollNo,
      options: this.phase === 'playing' ? this.options() : {},
      sheets: this.sheets,
      totals: this.sheets.map(totals),
      lastScore: this.lastScore,
      log: this.log.slice(-12),
    };
  }
}
