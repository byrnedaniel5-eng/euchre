// Codenames Duet: the key card, the turn rules, and a game over the wire in
// which neither phone ever holds the other's key.
//
//   node server/codenames-e2e.js

import { CodenamesGame, dealKey, AGENTS } from './games/codenames/engine.js';
import { WORDS } from './games/codenames/words.js';
import { assert, section, finish, bootServer, startRoom, waitFor, sleep, Client } from './testkit.js';

const rngFrom = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

section('1. the key card');
{
  let ok = true;
  for (let n = 0; n < 200; n++) {
    const [a, b] = dealKey();
    const count = (side, k) => side.filter((x) => x === k).length;
    const both = (x, y) => a.filter((v, i) => v === x && b[i] === y).length;
    ok &&= count(a, 'A') === 9 && count(b, 'A') === 9 && count(a, 'X') === 3 && count(b, 'X') === 3;
    ok &&= both('A', 'A') === 3 && both('X', 'X') === 1 && both('A', 'X') === 1 && both('X', 'A') === 1;
    ok &&= a.filter((v, i) => v === 'A' || b[i] === 'A').length === AGENTS;
  }
  assert(ok, 'every key: nine agents and three assassins a side, overlapping like the real card');
  assert(new Set(WORDS).size === WORDS.length && WORDS.every((w) => /^[a-z]{2,11}$/.test(w)),
    `${WORDS.length} distinct words, all short enough for a phone`);
}

/** A game where we know the key, with seat 0 to give the first clue. */
function fresh(turns = 9) {
  const g = new CodenamesGame({ names: ['Dan', 'Sam'], turns, rng: rngFrom(7) });
  g.giver = 0;
  return g;
}
const cards = (g, side, kind) => g.key[side].map((k, i) => (k === kind ? i : -1)).filter((i) => i >= 0);

section('2. clues');
{
  const g = fresh();
  const tryClue = (w, n = 1, seat = 0) => {
    try { g.giveClue(seat, w, n); return null; } catch (e) { return e.message; }
  };
  assert(/not your clue/.test(tryClue('ocean', 1, 1)), 'only the giver gives the clue');
  assert(/on the board/.test(tryClue(g.words[3].toUpperCase())), 'a word on the board is refused');
  assert(/too close/.test(tryClue(`${g.words[3]}s`)), 'and so is its plural');
  assert(/0 to 9/.test(tryClue('ocean', 12)), 'the number is 0 to 9');
  assert(tryClue('zzyzx', 2) === null && g.phase === 'guess', 'a fine clue starts the guessing');
}

section('3. guessing');
{
  const g = fresh();
  g.giveClue(0, 'zzyzx', 2);
  const agents = cards(g, 0, 'A');
  const by = cards(g, 0, 'N');
  let err = '';
  try { g.stop(1); } catch (e) { err = e.message; }
  assert(/at least one/.test(err), 'you cannot end a turn without guessing');
  try { g.guess(0, agents[0]); } catch (e) { err = e.message; }
  assert(/not your guess/.test(err), 'the giver cannot guess');

  g.guess(1, agents[0]);
  assert(g.found[agents[0]] && g.phase === 'guess', 'an agent keeps the turn going');
  g.guess(1, by[0]);
  assert(g.phase === 'clue' && g.turnsLeft === 8, 'a bystander ends the turn and costs it');
  assert(g.giver === 1, 'and the clue passes to the other side');
  assert(g.neutral[0][by[0]], 'the bystander is marked on the side it came from');

  // That card is still in play from the other side, if it is one of theirs.
  g.giveClue(1, 'zzyzx', 1);
  const theirs = cards(g, 1, 'A').filter((i) => !g.found[i]);
  g.guess(0, theirs[0]);
  assert(g.found[theirs[0]], 'and the other side can still find its own agents');
}

section('4. the assassin');
{
  const g = fresh();
  g.giveClue(0, 'zzyzx', 1);
  g.guess(1, cards(g, 0, 'X')[0]);
  assert(g.phase === 'gameOver' && g.result.won === false && g.result.reason === 'assassin',
    'an assassin ends it for both of you');
}

section('5. one side finished, then sudden death');
{
  const g = fresh(20);
  g.giveClue(0, 'zzyzx', 9);
  for (const c of cards(g, 0, 'A')) if (!g.found[c]) g.guess(1, c);
  assert(g.agentsLeftFor(0) === 0 && g.phase === 'clue' && g.giver === 1,
    'finding all of one side\'s agents ends the turn by itself');
  g.giveClue(1, 'zzyzx', 1);
  const leftForSam = cards(g, 1, 'A').filter((i) => !g.found[i]);
  g.guess(0, leftForSam[0]);
  g.guess(0, cards(g, 1, 'N').find((i) => !g.found[i] && !g.neutral[1][i]));
  assert(g.giver === 1, 'with nothing left on Dan\'s side, Sam gives every clue from then on');

  const s = fresh(1);
  s.giveClue(0, 'zzyzx', 1);
  s.guess(1, cards(s, 0, 'N')[0]);
  assert(s.phase === 'suddenDeath', 'running out of turns is sudden death');
  const needed = cards(s, 1, 'A').filter((i) => !s.found[i]);
  s.guess(0, needed[0]);
  assert(s.phase === 'suddenDeath' && s.found[needed[0]], 'a right tap keeps you alive');
  s.guess(0, cards(s, 1, 'N').find((i) => !s.found[i]));
  assert(s.phase === 'gameOver' && !s.result.won, 'a wrong one loses');
}

const srv = await bootServer(3995);
try {
  section('6. over the wire, perfect play, and nobody sees the other key');
  {
    const [a, b] = await startRoom(srv.url, 'codenames', ['Dan', 'Sam'], { turns: '9' });
    const players = [a, b];
    let leaked = false;
    let rounds = 0;
    const check = () => {
      for (const p of players) {
        const st = p.state;
        if (st.phase !== 'gameOver' && st.theirKey !== null) leaked = true;
      }
    };
    // The two keys differ somewhere, or this proves nothing.
    assert(a.state.yourKey.join() !== b.state.yourKey.join(), 'the two phones hold different keys');

    while (a.state.phase !== 'gameOver' && rounds++ < 30) {
      check();
      const giver = players[a.state.giver === a.seat ? 0 : 1];
      const guesser = giver === a ? b : a;
      giver.act({ kind: 'clue', word: `qx${rounds}`, number: 3 });
      await waitFor(() => guesser.state.phase === 'guess', 'the clue');
      check();
      // The guesser cannot see the giver's key — but this test can, which is
      // how it plays perfectly. Three agents a turn, then stop.
      const targets = giver.state.yourKey
        .map((k, i) => (k === 'A' && !giver.state.found[i] ? i : -1)).filter((i) => i >= 0).slice(0, 3);
      for (const c of targets) {
        const n = guesser.state.agentsFound;
        guesser.act({ kind: 'guess', card: c });
        await waitFor(() => guesser.state.agentsFound > n || guesser.state.phase !== 'guess', 'the guess');
        if (guesser.state.phase !== 'guess') break;
      }
      if (guesser.state.phase === 'guess') {
        guesser.act({ kind: 'stop' });
        await waitFor(() => guesser.state.phase !== 'guess', 'the stop');
      }
    }
    assert(!leaked, 'no state before the end carried the other key');
    assert(a.state.phase === 'gameOver' && a.state.result.won, `perfect play wins (${9 - a.state.turnsLeft} turns)`);
    assert(a.state.theirKey && a.state.theirKey.join() === b.state.yourKey.join(),
      'at the end both keys are shown');
    assert(a.state.rivalry?.total.coop.won === 1 && a.state.rivalry.total.played === 0,
      'on the record as a win together, not a point to either');

    // Rematch, then a dropped phone keeps the clue it gave.
    a.act({ kind: 'newGame' });
    await waitFor(() => a.state.phase === 'clue' && a.state.agentsFound === 0, 'the rematch');
    const giver = a.state.giver === a.seat ? a : b;
    const other = giver === a ? b : a;
    giver.act({ kind: 'clue', word: 'harbour', number: 2 });
    await waitFor(() => other.state.phase === 'guess', 'the clue');
    await other.drop();
    const back = new Client(srv.url, other.name, other.playerId);
    await back.connect(a.room);
    await waitFor(() => back.state?.phase === 'guess', 'the rejoin');
    assert(back.state.clue?.word === 'harbour', 'a clue given before a phone locked is still there');
    await Promise.all([giver.close(), back.close()]);
  }
  assert(srv.errors.length === 0, `the server logged nothing alarming (${srv.errors.join('').slice(0, 200)})`);
} catch (err) {
  assert(false, err.message);
} finally {
  srv.stop();
}
finish('CODENAMES END-TO-END');
