// End-to-end test: boots the real server, connects two WebSocket clients, and
// plays complete games through the wire protocol — including a mid-game
// disconnect and rejoin, which is the thing most likely to bite on a phone.
//
//   node server/e2e.js

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3987;
const URL = `ws://127.0.0.1:${PORT}/ws`;

let failures = 0;
// Both branches go to stdout so the transcript stays in order.
const assert = (cond, msg) => {
  if (cond) console.log(`  ok   ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ test client

class Client {
  constructor(name, playerId) {
    this.name = name;
    this.playerId = playerId;
    this.state = null;
    this.seat = null;
    this.room = null;
    this.chat = [];
    this.errors = [];
    this.autoPlay = false; // switched on once the inspection checks are done
    this.autoNext = true; // press "next hand" automatically
    this.moves = 0;
  }

  connect(room) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ type: 'join', playerId: this.playerId, name: this.name, room }));
      });
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'joined') {
          this.seat = msg.seat;
          this.room = msg.room;
          resolve(this);
        } else if (msg.type === 'state') {
          this.state = msg.state;
          if (this.autoPlay) this.think();
        } else if (msg.type === 'chat') {
          this.chat.push(msg.entry);
        } else if (msg.type === 'error') {
          this.errors.push(msg.message);
          reject?.(new Error(msg.message));
        }
      });
      this.ws.on('error', reject);
    });
  }

  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  act(action) {
    this.moves++;
    this.send({ type: 'action', action });
  }

  /** Play a random legal move. Randomness is the point: it probes odd states. */
  think() {
    const s = this.state;
    if (!s || s.phase === 'lobby') return;

    if (s.phase === 'gameOver') return;
    if (s.phase === 'handOver') {
      // Both players must press. Guard against re-sending on every rebroadcast,
      // which would otherwise ping-pong with the server forever.
      if (this.autoNext && this.readyForHand !== s.handNumber) {
        this.readyForHand = s.handNumber;
        this.act({ kind: 'nextHand' });
      }
      return;
    }

    const a = s.you?.actions;
    if (!a) return;

    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    if (a.type === 'bid1') {
      if (Math.random() < 0.35 || !a.canPass) {
        this.act({ kind: 'bid1', order: true, alone: Math.random() < 0.1 });
      } else {
        this.act({ kind: 'bid1', order: false });
      }
    } else if (a.type === 'bid2') {
      if (Math.random() < 0.4 || !a.canPass) {
        this.act({ kind: 'bid2', suit: pick(a.suits), alone: Math.random() < 0.1 });
      } else {
        this.act({ kind: 'bid2', suit: null });
      }
    } else if (a.type === 'discard') {
      this.act({ kind: 'discard', card: pick(a.cards) });
    } else if (a.type === 'play') {
      this.act({ kind: 'play', card: pick(a.cards) });
    }
  }

  close() {
    return new Promise((r) => {
      this.ws.once('close', r);
      this.ws.close();
    });
  }
}

const waitFor = async (fn, label, timeoutMs = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${label}`);
};

// ------------------------------------------------------------------- run

const server = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  env: { ...process.env, PORT: String(PORT), EUCHRE_FAST: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverErrors = [];
server.stderr.on('data', (d) => serverErrors.push(d.toString()));

try {
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server never started')), 10000);
    server.stdout.on('data', (d) => {
      if (d.toString().includes('Euchre running')) { clearTimeout(t); resolve(); }
    });
  });

  console.log('\n0. clients are never cached past a deploy');
  for (const asset of ['/', '/app.js', '/style.css', '/index.html']) {
    const res = await fetch(`http://127.0.0.1:${PORT}${asset}`);
    const cc = res.headers.get('cache-control') || '';
    const maxAge = /max-age=(\d+)/.exec(cc);
    const stale = maxAge && Number(maxAge[1]) > 0;
    assert(!stale, `${asset.padEnd(12)} is revalidated ("${cc || 'none'}")`);
  }

  console.log('\n1. two players join');
  const dan = new Client('Dan', 'pid-dan');
  await dan.connect(null);
  assert(dan.seat === 0, 'first player takes seat 0');
  assert(/^[A-Z2-9]{4}$/.test(dan.room), `room code looks right (${dan.room})`);

  const gf = new Client('Sam', 'pid-sam');
  await gf.connect(dan.room);
  assert(gf.seat === 1, 'second player takes seat 1');
  assert(gf.room === dan.room, 'both in the same room');

  await waitFor(() => dan.state && dan.state.phase !== 'lobby', 'game start');
  assert(dan.state.names[2] === 'Robo' && dan.state.names[3] === 'Chip', 'bots fill seats 2 and 3');
  assert(dan.state.you.hand.length === 5, 'dealt five cards');

  console.log('\n2. hands stay private');
  assert(dan.state.you.seat === 0 && !('hands' in dan.state), 'no full hand list is sent');
  assert(gf.state.you.hand.every((c) => !dan.state.you.hand.includes(c)),
    "opponent's cards are not in your hand");

  console.log('\n3. illegal moves are rejected');
  const before = JSON.stringify(dan.state.you.hand);
  dan.send({ type: 'action', action: { kind: 'play', card: 'JS' } });
  await sleep(120);
  assert(dan.errors.length > 0, `server refused an out-of-phase play (${dan.errors[0]})`);
  assert(JSON.stringify(dan.state.you.hand) === before, 'hand unchanged after a rejected move');

  console.log('\n4. chat both ways');
  dan.send({ type: 'chat', text: 'good luck' });
  await waitFor(() => gf.chat.length > 0, 'chat delivery');
  assert(gf.chat[0].text === 'good luck' && gf.chat[0].from === 'Dan', 'chat arrives with a name');

  console.log('\n5. the next hand waits for both players');
  dan.autoPlay = gf.autoPlay = true;
  dan.autoNext = gf.autoNext = false;
  dan.think();
  gf.think();
  await waitFor(() => dan.state.phase === 'handOver', 'first hand to be scored');
  const handNo = dan.state.handNumber;

  dan.act({ kind: 'nextHand' });
  await sleep(500);
  assert(dan.state.phase === 'handOver' && dan.state.handNumber === handNo,
    'one player pressing does NOT deal the next hand');
  assert((dan.state.ready || []).includes(0), 'the presser is marked ready');
  assert((gf.state.ready || []).includes(0), 'the other player can see who is ready');
  assert(!(gf.state.ready || []).includes(1), 'the one who has not pressed is not ready');

  gf.act({ kind: 'nextHand' });
  await waitFor(() => dan.state.handNumber === handNo + 1, 'next hand once both pressed', 10000);
  assert(true, 'both pressing deals the next hand');
  assert((dan.state.ready || []).length === 0, 'ready flags reset for the new hand');

  console.log('\n6. play a full game to ten');
  dan.errors.length = 0;
  gf.errors.length = 0;
  dan.autoNext = gf.autoNext = true;
  dan.think();
  gf.think();
  await waitFor(() => dan.state.phase === 'gameOver', 'game to finish', 120000);
  const score = dan.state.score;
  assert(Math.max(...score) >= 10, `someone reached ten (${score[0]}-${score[1]})`);
  assert(dan.state.score.join() === gf.state.score.join(), 'both clients agree on the score');
  assert(dan.errors.length === 0 && gf.errors.length === 0,
    `no illegal-move errors during play (${dan.errors.concat(gf.errors).slice(0, 3)})`);
  assert(dan.moves + gf.moves > 50, `players actually moved (${dan.moves + gf.moves} actions)`);

  console.log('\n7. rematch');
  dan.act({ kind: 'newGame' });
  await waitFor(() => dan.state.phase !== 'gameOver', 'new game');
  assert(dan.state.score[0] === 0 && dan.state.score[1] === 0, 'scores reset');

  console.log('\n8. drop a phone mid-hand and come back');
  dan.autoPlay = false;
  gf.autoPlay = false;
  await sleep(50);
  const scoreBefore = dan.state.score.join();
  const handBefore = JSON.stringify(dan.state.you.hand);
  await dan.close();
  await sleep(150);

  const danAgain = new Client('Dan', 'pid-dan'); // same playerId
  await danAgain.connect(dan.room);
  danAgain.autoPlay = false;
  assert(danAgain.seat === 0, 'rejoins the same seat');
  await waitFor(() => danAgain.state && danAgain.state.you, 'state resend');
  assert(danAgain.state.score.join() === scoreBefore, 'score survived the disconnect');
  assert(JSON.stringify(danAgain.state.you.hand) === handBefore, 'hand survived the disconnect');

  console.log('\n9. a third person cannot barge in');
  const rando = new Client('Nope', 'pid-rando');
  await rando.connect(dan.room).catch(() => {});
  await sleep(150);
  assert(rando.errors.some((e) => /two players/i.test(e)), 'third joiner is turned away');

  console.log('\n10. finish the resumed game');
  danAgain.autoPlay = true;
  gf.autoPlay = true;
  danAgain.think();
  gf.think();
  await waitFor(() => danAgain.state.phase === 'gameOver', 'resumed game to finish', 120000);
  assert(Math.max(...danAgain.state.score) >= 10, 'resumed game completed normally');

  console.log('\n11. leaving gives the seat up');
  danAgain.autoPlay = gf.autoPlay = false;
  const sharedRoom = danAgain.room;
  gf.send({ type: 'leave' });
  await waitFor(() => danAgain.state.phase === 'lobby', 'remaining player back to the lobby');
  assert(danAgain.state.phase === 'lobby', 'the player left behind returns to the lobby');
  assert(danAgain.state.room === sharedRoom, 'they keep the same code for a replacement');

  const newcomer = new Client('Alex', 'pid-alex');
  await newcomer.connect(sharedRoom);
  assert(newcomer.seat === 1, 'the vacated seat is free for someone new');

  console.log('\n12. an abandoned room is cleaned up');
  danAgain.send({ type: 'leave' });
  newcomer.send({ type: 'leave' });
  await sleep(300);
  const ghost = new Client('Ghost', 'pid-ghost');
  let joinError = null;
  await ghost.connect(sharedRoom).catch((e) => { joinError = e.message; });
  await sleep(200);
  const refused = joinError || ghost.errors.join(' ');
  assert(/no game with that code/i.test(refused), `the empty room is gone (${refused})`);

  await Promise.all([
    danAgain.close(), gf.close(), newcomer.close(),
    rando.close().catch(() => {}), ghost.close().catch(() => {}),
  ]);
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

console.log(failures === 0 ? '\nEND-TO-END PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
