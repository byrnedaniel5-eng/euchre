// Drives Battleships in a real browser: picks it off the landing page, lays a
// fleet out by tapping, fires a shot, and checks the fog holds in the DOM as
// well as in the state.
//
//   node server/battleship-ui.js
//
// The interesting check is the last one. It is not enough that the server keeps
// the other fleet out of the state — nothing may render it either, and the only
// way to be sure is to go and look at the squares on the page.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3999;
const CDP_PORT = 9341;
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

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'euchre-bs-'));
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

/** Tap a square on a grid by its cell number. */
const tap = (grid, cell) =>
  evaluate(`document.querySelector('#${grid} [data-cell="${cell}"]').click(); true`);

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

  console.log('\n1. pick it off the landing page');
  check(await until(`!!document.querySelector('[data-game="battleship"]')`),
    'Battleships is listed');
  await evaluate(`document.getElementById('name').value = 'Ann';
                  document.querySelector('[data-game="battleship"]').click(); true`);
  check(await until(`!document.getElementById('setup').hidden`), 'its setup screen opens');
  check(await evaluate(`document.body.dataset.theme`) === 'battleship',
    'and it has a look of its own');
  check(await evaluate(
    `document.getElementById('game-options').textContent.includes('After a hit')`),
    'both options come through from the server');
  await shot('bs-1-setup');

  await evaluate(`document.getElementById('create').click(); true`);
  check(await until(`!document.getElementById('lobby').hidden`), 'the lobby appears');
  check(await evaluate(
    `/1 bot|and 1 bot/i.test(document.getElementById('lobby-start').textContent)`),
    'on your own it offers to fill the other seat with a bot');
  await evaluate(`document.getElementById('lobby-start').click(); true`);
  check(await until(`!document.getElementById('game-battleship').hidden`), 'the game screen opens');

  console.log('\n2. laying the fleet out');
  check(await until(`!document.getElementById('bs-place').hidden`), 'setup pane is showing');
  check(await evaluate(`document.querySelectorAll('#bs-own-grid .bs-c').length`) === 100,
    'a hundred squares');
  check(await evaluate(`document.querySelectorAll('#bs-own-grid .bs-lab').length`) === 21,
    'with letters and numbers down the sides to call shots by');
  check(await evaluate(`document.querySelectorAll('#bs-tray .bs-ship').length`) === 5,
    'five ships in the tray');
  check(await evaluate(`document.getElementById('bs-ready').disabled`),
    'and Ready is refused until they are all at sea');
  await shot('bs-2-empty');

  // Tap the carrier down at A1, then check it actually occupies five squares.
  await tap('bs-own-grid', 0);
  check(await until(`document.querySelectorAll('#bs-own-grid .bs-c.ship').length === 5`),
    'tapping the grid drops the carrier across five squares');
  check(await evaluate(
    `document.querySelector('#bs-tray [data-ship="carrier"]').classList.contains('placed')`),
    'and the tray marks it as placed');

  check(await evaluate(
    `document.querySelector('#bs-tray [data-ship="battleship"]').classList.contains('picked')`),
    'the highlight moves on to the next ship, so you can keep tapping');

  // Rotate acts on the highlighted ship, so pick the carrier back up first —
  // that is the gesture, and the hint on screen now says so.
  await tap('bs-own-grid', 0);
  check(await until(`/carrier/i.test(document.getElementById('bs-place-hint').textContent)`),
    'tapping a placed ship picks it up again, and the hint names it');
  await evaluate(`document.getElementById('bs-rotate').click(); true`);
  check(await until(`(() => {
    const on = [...document.querySelectorAll('#bs-own-grid .bs-c.ship')]
      .map(el => +el.dataset.cell);
    return on.length === 5 && on.every((c, i) => c === on[0] + i * 10);
  })()`), 'rotating turns it where it stands, into a column');
  await shot('bs-3-placing');

  await evaluate(`document.getElementById('bs-random').click(); true`);
  check(await until(`document.querySelectorAll('#bs-own-grid .bs-c.ship').length === 17`),
    'Random lays out all seventeen squares at once');
  check(await until(`!document.getElementById('bs-ready').disabled`), 'Ready comes alive');
  await shot('bs-4-fleet-ready');

  await evaluate(`document.getElementById('bs-ready').click(); true`);
  check(await until(`!document.getElementById('bs-play').hidden`), 'the shooting pane opens');

  console.log('\n3. firing');
  check(await evaluate(`document.querySelectorAll('#bs-enemy-grid .bs-c').length`) === 100,
    'the enemy waters are drawn');
  check(await evaluate(`document.querySelectorAll('#bs-mini-grid .bs-c.ship').length`) === 17,
    'your own fleet sits below it, so you can see what is being shot at');

  // Wait for our turn — the bot may have won the toss.
  check(await until(`/your shot/i.test(document.getElementById('bs-turn').textContent)`, 20000),
    'the turn comes round');
  check(await evaluate(`document.getElementById('bs-fire').disabled`),
    'Fire is dead until something is lined up');
  await tap('bs-enemy-grid', 44);
  check(await until(`document.querySelector('#bs-enemy-grid [data-cell="44"]')
    .classList.contains('aim')`), 'tapping a square lines it up');
  check(await until(`/Fire at E5/.test(document.getElementById('bs-fire').textContent)`),
    'and the button names the square it will fire at');
  await shot('bs-5-aimed');

  await evaluate(`document.getElementById('bs-fire').click(); true`);
  check(await until(`!!document.querySelector('#bs-enemy-grid [data-cell="44"]')
    .className.match(/hit|miss|sunk/)`), 'firing marks the square');
  check(await until(`!document.getElementById('bs-shout').hidden`),
    'and it is announced in words');
  const shout = await evaluate(`document.getElementById('bs-shout').textContent`);
  console.log(`        "${shout.trim()}"`);
  await shot('bs-6-fired');

  console.log('\n4. the fog holds on the page, not just in the state');
  // Nothing on the enemy grid may be marked as a ship. A hit is a hit; a ship
  // is where a ship *is*, and that is the thing that must never be drawn.
  check(await evaluate(`document.querySelectorAll('#bs-enemy-grid .bs-c.ship').length`) === 0,
    'no square of the enemy grid is drawn as a ship');
  const painted = await evaluate(`(() => {
    const cells = [...document.querySelectorAll('#bs-enemy-grid .bs-c')];
    const looks = cells.map(c => getComputedStyle(c).backgroundColor);
    return new Set(looks).size;
  })()`);
  check(painted <= 3,
    `the untouched squares all look identical — no shading gives a ship away (${painted} shades)`);

  console.log('\n5. the way out and the layout');
  await evaluate(`window.confirm = () => true;
                  document.querySelector('#game-battleship .menu-btn').click(); true`);
  await sleep(250);
  await evaluate(`document.getElementById('leave-game').click(); true`);
  check(await until(`!document.getElementById('home').hidden`), 'you can leave mid-game');

  const overflow = await evaluate(
    `document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  check(overflow <= 0, `no horizontal overflow at 390px (${overflow}px)`);
  check(consoleErrors.length === 0, `no console errors (${consoleErrors.slice(0, 2).join('; ')})`);
} catch (err) {
  failures++;
  console.error('\nFAIL:', err.message);
} finally {
  chrome.kill();
  server.kill();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* locked */ }
}

console.log(`\nscreenshots in ${SHOT_DIR}`);
console.log(failures === 0 ? 'BATTLESHIP UI OK' : `${failures} PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
