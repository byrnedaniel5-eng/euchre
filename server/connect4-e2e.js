// Connect Four: the rules, the bot, and whole games over the wire.
//
//   node server/connect4-e2e.js

import { ConnectFourGame, at, COLS, ROWS } from './games/connect4/engine.js';
import { chooseColumn, SKILLS } from './games/connect4/bot.js';
import { assert, section, finish, bootServer, Client, startRoom, waitFor, sleep } from './testkit.js';

/** Play a list of columns, alternating from whoever is first. */
function playOut(cols, first = 0) {
  const g = new ConnectFourGame({ names: ['A', 'B'], first });
  for (const c of cols) g.drop(g.turn, c);
  return g;
}

section('1. four in a row, every way round');
{
  let g = playOut([0, 0, 1, 1, 2, 2, 3]);
  assert(g.phase === 'gameOver' && g.winner === 0, 'across');
  g = playOut([0, 1, 0, 1, 0, 1, 0]);
  assert(g.winner === 0 && g.line.every((c) => c % COLS === 0), 'up');
  // A rising diagonal: A at (0,0) (1,1) (2,2) (3,3).
  g = playOut([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
  assert(g.winner === 0 && g.line.includes(at(3, 3)), 'diagonally up');
  g = playOut([6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]);
  assert(g.winner === 0 && g.line.includes(at(3, 3)), 'diagonally down');
  g = playOut([0, 0, 1, 1, 2, 2]);
  assert(g.phase === 'playing', 'three is not four');
}

section('2. the rules say no');
{
  const g = playOut([]);
  let err = '';
  try { g.drop(1, 3); } catch (e) { err = e.message; }
  assert(/not your turn/.test(err), 'out of turn');
  for (let i = 0; i < ROWS; i++) g.drop(g.turn, 3);
  try { g.drop(g.turn, 3); } catch (e) { err = e.message; }
  assert(/full/.test(err), 'a full column');
  try { g.drop(g.turn, 9); } catch (e) { err = e.message; }
  assert(/no such column/.test(err), 'off the board');

  // A full board with no four anywhere: pairs of columns alternating, and
  // flipping every row. Vertically it alternates, horizontally it never runs
  // past two, and on any diagonal the row flip changes every step while the
  // column pair changes every other step, so no four can match.
  const d = new ConnectFourGame({ names: ['A', 'B'] });
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) d.board[at(c, r)] = ((c >> 1) & 1) ^ (r & 1);
  }
  const lastCell = at(6, ROWS - 1);
  const lastSeat = d.board[lastCell];
  d.board[lastCell] = -1;
  d.moves = 41;
  d.turn = lastSeat;
  d.drop(lastSeat, 6);
  assert(d.phase === 'gameOver' && d.winner === null && d.moves === 42,
    'the forty-second disc with no four is a draw');
}

section('3. the bot');
{
  // A sits on three across the bottom; whoever is to move must deal with it.
  const g = playOut([0, 0, 1, 1, 2]);
  assert(chooseColumn(g.board, 1, SKILLS.easy) === 3, 'even easy blocks a four');
  const h = playOut([0, 6, 1, 6, 2]); // A has three across again, B elsewhere
  assert(chooseColumn(h.board, 1, SKILLS.casual) === 3, 'casual blocks too');
  const w = playOut([0, 0, 1, 1, 2, 2]); // A to move with three across
  assert(chooseColumn(w.board, 0, SKILLS.easy) === 3, 'and takes a win that is sitting there');

  const play = (a, b) => {
    const x = new ConnectFourGame({ names: ['a', 'b'] });
    const sk = [a, b];
    while (x.phase === 'playing') x.drop(x.turn, chooseColumn(x.board, x.turn, sk[x.turn]));
    return x.winner;
  };
  let casual = 0;
  let easy = 0;
  for (let i = 0; i < 40; i++) {
    const flip = i % 2 === 1;
    const w2 = flip ? play(SKILLS.easy, SKILLS.casual) : play(SKILLS.casual, SKILLS.easy);
    if (w2 === null) continue;
    if ((w2 === 0) !== flip) casual++; else easy++;
  }
  assert(casual > easy * 2, `casual is clearly stronger than easy (${casual}–${easy})`);

  const t0 = Date.now();
  chooseColumn(new ConnectFourGame({ names: ['a', 'b'] }).board, 0, SKILLS.sharp);
  assert(Date.now() - t0 < 1500, `sharp decides fast enough (${Date.now() - t0}ms)`);
}

const srv = await bootServer(3994);
try {
  section('4. against the bot over the wire');
  {
    const [a] = await startRoom(srv.url, 'connect4', ['Ann'], { difficulty: 'easy' });
    assert(a.state.names[1] === 'Bot' && a.state.botCount === 1, 'one person gets a bot');
    let guard = 0;
    while (a.state.phase !== 'gameOver' && guard++ < 200) {
      if (a.state.yourTurn) {
        const free = [3, 2, 4, 1, 5, 0, 6].filter((c) => a.state.board[(ROWS - 1) * COLS + c] === -1);
        a.act({ kind: 'drop', col: free[0] });
      }
      await sleep(15);
    }
    assert(a.state.phase === 'gameOver', `the game ends (${a.state.lastMove?.n} moves)`);
    assert(a.state.rivalry === null, 'a game against the bot is not on the record');
    await a.close();
  }

  section('5. two people, a rematch, and the record');
  {
    const [a, b] = await startRoom(srv.url, 'connect4', ['Dan', 'Sam']);
    assert(a.state.first === 0 && a.state.yourTurn && !b.state.yourTurn, 'the host starts the first game');
    b.act({ kind: 'drop', col: 0 });
    await sleep(80);
    assert(b.errors.some((e) => /not your turn/.test(e)), 'the other player cannot jump in');

    for (const [who, col] of [[a, 0], [b, 6], [a, 1], [b, 6], [a, 2], [b, 6], [a, 3]]) {
      const n = who.state.lastMove?.n ?? 0;
      who.act({ kind: 'drop', col });
      await waitFor(() => (who.state.lastMove?.n ?? 0) > n, 'the drop');
    }
    await waitFor(() => b.state.phase === 'gameOver', 'game over');
    assert(b.state.winner === 0 && b.state.line.length === 4, 'Dan wins across the bottom');
    assert(b.state.rivalry?.total.wins.Dan === 1 && b.state.rivalry.byGame.connect4.played === 1,
      'it goes on the record, once');

    a.act({ kind: 'newGame' });
    await waitFor(() => a.state.phase === 'playing' && a.state.moves !== 7 && a.state.board.every((v) => v === -1), 'the rematch');
    assert(a.state.first === 1 && b.state.yourTurn, 'the rematch is Sam\'s to start');

    // Drop Sam's phone mid-game; the board is the server's, so nothing is lost.
    b.act({ kind: 'drop', col: 3 });
    await waitFor(() => a.state.lastMove?.n === 1, 'the first drop');
    await b.drop();
    const back = new Client(srv.url, 'Sam', b.playerId);
    await back.connect(a.room);
    await waitFor(() => back.state?.phase === 'playing', 'the rejoin');
    assert(back.state.board[at(3, 0)] === 1, 'a disc dropped before the phone locked is still there');
    await Promise.all([a.close(), back.close()]);
  }

  assert(srv.errors.length === 0, `the server logged nothing alarming (${srv.errors.join('').slice(0, 200)})`);
} catch (err) {
  assert(false, err.message);
} finally {
  srv.stop();
}
finish('CONNECT FOUR END-TO-END');
