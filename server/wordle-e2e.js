// Word Race: marking (repeated letters especially), the word lists, what
// other players can see mid-round, scoring, and a race over the wire.
//
//   node server/wordle-e2e.js

import { mark, WordRaceGame } from './games/wordle/engine.js';
import { ANSWERS, VALID } from './games/wordle/words.js';
import { assert, section, finish, bootServer, startRoom, waitFor } from './testkit.js';

section('1. marking');
{
  const cases = [
    ['crane', 'crane', 'ggggg', 'all right'],
    ['crane', 'caner', 'gyyyy', 'all there, mostly elsewhere'],
    ['eerie', 'three', 'y.g.g', 'a third E is grey when the answer has two'],
    ['llama', 'label', 'gyy..', 'a second L is yellow, a second A is not'],
    ['geese', 'eerie', '.gy.g', 'greens are counted before yellows'],
    ['spill', 'lolly', '...gy', 'one L green, one yellow, the answer has three'],
    ['abbey', 'babes', 'yygg.', 'a doubled B against a doubled B'],
  ];
  for (const [g, a, want, why] of cases) {
    const got = mark(g, a);
    assert(got === want, `${g} / ${a}: ${got} (${why})`);
  }
}

section('2. the word lists');
{
  assert(ANSWERS.length > 800 && new Set(ANSWERS).size === ANSWERS.length, `${ANSWERS.length} distinct answers`);
  assert(ANSWERS.every((w) => /^[a-z]{5}$/.test(w) && VALID.has(w)), 'every answer is five letters and a valid guess');
  assert(VALID.size > 12000, `${VALID.size} valid guesses`);
  assert(['cakes', 'adieu', 'jumbo'].every((w) => VALID.has(w)), 'plurals and vowel-dumps are allowed');
  assert(!ANSWERS.includes('color') && !ANSWERS.includes('which'), 'no US spellings or filler as answers');
}

section('3. a round with the engine');
{
  let t = 0;
  const g = new WordRaceGame({ names: ['Dan', 'Sam'], playerCount: 2, words: 1, now: () => t, rng: () => 0.5 });
  const answer = g.answer;
  let err = '';
  try { g.guess(0, 'zzzzz'); } catch (e) { err = e.message; }
  assert(/not in the word list/.test(err) && g.boards[0].length === 0, 'a made-up word is refused and costs nothing');
  try { g.guess(0, 'cat'); } catch (e) { err = e.message; }
  assert(/five letters/.test(err), 'so is a short one');

  const wrong = ANSWERS.find((w) => w !== answer && [...w].every((ch) => !answer.includes(ch))) || 'fuzzy';
  g.guess(1, wrong);
  const v = g.viewFor(0);
  assert(v.boards[1][0].word === null && v.boards[1][0].marks.length === 5,
    'mid-round you see their colours but not their letters');
  assert(v.answer === null, 'and nobody is sent the answer');

  t = 5000;
  g.guess(0, wrong);
  g.guess(0, answer);
  t = 9000;
  g.guess(1, answer);
  assert(g.phase === 'reveal', 'everyone solved: the round is over');
  // Dan: two guesses = 5, plus first to solve. Sam: two guesses = 5.
  assert(g.roundPoints.join() === '6,5', `fewer guesses and first to solve (${g.roundPoints.join()})`);
  assert(g.viewFor(0).boards[1][0].word === wrong, 'after the round, every board is shown in full');

  const out = new WordRaceGame({ names: ['A', 'B'], playerCount: 2, words: 1 });
  for (let i = 0; i < 6; i++) out.guess(0, ANSWERS.find((w) => w !== out.answer));
  assert(out.done(0) && out.phase === 'playing', 'six misses and you are out, but the round waits for the others');
  let late = '';
  try { out.guess(0, 'crane'); } catch (e) { late = e.message; }
  assert(/finished/.test(late), 'and you cannot guess again');
}

section('4. no repeats across rematches');
{
  const used = new Set();
  const seen = new Set();
  let repeated = false;
  for (let i = 0; i < 50; i++) {
    const g = new WordRaceGame({ names: ['A', 'B'], playerCount: 2, words: 5, used });
    for (let r = 0; r < 5; r++) {
      if (seen.has(g.answer)) repeated = true;
      seen.add(g.answer);
      if (r < 4) { g.phase = 'reveal'; g.afterReveal(); }
    }
  }
  assert(!repeated, `250 words across 50 rematches, none repeated`);
}

const srv = await bootServer(3999);
try {
  section('5. a race over the wire');
  {
    const [a, b] = await startRoom(srv.url, 'wordle', ['Dan', 'Sam'], { words: '1' });
    assert(a.state.answer === null && b.state.answer === null, 'nobody is sent the word');
    a.act({ kind: 'guess', word: 'zzzzz' });
    await waitFor(() => a.errors.length > 0, 'the refusal');
    assert(/word list/.test(a.errors[0]), 'a bad word is turned away');

    // The test cannot see the answer either, so it plays a real game: guess,
    // read the colours, keep only words that fit.
    const solve = async (c) => {
      let pool = ANSWERS.slice();
      while (!c.state.done[c.seat]) {
        const g = pool[0];
        const n = c.state.boards[c.seat].length;
        c.act({ kind: 'guess', word: g });
        await waitFor(() => c.state.boards[c.seat].length > n || c.state.phase !== 'playing', 'the guess');
        const row = c.state.boards[c.seat][n];
        pool = pool.filter((w) => mark(g, w) === row.marks);
      }
    };
    await solve(a);
    await solve(b);
    await waitFor(() => a.state.phase === 'reveal', 'the reveal');
    assert(a.state.answer && /^[a-z]{5}$/.test(a.state.answer), `the word is shown at the end (${a.state.answer})`);
    a.act({ kind: 'next' });
    b.act({ kind: 'next' });
    await waitFor(() => a.state.phase === 'gameOver' && b.state.phase === 'gameOver', 'the end');
    assert(a.state.rivalry?.byGame.wordle?.played === 1, 'on the record');
    await Promise.all([a.close(), b.close()]);
  }
  assert(srv.errors.length === 0, `the server logged nothing alarming (${srv.errors.join('').slice(0, 200)})`);
} catch (err) {
  assert(false, err.message);
} finally {
  srv.stop();
}
finish('WORD RACE END-TO-END');
