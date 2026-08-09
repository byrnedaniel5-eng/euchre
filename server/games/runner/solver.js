// A scripted player good enough to prove a course is fair.
//
// It is not an opponent — Lava Run has no bots. It exists so the tests can
// assert that a generated course is survivable and that a run always ends. A
// procedural runner that can emit an impossible gap is worthless, and you would
// only find out mid-game.
//
// It plays by one-step lookahead rather than a formula: at each take-off it
// tries a spread of hold lengths, simulates each until the next landing, and
// takes the one that survives and gets furthest. That distinguishes "this
// course cannot be beaten" from "my closed-form guess was wrong", which a
// hand-derived policy cannot.

import '../../../public/games/runner-level.js';

const R = globalThis.RunnerLevel;

const clone = (p) => ({ ...p });

/**
 * Simulate one hold length from here until the player next lands, dies, or the
 * horizon runs out. Returns how it went.
 */
function tryHold(player, level, hold, t0, dt) {
  const p = clone(player);
  let t = t0;
  const limit = t0 + 3;
  // Leave the ground first, so "landed" cannot mean "never left".
  while (!p.dead && p.grounded && t < limit) {
    R.step(p, level, { down: true }, dt, t);
    t += dt;
  }
  while (!p.dead && !p.grounded && t < limit) {
    R.step(p, level, { down: t - t0 < hold }, dt, t);
    t += dt;
  }
  return { dead: p.dead, cause: p.cause, x: p.x, t };
}

/**
 * The best hold to use right now, or null if nothing survives.
 *
 * `trapped` distinguishes the two ways that can happen. Late in a run the
 * closing edge catches every branch inside the horizon, which is the run
 * ending normally rather than the course being unfair; only a branch set where
 * everything ends in lava or a slab means the course itself is at fault.
 */
export function chooseHold(player, level, t, dt, samples = 24) {
  let best = null;
  let anyNonEdgeDeath = false;
  let allDead = true;
  for (let i = 0; i <= samples; i++) {
    const hold = (R.PHYS.holdSeconds * i) / samples;
    const out = tryHold(player, level, hold, t, dt);
    if (out.dead) {
      if (out.cause !== 'caught') anyNonEdgeDeath = true;
      continue;
    }
    allDead = false;
    if (!best || out.x > best.x) best = { hold, x: out.x };
  }
  return best ? { ...best, trapped: false } : { hold: null, trapped: allDead && anyNonEdgeDeath };
}

/**
 * Play a whole course. `noise` perturbs the chosen hold, which is how the
 * tests check that sloppier play really does die sooner.
 */
export function solve(seed, { dt = 1 / 120, maxSeconds = 300, noise = 0 } = {}) {
  const level = R.makeLevel(seed);
  const p = R.newPlayer(level);
  const rng = R.makeRng(seed * 7919 + 11);
  let t = 0;
  let holdUntil = -1;
  let stuck = 0;

  while (!p.dead && t < maxSeconds) {
    if (p.grounded && holdUntil < t) {
      const here = level.groundAt(p.x);
      const runway = here ? here.x + here.w - p.x : 0;
      // Only commit to a jump once the edge is close; jumping early wastes the
      // platform and puts you under the next slab too high.
      if (here && runway < R.PHYS.runSpeed * 0.12) {
        const best = chooseHold(p, level, t, dt);
        if (best.trapped) stuck++;
        let hold = best.hold !== null ? best.hold : R.PHYS.holdSeconds * 0.5;
        if (noise) hold = Math.max(0, Math.min(R.PHYS.holdSeconds, hold * (1 + (rng() - 0.5) * noise)));
        holdUntil = t + hold;
      }
    }
    R.step(p, level, { down: holdUntil >= t }, dt, t);
    t += dt;
  }

  return { seconds: t, distance: p.x, cause: p.cause, stuck };
}
