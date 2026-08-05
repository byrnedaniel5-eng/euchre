// Visual check: boots the server, drives a real Chrome as player 1 and a
// scripted socket as player 2, and screenshots the phone-sized UI at each
// stage of a hand. Output lands in the directory given by SHOT_DIR.
//
//   node server/uicheck.js

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3988;
const CDP_PORT = 9333;
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'shots');
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

fs.mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- CDP client

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }

  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    return new CDP(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }

  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(SHOT_DIR, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`  shot  ${name}.png`);
    return file;
  }
}

// --------------------------------------------------------- scripted player

function scriptedPlayer(room, name) {
  const p = { state: null, ws: new WebSocket(`ws://127.0.0.1:${PORT}/ws`), seat: null };
  p.ws.on('open', () =>
    p.ws.send(JSON.stringify({ type: 'join', playerId: 'pid-scripted', name, room })));
  p.ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === 'joined') { p.seat = msg.seat; p.room = msg.room; }
    if (msg.type !== 'state') return;
    p.state = msg.state;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const act = (action) => p.ws.send(JSON.stringify({ type: 'action', action }));
    if (msg.state.phase === 'handOver') {
      // The next hand needs both players; send once per hand, not per update.
      if (p.readyForHand !== msg.state.handNumber) {
        p.readyForHand = msg.state.handNumber;
        setTimeout(() => act({ kind: 'nextHand' }), 600);
      }
      return;
    }
    const a = msg.state.you?.actions;
    if (!a) return;
    // Always pass in bidding so the browser player gets the interesting choices.
    if (a.type === 'bid1') act({ kind: 'bid1', order: !a.canPass });
    else if (a.type === 'bid2') act({ kind: 'bid2', suit: a.canPass ? null : pick(a.suits) });
    else if (a.type === 'discard') act({ kind: 'discard', card: pick(a.cards) });
    else if (a.type === 'play') setTimeout(() => act({ kind: 'play', card: pick(a.cards) }), 300);
  });
  return p;
}

// ------------------------------------------------------------------- run

const server = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server never started')), 10000);
  server.stdout.on('data', (d) => {
    if (d.toString().includes('Euchre running')) { clearTimeout(t); resolve(); }
  });
});
console.log(`server up on ${PORT}`);

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'euchre-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let failures = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

try {
  // Wait for the debugger endpoint.
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const list = await res.json();
      if (list.some((t) => t.type === 'page')) targets = list;
    } catch { /* not up yet */ }
    if (!targets) await sleep(250);
  }
  if (!targets) throw new Error('chrome debugger never appeared');

  const page = targets.find((t) => t.type === 'page');
  const cdp = await CDP.attach(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });

  const consoleErrors = [];
  cdp.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value || a.description).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails.exception?.description || 'exception');
    }
  });

  console.log('\n1. join screen');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1200);
  check(await cdp.eval(`!document.getElementById('join').hidden`), 'join screen is showing');
  check(await cdp.eval(`getComputedStyle(document.body).backgroundImage.includes('gradient')`),
    'stylesheet loaded');
  await cdp.shot('1-join');

  console.log('\n2. create a game');
  await cdp.eval(`
    document.getElementById('name').value = 'Dan';
    document.getElementById('create').click(); true`);
  await sleep(900);
  const code = await cdp.eval(`document.getElementById('room-code').textContent`);
  check(/^[A-Z2-9]{4}$/.test(code), `lobby shows a room code (${code})`);
  await cdp.shot('2-lobby');

  console.log('\n3. partner joins, game starts');
  const p2 = scriptedPlayer(code, 'Sam');
  await sleep(1500);
  check(await cdp.eval(`!document.getElementById('game').hidden`), 'game screen took over');
  check(await cdp.eval(`document.querySelectorAll('#hand .card').length`) === 5,
    'five cards in hand');
  const seatTags = await cdp.eval(
    `[...document.querySelectorAll('.seat .tag')].map(t => t.textContent)`);
  check(seatTags.some((t) => t.includes('You')), `seats labelled (${seatTags.join(' | ')})`);

  // Wait until the browser player is asked to bid.
  for (let i = 0; i < 40; i++) {
    if (await cdp.eval(`!document.getElementById('bid-panel').hidden`)) break;
    await sleep(400);
  }
  check(await cdp.eval(`!document.getElementById('bid-panel').hidden`), 'bidding panel appeared');
  check(await cdp.eval(`!document.getElementById('upcard-area').hidden`), 'upcard is face up');
  await cdp.shot('3-bidding-round1');

  console.log('\n4. order it up');
  await cdp.eval(`document.getElementById('bid-order').click(); true`);
  await sleep(1600);
  const trumpShown = await cdp.eval(
    `document.getElementById('trump-badge').hidden ? null
      : document.querySelector('#trump-badge .t-suit').textContent`);
  check(!!trumpShown, `trump badge shows ${trumpShown}`);
  await cdp.shot('4-trump-set');

  console.log('\n5. play through a trick');
  for (let i = 0; i < 60; i++) {
    const playable = await cdp.eval(`document.querySelectorAll('#hand .card.playable').length`);
    if (playable > 0) break;
    await sleep(400);
  }
  check(await cdp.eval(`document.querySelectorAll('#hand .card.playable').length`) > 0,
    'own cards became tappable on your turn');
  await cdp.shot('5-your-turn');

  await cdp.eval(`document.querySelector('#hand .card.playable').click(); true`);
  await sleep(2600);
  const onTable = await cdp.eval(`document.querySelectorAll('#trick-area .tslot .card').length`);
  check(onTable >= 1, `cards appear on the table (${onTable} showing)`);
  const backs = await cdp.eval(`document.querySelectorAll('.seat .backs i').length`);
  check(backs > 0, `opponents show face-down cards (${backs})`);
  await cdp.shot('6-trick-in-progress');

  console.log('\n6. play out the hand');
  // Keep tapping the first legal card until the hand is scored.
  let sawOverlay = false;
  for (let i = 0; i < 160; i++) {
    await cdp.eval(`
      (() => { const c = document.querySelector('#hand .card.playable');
               if (c) c.click(); return !!c; })()`);
    if (await cdp.eval(`!document.getElementById('overlay').hidden`)) { sawOverlay = true; break; }
    await sleep(400);
  }
  check(sawOverlay, 'hand-result overlay appeared');
  if (sawOverlay) {
    const title = await cdp.eval(`document.getElementById('ov-title').textContent`);
    const body = await cdp.eval(`document.getElementById('ov-body').textContent`);
    console.log(`        "${title}" — ${body}`);
    check(title.length > 0 && body.length > 0, 'overlay explains the result');
    await cdp.shot('7-hand-result');
  }

  console.log('\n7. menu drawer');
  await cdp.eval(`document.getElementById('ov-btn').click(); true`);
  await sleep(600);
  await cdp.eval(`document.getElementById('menu-btn').click(); true`);
  await sleep(400);
  const logLines = await cdp.eval(`document.querySelectorAll('#log div').length`);
  check(logLines > 3, `game log is populated (${logLines} lines)`);
  await cdp.shot('8-drawer');

  console.log('\n8. no layout or script errors');
  const overflow = await cdp.eval(
    `document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check(overflow <= 0, `no horizontal overflow at 390px (${overflow}px)`);
  check(consoleErrors.length === 0, `no console errors (${consoleErrors.slice(0, 2).join('; ')})`);

  p2.ws.close();
} catch (err) {
  failures++;
  console.error('\nFAIL:', err.message);
} finally {
  chrome.kill();
  server.kill();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* locked */ }
}

console.log(`\nscreenshots in ${SHOT_DIR}`);
console.log(failures === 0 ? 'UI CHECK PASSED' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
