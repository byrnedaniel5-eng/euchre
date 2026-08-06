// Focused check on the seat name tag. It carries the player's name plus a
// dealer badge, a maker badge and one dot per trick taken — and it is
// width-capped, so the combinations have to be measured, not eyeballed.
//
//   node server/tagcheck.js

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3989;
const CDP_PORT = 9335;
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

// Same shapes app.js builds, worst case first.
const CASES = [
  { label: 'name only',                    name: 'Robo', d: false, maker: null,   pips: 0 },
  { label: 'dealer',                       name: 'Robo', d: true,  maker: null,   pips: 0 },
  { label: 'maker + 3 tricks',             name: 'Robo', d: false, maker: 'MAKER', pips: 3 },
  { label: 'dealer + maker',               name: 'Robo', d: true,  maker: 'MAKER', pips: 0 },
  { label: 'dealer + maker + 3 tricks',    name: 'Robo', d: true,  maker: 'MAKER', pips: 3 },
  { label: 'dealer + alone + 5 tricks',    name: 'Robo', d: true,  maker: 'ALONE', pips: 5 },
  { label: 'long name + dealer + maker',   name: 'Samantha', d: true, maker: 'MAKER', pips: 3 },
];

const buildTag = (c) =>
  `<span>${c.name}</span>` + (c.d ? '<span class="badge">D</span>' : '');

const buildMarks = (c) => {
  const bits = [];
  if (c.maker) bits.push(`<span class="badge">${c.maker}</span>`);
  if (c.pips) bits.push(`<span class="pips">${'\u25cf'.repeat(c.pips)}</span>`);
  return bits.join('');
};

const server = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('server never started')), 10000);
  server.stdout.on('data', (d) => { if (d.toString().includes('Euchre running')) { clearTimeout(t); res(); } });
});

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'euchre-tag-'));
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
  await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1000);

  // Reveal the table so real styles apply, then measure each tag shape.
  await evaluate(`
    document.getElementById('home').hidden = true;
    document.getElementById('game-euchre').hidden = false;
    document.body.dataset.theme = 'euchre'; true`);

  // Every case is measured in the tightest seat (a side seat, whose column
  // sits next to the trick pile) as well as the roomy top seat — and at the
  // narrowest phone worth supporting as well as a normal one.
  const WIDTHS = [
    { w: 360, h: 640, label: 'small android' },
    { w: 390, h: 844, label: 'iPhone' },
  ];
  for (const { w, h, label } of WIDTHS) {
  await cdp('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await sleep(150);
  for (const where of ['top', 'left']) {
    console.log(`\nseat "${where}" at ${w}px (${label}):\n`);
    for (const c of CASES) {
      const r = await evaluate(`(() => {
        const seat = document.querySelector('.seat.${where}');
        const tag = seat.querySelector('.tag');
        const marks = seat.querySelector('.marks');
        tag.className = 'tag';
        marks.className = 'marks';
        tag.innerHTML = ${JSON.stringify(buildTag(c))};
        marks.innerHTML = ${JSON.stringify(buildMarks(c))};

        const clip = (el) => el.scrollWidth - el.clientWidth;
        const visible = (sel) => {
          const el = seat.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return false;
          // Must also sit inside the table, not spill off the screen.
          const t = document.getElementById('table').getBoundingClientRect();
          return r.left >= t.left - 0.5 && r.right <= t.right + 0.5;
        };
        const seatBox = seat.getBoundingClientRect();
        const trick = document.getElementById('trick-area').getBoundingClientRect();
        const overlapsTrick = seatBox.right > trick.left + 0.5 &&
                              seatBox.left < trick.right - 0.5 &&
                              seatBox.bottom > trick.top + 0.5 &&
                              seatBox.top < trick.bottom - 0.5;
        return {
          tagClip: clip(tag), marksClip: clip(marks),
          pips: visible('.pips'), badge: visible('.badge'),
          overlapsTrick, width: Math.round(seatBox.width),
        };
      })()`);

      const problems = [];
      if (r.tagClip > 0) problems.push(`name clipped ${r.tagClip}px`);
      if (r.marksClip > 0) problems.push(`marks clipped ${r.marksClip}px`);
      if (r.pips === false) problems.push('trick dots not visible');
      if (r.badge === false) problems.push('badge not visible');
      if (r.overlapsTrick) problems.push('overlaps the trick pile');

      check(problems.length === 0,
        `${c.label.padEnd(30)} ${String(r.width).padStart(3)}px wide` +
        (problems.length ? ` — ${problems.join(', ')}` : ''));
    }
  }
  }
} catch (err) {
  failures++;
  console.error('FAIL:', err.message);
} finally {
  chrome.kill();
  server.kill();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* locked */ }
}

console.log(failures === 0 ? '\nTAG LAYOUT OK' : `\n${failures} PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
