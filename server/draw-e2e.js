// End-to-end test for the drawing game, over the real wire protocol.
//
//   node server/draw-e2e.js

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

import {
  matchesWord, isNearMiss, offerWords, tierOf, DRAWER_BONUS, WORDS,
} from './games/draw/words.js';
import { pointsFor, scoreGuess, DrawGame } from './games/draw/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3992;
const URL = `ws://127.0.0.1:${PORT}/ws`;

let failures = 0;
const assert = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ word matching

console.log('1. guess matching');
assert(matchesWord('Cat', 'cat'), 'case does not matter');
assert(matchesWord(' ice  cream ', 'ice cream'), 'spacing does not matter');
assert(matchesWord('lighthouses', 'lighthouse'), 'a stray plural is accepted');
assert(matchesWord('butterfly', 'butterflies'), 'and the other way round');
assert(!matchesWord('dog', 'cat'), 'a different word is not accepted');
assert(!matchesWord('', 'cat'), 'an empty guess is not accepted');
assert(isNearMiss('lighthous', 'lighthouse'), 'a typo counts as close');
assert(!isNearMiss('boat', 'lighthouse'), 'an unrelated word is not close');

// Two players used to be structurally unable to win: the drawer was paid the
// same as the guesser, so both scores moved together every turn and every game
// ended level. Points are for guessing only now, so a game must separate.
{
  const g = new DrawGame({ names: ['A', 'B'], playerCount: 2, turnsEach: 2, drawSeconds: 80 });
  const speeds = [70, 15, 70, 15]; // one player consistently quicker
  for (let t = 0; t < 4; t++) {
    g.chooseWord(g.drawer, g.choices[0]);
    const guesser = g.guessers()[0];
    g.deadline = Date.now() + speeds[t] * 1000; // pretend this much clock is left
    g.guess(guesser, g.word);
    if (g.phase !== 'reveal') g.endTurn();
    if (t < 3) g.nextTurn();
  }
  const [sa, sb] = g.scores;
  assert(sa !== sb, `a two-player game can separate (${sa} vs ${sb})`);
  assert(sa + sb > 0, 'and somebody scored');
}

// Word difficulty. A harder prompt pays the guesser more, and pays the drawer
// a flat bonus so that picking one is not pure charity.
assert(scoreGuess(80, 80, 'easy') === 100, 'an easy word tops out at 100');
assert(scoreGuess(80, 80, 'medium') === 130, 'a medium word tops out at 130');
assert(scoreGuess(80, 80, 'hard') === 170, 'a hard word tops out at 170');
assert(scoreGuess(40, 80, 'hard') > scoreGuess(40, 80, 'easy'),
  'the multiplier applies at any point on the clock');
assert(DRAWER_BONUS.easy === 0 && DRAWER_BONUS.hard > DRAWER_BONUS.medium,
  'the drawer bonus rises with difficulty and is nothing for an easy word');
assert(tierOf('cat') === 'easy' && tierOf('lighthouse') === 'medium'
  && tierOf('procrastination') === 'hard', 'prompts report their tier');

// Word list integrity. tierOf resolves a word to a tier through one map, so a
// word appearing in two tiers would silently take whichever was loaded last —
// and a hard prompt scored as easy is a quiet unfairness nobody would spot.
{
  const all = [...WORDS.easy, ...WORDS.medium, ...WORDS.hard];
  const lower = all.map((w) => w.toLowerCase());
  const dupes = lower.filter((w, i) => lower.indexOf(w) !== i);
  assert(dupes.length === 0, `no prompt appears in two tiers (${dupes.join(', ') || 'none'})`);

  const malformed = all.filter((w) => w !== w.trim() || /\s{2,}/.test(w) || w.length < 2);
  assert(malformed.length === 0,
    `every prompt is clean text (${JSON.stringify(malformed)})`);

  // A short game must never have to repeat itself within a tier.
  const smallest = Math.min(WORDS.easy.length, WORDS.medium.length, WORDS.hard.length);
  assert(smallest >= 60,
    `every tier has enough prompts (smallest ${smallest}, total ${all.length})`);
}

// The point of the bonus: picking hard must cost the drawer less than picking
// easy. Harder prompts take longer to land, so the guesser's larger multiplier
// is partly cancelled — the assumed times below are the design's premise, and
// if a retune breaks this the brave pick becomes charity again.
{
  const assumedShareLeft = { easy: 0.70, medium: 0.45, hard: 0.25 };
  const netGap = (tier) => DRAWER_BONUS[tier] -
    scoreGuess(Math.round(80 * assumedShareLeft[tier]), 80, tier);
  assert(netGap('hard') > netGap('medium') && netGap('medium') > netGap('easy'),
    `harder is the better pick for the drawer ` +
    `(easy ${netGap('easy')}, medium ${netGap('medium')}, hard ${netGap('hard')})`);
}

console.log('\n2. scoring and prompts');
assert(pointsFor(80, 80) === 100, 'an instant guess is worth the full 100');
assert(pointsFor(40, 80) === 60, 'halfway through is worth 60');
assert(pointsFor(1, 80) === 21, 'a buzzer-beater still scores 21');
assert(pointsFor(0, 80) === 0, 'no time left scores nothing');
// Every second has to cost something, which is the whole point of the change.
let prev = Infinity;
let strictlyFalling = true;
for (let left = 80; left >= 1; left--) {
  const p = pointsFor(left, 80);
  if (p > prev) strictlyFalling = false;
  prev = p;
}
assert(strictlyFalling, 'the value never rises as the clock runs down');
assert(pointsFor(80, 80) - pointsFor(79, 80) > 0, 'even one second off the top costs points');
const offer = offerWords();
assert(offer.length === 3 && new Set(offer).size === 3, 'three distinct prompts are offered');
const used = new Set(offer);
assert(offerWords(used).every((w) => !used.has(w)), 'already-used prompts are avoided');

// ------------------------------------------------------------- test client

class Client {
  constructor(name, playerId) {
    Object.assign(this, { name, playerId, state: null, seat: null, errors: [], ink: [], guesses: [] });
  }
  connect(room, opts = {}) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      const t = setTimeout(() => reject(new Error('join timed out')), 10000);
      this.ws.on('open', () => this.ws.send(JSON.stringify({
        type: 'join', playerId: this.playerId, name: this.name, room,
        game: 'draw', players: opts.players, options: opts.options,
      })));
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.type === 'joined') { clearTimeout(t); this.seat = m.seat; this.room = m.room; resolve(this); }
        else if (m.type === 'state') this.state = m.state;
        else if (m.type === 'ink') this.ink.push(m);
        else if (m.type === 'guess') this.guesses.push(m.entry);
        else if (m.type === 'error') this.errors.push(m.message);
      });
      this.ws.on('error', (e) => { clearTimeout(t); reject(e); });
    });
  }
  act(action) { this.ws.send(JSON.stringify({ type: 'action', action })); }
  close() { return new Promise((r) => { this.ws.once('close', r); this.ws.close(); }); }
}

const waitFor = async (fn, label, ms = 20000) => {
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
  const t = setTimeout(() => rej(new Error('server never started')), 10000);
  server.stdout.on('data', (d) => {
    if (d.toString().includes('running')) { clearTimeout(t); res(); }
  });
});

try {
  console.log('\n3. two players start a drawing game');
  const a = new Client('Ann', 'pid-draw-a');
  await a.connect(null, { players: 2, options: { turns: '2' } });
  const b = new Client('Ben', 'pid-draw-b');
  await b.connect(a.room);
  await waitFor(() => a.state && a.state.phase !== 'lobby', 'game start');
  assert(a.state.game === 'draw', 'the room reports the drawing game');
  assert(a.state.totalTurns === 4, 'two players, two turns each');

  const drawer = () => (a.state.drawer === a.seat ? a : b);
  const guesser = () => (a.state.drawer === a.seat ? b : a);

  console.log('\n4. only the drawer sees the word');
  await waitFor(() => a.state.phase === 'choosing', 'choosing phase');
  assert(Array.isArray(drawer().state.choices) && drawer().state.choices.length === 3,
    'the drawer is offered three words');
  assert(guesser().state.choices === null, 'the guesser is offered nothing');

  guesser().act({ kind: 'choose', word: 'cat' });
  await sleep(120);
  assert(guesser().errors.some((e) => /only the drawer/i.test(e)),
    'a guesser cannot choose the word');

  const chosen = drawer().state.choices[0];
  drawer().act({ kind: 'choose', word: chosen });
  await waitFor(() => a.state.phase === 'drawing', 'drawing phase');
  assert(drawer().state.word === chosen, 'the drawer knows the word');
  assert(guesser().state.word === null, 'the guesser does not');
  assert(guesser().state.wordPattern.length === chosen.length,
    `the guesser sees its shape only ("${guesser().state.wordPattern}")`);

  console.log('\n5. ink reaches the other phone');
  const before = guesser().ink.length;
  drawer().act({ kind: 'stroke', stroke: { id: 's1', color: '#111', width: 6,
    points: [[0.1, 0.1], [0.5, 0.5], [0.9, 0.2]] } });
  await waitFor(() => guesser().ink.length > before, 'stroke to arrive');
  const inkMsg = guesser().ink[guesser().ink.length - 1];
  assert(inkMsg.op === 'add' && inkMsg.stroke.points.length === 3, 'the stroke arrives intact');
  assert(inkMsg.stroke.points.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1),
    'coordinates stay normalised');

  guesser().act({ kind: 'stroke', stroke: { id: 'x', points: [[0.5, 0.5]] } });
  await sleep(120);
  assert(guesser().errors.some((e) => /only the drawer can draw/i.test(e)),
    'a guesser cannot draw');

  console.log('\n6. guessing');
  const wrongBefore = drawer().guesses.length;
  guesser().act({ kind: 'guess', text: 'definitely not it' });
  await waitFor(() => drawer().guesses.length > wrongBefore, 'wrong guess to be relayed');
  assert(drawer().guesses.some((x) => x.text === 'definitely not it'),
    'the drawer sees wrong guesses');
  assert(drawer().state.phase === 'drawing', 'a wrong guess does not end the turn');

  drawer().act({ kind: 'guess', text: chosen });
  await sleep(120);
  assert(drawer().errors.some((e) => /drawer cannot guess/i.test(e)),
    'the drawer cannot guess their own word');

  guesser().act({ kind: 'guess', text: chosen.toUpperCase() });
  await waitFor(() => a.state.phase === 'reveal', 'the turn to end');
  assert(a.state.revealed.word === chosen, 'the word is revealed to everyone');
  const gScore = a.state.scores[guesser().seat];
  const dScore = a.state.scores[drawer().seat];
  assert(gScore > 0, `the guesser scored ${gScore}`);
  const expectedBonus = DRAWER_BONUS[tierOf(chosen)] || 0;
  assert(dScore === expectedBonus,
    `the drawer scores only the difficulty bonus (${dScore} for a ${tierOf(chosen)} word)`);
  assert(a.state.revealed.solved[0].secondsLeft > 0, 'the reveal shows how fast it was');

  console.log('\n7. the next turn waits for both, and swaps the drawer');
  const wasDrawer = a.state.drawer;
  a.act({ kind: 'nextTurn' });
  await sleep(250);
  assert(a.state.phase === 'reveal', 'one player pressing does not start the next turn');
  b.act({ kind: 'nextTurn' });
  await waitFor(() => a.state.phase === 'choosing', 'next turn');
  assert(a.state.drawer !== wasDrawer, 'the drawer swaps over');
  assert(a.state.turn === 2, 'the turn counter advanced');

  console.log('\n8. running out of time ends the turn by itself');
  await waitFor(() => a.state.phase === 'drawing', 'auto-chosen word', 12000);
  assert(a.state.word !== null || a.state.wordPattern.length > 0,
    'a word was picked automatically when nobody chose');
  await waitFor(() => a.state.phase === 'reveal', 'the clock to run out', 15000);
  assert(a.state.revealed.reason === 'time', 'the turn ended on time');

  console.log('\n9. the board is replayed to someone who reconnects');
  a.act({ kind: 'nextTurn' });
  b.act({ kind: 'nextTurn' });
  await waitFor(() => a.state.phase === 'choosing', 'turn 3');
  const d3 = a.state.drawer === a.seat ? a : b;
  d3.act({ kind: 'choose', word: d3.state.choices[0] });
  await waitFor(() => a.state.phase === 'drawing', 'turn 3 drawing');
  d3.act({ kind: 'stroke', stroke: { id: 'r1', points: [[0.2, 0.2], [0.8, 0.8]] } });
  await sleep(200);

  const other = d3 === a ? b : a;
  await other.close();
  const rejoined = new Client(other.name, other.playerId);
  await rejoined.connect(other.room);
  await waitFor(() => rejoined.ink.length > 0, 'board replay');
  const replay = rejoined.ink.find((m) => m.op === 'replace');
  assert(!!replay, 'a reconnecting player is sent the whole board');
  assert(replay.strokes.some((s) => s.id === 'r1'), 'including strokes drawn before they left');

  console.log('\n10. play the game out');
  let steps = 0;
  while (rejoined.state?.phase !== 'gameOver' && steps++ < 200) {
    const st = rejoined.state;
    if (!st) { await sleep(50); continue; }
    const dr = st.drawer === rejoined.seat ? rejoined : d3;
    const gu = st.drawer === rejoined.seat ? d3 : rejoined;
    if (st.phase === 'choosing' && dr.state.choices) dr.act({ kind: 'choose', word: dr.state.choices[0] });
    else if (st.phase === 'drawing' && dr.state.word) gu.act({ kind: 'guess', text: dr.state.word });
    else if (st.phase === 'reveal') { rejoined.act({ kind: 'nextTurn' }); d3.act({ kind: 'nextTurn' }); }
    await sleep(80);
  }
  assert(rejoined.state.phase === 'gameOver', `the game finished (${steps} steps)`);
  assert(rejoined.state.scores.some((s) => s > 0), `final scores ${rejoined.state.scores.join('–')}`);

  await Promise.all([rejoined.close(), d3.close()]);
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

console.log(failures === 0 ? '\nDRAW END-TO-END PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
