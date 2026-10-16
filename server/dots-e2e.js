// Dots and Boxes: geometry, the go-again rule, the bot, and games over the
// wire.
//
//   node server/dots-e2e.js

import { DotsGame, geometry } from './games/dots/engine.js';
import { chooseLine, SKILLS } from './games/dots/bot.js';
import { assert, section, finish, bootServer, startRoom, waitFor, sleep } from './testkit.js';

section('1. the board');
{
  const g = geometry(4, 4);
  assert(g.edges === 40 && g.boxes === 16, 'a 4×4 board has 40 lines and 16 boxes');
  assert(g.boxEdges.every((e) => new Set(e).size === 4), 'every box has four different sides');
  const touching = g.edgeBoxes.map((b) => b.length);
  assert(touching.filter((n) => n === 1).length === 16 && touching.filter((n) => n === 2).length === 24,
    'the 16 outside lines touch one box, the 24 inside lines touch two');
}

section('2. closing boxes');
{
  const g = new DotsGame({ names: ['A', 'B'], rows: 2, cols: 2 });
  const [top, bottom, left, right] = g.geo.boxEdges[0];
  g.draw(0, top);
  g.draw(1, left);
  g.draw(0, bottom);
  assert(g.turn === 1, 'no box, the turn passes');
  g.draw(1, right);
  assert(g.owner[0] === 1 && g.scores[1] === 1 && g.turn === 1, 'closing a box scores it and goes again');
  let err = '';
  try { g.draw(1, right); } catch (e) { err = e.message; }
  assert(/already drawn/.test(err), 'a line cannot be drawn twice');

  // One line closing two boxes at once.
  const h = new DotsGame({ names: ['A', 'B'], rows: 1, cols: 2 });
  const shared = h.geo.boxEdges[0][3];
  for (const e of [...h.geo.boxEdges[0], ...h.geo.boxEdges[1]]) {
    if (e !== shared && h.lines[e] === -1) h.draw(h.turn, e);
  }
  const who = h.turn;
  h.draw(who, shared);
  assert(h.scores[who] === 2 && h.phase === 'gameOver', 'one line can close two boxes, and that ends a full board');

  const t = new DotsGame({ names: ['A', 'B'], rows: 1, cols: 2 });
  t.scores = [1, 1];
  assert(t.winners().length === 2, 'equal boxes is a tie');
}

section('3. the bot');
{
  const g = new DotsGame({ names: ['A', 'B'], rows: 3, cols: 3 });
  const [a, b, c] = g.geo.boxEdges[4];
  g.lines[a] = 0; g.lines[b] = 0; g.lines[c] = 0;
  assert(chooseLine(g.geo, g.lines, SKILLS.casual) === g.geo.boxEdges[4][3], 'it takes a box that is sitting there');

  const fresh = new DotsGame({ names: ['A', 'B'], rows: 3, cols: 3 });
  fresh.lines[fresh.geo.boxEdges[0][0]] = 0;
  fresh.lines[fresh.geo.boxEdges[0][1]] = 0;
  let gave = false;
  for (let i = 0; i < 200; i++) {
    const e = chooseLine(fresh.geo, fresh.lines, SKILLS.casual);
    if (fresh.geo.edgeBoxes[e].some((bx) => fresh.geo.boxEdges[bx].filter((x) => fresh.lines[x] !== -1).length === 2)) gave = true;
  }
  assert(!gave, 'while safe lines are left it never draws a third side');

  const play = (x, y) => {
    const d = new DotsGame({ names: ['x', 'y'], rows: 4, cols: 4 });
    const sk = [x, y];
    while (d.phase === 'playing') d.draw(d.turn, chooseLine(d.geo, d.lines, sk[d.turn]));
    return d.scores;
  };
  const ladder = (x, y, n = 120) => {
    let wx = 0;
    let wy = 0;
    for (let i = 0; i < n; i++) {
      const flip = i % 2 === 1;
      const s = flip ? play(y, x) : play(x, y);
      const [sx, sy] = flip ? [s[1], s[0]] : s;
      if (sx > sy) wx++; else if (sy > sx) wy++;
    }
    return [wx, wy];
  };
  const [e1, c1] = ladder(SKILLS.easy, SKILLS.casual);
  assert(c1 > e1 * 3, `casual beats easy (${c1}–${e1})`);
  const [c2, s2] = ladder(SKILLS.casual, SKILLS.sharp);
  assert(s2 > c2 * 2, `sharp beats casual (${s2}–${c2})`);
}

const srv = await bootServer(3998);
try {
  section('4. against the bot over the wire');
  {
    const [a] = await startRoom(srv.url, 'dots', ['Ann'], { size: 'small', difficulty: 'sharp' });
    assert(a.state.rows === 3 && a.state.names[1] === 'Bot', 'a small board, and a bot to play');
    let guard = 0;
    while (a.state.phase !== 'gameOver' && guard++ < 400) {
      if (a.state.yourTurn) {
        const free = a.state.lines.map((v, e) => (v === -1 ? e : -1)).filter((e) => e >= 0);
        a.act({ kind: 'line', edge: free[0] });
      }
      await sleep(10);
    }
    assert(a.state.phase === 'gameOver' && a.state.scores[0] + a.state.scores[1] === 9, 'every box is claimed');
    assert(a.state.rivalry === null, 'and a bot game is not on the record');
    await a.close();
  }

  section('5. two people, and the record');
  {
    const [a, b] = await startRoom(srv.url, 'dots', ['Dan', 'Sam'], { size: 'small' });
    const players = [a, b];
    let guard = 0;
    while (a.state.phase !== 'gameOver' && guard++ < 400) {
      const mover = players.find((p) => p.state.yourTurn);
      if (mover) {
        const free = mover.state.lines.map((v, e) => (v === -1 ? e : -1)).filter((e) => e >= 0);
        const n = mover.state.lastLine?.n ?? 0;
        mover.act({ kind: 'line', edge: free[free.length - 1] });
        await waitFor(() => (a.state.lastLine?.n ?? 0) > n, 'the line');
      }
      await sleep(5);
    }
    await waitFor(() => b.state.phase === 'gameOver', 'both phones to finish');
    const [x, y] = a.state.scores;
    assert(x + y === 9 && b.state.scores.join() === a.state.scores.join(), `both phones agree (${x}–${y})`);
    assert(a.state.rivalry?.byGame.dots?.played === 1, 'on the record');
    a.act({ kind: 'newGame' });
    await waitFor(() => a.state.phase === 'playing' && a.state.scores.every((v) => v === 0), 'the rematch');
    assert(a.state.turn === 1, 'the rematch starts with the other player');
    await Promise.all([a.close(), b.close()]);
  }
  assert(srv.errors.length === 0, `the server logged nothing alarming (${srv.errors.join('').slice(0, 200)})`);
} catch (err) {
  assert(false, err.message);
} finally {
  srv.stop();
}
finish('DOTS END-TO-END');
