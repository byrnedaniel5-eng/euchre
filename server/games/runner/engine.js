// Lava Run engine.
//
// The server does not simulate anything here. Every client generates the same
// course from the same seed and runs its own physics at its own frame rate;
// this only holds the seed, the start time, and how far each person got. That
// is what makes a 60fps game workable over a phone connection — nothing that
// matters travels per frame.
//
// The trade is that a player's distance is taken on trust. For a game you play
// with your partner that is the right call; there is nothing to win by lying.
//
// Phases:
//   'countdown' - everyone has the seed, waiting for the off
//   'running'   - clients are simulating; deaths arrive as they happen
//   'results'   - the round is scored, waiting for everyone to move on
//   'gameOver'  - every round played

export const COUNTDOWN_MS = 3200;
export const ROUND_CAP_SECONDS = 150; // nobody survives this; it is a backstop

export class RunnerGame {
  constructor({ names = [], playerCount = 2, rounds = 3, rng = Math.random } = {}) {
    this.names = names;
    this.playerCount = playerCount;
    this.rng = rng;
    this.rounds = rounds;
    this.round = 0;
    this.wins = new Array(playerCount).fill(0);
    this.bestSeconds = new Array(playerCount).fill(0);
    this.log = [];
    this.startRound();
  }

  pushLog(text) {
    this.log.push(text);
    if (this.log.length > 60) this.log.shift();
  }

  seats() {
    return Array.from({ length: this.playerCount }, (_, i) => i);
  }

  startRound() {
    this.round += 1;
    this.seed = Math.floor(this.rng() * 2 ** 31) || 1;
    this.results = this.seats().map((seat) => ({
      seat, alive: true, seconds: 0, distance: 0, cause: null,
    }));
    this.startAt = Date.now() + COUNTDOWN_MS;
    this.phase = 'countdown';
    this.pushLog(`--- Round ${this.round} of ${this.rounds} ---`);
  }

  /** Seconds since the off; negative while the countdown is still running. */
  elapsed() {
    return (Date.now() - this.startAt) / 1000;
  }

  begin() {
    if (this.phase !== 'countdown') return;
    this.phase = 'running';
  }

  /** A client reporting how far it got before it died. */
  reportDeath(seat, { seconds, distance, cause }) {
    if (this.phase !== 'running') throw new Error('no round is running');
    const r = this.results[seat];
    if (!r) throw new Error('not a runner');
    if (!r.alive) return; // a duplicate report is harmless, not an error

    r.alive = false;
    // Clamp to the wall clock: a client cannot claim to have outlived the
    // round it was in. elapsed() is negative during the countdown, so floor it
    // at zero first — otherwise every report collapses to nothing and the
    // round ends in a tie regardless of who actually lasted longer.
    const ceiling = Math.min(ROUND_CAP_SECONDS, Math.max(0, this.elapsed()) + 1);
    r.seconds = Math.max(0, Math.min(Number(seconds) || 0, ceiling));
    r.distance = Math.max(0, Number(distance) || 0);
    r.cause = ['lava', 'ceiling'].includes(cause) ? cause : 'lava';
    this.bestSeconds[seat] = Math.max(this.bestSeconds[seat], r.seconds);
    this.pushLog(`${this.names[seat]} ${r.cause} at ${r.seconds.toFixed(1)}s`);

    if (this.results.every((x) => !x.alive)) this.endRound();
  }

  /** Everyone is out — or the backstop fired. */
  endRound(reason = 'everyone out') {
    if (this.phase !== 'running') return;
    this.phase = 'results';

    // Anyone still standing when the cap hit is credited with the whole round.
    for (const r of this.results) {
      if (r.alive) {
        r.alive = false;
        r.seconds = ROUND_CAP_SECONDS;
        r.cause = 'survived';
      }
    }

    const best = Math.max(...this.results.map((r) => r.seconds));
    this.roundWinners = this.results.filter((r) => r.seconds === best).map((r) => r.seat);
    for (const seat of this.roundWinners) this.wins[seat] += 1;
    this.revealed = {
      round: this.round,
      reason,
      results: this.results.map((r) => ({ ...r })),
      winners: this.roundWinners.slice(),
      best,
    };
    this.pushLog(
      `${this.roundWinners.map((s) => this.names[s]).join(' & ')} last ${best.toFixed(1)}s`);
  }

  nextRound() {
    if (this.phase !== 'results') throw new Error('the round is not over');
    if (this.round >= this.rounds) {
      this.phase = 'gameOver';
      const best = Math.max(...this.wins);
      const champs = this.wins
        .map((w, i) => (w === best ? this.names[i] : null))
        .filter(Boolean);
      this.pushLog(`*** ${champs.join(' & ')} win ${best}-${Math.min(...this.wins)} ***`);
      return;
    }
    this.startRound();
  }

  viewFor(seat) {
    return {
      phase: this.phase,
      game: 'runner',
      names: this.names,
      wins: this.wins,
      bestSeconds: this.bestSeconds,
      round: this.round,
      rounds: this.rounds,
      seed: this.seed,
      startAt: this.startAt,
      countdownMs: COUNTDOWN_MS,
      capSeconds: ROUND_CAP_SECONDS,
      alive: this.results.map((r) => r.alive),
      youAlive: !!this.results[seat]?.alive,
      results: this.phase === 'results' || this.phase === 'gameOver'
        ? this.results.map((r) => ({ ...r })) : null,
      revealed: this.phase === 'results' || this.phase === 'gameOver' ? this.revealed : null,
      log: this.log.slice(-12),
      you: { seat },
    };
  }
}
