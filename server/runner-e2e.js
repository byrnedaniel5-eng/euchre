// End-to-end test for Lava Run.
//
// The most valuable part is not the wire protocol but the course generator: a
// procedural runner that can emit an impossible jump is worthless, and the
// only way to know is to have something play it.
//
//   node server/runner-e2e.js

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

import { solve } from './games/runner/solver.js';
import { RunnerGame, ROUND_CAP_SECONDS } from './games/runner/engine.js';

const R = globalThis.RunnerLevel;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3996;
const URL = `ws://127.0.0.1:${PORT}/ws`;

let failures = 0;
const assert = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

// ------------------------------------------------------- the course itself

console.log('1. the same seed builds the same course');
{
  const a = R.makeLevel(12345);
  const b = R.makeLevel(12345);
  a.extendTo(600);
  b.extendTo(600);
  assert(JSON.stringify(a.platforms) === JSON.stringify(b.platforms),
    'two runs of one seed produce identical platforms');
  assert(JSON.stringify(a.hazards) === JSON.stringify(b.hazards), 'and identical hazards');
  const c = R.makeLevel(999);
  c.extendTo(600);
  assert(JSON.stringify(a.platforms) !== JSON.stringify(c.platforms),
    'a different seed produces a different course');
}

console.log('\n2. every course can actually be run');
{
  const runs = [];
  for (let seed = 1; seed <= 40; seed++) runs.push(solve(seed));
  const unwinnable = runs.reduce((n, r) => n + r.stuck, 0);
  const secs = runs.map((r) => r.seconds);

  assert(unwinnable === 0,
    `no moment where every possible jump kills you (${unwinnable} across 40 courses)`);
  assert(Math.min(...secs) > 25,
    `good play survives a long time (worst course ${Math.min(...secs).toFixed(1)}s)`);
  assert(runs.every((r) => r.seconds < ROUND_CAP_SECONDS),
    'and every run ends by itself, so a round always finishes');
  const causes = {};
  for (const r of runs) causes[r.cause] = (causes[r.cause] || 0) + 1;
  assert((causes.caught || 0) >= runs.length * 0.8,
    `skilled runs end at the closing edge rather than a mistake (${JSON.stringify(causes)})`);
}

console.log('\n3. it is a game, not a timer');
{
  // Holding the screen down must not be a winning strategy. It was, before
  // the overhead slabs existed: airborne is faster than grounded, so jumping
  // was free and more of it was always better.
  const holdForever = [];
  for (let seed = 1; seed <= 30; seed++) {
    const level = R.makeLevel(seed);
    const p = R.newPlayer(level);
    let t = 0;
    while (!p.dead && t < 200) { R.step(p, level, { down: true }, 1 / 120, t); t += 1 / 120; }
    holdForever.push(t);
  }
  const skilled = [];
  for (let seed = 1; seed <= 30; seed++) skilled.push(solve(seed).seconds);

  assert(median(holdForever) < median(skilled) * 0.5,
    `mashing the screen loses badly (${median(holdForever).toFixed(1)}s vs ` +
    `${median(skilled).toFixed(1)}s)`);

  // And the opposite mistake. Landing used to be "am I at or below the
  // platform top", with no check that you had been above it — so walking off
  // a ledge and drifting over a narrow gap snapped you up onto the next
  // platform through its side, and never jumping was a way to play. Nothing
  // caught it because the solver always jumps.
  const neverJump = [];
  const causes = {};
  for (let seed = 1; seed <= 30; seed++) {
    const level = R.makeLevel(seed);
    const p = R.newPlayer(level);
    let t = 0;
    while (!p.dead && t < 200) { R.step(p, level, { down: false }, 1 / 120, t); t += 1 / 120; }
    neverJump.push(t);
    causes[p.cause] = (causes[p.cause] || 0) + 1;
  }
  assert(Math.max(...neverJump) < 8,
    `never jumping drops you in the first gap (worst ${Math.max(...neverJump).toFixed(1)}s)`);
  assert(causes.lava === 30, `and it is the lava that gets you (${JSON.stringify(causes)})`);
}

console.log('\n3b. you cannot land through the side of a platform');
{
  // Straight at the flank of a raised platform, below its top.
  const level = R.makeLevel(4242);
  level.extendTo(400);
  const target = level.platforms.find((q, i) => i > 0 && q.y > level.platforms[i - 1].y + 1);
  if (!target) {
    assert(false, 'expected the course to contain a step up');
  } else {
    const p = R.newPlayer(level);
    p.x = target.x - 0.05;
    p.y = target.y - 1.5;   // below its surface
    p.vy = -1;              // and falling
    p.grounded = false;
    R.step(p, level, { down: false }, 1 / 120, 5);
    assert(!p.grounded && p.y < target.y,
      `arriving below the lip does not put you on top of it (y ${p.y.toFixed(2)} vs top ${target.y.toFixed(2)})`);
  }
}

console.log('\n4. the viewport is the same for everyone');
{
  assert(R.VIEW.w > 0 && R.VIEW.h > 0, 'the world viewport is a fixed size in game units');
  // The camera is a pure function of time, which is what lets every player
  // share one camera and see each other on the same screen.
  assert(R.cameraX(10) === R.cameraX(10), 'the camera depends only on elapsed time');
  assert(R.cameraX(20) > R.cameraX(10), 'and it closes in as the round goes on');
}

console.log('\n5. the engine scores a round');
{
  const g = new RunnerGame({ names: ['A', 'B'], playerCount: 2, rounds: 2 });
  assert(g.phase === 'countdown', 'a round opens with a countdown');
  assert(typeof g.seed === 'number' && g.seed > 0, 'and a seed to build the course from');
  g.startAt = Date.now() - 30000; // pretend the round has been going a while
  g.begin();
  g.reportDeath(0, { seconds: 12.5, distance: 140, cause: 'lava' });
  assert(g.phase === 'running', 'one player out does not end the round');
  g.reportDeath(1, { seconds: 20.1, distance: 230, cause: 'caught' });
  assert(g.phase === 'results', 'the last one out ends it');
  assert(g.revealed.winners.length === 1 && g.revealed.winners[0] === 1,
    'the longest survivor takes the round');
  assert(g.wins[1] === 1 && g.wins[0] === 0, 'and the win is recorded');

  // A client cannot claim to have outlived the round it was in.
  const h = new RunnerGame({ names: ['A', 'B'], playerCount: 2, rounds: 1 });
  h.startAt = Date.now() - 10000; // ten seconds into the round
  h.begin();
  h.reportDeath(0, { seconds: 99999, distance: 1e9, cause: 'lava' });
  assert(h.results[0].seconds > 5 && h.results[0].seconds < 12,
    `a claim longer than the round is cut back to it (${h.results[0].seconds.toFixed(1)}s)`);
  assert(h.results[1].alive, 'and the other runner is untouched');
}

// ------------------------------------------------------------- the wire

class Client {
  constructor(name, playerId) {
    Object.assign(this, { name, playerId, state: null, seat: null, errors: [], runners: [] });
  }
  connect(room, opts = {}) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      const t = setTimeout(() => reject(new Error('join timed out')), 10000);
      this.ws.on('open', () => this.ws.send(JSON.stringify({
        type: 'join', playerId: this.playerId, name: this.name, room,
        game: 'runner', options: opts.options,
      })));
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.type === 'joined') { clearTimeout(t); this.seat = m.seat; this.room = m.room; resolve(this); }
        else if (m.type === 'state') this.state = m.state;
        else if (m.type === 'runners') this.runners.push(m);
        else if (m.type === 'error') this.errors.push(m.message);
      });
      this.ws.on('error', (e) => { clearTimeout(t); reject(e); });
    });
  }
  act(action) { this.ws.send(JSON.stringify({ type: 'action', action })); }
  start() { this.ws.send(JSON.stringify({ type: 'start' })); }
  close() { return new Promise((r) => { this.ws.once('close', r); this.ws.close(); }); }
}

const waitFor = async (fn, label, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await sleep(30); }
  throw new Error(`timed out waiting for ${label}`);
};

const server = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  env: { ...process.env, PORT: String(PORT), EUCHRE_FAST: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverErrors = [];
server.stderr.on('data', (d) => serverErrors.push(d.toString()));
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`server never started: ${serverErrors.join('')}`)), 12000);
  server.stdout.on('data', (d) => {
    if (d.toString().includes('running')) { clearTimeout(t); res(); }
  });
});

try {
  console.log('\n6. two runners over the wire');
  const a = new Client('Ann', 'pid-run-a');
  await a.connect(null, { options: { rounds: '1' } });
  const b = new Client('Ben', 'pid-run-b');
  await b.connect(a.room);
  await waitFor(() => a.state?.phase === 'lobby' && b.state?.phase === 'lobby', 'the lobby');
  a.start();
  await waitFor(() => a.state && a.state.phase !== 'lobby', 'the round to open');

  assert(a.state.phase === 'countdown', 'it opens on a countdown');
  assert(a.state.seed === b.state.seed, 'both runners are given the same course');
  assert(a.state.startAt === b.state.startAt, 'and the same start time');
  assert(a.state.startAt > Date.now() - 1000, 'which is in the near future');

  await waitFor(() => a.state.phase === 'running', 'the off', 10000);

  // Positions are relayed to the others, never through the state broadcast.
  const before = b.runners.length;
  a.act({ kind: 'pos', x: 42, y: 5, alive: true });
  await waitFor(() => b.runners.length > before, 'a position to arrive');
  const pos = b.runners[b.runners.length - 1];
  assert(pos.seat === a.seat && pos.x === 42, 'the other runner sees where you are');
  assert(!JSON.stringify(b.state).includes('"x":42'),
    'and it never travels inside the game state');

  console.log('\n7. the longest survivor takes the round');
  a.act({ kind: 'died', seconds: 4.0, distance: 40, cause: 'lava' });
  await sleep(150);
  assert(a.state.phase === 'running', 'one out does not end it');
  assert(a.state.alive[a.seat] === false && a.state.alive[b.seat] === true,
    'and the others can see who is still going');
  b.act({ kind: 'died', seconds: 1.2, distance: 70, cause: 'caught' });
  await waitFor(() => a.state.phase === 'results', 'the round to be scored');
  assert(a.state.revealed.winners.includes(b.seat), 'the one who lasted longer won it');

  console.log('\n8. moving on takes everyone');
  a.act({ kind: 'nextRound' });
  await sleep(200);
  assert(a.state.phase === 'results', 'one player pressing does not move on');
  b.act({ kind: 'nextRound' });
  await waitFor(() => a.state.phase === 'gameOver', 'the game to finish');
  assert(a.state.wins[b.seat] === 1, 'the round win carried through to the result');

  const unexpected = a.errors.concat(b.errors);
  assert(unexpected.length === 0, `no unexpected errors (${unexpected.slice(0, 2).join('; ')})`);

  await Promise.all([a.close(), b.close()]);

  console.log('\n9. a solo time trial');
  const solo = new Client('Solo', 'pid-run-solo');
  await solo.connect(null, { options: { rounds: '1' } });
  await waitFor(() => solo.state?.phase === 'lobby', 'the lobby');
  assert(solo.state.canStart === true, 'one player is enough to start Lava Run');
  assert(solo.state.bots === 0, 'and no bots are offered — there are none');
  solo.start();
  await waitFor(() => solo.state.phase !== 'lobby', 'the round to open');
  await waitFor(() => solo.state.phase === 'running', 'the off', 10000);

  await sleep(1200);
  solo.act({ kind: 'died', seconds: 0.9, distance: 30, cause: 'caught' });
  await waitFor(() => solo.state.phase === 'results', 'the run to be scored');
  assert(solo.state.revealed.winners.includes(solo.seat),
    'a solo run scores rather than hanging');
  assert(solo.state.bestSeconds[solo.seat] > 0,
    `and records a best time (${solo.state.bestSeconds[solo.seat].toFixed(1)}s)`);
  solo.act({ kind: 'nextRound' });
  await waitFor(() => solo.state.phase === 'gameOver', 'the trial to end');
  assert(solo.errors.length === 0, `no errors playing alone (${solo.errors.join('; ')})`);
  await solo.close();
} catch (err) {
  failures++;
  console.error('\nFAIL:', err.message);
} finally {
  server.kill();
}

const crashed = serverErrors.join('');
if (crashed.trim()) {
  failures++;
  console.error('\nserver stderr:\n' + crashed);
}

console.log(failures === 0 ? '\nRUNNER END-TO-END PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
