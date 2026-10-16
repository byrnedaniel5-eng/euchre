// Know Me: the question deck, scoring each kind of question, who sees what
// before the reveal, and a game over the wire.
//
//   node server/knowme-e2e.js

import { KnowMeGame } from './games/knowme/engine.js';
import { QUESTIONS } from './games/knowme/questions.js';
import { assert, section, finish, bootServer, startRoom, waitFor, sleep } from './testkit.js';

section('1. the deck');
{
  const ok = QUESTIONS.every((q) =>
    (q.type === 'choice' && q.options.length >= 2 && q.options.length <= 5) ||
    (q.type === 'scale' && q.low && q.high) || q.type === 'text');
  assert(ok, `${QUESTIONS.length} questions, each well formed`);
  const g = new KnowMeGame({ names: ['A', 'B'], deck: 'everyone' });
  assert(g.pool.every((i) => !QUESTIONS[i].couple), 'the Anyone deck has no couples questions');
  const c = new KnowMeGame({ names: ['A', 'B'], deck: 'couples' });
  assert(c.pool.length === QUESTIONS.length, 'the Couples deck has everything');
  // The opening question is already drawn, so the rest of the deck is one less.
  const seen = new Set([g.question.q]);
  for (let i = 1; i < g.pool.length; i++) seen.add(g.drawQuestion().q);
  assert(seen.size === g.pool.length, 'no question comes round twice until the deck is used up');
}

/** A game with seat 0 as the subject and a chosen question. */
function round(players, question) {
  const g = new KnowMeGame({ names: ['Dan', 'Sam', 'Ali'].slice(0, players), playerCount: players });
  g.subject = 0;
  g.question = question;
  g.ask(0);
  return g;
}

section('2. scoring');
{
  let g = round(3, { type: 'choice', q: 'x', options: ['a', 'b', 'c'] });
  g.answer(0, 1); g.answer(1, 1); g.answer(2, 2);
  assert(g.phase === 'reveal' && g.roundPoints.join() === '0,2,0', 'choice: right is two, the subject scores nothing');

  g = round(3, { type: 'scale', q: 'x', low: 'l', high: 'h' });
  g.answer(0, 3); g.answer(1, 4); g.answer(2, 1);
  assert(g.roundPoints.join() === '0,1,0', 'scale: one off is one, two off is nothing');

  g = round(3, { type: 'text', q: 'x' });
  g.answer(0, 'The Beatles'); g.answer(1, 'beatles!'); g.answer(2, 'Queen');
  assert(g.phase === 'judge' && g.marks[1] === 'right' && g.marks[2] === null,
    'text: an obvious match is settled, the rest go to the subject');
  let err = '';
  try { g.judge(1, 2, 'right'); } catch (e) { err = e.message; }
  assert(/only the subject/.test(err), 'only the subject may mark');
  g.judge(0, 2, 'close');
  assert(g.phase === 'reveal' && g.roundPoints.join() === '0,2,1', 'and their marks score');
}

section('3. nothing shows early');
{
  const g = round(3, { type: 'choice', q: 'x', options: ['a', 'b'] });
  g.answer(0, 0);
  g.answer(1, 1);
  assert(g.viewFor(2).answers === null && g.viewFor(1).answers === null,
    'nobody sees anyone else\'s answer while answering');
  assert(g.viewFor(1).yourAnswer === 1, 'but you see your own');
  const t = round(2, { type: 'text', q: 'x' });
  t.answer(0, 'yes');
  t.answer(1, 'nope');
  assert(t.viewFor(0).answers !== null && t.viewFor(1).answers === null,
    'while judging, the subject sees the guesses and the guesser does not');
}

section('4. the subject picks');
{
  const g = new KnowMeGame({ names: ['Dan', 'Sam'], playerCount: 2 });
  const s = g.subject;
  let err = '';
  try { g.swap(1 - s); } catch (e) { err = e.message; }
  assert(/only the subject/.test(err), 'only the subject changes the question');
  g.swap(s); g.swap(s); g.swap(s);
  try { g.swap(s); } catch (e) { err = e.message; }
  assert(/no swaps/.test(err), 'three swaps, then that is it');
  g.custom(s, 'Who is my favourite Beatle?');
  assert(g.question.type === 'text' && g.question.custom, 'writing your own makes a free-text question');
}

const srv = await bootServer(3997);
try {
  section('5. over the wire');
  {
    const [a, b] = await startRoom(srv.url, 'knowme', ['Dan', 'Sam'], { rounds: '3', deck: 'couples' });
    assert(a.state.totalRounds === 6, 'three rounds each');
    let n = 0;
    while (a.state.phase !== 'gameOver' && n++ < 20) {
      const subject = a.state.youAreSubject ? a : b;
      const guesser = subject === a ? b : a;
      subject.act({ kind: 'custom', text: 'What is my favourite number?' });
      await waitFor(() => subject.state.question.custom, 'the custom question');
      subject.act({ kind: 'ask' });
      await waitFor(() => guesser.state.phase === 'answer', 'answering');
      subject.act({ kind: 'answer', value: 'seven' });
      await sleep(40);
      assert(guesser.state.answers === null, `round ${a.state.round}: the guess cannot see the truth`);
      guesser.act({ kind: 'answer', value: n % 2 ? 'Seven' : 'three' });
      await waitFor(() => ['judge', 'reveal'].includes(subject.state.phase), 'the answers');
      if (subject.state.phase === 'judge') {
        subject.act({ kind: 'judge', seat: guesser.seat, mark: 'wrong' });
      }
      await waitFor(() => a.state.phase === 'reveal' && b.state.phase === 'reveal', 'the reveal');
      a.act({ kind: 'next' });
      b.act({ kind: 'next' });
      await waitFor(() => a.state.phase !== 'reveal', 'the next round');
    }
    assert(a.state.phase === 'gameOver', 'six rounds and done');
    const total = a.state.scores[0] + a.state.scores[1];
    assert(total === 6, `three right guesses at two points each (${a.state.scores.join('–')})`);
    assert(a.state.rivalry?.total.played === 1, 'on the record');
    await Promise.all([a.close(), b.close()]);
  }
  assert(srv.errors.length === 0, `the server logged nothing alarming (${srv.errors.join('').slice(0, 200)})`);
} catch (err) {
  assert(false, err.message);
} finally {
  srv.stop();
}
finish('KNOW ME END-TO-END');
