// Wavelength engine.
//
// One player sees where a hidden target sits on a spectrum — Cold to Hot, say
// — and gives a clue that lands about there. Everyone else turns a dial to
// where they think it is. Closer is better.
//
// Two people play together: the clue-giver and guesser are the same team, and
// the score is how in sync you are. With three or more, every guesser scores
// their own dial, and the clue-giver collects the average of what their clue
// earned — so a clear clue pays them too, without letting one guess decide it.
// (Paying the clue-giver with two people would just tie every game, the same
// trap the drawing game fell into.)
//
// Phases:
//   'clue'     - the psychic has the target and is writing a clue
//   'guess'    - everyone else is setting their dial
//   'reveal'   - the target is shown, with every dial; wait for everyone
//   'gameOver' - every round played

import { SPECTRA } from './spectra.js';

// Scoring bands either side of the target, in dial units (0..100). Together
// they cover about a fifth of the dial, which is the boxed game's proportion.
export const BANDS = [
  { within: 2.2, points: 4 },
  { within: 6.6, points: 3 },
  { within: 11, points: 2 },
];
export const MAX_POINTS = 4;

export const pointsFor = (target, dial) => {
  const d = Math.abs(target - dial);
  return BANDS.find((b) => d <= b.within)?.points ?? 0;
};

const SKIPS_PER_TURN = 2;

export class WavelengthGame {
  constructor({ names = [], playerCount = 2, roundsEach = 3, rng = Math.random } = {}) {
    this.names = names;
    this.playerCount = playerCount;
    this.coop = playerCount === 2;
    this.rng = rng;
    this.totalRounds = roundsEach * playerCount;
    this.round = 0;
    this.scores = new Array(playerCount).fill(0);
    this.team = 0; // co-op total
    this.deck = this.shuffle(SPECTRA.map((_, i) => i));
    this.history = [];
    this.log = [];
    this.psychic = Math.floor(rng() * playerCount);
    this.nextRound();
  }

  shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  drawSpectrum() {
    if (!this.deck.length) this.deck = this.shuffle(SPECTRA.map((_, i) => i));
    return SPECTRA[this.deck.pop()];
  }

  nextRound() {
    if (this.round > 0) this.psychic = (this.psychic + 1) % this.playerCount;
    this.round++;
    this.spectrum = this.drawSpectrum();
    // Never right at an end: a target on the very edge has half a bullseye.
    this.target = 3 + this.rng() * 94;
    this.clue = null;
    this.skipsLeft = SKIPS_PER_TURN;
    this.dials = new Array(this.playerCount).fill(null);
    this.locked = new Array(this.playerCount).fill(false);
    this.roundPoints = null;
    this.phase = 'clue';
  }

  skip(seat) {
    if (this.phase !== 'clue' || seat !== this.psychic) throw new Error('only the psychic can change the card');
    if (this.skipsLeft <= 0) throw new Error('no more skips this turn');
    this.skipsLeft--;
    this.spectrum = this.drawSpectrum();
    this.target = 3 + this.rng() * 94;
  }

  giveClue(seat, text) {
    if (this.phase !== 'clue') throw new Error('it is not time for a clue');
    if (seat !== this.psychic) throw new Error('you are not the psychic this round');
    const clue = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!clue) throw new Error('the clue is empty');
    this.clue = clue;
    this.phase = 'guess';
    this.log.push(`${this.names[seat]}: “${clue}” (${this.spectrum[0]} – ${this.spectrum[1]})`);
  }

  /** Move a dial. Free to change until locked in. */
  setDial(seat, value) {
    if (this.phase !== 'guess') throw new Error('it is not time to guess');
    if (seat === this.psychic) throw new Error('the psychic does not guess');
    if (this.locked[seat]) throw new Error('you have locked in');
    const v = Number(value);
    if (!Number.isFinite(v)) throw new Error('bad dial value');
    this.dials[seat] = Math.max(0, Math.min(100, v));
  }

  lock(seat, value) {
    if (value !== undefined) this.setDial(seat, value);
    if (this.phase !== 'guess' || seat === this.psychic) throw new Error('nothing to lock');
    if (this.dials[seat] === null) throw new Error('turn the dial first');
    this.locked[seat] = true;
    if (this.guessers().every((s) => this.locked[s])) this.reveal();
  }

  guessers() {
    return Array.from({ length: this.playerCount }, (_, s) => s).filter((s) => s !== this.psychic);
  }

  reveal() {
    const pts = new Array(this.playerCount).fill(0);
    for (const s of this.guessers()) pts[s] = pointsFor(this.target, this.dials[s]);
    if (this.coop) {
      this.team += pts[1 - this.psychic];
    } else {
      const g = this.guessers();
      pts[this.psychic] = Math.round(g.reduce((a, s) => a + pts[s], 0) / g.length);
    }
    pts.forEach((p, s) => { this.scores[s] += p; });
    this.roundPoints = pts;
    this.history.push({ spectrum: this.spectrum, clue: this.clue, target: this.target, dials: this.dials.slice(), points: pts });
    this.phase = 'reveal';
  }

  afterReveal() {
    if (this.phase !== 'reveal') throw new Error('nothing to move on from');
    if (this.round >= this.totalRounds) {
      this.phase = 'gameOver';
      this.log.push(this.coop
        ? `*** ${this.team} of ${this.totalRounds * MAX_POINTS} — in sync ${Math.round(this.syncPercent())}% ***`
        : `*** ${this.winners().map((s) => this.names[s]).join(' & ')} win ***`);
      return;
    }
    this.nextRound();
  }

  syncPercent() {
    return (this.team / (this.totalRounds * MAX_POINTS)) * 100;
  }

  winners() {
    const best = Math.max(...this.scores);
    return this.scores.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
  }

  viewFor(seat) {
    const open = this.phase === 'reveal' || this.phase === 'gameOver';
    const psychic = seat === this.psychic;
    return {
      phase: this.phase,
      game: 'wavelength',
      names: this.names,
      players: this.playerCount,
      coop: this.coop,
      round: this.round,
      totalRounds: this.totalRounds,
      psychic: this.psychic,
      youArePsychic: psychic,
      spectrum: this.spectrum,
      clue: this.clue,
      skipsLeft: psychic ? this.skipsLeft : null,
      // The target is the psychic's alone until the reveal.
      target: psychic || open ? this.target : null,
      // Your own dial always; everyone else's only once it is revealed, so
      // nobody can drift towards a sharper guesser.
      dials: this.dials.map((d, s) => (s === seat || open ? d : null)),
      locked: this.locked.slice(),
      roundPoints: this.roundPoints,
      scores: this.scores.slice(),
      team: this.team,
      maxTeam: this.totalRounds * MAX_POINTS,
      bands: BANDS,
      history: open ? this.history : [],
      log: this.log.slice(-12),
    };
  }
}
