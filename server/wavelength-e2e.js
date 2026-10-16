// Wavelength: scoring, who may see the target and the dials, and games over
// the wire — co-op with two, everyone for themselves with three.
//
//   node server/wavelength-e2e.js

import { WavelengthGame, pointsFor, BANDS } from './games/wavelength/engine.js';
import { SPECTRA } from './games/wavelength/spectra.js';
import { assert, section, finish, bootServer, startRoom, waitFor, sleep } from './testkit.js';

section('1. scoring');
{
  assert(pointsFor(50, 50) === 4 && pointsFor(50, 52.1) === 4, 'dead on is four');
  assert(pointsFor(50, 55) === 3 && pointsFor(50, 41) === 2, 'then three, then two');
  assert(pointsFor(50, 61.5) === 0, 'and outside the bands, nothing');
  const cover = (BANDS[BANDS.length - 1].within * 2) / 100;
  assert(cover > 0.18 && cover < 0.25, `the target covers about a fifth of the dial (${Math.round(cover * 100)}%)`);
  assert(SPECTRA.length >= 100 && SPECTRA.every((p) => p.length === 2 && p[0] !== p[1]),
    `${SPECTRA.length} spectrum cards, each with two different ends`);
}

section('2. a round, alone with the engine');
{
  const g = new WavelengthGame({ names: ['Dan', 'Sam'], playerCount: 2, roundsEach: 1 });
  const p = g.psychic;
  const q = 1 - p;
  assert(g.coop, 'two players are on one team');
  assert(g.viewFor(q).target === null && g.viewFor(p).target !== null, 'only the psychic sees the target');
  let err = '';
  try { g.giveClue(q, 'tea'); } catch (e) { err = e.message; }
  assert(/not the psychic/.test(err), 'only the psychic gives the clue');
  g.skip(p);
  g.skip(p);
  try { g.skip(p); } catch (e) { err = e.message; }
  assert(/no more skips/.test(err) && g.skipsLeft === 0, 'two new cards a turn, then that is it');
  g.giveClue(p, 'tea');
  try { g.lock(q); } catch (e) { err = e.message; }
  assert(/turn the dial/.test(err), 'you have to move the dial before locking');
  g.lock(q, g.target + 4);
  assert(g.phase === 'reveal' && g.team === 3, 'four off the target is three points together');
  assert(g.viewFor(q).target !== null, 'the reveal shows everyone the target');
  g.afterReveal();
  assert(g.psychic === q && g.phase === 'clue', 'the psychic role passes on');
}

section('3. three players: everyone for themselves');
{
  const g = new WavelengthGame({ names: ['A', 'B', 'C'], playerCount: 3, roundsEach: 1 });
  const p = g.psychic;
  const [x, y] = [0, 1, 2].filter((s) => s !== p);
  g.giveClue(p, 'clue');
  g.setDial(x, g.target);
  assert(g.viewFor(y).dials[x] === null, 'guessers do not see each other\'s dials');
  g.lock(x);
  g.lock(y, g.target > 50 ? 0 : 100);
  assert(g.roundPoints[x] === 4 && g.roundPoints[y] === 0, 'each guesser scores their own dial');
  assert(g.roundPoints[p] === 2, 'the psychic gets the average of what their clue earned');
}

const srv = await bootServer(3996);
try {
  section('4. two people over the wire');
  {
    const [a, b] = await startRoom(srv.url, 'wavelength', ['Dan', 'Sam'], { rounds: '2' });
    assert(a.state.totalRounds === 4 && a.state.coop, 'two rounds each, four in all, co-op');
    let rounds = 0;
    while (a.state.phase !== 'gameOver' && rounds++ < 10) {
      const psychic = a.state.youArePsychic ? a : b;
      const guesser = psychic === a ? b : a;
      assert(guesser.state.target === null, `round ${a.state.round}: the guesser cannot see the target`);
      psychic.act({ kind: 'clue', text: 'somewhere about there' });
      await waitFor(() => guesser.state.phase === 'guess', 'the clue');
      const target = psychic.state.target;
      const before = psychic.messages.length;
      guesser.act({ kind: 'dial', value: 10 });
      await waitFor(() => psychic.messages.length > before, 'the psychic watching the dial');
      assert(psychic.messages.at(-1).value === 10, 'the psychic sees the dial move');
      guesser.act({ kind: 'lock', value: target });
      await waitFor(() => a.state.phase === 'reveal' && b.state.phase === 'reveal', 'the reveal');
      a.act({ kind: 'next' });
      await sleep(60);
      assert(b.state.phase === 'reveal', 'one person pressing next does not move it on');
      b.act({ kind: 'next' });
      await waitFor(() => a.state.phase !== 'reveal', 'the next round');
    }
    assert(a.state.phase === 'gameOver' && a.state.team === 16, `bullseye every time is 16 of 16 (${a.state.team})`);
    assert(a.state.rivalry?.total.coop.won === 1, 'on the record as a win together');
    await Promise.all([a.close(), b.close()]);
  }

  section('5. three people: only the psychic watches');
  {
    const [a, b, c] = await startRoom(srv.url, 'wavelength', ['Ann', 'Bo', 'Cy'], { rounds: '2' });
    const all = [a, b, c];
    const psychic = all.find((p) => p.state.youArePsychic);
    const [g1, g2] = all.filter((p) => p !== psychic);
    psychic.act({ kind: 'clue', text: 'hmm' });
    await waitFor(() => g1.state.phase === 'guess', 'the clue');
    const seen = g2.messages.length;
    g1.act({ kind: 'dial', value: 33 });
    await waitFor(() => psychic.messages.some((m) => m.type === 'wl-dial' && m.value === 33), 'the psychic');
    await sleep(60);
    assert(g2.messages.length === seen, 'another guesser is not sent your dial');
    g1.act({ kind: 'lock', value: psychic.state.target });
    await sleep(60);
    assert(g2.state.dials[g1.seat] === null, 'nor does it arrive in their state');
    g2.act({ kind: 'lock', value: 50 });
    await waitFor(() => psychic.state.phase === 'reveal', 'the reveal');
    assert(psychic.state.scores[g1.seat] === 4 && !psychic.state.coop, 'scored one by one');
    await Promise.all(all.map((p) => p.close()));
  }
  assert(srv.errors.length === 0, `the server logged nothing alarming (${srv.errors.join('').slice(0, 200)})`);
} catch (err) {
  assert(false, err.message);
} finally {
  srv.stop();
}
finish('WAVELENGTH END-TO-END');
