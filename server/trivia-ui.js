// Drives the trivia game in a real browser: picks it from the landing page,
// watches the wheel spin, answers a question and checks the reveal.
//
//   node server/trivia-ui.js

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3995;
const CDP_PORT = 9339;
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'shots');
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

fs.mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

const server = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverErrors = [];
server.stderr.on('data', (d) => serverErrors.push(d.toString()));
await new Promise((res, rej) => {
  const t = setTimeout(
    () => rej(new Error(`server never started: ${serverErrors.join('')}`)), 12000);
  server.stdout.on('data', (d) => {
    if (d.toString().includes('running')) { clearTimeout(t); res(); }
  });
});

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'euchre-tv-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--hide-scrollbars', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
  'about:blank'], { stdio: 'ignore' });

let id = 0;
const pending = new Map();
let ws;
const cdp = (method, params = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((resolve, reject) => pending.set(mid, { resolve, reject }));
};
const evaluate = async (expression) => {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
  return r.result.value;
};
const until = async (expr, ms = 25000) => {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await evaluate(expr);
    if (last) return last;
    await sleep(150);
  }
  return last;
};
const shot = async (name) => {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  shot  ${name}.png`);
};

/** The second player, over a plain socket. */
function socketPlayer(room, name) {
  const p = { state: null, seat: null };
  p.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  p.ws.on('open', () => p.ws.send(JSON.stringify({
    type: 'join', playerId: 'pid-tv-ui-2', name, room, game: 'trivia', players: 2,
  })));
  p.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'joined') { p.seat = m.seat; p.room = m.room; }
    else if (m.type === 'state') p.state = m.state;
  });
  p.act = (action) => p.ws.send(JSON.stringify({ type: 'action', action }));
  return p;
}

const consoleErrors = [];

try {
  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = list.find((t) => t.type === 'page');
    } catch { /* not up */ }
    if (!page) await sleep(250);
  }
  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value || a.description).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails.exception?.description || 'exception');
    }
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride',
    { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1300);

  console.log('\n1. pick the quiz from the landing page');
  check(await until(`!!document.querySelector('[data-game="trivia"]')`),
    'the quiz is listed on the landing page');
  await evaluate(`document.getElementById('name').value = 'Ann';
                  document.querySelector('[data-game="trivia"]').click(); true`);
  check(await until(`!document.getElementById('setup').hidden`), 'its setup screen opens');
  check(await evaluate(`document.body.dataset.theme`) === 'trivia', 'and it has its own look');
  check(await evaluate(`document.getElementById('game-options').textContent.includes('Questions')`),
    'the question-count option comes from the server');
  await shot('trivia-1-setup');

  await evaluate(`document.getElementById('create').click(); true`);
  check(await until(`!document.getElementById('lobby').hidden`), 'lobby appears');
  const code = await evaluate(`document.getElementById('room-code').textContent`);
  const p2 = socketPlayer(code, 'Ben');
  await until(`!document.getElementById('lobby-start').disabled`, 10000);
  await evaluate(`document.getElementById('lobby-start').click(); true`);
  check(await until(`!document.getElementById('game-trivia').hidden`), 'the quiz screen opens');

  console.log('\n2. the wheel waits for you to tap it');
  const painted = await evaluate(
    `document.getElementById('wheel').style.background.includes('conic-gradient')`);
  check(painted, 'the wheel is painted from the category list');
  check(await until(`document.getElementById('wheel').classList.contains('tappable')`),
    'it is your spin, so the wheel is tappable');
  check(await evaluate(`/your spin/i.test(document.getElementById('wheel-label').textContent)`),
    'and it says so');
  check(await evaluate(`document.getElementById('tv-category').textContent === ''`),
    'the category is not given away before the spin');
  await shot('trivia-2-wheel-ready');

  const before = await evaluate(`document.getElementById('wheel').style.transform`);
  await evaluate(`document.getElementById('wheel-stage').click(); true`);
  check(await until(`document.getElementById('wheel').style.transform !== '${before}'`),
    'tapping the wheel spins it');
  const spun = await evaluate(`document.getElementById('wheel').style.transform`);
  check(/rotate\([-0-9.]+deg\)/.test(spun || ''), `it rotated (${spun})`);
  await shot('trivia-3-spinning');

  console.log('\n3. the question arrives');
  check(await until(`!document.getElementById('tv-question').hidden`, 25000),
    'the question panel replaces the wheel');
  check(await evaluate(`document.querySelectorAll('#tv-options button').length`) === 4,
    'four options offered');
  const qText = await evaluate(`document.getElementById('tv-text').textContent`);
  check(qText.length > 5, `question shown ("${qText.slice(0, 46)}...")`);
  const shownCat = await evaluate(`document.getElementById('tv-category').textContent`);
  check(shownCat.length > 0, `the category is named (${shownCat})`);
  check(await evaluate(`document.getElementById('tv-worth').textContent.includes('pts')`),
    'and it shows what answering now is worth');
  await shot('trivia-4-question');

  console.log('\n4. answering locks in');
  await evaluate(`document.querySelector('#tv-options button').click(); true`);
  check(await until(`document.querySelectorAll('#tv-options button:disabled').length === 4`),
    'the options lock once you answer');
  check(await until(`/waiting|locked/i.test(document.getElementById('tv-status').textContent)`),
    'and it says it is waiting for the other player');
  await shot('trivia-5-locked');

  await sleep(200);
  p2.act({ kind: 'answer', choice: 1 });
  check(await until(`!document.getElementById('overlay').hidden`, 20000),
    'the reveal overlay appears');
  const title = await evaluate(`document.getElementById('ov-title').textContent`);
  const body = await evaluate(`document.getElementById('ov-body').textContent`);
  console.log(`        "${title}" - ${body}`);
  check(/answer:/i.test(body), 'the overlay names the correct answer');
  check(await evaluate(`document.querySelectorAll('#tv-options button.right').length === 1`),
    'the right option is highlighted behind it');
  await shot('trivia-5-reveal');

  console.log('\n4b. moving on takes both of you');
  check(await evaluate(`!document.getElementById('ov-btn').hidden`),
    'the reveal offers a next-question button');
  check(await evaluate(`/next question|see the result/i.test(
    document.getElementById('ov-btn').textContent)`), 'labelled for what comes next');
  check(await evaluate(`document.getElementById('ov-leave').offsetHeight > 0`),
    'and still carries a way out from under it');

  await evaluate(`document.getElementById('ov-btn').click(); true`);
  check(await until(`document.getElementById('ov-btn').disabled`),
    'pressing it waits rather than advancing on its own');
  check(await until(`/waiting/i.test(document.getElementById('ov-btn').textContent)`),
    'and says who it is waiting for');

  p2.act({ kind: 'nextQuestion' });
  check(await until(`document.getElementById('overlay').hidden`, 15000),
    'once both have pressed, the reveal clears');
  check(await until(`!document.getElementById('wheel-stage').hidden`),
    'and the wheel comes back round');
  const segs = await evaluate(`document.querySelectorAll('#wheel .wseg i').length`);
  check(segs === 8, `every wheel segment carries an icon (${segs})`);
  check(await evaluate(`document.getElementById('tv-category').textContent === ''`),
    'and the last question category is not left hanging over an unspun wheel');
  await shot('trivia-6-back-to-wheel');

  console.log('\n5. you can leave from the overlay');
  await evaluate(`window.confirm = () => true;
                  document.querySelector('#game-trivia .menu-btn').click(); true`);
  await sleep(200);
  await evaluate(`document.getElementById('leave-game').click(); true`);
  check(await until(`!document.getElementById('home').hidden`), 'back to the landing page');

  console.log('\n6. no layout or script errors');
  const overflow = await evaluate(
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
console.log(failures === 0 ? 'TRIVIA UI OK' : `${failures} PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
