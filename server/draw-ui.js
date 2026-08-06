// Drives the drawing game in a real browser: picks a word, draws on the
// canvas with synthetic pointer events, and checks the ink actually reaches
// the second player. Screenshots both sides.
//
//   node server/draw-ui.js

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3993;
const CDP_PORT = 9338;
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
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('server never started')), 10000);
  server.stdout.on('data', (d) => {
    if (d.toString().includes('running')) { clearTimeout(t); res(); }
  });
});

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'euchre-draw-'));
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
const until = async (expr, ms = 20000) => {
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

/** The second player, over a plain socket, so we can see what the browser sends. */
function socketPlayer(room, name, onMsg) {
  const p = { ink: [], state: null, seat: null, guesses: [] };
  p.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  p.ws.on('open', () => p.ws.send(JSON.stringify({
    type: 'join', playerId: 'pid-ui-p2', name, room, game: 'draw', players: 2,
  })));
  p.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'joined') { p.seat = m.seat; p.room = m.room; }
    else if (m.type === 'state') p.state = m.state;
    else if (m.type === 'ink') p.ink.push(m);
    else if (m.type === 'guess') p.guesses.push(m.entry);
    onMsg?.(m);
  });
  p.act = (action) => p.ws.send(JSON.stringify({ type: 'action', action }));
  return p;
}

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
  const consoleErrors = [];
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
  await sleep(1200);

  console.log('\n1. the home screen lists both games');
  check(await until(`document.querySelectorAll('#game-list .game-card').length >= 2`),
    'two games offered');
  const names = await evaluate(
    `[...document.querySelectorAll('#game-list .game-card b')].map(b => b.textContent).join(', ')`);
  console.log(`        ${names}`);
  await shot('draw-1-home');

  console.log('\n2. start a drawing game');
  await evaluate(`document.getElementById('name').value = 'Ann';
                  document.querySelector('[data-game="draw"]').click(); true`);
  check(await until(`!document.getElementById('setup').hidden`),
    'picking a game opens its setup screen');
  check(await evaluate(`document.getElementById('setup-name').textContent`) === 'Draw It',
    'the setup screen names the game');
  check(await evaluate(`document.body.dataset.theme`) === 'draw',
    'and switches to the drawing game look');
  check(await evaluate(`document.getElementById('game-options').textContent.includes('Turns')`),
    'its options come from the server');
  await shot('draw-2-setup');

  await evaluate(`document.getElementById('create').click(); true`);
  check(await until(`!document.getElementById('lobby').hidden`), 'lobby, waiting for one more');
  const code = await evaluate(`document.getElementById('room-code').textContent`);

  const p2 = socketPlayer(code, 'Ben');
  check(await until(`!document.getElementById('game-draw').hidden`), 'the drawing screen opens');
  check(await evaluate(`document.getElementById('game-euchre').hidden`),
    'the euchre screen stays hidden');

  console.log('\n3. picking a word');
  const browserDraws = await until(`
    (window.__s = null, true) &&
    !document.getElementById('choose-panel').hidden`, 4000);
  if (browserDraws) {
    check(true, 'the browser player is drawing and gets three words');
    await shot('draw-3-choose');
    await evaluate(`document.querySelector('#choose-words .word-btn').click(); true`);
  } else {
    // The socket player drew first; let it pick so the browser is the guesser.
    check(true, 'the socket player is drawing this turn');
    await sleep(200);
    if (p2.state?.choices) p2.act({ kind: 'choose', word: p2.state.choices[0] });
  }
  check(await until(`document.getElementById('draw-clock').textContent !== '–'`),
    'the clock is running');

  console.log('\n4. drawing on the canvas reaches the other player');
  const amDrawing = await evaluate(`!document.getElementById('tools').hidden`);
  if (amDrawing) {
    const inkBefore = p2.ink.length;
    // Synthetic pointer events across the board, as a finger would.
    const box = await evaluate(`(() => {
      const r = document.getElementById('board').getBoundingClientRect();
      return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
    })()`);
    const b = JSON.parse(box);
    const pt = (fx, fy) => ({ x: Math.round(b.x + b.w * fx), y: Math.round(b.y + b.h * fy) });
    const send = (type, p) => cdp('Input.dispatchMouseEvent', {
      type, x: p.x, y: p.y, button: 'left', clickCount: 1, pointerType: 'mouse',
    });
    await send('mousePressed', pt(0.2, 0.3));
    for (let i = 1; i <= 12; i++) await send('mouseMoved', pt(0.2 + i * 0.05, 0.3 + i * 0.03));
    await send('mouseReleased', pt(0.8, 0.66));
    await sleep(400);

    check(p2.ink.length > inkBefore, `strokes reached the other player (${p2.ink.length - inkBefore} messages)`);
    const pts = p2.ink.filter((m) => m.op === 'add')
      .reduce((n, m) => n + m.stroke.points.length, 0);
    check(pts > 3, `the line arrived as ${pts} points`);
    const painted = await evaluate(`(() => {
      const c = document.getElementById('board');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 200 && d[i + 3] > 0) ink++;
      return ink;
    })()`);
    check(painted > 200, `the canvas actually has ink on it (${painted} dark pixels)`);
    await shot('draw-4-drawing');

    console.log('\n4b. the drawing survives losing the connection');
    const inkPixels = `(() => {
      const c = document.getElementById('board');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 200 && d[i + 3] > 0) n++;
      return n;
    })()`;
    const beforeDrop = await evaluate(inkPixels);

    // A phone whose screen turns off loses its socket and rejoins from
    // scratch: join, board replay, first state. A reload takes exactly that
    // path, and does it deterministically.
    await cdp('Page.reload', {});
    await sleep(1400);
    const back = await until(`!document.getElementById('game-draw').hidden`, 20000);
    check(back, 'rejoined the game after the connection was lost');
    await sleep(700);
    const afterDrop = await evaluate(inkPixels);
    check(afterDrop > beforeDrop * 0.8,
      `the drawing is still there (${beforeDrop} px before, ${afterDrop} after)`);
    await shot('draw-4b-after-reconnect');

    console.log('\n5. the guesser gets it');
    const word = await evaluate(`document.getElementById('draw-word').textContent`);
    p2.act({ kind: 'guess', text: 'not that' });
    await sleep(200);
    check(await until(`document.getElementById('guess-feed') !== null`), 'guess feed exists');
    p2.act({ kind: 'guess', text: word });
    check(await until(`!document.getElementById('overlay').hidden`), 'the reveal overlay appears');
    const title = await evaluate(`document.getElementById('ov-title').textContent`);
    const body = await evaluate(`document.getElementById('ov-body').textContent`);
    console.log(`        "${title}" — ${body}`);
    check(body.includes(word), 'the overlay names the word');
    await shot('draw-5-reveal');
  } else {
    console.log('\n5. guessing from the browser side');
    check(await until(`!document.getElementById('guess-area').hidden`), 'the guess box is shown');
    check(await evaluate(`document.getElementById('draw-word').className.includes('masked')`),
      'the word is masked for the guesser');
    await shot('draw-4-guessing');
    const word = p2.state.word;
    await evaluate(`(() => {
      const i = document.getElementById('guess-input');
      i.value = ${JSON.stringify(word)};
      document.getElementById('guess-form').dispatchEvent(new Event('submit', { cancelable: true }));
    })()`);
    check(await until(`!document.getElementById('overlay').hidden`), 'the reveal overlay appears');
    await shot('draw-5-reveal');
  }

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
console.log(failures === 0 ? 'DRAW UI OK' : `${failures} PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
