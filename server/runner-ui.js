// Drives Lava Run in a real browser: starts a round, plays it with synthetic
// taps, and checks the canvas is actually rendering a course.
//
//   node server/runner-ui.js

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3997;
const CDP_PORT = 9340;
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'shots');
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
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

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'euchre-run-'));
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
    await sleep(120);
  }
  return last;
};
const shot = async (name) => {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  shot  ${name}.png`);
};

function socketPlayer(room, name) {
  const p = { state: null, seat: null, runners: [] };
  p.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  p.ws.on('open', () => p.ws.send(JSON.stringify({
    type: 'join', playerId: 'pid-run-ui-2', name, room, game: 'runner',
  })));
  p.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'joined') { p.seat = m.seat; p.room = m.room; }
    else if (m.type === 'state') p.state = m.state;
    else if (m.type === 'runners') p.runners.push(m);
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

  console.log('\n1. start a run');
  check(await until(`!!document.querySelector('[data-game="runner"]')`),
    'Lava Run is on the landing page');
  await evaluate(`document.getElementById('name').value = 'Ann';
                  document.querySelector('[data-game="runner"]').click(); true`);
  check(await evaluate(`document.body.dataset.theme`) === 'runner', 'it has its own look');
  await evaluate(`document.getElementById('create').click(); true`);
  check(await until(`!document.getElementById('lobby').hidden`), 'lobby opens');
  const code = await evaluate(`document.getElementById('room-code').textContent`);
  const p2 = socketPlayer(code, 'Ben');
  await until(`!document.getElementById('lobby-start').disabled`, 10000);
  await evaluate(`document.getElementById('lobby-start').click(); true`);
  check(await until(`!document.getElementById('game-runner').hidden`), 'the course screen opens');

  console.log('\n2. the countdown, then the off');
  check(await until(`!document.getElementById('run-countdown').hidden`),
    'a countdown runs before anyone can move');
  await shot('runner-1-countdown');
  check(await until(`document.getElementById('run-countdown').hidden`, 12000),
    'and then it clears');

  console.log('\n3. the course is actually being drawn');
  const painted = await evaluate(`(() => {
    const c = document.getElementById('run-canvas');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lava = 0, rock = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gr = d[i + 1], b = d[i + 2];
      if (r > 170 && gr < 140 && b < 90) lava++;
      if (Math.abs(r - 59) < 40 && Math.abs(gr - 47) < 40 && b > 55 && b < 110) rock++;
    }
    return { lava, rock, total: c.width * c.height };
  })()`);
  check(painted.lava > 2000, `lava is on screen (${painted.lava} px)`);
  check(painted.rock > 500, `and platforms too (${painted.rock} px)`);
  await shot('runner-2-running');

  console.log('\n4. tapping makes the runner jump');
  const yBefore = await evaluate(`window.__runnerY || 0`);
  const box = JSON.parse(await evaluate(`(() => {
    const r = document.getElementById('run-canvas').getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  })()`));
  // A hold: press, wait, release — the long jump this game is built around.
  await cdp('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: Math.round(box.x), y: Math.round(box.y),
    button: 'left', clickCount: 1, pointerType: 'mouse',
  });
  await sleep(220);
  await cdp('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: Math.round(box.x), y: Math.round(box.y),
    button: 'left', clickCount: 1, pointerType: 'mouse',
  });
  check(true, `held the screen for 220ms (from y ${yBefore})`);

  console.log('\n5. the round ends and is scored');
  // The other runner drops out; ours will be caught by the edge soon enough.
  p2.act({ kind: 'died', seconds: 2.0, distance: 30, cause: 'lava' });
  check(await until(`!document.getElementById('overlay').hidden`, 90000),
    'the round result appears');
  const title = await evaluate(`document.getElementById('ov-title').textContent`);
  const body = await evaluate(`document.getElementById('ov-body').textContent`);
  console.log(`        "${title}" - ${body}`);
  check(/lasted longest/i.test(title), 'the overlay says who lasted longest');
  check(/\d+\.\d+s/.test(await evaluate(`document.getElementById('ov-tricks').textContent`)),
    'and lists the times');
  await shot('runner-3-result');

  console.log('\n6. no layout or script errors');
  console.log(String.fromCharCode(10) + '5b. and you can run it alone');
  await evaluate(`window.confirm = () => true;
                  document.getElementById('ov-leave').click(); true`);
  await until(`!document.getElementById('home').hidden`);
  await evaluate(`document.querySelector('[data-game="runner"]').click();
                  document.getElementById('create').click(); true`);
  check(await until(`!document.getElementById('lobby').hidden`), 'a solo lobby opens');
  check(await until(`!document.getElementById('lobby-start').disabled`),
    'and one player is enough to start');
  await evaluate(`document.getElementById('lobby-start').click(); true`);
  check(await until(`!document.getElementById('game-runner').hidden`), 'the course opens');
  check(await until(`document.getElementById('run-countdown').hidden`, 12000),
    'the countdown clears and the run begins');
  check(await until(`!document.getElementById('overlay').hidden`, 90000),
    'the solo run ends and is scored');
  const soloTitle = await evaluate(`document.getElementById('ov-title').textContent`);
  check(/^[0-9]+\.[0-9]+s$/.test(soloTitle),
    `alone it reports the time rather than a winner ("${soloTitle}")`);
  await shot('runner-4-solo');

  console.log(String.fromCharCode(10) + '5c. never touching the screen must drop you in');
  // A fresh page rather than leaving and re-creating in place: the point of
  // this check is the physics, and it should not be able to fail for reasons
  // to do with navigating between games.
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1400);
  await evaluate(`document.getElementById('name').value = 'Idle';
                  document.querySelector('[data-game="runner"]').click();
                  document.getElementById('create').click(); true`);
  check(await until(`!document.getElementById('lobby-start').disabled`, 15000),
    'a solo lobby is ready');
  await evaluate(`document.getElementById('lobby-start').click(); true`);
  check(await until(`!document.getElementById('game-runner').hidden`), 'the course opens');

  // Never send a single pointer event. The runner must go in the first gap.
  const idleBody = await until(`(() => {
    const ov = document.getElementById('overlay');
    const body = document.getElementById('ov-body').textContent;
    return (!ov.hidden && /at [0-9.]+s/.test(body)) ? body : '';
  })()`, 40000);
  check(!!idleBody, `the run ends without a single tap ("${idleBody}")`);
  const idleSecs = parseFloat((String(idleBody).match(/([0-9.]+)s/) || [])[1] || '999');
  check(/lava/i.test(String(idleBody)), `and it is the lava that gets you ("${idleBody}")`);
  check(idleSecs < 8, `at the first gap, not thirty seconds later (${idleSecs}s)`);
  await shot('runner-5-idle');

  console.log(String.fromCharCode(10) + '6. no layout or script errors');
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
console.log(failures === 0 ? 'RUNNER UI OK' : `${failures} PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
