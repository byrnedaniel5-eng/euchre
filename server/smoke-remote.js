// Smoke test against a deployed instance. Plays a full game over wss:// with
// two clients, which is the only way to prove the host actually passes
// WebSocket upgrades through its proxy.
//
//   node server/smoke-remote.js https://euchre-c0f4.onrender.com

import WebSocket from 'ws';

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) {
  console.error('usage: node server/smoke-remote.js https://your-app.onrender.com');
  process.exit(2);
}
const wsUrl = base.replace(/^http/, 'ws') + '/ws';

let failures = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name, playerId) {
    Object.assign(this, { name, playerId, state: null, seat: null, errors: [], moves: 0 });
    this.autoPlay = false;
    this.autoNext = true;
  }
  connect(room) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      const t = setTimeout(() => reject(new Error('websocket upgrade timed out')), 30000);
      this.ws.on('open', () =>
        this.ws.send(JSON.stringify({ type: 'join', playerId: this.playerId, name: this.name, room })));
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.type === 'joined') { clearTimeout(t); this.seat = m.seat; this.room = m.room; resolve(this); }
        else if (m.type === 'state') { this.state = m.state; if (this.autoPlay) this.think(); }
        else if (m.type === 'error') this.errors.push(m.message);
      });
      this.ws.on('error', (e) => { clearTimeout(t); reject(e); });
    });
  }
  think() {
    const s = this.state;
    const act = (action) => { this.moves++; this.ws.send(JSON.stringify({ type: 'action', action })); };
    if (s?.phase === 'handOver') {
      // Both players press; only once per hand or we loop with the server.
      if (this.autoNext && this.readyForHand !== s.handNumber) {
        this.readyForHand = s.handNumber;
        act({ kind: 'nextHand' });
      }
      return;
    }
    const a = s?.you?.actions;
    if (!a) return;
    const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
    if (a.type === 'bid1') act({ kind: 'bid1', order: Math.random() < 0.35 || !a.canPass });
    else if (a.type === 'bid2') act({ kind: 'bid2', suit: (Math.random() < 0.4 || !a.canPass) ? pick(a.suits) : null });
    else if (a.type === 'discard') act({ kind: 'discard', card: pick(a.cards) });
    else if (a.type === 'play') act({ kind: 'play', card: pick(a.cards) });
  }
}

const waitFor = async (fn, label, ms = 90000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await sleep(50); }
  throw new Error(`timed out waiting for ${label}`);
};

console.log(`testing ${base}\n`);
const t0 = Date.now();

try {
  console.log('1. websocket upgrade through the proxy');
  const a = new Client('SmokeA', 'smoke-a-' + Date.now());
  await a.connect(null);
  check(a.seat === 0, `connected and seated (room ${a.room})`);
  check(a.ws.readyState === WebSocket.OPEN, 'wss connection is open');

  console.log('\n2. second player joins');
  const b = new Client('SmokeB', 'smoke-b-' + Date.now());
  await b.connect(a.room);
  check(b.seat === 1, 'second player took seat 1');
  a.ws.send(JSON.stringify({ type: 'start' }));
  await waitFor(() => a.state && a.state.phase !== 'lobby', 'game start');
  check(a.state.you.hand.length === 5, 'cards dealt over the wire');

  console.log('\n3. the next hand waits for both players');
  a.autoPlay = b.autoPlay = true;
  a.autoNext = b.autoNext = false;
  a.think(); b.think();
  await waitFor(() => a.state.phase === 'handOver', 'first hand to be scored', 120000);
  const handNo = a.state.handNumber;
  check(Array.isArray(a.state.ready), 'server reports per-player readiness');
  a.ws.send(JSON.stringify({ type: 'action', action: { kind: 'nextHand' } }));
  await sleep(1500);
  check(a.state.phase === 'handOver' && a.state.handNumber === handNo,
    'one player pressing does NOT deal the next hand');
  check((b.state.ready || []).includes(0), 'the other player sees who is ready');
  b.ws.send(JSON.stringify({ type: 'action', action: { kind: 'nextHand' } }));
  await waitFor(() => a.state.handNumber === handNo + 1, 'next hand once both pressed', 20000);
  check(true, 'both pressing deals the next hand');

  if (process.env.SMOKE_QUICK === '1') {
    console.log('\n(quick mode: skipping the full game)');
    a.autoNext = b.autoNext = true;
    console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s elapsed`);
    console.log(failures === 0 ? 'LIVE SMOKE PASSED' : `${failures} FAILURE(S)`);
    a.ws.close(); b.ws.close();
    process.exit(failures === 0 ? 0 : 1);
  }

  console.log('\n4. play a full game to ten');
  a.autoNext = b.autoNext = true;
  console.log('   (real trick pauses, so this takes minutes)');
  a.think(); b.think();

  // Report progress, and fail fast if the game stops advancing rather than
  // burning the whole timeout on a stall.
  let lastSeen = '';
  let stalledFor = 0;
  const progress = setInterval(() => {
    const s = a.state;
    if (!s) return;
    const mark = `${s.handNumber}:${s.score.join('-')}:${s.tricksPlayed}:${s.phase}`;
    if (mark === lastSeen) {
      stalledFor += 5;
      if (stalledFor >= 30) console.log(`   ...no movement for ${stalledFor}s (${s.phase}, turn ${s.turn})`);
    } else {
      stalledFor = 0;
      console.log(`   hand ${s.handNumber}  score ${s.score[0]}-${s.score[1]}  (${s.phase})`);
    }
    lastSeen = mark;
  }, 5000);

  try {
    await waitFor(() => a.state.phase === 'gameOver', 'game to finish', 420000);
  } finally {
    clearInterval(progress);
  }
  check(Math.max(...a.state.score) >= 10, `finished ${a.state.score[0]}-${a.state.score[1]}`);
  check(a.state.score.join() === b.state.score.join(), 'both clients agree on the score');
  check(a.errors.length + b.errors.length === 0,
    `no rule errors (${a.errors.concat(b.errors).slice(0, 2).join('; ')})`);

  console.log('\n5. reconnect against the live host');
  const handBefore = JSON.stringify(a.state.you.hand);
  a.ws.close();
  await sleep(500);
  const again = new Client('SmokeA', a.playerId);
  await again.connect(a.room);
  check(again.seat === 0, 'rejoined the same seat through the proxy');
  await waitFor(() => again.state?.you, 'state resend');
  check(JSON.stringify(again.state.you.hand) === handBefore, 'hand survived the reconnect');

  again.ws.close();
  b.ws.close();
} catch (err) {
  failures++;
  console.error('\nFAIL:', err.message);
}

console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s elapsed`);
console.log(failures === 0 ? 'LIVE SMOKE PASSED' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
