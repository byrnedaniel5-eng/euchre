// Drives a real browser through the trap the player hit: start a game, then
// try to get back to the start screen — including surviving a refresh, which
// is what made it feel inescapable.
//
//   node server/leavecheck.js

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3991;
const CDP_PORT = 9337;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

const server = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  env: { ...process.env, PORT: String(PORT), EUCHRE_FAST: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('server never started')), 10000);
  server.stdout.on('data', (d) => {
    if (d.toString().includes('Euchre running')) { clearTimeout(t); res(); }
  });
});

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'euchre-leave-'));
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
const until = async (expr, ms = 15000) => {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await evaluate(expr);
    if (last) return last;
    await sleep(150);
  }
  return last;
};
const onJoinScreen = `!document.getElementById('join').hidden`;
const onLobby = `!document.getElementById('lobby').hidden`;
const onGame = `!document.getElementById('game').hidden`;

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
    }
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride',
    { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const go = async (url) => {
    await cdp('Page.navigate', { url });
    await sleep(900);
  };

  console.log('\n1. start a game, then back out of the lobby');
  await go(`http://127.0.0.1:${PORT}/`);
  check(await evaluate(onJoinScreen), 'starts on the join screen');
  await evaluate(`document.getElementById('name').value = 'Dan';
                  document.getElementById('create').click(); true`);
  check(await until(onLobby), 'reached the waiting-for-opponent lobby');
  const code = await evaluate(`document.getElementById('room-code').textContent`);
  check(await evaluate(`location.search.includes('room=')`), 'the URL now carries the room');

  await evaluate(`document.getElementById('lobby-cancel').click(); true`);
  check(await until(onJoinScreen), 'Cancel returns to the join screen');
  check(await evaluate(`!location.search.includes('room=')`), 'the room is cleared from the URL');

  console.log('\n2. a refresh after leaving stays out');
  await go(`http://127.0.0.1:${PORT}/`);
  check(await evaluate(onJoinScreen), 'refresh lands on the join screen, not back in a room');
  check(!(await evaluate(onLobby)), 'not dragged back to the lobby');

  console.log('\n3. mid-game, leaving works too');
  await evaluate(`document.getElementById('name').value = 'Dan';
                  document.getElementById('create').click(); true`);
  check(await until(onLobby), 'second game created');
  const code2 = await evaluate(`document.getElementById('room-code').textContent`);

  // Second player joins over a socket so a real game starts.
  const p2 = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  await new Promise((r) => p2.once('open', r));
  p2.send(JSON.stringify({ type: 'join', playerId: 'pid-p2', name: 'Sam', room: code2 }));
  check(await until(onGame), 'game started with both players');

  // confirm() would block a headless click, so answer it automatically.
  await evaluate(`window.confirm = () => true; true`);
  await evaluate(`document.getElementById('menu-btn').click(); true`);
  await sleep(200);
  await evaluate(`document.getElementById('leave-game').click(); true`);
  check(await until(onJoinScreen), 'Leave game returns to the join screen mid-hand');
  check(await evaluate(`document.getElementById('drawer').hidden`), 'the menu closed behind it');

  console.log('\n4. and that refresh stays out too');
  await go(`http://127.0.0.1:${PORT}/`);
  check(await evaluate(onJoinScreen), 'still on the join screen after a refresh');

  console.log('\n5. a dead room code does not trap you in a retry loop');
  await evaluate(`localStorage.setItem('euchre.lastRoom',
    JSON.stringify({ code: 'ZZZZ', at: Date.now() })); true`);
  await go(`http://127.0.0.1:${PORT}/`);
  check(await until(onJoinScreen), 'a stale stored room drops you on the join screen');
  check(await until(`!document.getElementById('join-error').hidden`),
    'and says why');
  const cleared = await evaluate(`localStorage.getItem('euchre.lastRoom')`);
  check(cleared === 'null' || cleared === null, 'the dead room is forgotten, so refreshing is clean');

  p2.close();

  console.log('\n6. picking the number of people');
  await go(`http://127.0.0.1:${PORT}/`);
  for (const n of [1, 2, 3, 4]) {
    await evaluate(`document.querySelector('#opt-players button[data-v="${n}"]').click(); true`);
    const on = await evaluate(
      `document.querySelector('#opt-players button.on').dataset.v`);
    const hint = await evaluate(`document.getElementById('players-hint').textContent`);
    check(on === String(n) && hint.length > 0, `${n} selected — "${hint}"`);
  }

  console.log('\n7. a solo game starts with no lobby at all');
  await evaluate(`document.querySelector('#opt-players button[data-v="1"]').click();
                  document.getElementById('name').value = 'Dan';
                  document.getElementById('create').click(); true`);
  check(await until(onGame), 'one player goes straight to the table, skipping the lobby');
  check(!(await evaluate(onLobby)), 'no waiting screen for a solo game');
  const seatNames = await evaluate(
    `[...document.querySelectorAll('.seat .tag')].map(t => t.textContent).join(' | ')`);
  check(await until(`document.querySelectorAll('#hand .card').length === 5`),
    `dealt in against three bots (${seatNames})`);
  await evaluate(`window.confirm = () => true;
                  document.getElementById('menu-btn').click(); true`);
  await sleep(200);
  const conn = await evaluate(`document.getElementById('drawer-conn').textContent`);
  check(/solo/i.test(conn), `the menu says it is a solo game ("${conn}")`);

  console.log('\n8. bot difficulty carries into the game');
  await evaluate(`document.getElementById('leave-game').click(); true`);
  await until(onJoinScreen);
  for (const level of ['easy', 'casual', 'solid']) {
    await evaluate(`document.querySelector('#opt-skill button[data-v="${level}"]').click(); true`);
    const on = await evaluate(`document.querySelector('#opt-skill button.on').dataset.v`);
    check(on === level, `${level} selectable`);
  }
  await evaluate(`document.querySelector('#opt-skill button[data-v="easy"]').click();
                  document.querySelector('#opt-players button[data-v="1"]').click();
                  document.getElementById('create').click(); true`);
  check(await until(onGame), 'solo easy game started');
  await evaluate(`window.confirm = () => true;
                  document.getElementById('menu-btn').click(); true`);
  await sleep(200);
  const meta = await evaluate(`document.getElementById('drawer-conn').textContent`);
  check(/easy/i.test(meta), `the game reports the chosen difficulty ("${meta}")`);

  console.log('\n9. four people hides the difficulty setting');
  await evaluate(`document.getElementById('leave-game').click(); true`);
  await until(onJoinScreen);
  await evaluate(`document.querySelector('#opt-players button[data-v="4"]').click(); true`);
  check(await evaluate(`document.getElementById('difficulty-row').hidden`),
    'no bots, so no difficulty to choose');
  await evaluate(`document.querySelector('#opt-players button[data-v="2"]').click(); true`);
  check(!(await evaluate(`document.getElementById('difficulty-row').hidden`)),
    'it comes back when bots are in play');

  console.log('\n10. a three-person table waits for two more');
  await evaluate(`document.getElementById('leave-game').click(); true`);
  await until(onJoinScreen);
  await evaluate(`document.querySelector('#opt-players button[data-v="3"]').click();
                  document.getElementById('create').click(); true`);
  check(await until(onLobby), 'three-player table shows the lobby');
  const heading = await evaluate(`document.querySelector('#lobby h2').textContent`);
  check(/2 more/.test(heading), `it asks for the right number ("${heading}")`);
} catch (err) {
  failures++;
  console.error('\nFAIL:', err.message);
} finally {
  chrome.kill();
  server.kill();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* locked */ }
}

console.log(failures === 0 ? '\nLEAVE FLOW OK' : `\n${failures} PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
