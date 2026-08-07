// End-to-end test for the trivia game.
//
//   node server/trivia-e2e.js

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

import { TriviaGame, pointsFor, FIRST_BONUS } from './games/trivia/engine.js';
import { QuestionSource, CATEGORIES, FALLBACK, categoryById } from './games/trivia/questions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3994;
const URL = `ws://127.0.0.1:${PORT}/ws`;

let failures = 0;
const assert = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -------------------------------------------------------------- questions

console.log('1. the question supply');
{
  const cats = new Set(FALLBACK.map((q) => q.category));
  assert(CATEGORIES.every((c) => cats.has(c.id)),
    'every wheel category has bundled questions to fall back on');
  const perCat = CATEGORIES.map((c) => FALLBACK.filter((q) => q.category === c.id).length);
  assert(Math.min(...perCat) >= 3, `at least 3 bundled per category (min ${Math.min(...perCat)})`);
  const shaped = FALLBACK.every((q) =>
    q.options.length === 4 && q.answer >= 0 && q.answer < 4 && q.text.length > 5);
  assert(shaped, 'every bundled question has four options and a valid answer');
}

// The API is somebody else's server on the far side of a free-tier host, so
// the game has to survive it being down — not degrade, not stall.
{
  const dead = new QuestionSource({ fetchImpl: async () => { throw new Error('network down'); } });
  const q = await dead.next(CATEGORIES[0].id);
  assert(!!q && q.options.length === 4,
    'a question still arrives when the API is unreachable');
  assert(dead.fallbackCount === 1 && dead.liveCount === 0, 'and it came from the bundled set');

  const junk = new QuestionSource({ fetchImpl: async () => ({ response_code: 2, results: [] }) });
  const q2 = await junk.next(CATEGORIES[1].id);
  assert(!!q2 && q2.category === CATEGORIES[1].id, 'a bad response code falls back too');
}

// A stubbed API proves the decode path without depending on the network.
{
  const b = (s) => Buffer.from(s, 'utf8').toString('base64');
  const stub = new QuestionSource({
    fetchImpl: async () => ({
      response_code: 0,
      results: [{
        difficulty: b('easy'), question: b('What is 2 + 2?'),
        correct_answer: b('4'), incorrect_answers: [b('3'), b('5'), b('22')],
      }],
    }),
  });
  const q = await stub.next(9);
  assert(q.text === 'What is 2 + 2?', 'base64 questions are decoded');
  assert(q.options.length === 4 && q.options[q.answer] === '4',
    'the correct answer survives the shuffle');
}

console.log('\n2. scoring');
assert(pointsFor(20, 20) === 100, 'an instant answer is worth 100');
assert(pointsFor(10, 20) === 60, 'halfway is worth 60');
assert(pointsFor(0, 20) === 0, 'no time left scores nothing');
{
  const g = new TriviaGame({ names: ['A', 'B'], playerCount: 2, questionCount: 3, questionSeconds: 20 });
  g.beginQuestion({ category: 9, difficulty: 'easy', text: 'q', options: ['w', 'x', 'y', 'z'], answer: 2 });
  const first = g.answer(0, 2);
  const second = g.answer(1, 2);
  assert(first.correct && second.correct, 'both answered correctly');
  assert(first.first && !second.first, 'only the first correct answer is flagged first');
  assert(first.points >= second.points + FIRST_BONUS - 1,
    `being fastest is worth more (${first.points} vs ${second.points})`);
  assert(g.phase === 'reveal', 'the question closes once everyone has answered');
}
{
  const g = new TriviaGame({ names: ['A', 'B'], playerCount: 2, questionCount: 3 });
  g.beginQuestion({ category: 9, difficulty: 'easy', text: 'q', options: ['w', 'x', 'y', 'z'], answer: 1 });
  g.answer(0, 3);
  assert(g.scores[0] === 0, 'a wrong answer scores nothing');
  assert(g.streaks[0] === 0, 'and breaks the streak');
  let threw = false;
  try { g.answer(0, 1); } catch { threw = true; }
  assert(threw, 'you cannot answer twice');
  let threw2 = false;
  try { g.answer(1, 9); } catch { threw2 = true; }
  assert(threw2, 'you cannot pick an option that does not exist');
}

console.log('\n3. the wheel decides, not the animation');
{
  const g = new TriviaGame({ names: ['A', 'B'], playerCount: 2, questionCount: 5 });
  const seen = new Set();
  let noncesDiffer = true;
  let lastNonce = g.spinNonce;
  for (let i = 0; i < 4; i++) {
    seen.add(g.spunCategory);
    g.beginQuestion({ category: g.spunCategory, difficulty: 'easy', text: 'q',
      options: ['a', 'b', 'c', 'd'], answer: 0 });
    g.answer(0, 0); g.answer(1, 1);
    g.nextQuestion();
    if (g.spinNonce === lastNonce) noncesDiffer = false;
    lastNonce = g.spinNonce;
  }
  assert(CATEGORIES.some((c) => c.id === g.spunCategory), 'the wheel lands on a real category');
  assert(noncesDiffer, 'every spin gets a fresh nonce so the wheel re-animates');
  assert(seen.size >= 2, `the wheel actually varies (${seen.size} categories in 4 spins)`);
}

console.log('\n4. the answer is not leaked before the reveal');
{
  const g = new TriviaGame({ names: ['A', 'B'], playerCount: 2, questionCount: 3 });
  g.beginQuestion({ category: 9, difficulty: 'easy', text: 'q', options: ['a', 'b', 'c', 'd'], answer: 3 });
  const view = g.viewFor(0);
  assert(view.question.answer === null, 'the correct index is withheld mid-question');
  assert(JSON.stringify(view).indexOf('"answer":3') === -1,
    'and does not appear anywhere in the state a client receives');
  g.answer(0, 0); g.answer(1, 1);
  assert(g.viewFor(0).question.answer === 3, 'it is revealed once the question closes');
}

// --------------------------------------------------------------- clients

class Client {
  constructor(name, playerId) {
    Object.assign(this, { name, playerId, state: null, seat: null, errors: [] });
  }
  connect(room, opts = {}) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      const t = setTimeout(() => reject(new Error('join timed out')), 10000);
      this.ws.on('open', () => this.ws.send(JSON.stringify({
        type: 'join', playerId: this.playerId, name: this.name, room,
        game: 'trivia', players: opts.players, options: opts.options,
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
  console.log('\n5. a full game over the wire');
  const a = new Client('Ann', 'pid-tv-a');
  await a.connect(null, { players: 2, options: { questions: '5' } });
  const b = new Client('Ben', 'pid-tv-b');
  await b.connect(a.room);
  await waitFor(() => a.state && a.state.phase !== 'lobby', 'game start');
  assert(a.state.game === 'trivia', 'the room reports the trivia game');
  assert(a.state.questionCount === 5, 'five questions as chosen');
  assert(a.state.categories.length === 8, 'the wheel has eight categories');

  await waitFor(() => a.state.phase === 'question', 'first question', 20000);
  assert(!!a.state.question && a.state.question.options.length === 4,
    `a question arrived with four options ("${a.state.question.text.slice(0, 40)}…")`);
  assert(a.state.question.answer === null, 'the answer is hidden from the client');
  assert(a.state.category === b.state.category, 'both players got the same category');
  assert(a.state.question.text === b.state.question.text, 'and the same question');

  // Answer wrong deliberately, then confirm the other player can still score.
  const correctIndexHidden = a.state.question.answer === null;
  assert(correctIndexHidden, 'answers stay hidden until the reveal');
  a.act({ kind: 'answer', choice: 0 });
  await sleep(120);
  a.act({ kind: 'answer', choice: 1 });
  await sleep(120);
  assert(a.errors.some((e) => /already answered/i.test(e)), 'a second answer is refused');

  b.act({ kind: 'answer', choice: 1 });
  await waitFor(() => a.state.phase === 'reveal', 'reveal');
  assert(a.state.question.answer !== null, 'the answer appears at the reveal');
  assert(a.state.revealed.answers.length === 2, 'both answers are in the reveal');

  console.log('\n6. the next question waits for both');
  const idx = a.state.index;
  a.act({ kind: 'nextQuestion' });
  await sleep(250);
  assert(a.state.index === idx, 'one player pressing does not spin the wheel');
  b.act({ kind: 'nextQuestion' });
  await waitFor(() => a.state.index === idx + 1, 'next question');
  assert(a.state.spinNonce !== undefined, 'the new spin carries a nonce');

  console.log('\n7. play it out');
  let guard = 0;
  while (a.state.phase !== 'gameOver' && guard++ < 200) {
    if (a.state.phase === 'question') {
      if (a.state.yourAnswer === null) a.act({ kind: 'answer', choice: 0 });
      if (b.state.yourAnswer === null) b.act({ kind: 'answer', choice: 1 });
    } else if (a.state.phase === 'reveal') {
      a.act({ kind: 'nextQuestion' });
      b.act({ kind: 'nextQuestion' });
    }
    await sleep(120);
  }
  assert(a.state.phase === 'gameOver', `the game finished (${guard} steps)`);
  assert(a.state.scores.length >= 2, `final scores ${a.state.scores.slice(0, 2).join('–')}`);
  assert(a.errors.filter((e) => !/already answered/i.test(e)).length === 0,
    `no unexpected errors (${a.errors.slice(0, 3).join('; ')})`);

  await Promise.all([a.close(), b.close()]);
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

console.log(failures === 0 ? '\nTRIVIA END-TO-END PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
