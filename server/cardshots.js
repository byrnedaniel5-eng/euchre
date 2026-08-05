// Renders a sample hand in every card style and suit-colour combination and
// screenshots each, so the looks can be compared side by side instead of
// described. Also asserts each style is visually distinct and legible.
//
//   node server/cardshots.js

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3990;
const CDP_PORT = 9336;
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

const STYLES = ['bold', 'classic', 'jumbo'];
const SUITS = ['classic', 'vivid'];
// A hand that exercises everything: both bowers, a ten, a court card, an ace.
const SAMPLE = ['JS', 'JC', 'TD', 'QH', 'AS'];

const server = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('server never started')), 10000);
  server.stdout.on('data', (d) => {
    if (d.toString().includes('Euchre running')) { clearTimeout(t); res(); }
  });
});

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'euchre-cards-'));
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
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
  return r.result.value;
};
const shot = async (name, clip) => {
  const { data } = await cdp('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  shot  ${name}.png`);
};

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
    { width: 390, height: 300, deviceScaleFactor: 3, mobile: true });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1000);

  // Show just the hand strip against the felt, with a known set of cards.
  await evaluate(`
    document.getElementById('join').hidden = true;
    document.getElementById('game').hidden = false;
    document.getElementById('hud').style.display = 'none';
    document.getElementById('table').style.display = 'none';
    document.getElementById('prompt').style.display = 'none';
    document.getElementById('bid-panel').hidden = true;
    document.getElementById('hand').style.display = 'none';
    const box = document.createElement('div');
    box.id = 'shots';
    box.style.cssText =
      'display:flex;flex-direction:column;align-items:center;gap:18px;padding:26px 0';
    document.getElementById('game').appendChild(box);
    true`);

  for (const suits of SUITS) {
    for (const style of STYLES) {
      // Wrapped in an IIFE: these run repeatedly in one page context, and
      // bare const declarations would collide on the second pass.
      await evaluate(`(() => {
        document.body.dataset.cards = ${JSON.stringify(style)};
        document.body.dataset.suits = ${JSON.stringify(suits)};
        const box = document.getElementById('shots');
        box.innerHTML = '';
        const SYM = { S:'\\u2660', H:'\\u2665', D:'\\u2666', C:'\\u2663' };
        // Top row is the size a card is in your hand, bottom row the size it
        // is once played to the table — both have to stay legible.
        for (const scale of [1.36, 1]) {
          const row = document.createElement('div');
          // The big row really is the hand, so hand-only rules apply to it
          // exactly as they do in a game.
          if (scale > 1.2) row.className = 'hand';
          row.style.cssText = 'display:flex;gap:5px;min-height:0;padding:0';
          for (const c of ${JSON.stringify(SAMPLE)}) {
            const rank = c[0], suit = c[1];
            const label = rank === 'T' ? '10' : rank;
            const el = document.createElement('div');
            el.className = 'card ' + ('HD'.includes(suit) ? 'red ' : '') +
                           ('AKQJ'.includes(rank) ? 'court' : '');
            el.dataset.card = c; el.dataset.suit = suit;
            el.style.setProperty('--cs', scale);
            el.style.animation = 'none';
            const corner = '<span class="cr">' + label + '</span><span class="cs">' + SYM[suit] + '</span>';
            el.innerHTML = '<span class="corner tl">' + corner + '</span>' +
              '<span class="mid"><span class="r">' + label + '</span><span class="s">' + SYM[suit] + '</span></span>' +
              '<span class="corner br">' + corner + '</span>';
            row.appendChild(el);
          }
          box.appendChild(row);
        }
        return true;
      })()`);
      await sleep(200);

      const name = `cards-${style}-${suits}`;
      await shot(name);

      // Something must actually be painted inside every card.
      const ink = await evaluate(`(() => {
        const cards = [...document.querySelectorAll('#shots .card')];
        return cards.every(c => {
          const shown = [...c.querySelectorAll('span')].filter(s => s.offsetWidth > 0);
          return shown.length > 0 && c.innerText.trim().length > 0;
        });
      })()`);
      check(ink, `${style} / ${suits}: every card renders visible markings`);
    }
  }

  // The three styles must actually differ, or the switcher is decoration.
  const fingerprints = {};
  for (const style of STYLES) {
    await evaluate(`document.body.dataset.cards = ${JSON.stringify(style)}; true`);
    await sleep(120);
    fingerprints[style] = await evaluate(`(() => {
      const c = document.querySelector('#shots .card');
      const vis = [...c.querySelectorAll('span')].map(s =>
        s.className + ':' + (s.offsetWidth > 0 ? Math.round(parseFloat(getComputedStyle(s).fontSize)) : 0));
      return vis.join('|');
    })()`);
  }
  const unique = new Set(Object.values(fingerprints));
  check(unique.size === STYLES.length,
    `the ${STYLES.length} styles are visually distinct (${unique.size} unique layouts)`);

  // Four-colour mode must give all four suits different colours.
  await evaluate(`document.body.dataset.suits = 'vivid'; true`);
  await sleep(120);
  const colours = await evaluate(`(() => {
    const out = {};
    for (const s of ['S','H','D','C']) {
      const el = document.createElement('div');
      el.className = 'card'; el.dataset.suit = s;
      document.getElementById('shots').appendChild(el);
      out[s] = getComputedStyle(el).color;
      el.remove();
    }
    return JSON.stringify(out);
  })()`);
  const parsed = JSON.parse(colours);
  check(new Set(Object.values(parsed)).size === 4,
    `four colour mode gives four distinct suit colours`);
  console.log(`        ${colours}`);
} catch (err) {
  failures++;
  console.error('FAIL:', err.message);
} finally {
  chrome.kill();
  server.kill();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* locked */ }
}

console.log(`\nscreenshots in ${SHOT_DIR}`);
console.log(failures === 0 ? 'CARD STYLES OK' : `${failures} PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
