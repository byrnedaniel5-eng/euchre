// End-to-end test for Battleships.
//
//   node server/battleship-e2e.js
//
// The thing this game can get catastrophically wrong is showing somebody where
// the other fleet is, so a good part of what follows is about what does *not*
// appear in a state — including for the bot, which is handed a knowledge object
// rather than a board precisely so that it cannot cheat by accident.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

import {
  SIZE, CELLS, FLEET, FLEET_CELLS, idx, newBoard, place, placementError, randomFleet,
  fireAt, isSunk, sunkShips, shipsLeft, fleetDestroyed, shipCells, occupancy,
} from './games/battleship/rules.js';
import { BattleshipGame, square } from './games/battleship/engine.js';
import { chooseShot, knowledgeOf, skillByKey } from './games/battleship/bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3998; // every harness needs its own; 3993 is the drawing UI check
const URL = `ws://127.0.0.1:${PORT}/ws`;

let failures = 0;
const assert = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const laidOut = () => {
  const b = newBoard();
  b.placements = randomFleet();
  return b;
};

// ------------------------------------------------------------------- rules

console.log('1. the board');
{
  assert(FLEET.length === 5 && FLEET_CELLS === 17, 'five ships covering seventeen squares');
  assert(square(0) === 'A1' && square(CELLS - 1) === 'J10',
    'squares are named the way people say them (A1 … J10)');

  const b = newBoard();
  assert(placementError(b, { key: 'carrier', x: 6, y: 0, dir: 'h' }) !== null,
    'a ship that runs off the edge is refused');
  assert(placementError(b, { key: 'carrier', x: 5, y: 0, dir: 'h' }) === null,
    'and one that just fits is not');
  assert(placementError(b, { key: 'carrier', x: 0, y: 0, dir: 'diagonal' }) !== null,
    'there is no diagonal');

  place(b, { key: 'carrier', x: 0, y: 0, dir: 'h' });
  assert(placementError(b, { key: 'cruiser', x: 2, y: 0, dir: 'v' }) !== null,
    'ships may not overlap');
  assert(placementError(b, { key: 'cruiser', x: 0, y: 1, dir: 'h' }) === null,
    'but they may sit alongside each other, as in the boxed game');
  assert(placementError(b, { key: 'carrier', x: 3, y: 3, dir: 'v' }) === null,
    'moving a ship does not collide with where it already is');
}

console.log('\n2. a fleet laid out at random is always legal');
{
  let bad = 0;
  let touching = 0;
  for (let n = 0; n < 500; n++) {
    const b = newBoard();
    b.placements = randomFleet();
    const cells = b.placements.flatMap((p) => shipCells(p) || []);
    if (cells.length !== FLEET_CELLS) bad++;
    if (new Set(cells).size !== FLEET_CELLS) bad++;
    if (b.placements.length !== FLEET.length) bad++;
    if (occupancy(b).size !== FLEET_CELLS) bad++;
    // Not a fault — just proof the layouts are varied rather than one canned one.
    if (b.placements.some((p) => p.dir === 'v') && b.placements.some((p) => p.dir === 'h')) touching++;
  }
  assert(bad === 0, '500 random fleets, none overlapping or off the grid');
  assert(touching > 400, `and they are mixed orientations (${touching}/500)`);
}

console.log('\n3. firing');
{
  const b = newBoard();
  place(b, { key: 'destroyer', x: 0, y: 0, dir: 'h' });
  place(b, { key: 'carrier', x: 0, y: 9, dir: 'h' });
  place(b, { key: 'battleship', x: 5, y: 5, dir: 'v' });
  place(b, { key: 'cruiser', x: 9, y: 0, dir: 'v' });
  place(b, { key: 'submarine', x: 3, y: 3, dir: 'h' });

  assert(fireAt(b, idx(4, 4)).result === 'miss', 'open water is a miss');
  const first = fireAt(b, idx(0, 0));
  assert(first.result === 'hit' && first.sunk === null, 'a hit that does not finish a ship');
  const second = fireAt(b, idx(1, 0));
  assert(second.sunk === 'Destroyer', 'the last square of a ship reports it sunk, by name');
  assert(second.destroyed === false, 'and does not end the game on its own');

  let threw = false;
  try { fireAt(b, idx(0, 0)); } catch { threw = true; }
  assert(threw, 'the same square cannot be fired at twice');

  assert(shipsLeft(b) === 4, 'four ships still afloat');
  assert(sunkShips(b).length === 1 && sunkShips(b)[0].cells.length === 2,
    'the sunk list carries the ship it sank, and its squares');

  // Everything else, then the last shot ends it.
  const rest = b.placements.filter((p) => p.key !== 'destroyer').flatMap((p) => shipCells(p));
  let last = null;
  for (const c of rest) if (!b.incoming[c]) last = fireAt(b, c);
  assert(last.destroyed && fleetDestroyed(b), 'clearing every ship destroys the fleet');
  assert(b.incoming.filter((m) => m === 'hit').length === FLEET_CELLS,
    'exactly seventeen hits, no more');
}

// --------------------------------------------------------------------- bot

console.log('\n4. the bot cannot see through the water');
{
  // The test to want here is *not* "does it hit at chance". It does better
  // than chance on square one and should: a five-long ship dropped at random
  // covers the middle far more often than the corners, so the middle really is
  // the better guess. Beating 17% is good play, not second sight.
  //
  // What must be true is that the choice cannot depend on the answer. With the
  // same knowledge — an untouched board — it has to pick the same square no
  // matter what is hidden underneath, and that is exact rather than statistical.
  const fixedRng = () => 0.5;
  const opener = chooseShot(knowledgeOf(laidOut(), { sunkShips }), skillByKey('sharp'), fixedRng);
  let differed = 0;
  for (let n = 0; n < 300; n++) {
    const pick = chooseShot(knowledgeOf(laidOut(), { sunkShips }), skillByKey('sharp'), fixedRng);
    if (pick !== opener) differed++;
  }
  assert(differed === 0,
    `300 different fleets, always the same opening square (${square(opener)}) — ` +
    'the layout cannot reach the decision');

  const k = knowledgeOf(laidOut(), { sunkShips });
  assert(!('placements' in k) && !('ships' in k),
    'and the knowledge it is handed carries no ship positions at all');

  // Which leaves the honest ceiling: seventeen squares hold ships, so nothing
  // that is not cheating can clear a board in fewer than seventeen shots.
  let floor = Infinity;
  for (let n = 0; n < 200; n++) {
    const b = laidOut();
    let fired = 0;
    while (!fleetDestroyed(b) && fired < CELLS) {
      fireAt(b, chooseShot(knowledgeOf(b, { sunkShips }), skillByKey('sharp')));
      fired++;
    }
    floor = Math.min(floor, fired);
  }
  assert(floor > FLEET_CELLS,
    `it never once cleared a board in the ${FLEET_CELLS} shots perfect knowledge would take ` +
    `(best was ${floor})`);
}

console.log('\n5. the bot plays properly');
{
  // 400 games a side. Sharp averages about 44.5 shots and casual about 54.5;
  // the bar used to be a fixed "sharp under 45", which sat on sharp's own mean
  // and so failed on luck alone about one run in three. The claim worth making
  // is the gap between the two, which is ten shots against a noise of about one.
  const means = {};
  for (const key of ['casual', 'sharp']) {
    const skill = skillByKey(key);
    const shots = [];
    for (let n = 0; n < 400; n++) {
      const b = laidOut();
      let fired = 0;
      while (!fleetDestroyed(b) && fired < CELLS) {
        fireAt(b, chooseShot(knowledgeOf(b, { sunkShips }), skill));
        fired++;
      }
      shots.push(fired);
    }
    means[key] = shots.reduce((a, c) => a + c, 0) / shots.length;
    const worst = Math.max(...shots);
    assert(worst <= CELLS, `${key}: always clears the board (worst ${worst} shots)`);
  }
  assert(means.casual > 48 && means.casual < 60,
    `casual takes about as long as a person (${means.casual.toFixed(1)})`);
  assert(means.casual - means.sharp > 6,
    `sharp is meaningfully better (${means.sharp.toFixed(1)} against ${means.casual.toFixed(1)})`);

  // Chasing works: after one hit, the follow-up must be next to it.
  const b = newBoard();
  place(b, { key: 'carrier', x: 2, y: 4, dir: 'h' });
  place(b, { key: 'battleship', x: 0, y: 0, dir: 'v' });
  place(b, { key: 'cruiser', x: 9, y: 6, dir: 'v' });
  place(b, { key: 'submarine', x: 5, y: 8, dir: 'h' });
  place(b, { key: 'destroyer', x: 7, y: 1, dir: 'h' });
  fireAt(b, idx(4, 4)); // a hit on the carrier
  const next = chooseShot(knowledgeOf(b, { sunkShips }), skillByKey('sharp'));
  assert([idx(3, 4), idx(5, 4), idx(4, 3), idx(4, 5)].includes(next),
    'a lone hit is followed up next door');
  fireAt(b, idx(5, 4)); // second hit, now the line is known
  const along = chooseShot(knowledgeOf(b, { sunkShips }), skillByKey('sharp'));
  assert([idx(3, 4), idx(6, 4)].includes(along),
    'two hits in a row and it works along the line, not around it');
}

// ------------------------------------------------------------------ engine

console.log('\n6. turns and elimination');
{
  const g = new BattleshipGame({ names: ['A', 'B'], playerCount: 2, humanCount: 2, revealMs: 0 });
  assert(g.phase === 'placing', 'a game with two people starts in setup');
  let threw = false;
  try { g.fire(0, 1, 0); } catch { threw = true; }
  assert(threw, 'nobody can fire before the fleets are laid out');
  try { g.confirm(0); } catch (e) { threw = /place all five/.test(e.message); }
  assert(threw, 'and nobody can declare ready with ships still in the box');

  g.randomise(0);
  g.confirm(0);
  assert(g.phase === 'placing', 'one player being ready is not enough');
  g.randomise(1);
  g.confirm(1);
  assert(g.phase === 'playing', 'both ready and the shooting starts');

  const me = g.turn;
  const them = me === 0 ? 1 : 0;
  threw = false;
  try { g.fire(them, me, 0); } catch { threw = true; }
  assert(threw, 'you cannot fire out of turn');
  try { g.fire(me, me, 0); } catch { threw = true; }
  assert(threw, 'nor at your own fleet');

  g.fire(me, them, 0);
  assert(g.phase === 'shotResult', 'a shot pauses on the result');
  threw = false;
  try { g.fire(me, them, 1); } catch { threw = true; }
  assert(threw, 'and nothing else can be fired during it');
  g.afterShot();
  assert(g.turn === them, 'then the turn passes over');
}

console.log('\n7. after a hit');
{
  const build = (goAgain) => {
    const g = new BattleshipGame({
      names: ['A', 'B'], playerCount: 2, humanCount: 2, goAgain, revealMs: 0,
    });
    g.randomise(0); g.confirm(0); g.randomise(1); g.confirm(1);
    return g;
  };
  for (const goAgain of [false, true]) {
    const g = build(goAgain);
    const me = g.turn;
    const them = me === 0 ? 1 : 0;
    const shipCell = shipCells(g.boards[them].placements[0])[0];
    g.fire(me, them, shipCell);
    assert(g.lastShot.result === 'hit', `${goAgain ? 'go again' : 'pass over'}: found a ship`);
    g.afterShot();
    assert(g.turn === (goAgain ? me : them),
      goAgain ? 'a hit buys another shot' : 'a hit still passes the turn over');
  }
}

console.log('\n8. a whole game, and the fog holds all the way through');
{
  const g = new BattleshipGame({ names: ['A', 'B'], playerCount: 2, humanCount: 2, revealMs: 0 });
  g.randomise(0); g.confirm(0); g.randomise(1); g.confirm(1);

  let leaked = 0;
  let guard = 0;
  while (g.phase !== 'gameOver' && guard++ < 400) {
    if (g.phase === 'shotResult') { g.afterShot(); continue; }
    const me = g.turn;
    const them = me === 0 ? 1 : 0;
    for (const seat of [0, 1]) {
      const v = g.viewFor(seat);
      const other = seat === 0 ? 1 : 0;
      if (v.boards[other].placements !== null) leaked++;
      if (v.boards[seat].placements === null) leaked++;
    }
    g.fire(me, them, chooseShot(knowledgeOf(g.boards[them], { sunkShips }), skillByKey('sharp')));
  }
  assert(g.phase === 'gameOver', `the game ends (${guard} steps)`);
  assert(leaked === 0, 'at no point did a view carry the other fleet');
  assert(g.winner !== null && g.alive[g.winner] && !g.alive[g.winner === 0 ? 1 : 0],
    `one fleet left afloat (${g.names[g.winner]})`);
  const end = g.viewFor(0);
  assert(end.boards[1].placements !== null,
    'once it is over, both fleets are shown — you get to see where they were');
  assert(g.shotsHit[g.winner] === FLEET_CELLS,
    `the winner landed exactly seventeen hits (${g.shotsFired[g.winner]} shots)`);
}

console.log('\n9. four fleets');
{
  const g = new BattleshipGame({
    names: ['A', 'B', 'C', 'D'], playerCount: 4, humanCount: 4, revealMs: 0,
  });
  for (const s of [0, 1, 2, 3]) { g.randomise(s); g.confirm(s); }
  assert(g.targetsFor(0).length === 3, 'you may fire at any of the other three');

  // Wipe C out and check the turn order closes over the gap.
  const kill = (victim) => {
    for (const p of g.boards[victim].placements) {
      for (const c of shipCells(p)) {
        if (g.boards[victim].incoming[c]) continue;
        while (g.phase === 'shotResult') g.afterShot();
        const shooter = g.turn === victim ? (g.turn + 1) % 4 : g.turn;
        g.turn = shooter;
        g.fire(shooter, victim, c);
      }
    }
    while (g.phase === 'shotResult') g.afterShot();
  };
  kill(2);
  assert(!g.alive[2], 'a fleet with nothing left is out');
  assert(g.phase === 'playing', 'but the game carries on with three');
  assert(!g.targetsFor(0).includes(2), 'and nobody may keep firing at it');
  g.turn = 1;
  g.afterShot();
  let threw = false;
  try { g.fire(1, 2, 0); } catch { threw = true; }
  assert(threw, 'firing at a destroyed fleet is refused outright');
}

// ---------------------------------------------------------------- the wire

class Client {
  constructor(name, playerId) {
    this.name = name;
    this.playerId = playerId;
    this.state = null;
    this.errors = [];
  }
  connect(room, opts = {}) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      const t = setTimeout(() => reject(new Error(`${this.name} never joined`)), 8000);
      this.ws.on('open', () => this.ws.send(JSON.stringify({
        type: 'join', playerId: this.playerId, name: this.name, room,
        game: 'battleship', options: opts.options,
      })));
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.type === 'joined') { clearTimeout(t); this.seat = m.seat; this.room = m.room; resolve(this); }
        else if (m.type === 'state') this.state = m.state;
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
  while (Date.now() - t0 < ms) { if (fn()) return; await sleep(25); }
  throw new Error(`timed out waiting for ${label}`);
};

const server = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  env: { ...process.env, PORT: String(PORT), EUCHRE_FAST: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverErrors = [];
server.stderr.on('data', (d) => serverErrors.push(d.toString()));
let bootLog = '';
await new Promise((res, rej) => {
  const t = setTimeout(
    () => rej(new Error(`server never started.\nstdout: ${bootLog}\nstderr: ${serverErrors.join('')}`)),
    10000);
  server.stdout.on('data', (d) => {
    bootLog += d.toString();
    if (bootLog.includes('running')) { clearTimeout(t); res(); }
  });
  server.on('error', (e) => { clearTimeout(t); rej(e); });
  server.on('exit', (code) => {
    if (code !== null && code !== 0) {
      clearTimeout(t);
      rej(new Error(`server exited ${code}: ${serverErrors.join('')}`));
    }
  });
});

try {
  console.log('\n10. bots only make up the numbers when you are on your own');
  {
    const solo = new Client('Solo', 'pid-bs-solo');
    await solo.connect(null);
    await waitFor(() => solo.state?.phase === 'lobby', 'the lobby');
    assert(solo.state.bots === 1, 'one person in the lobby is promised one bot');
    const mate = new Client('Mate', 'pid-bs-mate');
    await mate.connect(solo.room);
    await waitFor(() => solo.state.players?.length === 2, 'the second player');
    assert(solo.state.bots === 0,
      'a second person means no bot — two people play each other, not a table of four');
    await mate.close();
    await solo.close();
  }

  console.log('\n11. a game against the bot');
  {
    const a = new Client('Ann', 'pid-bs-a');
    await a.connect(null, { options: { difficulty: 'sharp', goAgain: 'pass' } });
    await waitFor(() => a.state?.phase === 'lobby', 'the lobby');
    a.start();
    await waitFor(() => a.state.phase === 'placing', 'setup');
    assert(a.state.players === 2 && a.state.botCount === 1, 'one human and one bot');
    assert(a.state.boards[1].placements === null, 'the bot fleet is hidden from the off');
    assert(a.state.placingReady[1] === true, 'and it is already laid out');

    a.act({ kind: 'fire', target: 1, cell: 0 });
    await sleep(120);
    assert(a.errors.some((e) => /not ready to fire/i.test(e)), 'you cannot fire during setup');

    a.act({ kind: 'randomise' });
    await waitFor(() => a.state.yourFleet.length === 5, 'a random fleet');
    a.act({ kind: 'confirm' });
    await waitFor(() => a.state.phase !== 'placing', 'the game to begin');

    // Play it out. The bot takes its own turns; we just fire in order.
    let guard = 0;
    let next = 0;
    while (a.state.phase !== 'gameOver' && guard++ < 600) {
      if (a.state.yourTurn) {
        while (next < CELLS && a.state.boards[1].incoming[next]) next++;
        if (next < CELLS) a.act({ kind: 'fire', target: 1, cell: next });
      }
      await sleep(20);
    }
    assert(a.state.phase === 'gameOver', `the game finished (${guard} polls)`);
    assert(a.state.boards[1].placements !== null, 'the bot fleet is revealed at the end');
    assert(a.state.winner !== null, `${a.state.names[a.state.winner]} won it`);
    await a.close();
  }

  console.log('\n12. two people, and a fleet that survives a locked phone');
  {
    const a = new Client('Ann', 'pid-bs-2a');
    await a.connect(null, { options: { goAgain: 'again' } });
    const b = new Client('Ben', 'pid-bs-2b');
    await b.connect(a.room);
    await waitFor(() => a.state?.players?.length === 2, 'both in the lobby');
    a.start();
    await waitFor(() => a.state.phase === 'placing' && b.state.phase === 'placing', 'setup');
    assert(a.state.players === 2 && a.state.botCount === 0, 'two people, no bots');

    a.act({ kind: 'place', ship: 'carrier', x: 0, y: 0, dir: 'h' });
    await waitFor(() => a.state.yourFleet.length === 1, 'the carrier');
    a.act({ kind: 'place', ship: 'battleship', x: 2, y: 0, dir: 'v' });
    await sleep(120);
    assert(a.state.yourFleet.length === 1 && a.errors.some((e) => /overlap/i.test(e)),
      'an overlapping ship is refused with a reason');
    assert(b.state.boards[0].placements === null, 'the other player cannot see it going down');

    // The drawing game lost work when a phone locked; placement lives on the
    // server so this one cannot.
    await a.close();
    const back = new Client('Ann', 'pid-bs-2a');
    await back.connect(a.room);
    await waitFor(() => back.state?.phase === 'placing', 'coming back');
    assert(back.state.yourFleet.length === 1 && back.state.yourFleet[0].key === 'carrier',
      'the ship already placed is still there after a reconnect');

    back.act({ kind: 'randomise' });
    await waitFor(() => back.state.yourFleet.length === 5, 'the rest');
    back.act({ kind: 'confirm' });
    b.act({ kind: 'randomise' });
    await waitFor(() => b.state.yourFleet.length === 5, "Ben's fleet");
    b.act({ kind: 'confirm' });
    await waitFor(() => back.state.phase === 'playing', 'the shooting');

    const first = back.state.turn;
    const waiter = first === back.seat ? b : back;
    waiter.act({ kind: 'fire', target: first, cell: 0 });
    await sleep(150);
    assert(waiter.errors.some((e) => /not your turn/i.test(e)), 'the wrong player cannot fire');

    // Play it out between the two of them.
    const cursors = { [back.seat]: 0, [b.seat]: 0 };
    let guard = 0;
    while (back.state.phase !== 'gameOver' && guard++ < 900) {
      for (const cl of [back, b]) {
        if (cl.state?.yourTurn) {
          const t = cl.state.targets[0];
          let c = cursors[cl.seat];
          while (c < CELLS && cl.state.boards[t].incoming[c]) c++;
          cursors[cl.seat] = c;
          if (c < CELLS) cl.act({ kind: 'fire', target: t, cell: c });
        }
      }
      await sleep(15);
    }
    assert(back.state.phase === 'gameOver', `two-player game finished (${guard} polls)`);
    assert(back.state.winner === b.state.winner, 'both agree who won');
    assert(back.state.boards.every((bd) => bd.placements !== null),
      'and every fleet is on show at the end');

    const expected = /not your turn|already been fired at|not ready to fire|overlap|game is not over/i;
    const unexpected = back.errors.concat(b.errors).filter((e) => !expected.test(e));
    assert(unexpected.length === 0, `no unexpected errors (${unexpected.slice(0, 3).join('; ')})`);

    await Promise.all([back.close(), b.close()]);
  }
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

console.log(failures === 0 ? '\nBATTLESHIP END-TO-END PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
