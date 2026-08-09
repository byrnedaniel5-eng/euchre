/* Lava Run — level generation and physics.
 *
 * This file is deliberately shared. The browser loads it as a plain script and
 * the tests import it as a module (it has no import/export, so Node treats it
 * as a valid ES module and the global assignment below is the entry point).
 * One copy means the level a player runs and the level a test proves fair are
 * provably the same one.
 *
 * Nothing here touches the network. The server only ever hands out a seed and
 * a start time: every client generates the identical course from them and runs
 * its own physics, which is what makes a 60fps game workable over a phone
 * connection. The cost is that the server takes a player's word for how far
 * they got, which is the right trade for a game you play with your partner.
 *
 * The viewport is a fixed size in world units and letterboxed on screen, so a
 * taller phone cannot see further ahead than a shorter one.
 */

(() => {
  'use strict';

  // Portrait, to fill a phone held normally. `floor` is how much lava sits
  // below the surface inside the view — without it y=0 lands exactly on the
  // bottom edge and the lava is never seen. `playerX` is where the runner sits
  // on screen: the view follows them, so the distance you can see ahead is the
  // same whether you are barely clinging on or streets ahead. Before this the
  // view was pinned to the closing edge, which meant running well pushed you
  // towards the right of the screen and gave you less time to react — the
  // better you played, the less you could see.
  const VIEW = { w: 24, h: 32, floor: 4, playerX: 7 };

  const PHYS = {
    gravity: 70,          // units/s²
    jumpMin: 20,          // a tap
    jumpMax: 34,          // a full hold
    holdSeconds: 0.30,    // how long a hold takes to reach jumpMax
    // One speed, in the air and on the ground alike. It used to be faster
    // airborne, which made jumping gain ground on the closing edge — but it
    // also meant the run sped up and slowed down under you for no visible
    // reason. With a single speed nobody can fall behind, so the edge stops
    // being a clock that ends everyone at the same instant.
    speed: 9,
    speedRamp: 80,        // seconds for the pace to double — the difficulty
    lavaY: 0,
    height: 2.0,          // head height, for the slabs overhead
    startX: 10,           // how far ahead of the left edge you begin
    tideLag: 6,           // how far behind you the lava wall sits, in view
  };

  /** How fast everything moves at time t. It never stops rising. */
  const speedAt = (t) => PHYS.speed * (1 + t / PHYS.speedRamp);

  /** Distance covered by time t — the integral of the above. */
  const distanceAt = (t) => PHYS.speed * (t + (t * t) / (2 * PHYS.speedRamp));

  /** Roughly how fast you will be going by the time you reach x. */
  const speedAtX = (x) => PHYS.speed * (1 + x / (PHYS.speed * PHYS.speedRamp * 1.6));

  /** The furthest a single jump can carry you around there. */
  const reachAt = (x) => (2 * PHYS.jumpMax / PHYS.gravity) * speedAtX(x);

  /** Where the lava tide is: a fixed distance behind, pure pressure. */
  const tideBehind = () => PHYS.tideLag;

  /** Small deterministic PRNG — same seed, same course, on every device. */
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * The course, generated lazily rightwards. Difficulty ramps with distance:
   * gaps widen, platforms shorten and the steps between them grow.
   */
  function makeLevel(seed) {
    const rng = makeRng(seed);
    // A generous opening platform, so nobody dies before they have looked up.
    const platforms = [{ x: 0, w: 34, y: 9 }];

    // Slabs hanging over the start of some platforms. Without them the whole
    // game is solved by holding the screen down: airborne is faster than
    // grounded, so jumping is free and more of it is always better. A ceiling
    // over the landing zone makes an over-long jump fatal, which is what turns
    // "how long do you hold" into an actual decision.
    const hazards = [];

    const extendTo = (x) => {
      while (true) {
        const last = platforms[platforms.length - 1];
        if (last.x + last.w > x + VIEW.w * 2) return;
        const d = Math.min(1, (last.x + last.w) / 700); // 0 → 1 over ~700 units

        // Gaps are a share of what a jump can actually clear at this point,
        // and that share keeps climbing — so the course is unbounded but
        // eventually unjumpable, which is what makes every run end on a
        // mistake rather than on a timer.
        const reach = reachAt(last.x + last.w);
        const share = Math.min(0.95, 0.30 + d * 0.42 + rng() * 0.16);
        const gap = Math.max(2.2, reach * share);
        const width = Math.max(4.5, 10 - d * 3.5 + rng() * 3);
        // A taller world: the portrait view has the room for real height, and
        // without it most of the screen is empty sky.
        const stepLimit = 2.2 + d * 3.0;
        let y = last.y + (rng() * 2 - 1) * stepLimit;
        y = Math.max(4, Math.min(23, y));

        const p = { x: last.x + last.w + gap, w: width, y };
        platforms.push(p);

        // A slab must never be lower than the jump needed to get under it,
        // or the course is unwinnable and you only find out by dying to it.
        // Work out the smallest arc that reaches this platform, and hang the
        // slab above that — so it punishes a jump longer than necessary, and
        // nothing else.
        if (p.x > 60 && rng() < 0.3 + d * 0.5) {
          const reachTime = (gap + 1.2) / speedAtX(p.x);
          const rise = p.y - last.y;
          const need = Math.max(
            PHYS.jumpMin,
            (rise + 0.5 * PHYS.gravity * reachTime * reachTime) / reachTime);
          const apexAboveHere = (need * need) / (2 * PHYS.gravity) - rise;
          const floor = apexAboveHere + PHYS.height + 2.8;

          const clearance = Math.max(floor, 5.2 - d * 1.4 + rng() * 1.0);
          // If it has to hang that high it threatens nothing; skip it.
          if (clearance < 8) {
            hazards.push({
              // Starts at the landing, so the arc over the gap is never
              // squeezed — only an overshoot is.
              x: p.x,
              w: Math.min(p.w * 0.55, 2.5 + rng() * 2.5),
              yBottom: p.y + clearance,
            });
          }
        }
      }
    };

    /** The platform under this x, or null if that is open lava. */
    const groundAt = (x) => {
      extendTo(x);
      for (let i = platforms.length - 1; i >= 0; i--) {
        const p = platforms[i];
        if (x >= p.x && x <= p.x + p.w) return p;
        if (p.x + p.w < x - VIEW.w * 3) break;
      }
      return null;
    };

    const visible = (fromX, toX) => {
      extendTo(toX);
      return {
        platforms: platforms.filter((p) => p.x + p.w >= fromX && p.x <= toX),
        hazards: hazards.filter((h) => h.x + h.w >= fromX && h.x <= toX),
      };
    };

    /** The slab over this x, if any. */
    const ceilingAt = (x) => {
      extendTo(x);
      for (let i = hazards.length - 1; i >= 0; i--) {
        const h = hazards[i];
        if (x >= h.x && x <= h.x + h.w) return h;
        if (h.x + h.w < x - VIEW.w * 3) break;
      }
      return null;
    };

    return { platforms, hazards, groundAt, ceilingAt, visible, extendTo };
  }

  /** A fresh runner at the start line. */
  const newPlayer = (level) => ({
    x: PHYS.startX,
    y: level.groundAt(PHYS.startX).y,
    vy: 0,
    grounded: true,
    held: 0,       // how long the current jump input has been held
    jumping: false,
    dead: false,
    cause: null,
  });

  /**
   * One physics tick. `input.down` is whether the screen is being touched.
   *
   * A tap gives jumpMin; keeping it held keeps adding velocity for up to
   * holdSeconds, which is what makes a long press clear a wider gap. Airborne
   * you move faster than on the ground, so the way to stay ahead of the left
   * edge is to keep jumping — the control and the survival mechanic are the
   * same thing.
   */
  function step(p, level, input, dt, t) {
    if (p.dead) return p;

    if (input.down && p.grounded && !p.jumping) {
      p.jumping = true;
      p.held = 0;
      p.vy = PHYS.jumpMin;
      p.grounded = false;
    } else if (input.down && p.jumping && p.held < PHYS.holdSeconds) {
      const add = Math.min(dt, PHYS.holdSeconds - p.held);
      p.held += add;
      p.vy += ((PHYS.jumpMax - PHYS.jumpMin) / PHYS.holdSeconds) * add;
    } else if (!input.down) {
      p.jumping = false;
    }

    p.x += speedAt(t) * dt;

    if (!p.grounded) {
      const wasY = p.y;
      p.vy -= PHYS.gravity * dt;
      p.y += p.vy * dt;
      const ground = level.groundAt(p.x);
      // Land only when falling *through* the surface from above. Without the
      // `wasY` half, crossing into a platform's span at any height below its
      // top counts as a landing — so walking off a ledge and drifting over a
      // narrow gap teleports you up onto the next platform through its side,
      // and never jumping becomes a viable way to play.
      if (ground && p.vy <= 0 && wasY >= ground.y && p.y <= ground.y) {
        p.y = ground.y;
        p.vy = 0;
        p.grounded = true;
        p.jumping = input.down; // holding through a landing must not re-jump
      }
    } else {
      const ground = level.groundAt(p.x);
      if (!ground) {
        p.grounded = false; // ran off the edge
      } else {
        p.y = ground.y;
      }
    }

    const ceiling = level.ceilingAt(p.x);
    if (ceiling && p.y + PHYS.height > ceiling.yBottom) {
      p.dead = true;
      p.cause = 'ceiling';
    } else if (p.y <= PHYS.lavaY) {
      p.dead = true;
      p.cause = 'lava';
    }
    return p;
  }

  globalThis.RunnerLevel = {
    VIEW, PHYS, speedAt, distanceAt, speedAtX, reachAt, tideBehind,
    makeRng, makeLevel, newPlayer, step,
  };
})();
