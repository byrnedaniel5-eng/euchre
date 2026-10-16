// What every newer end-to-end suite needs: an assert that counts, a real
// server on its own port in fast mode, and a socket client that behaves like a
// phone. The older suites each carry their own copy of this; new ones share.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
export const assert = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};
export const section = (title) => console.log(`\n${title}`);

/** Print the verdict and exit with it. */
export function finish(label) {
  console.log(failures ? `\n${failures} FAILURE(S)` : `\n${label} PASSED`);
  process.exit(failures ? 1 : 0);
}

export async function waitFor(fn, label, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Boot the real server in fast mode. Returns { url, errors, stop }. */
export async function bootServer(port, env = {}) {
  const server = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: { ...process.env, PORT: String(port), EUCHRE_FAST: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const errors = [];
  server.stderr.on('data', (d) => errors.push(d.toString()));
  let log = '';
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`server never started: ${errors.join('')}`)), 10000);
    server.stdout.on('data', (d) => {
      log += d.toString();
      if (log.includes('running on http')) { clearTimeout(t); res(); }
    });
    server.on('exit', (code) => { clearTimeout(t); rej(new Error(`server exited ${code}: ${errors.join('')}`)); });
  });
  server.removeAllListeners('exit');
  return {
    url: `ws://127.0.0.1:${port}/ws`,
    http: `http://127.0.0.1:${port}`,
    errors,
    stop: () => server.kill(),
  };
}

export class Client {
  constructor(url, name, playerId = `pid-${name}-${Math.random().toString(36).slice(2, 8)}`) {
    this.url = url;
    this.name = name;
    this.playerId = playerId;
    this.state = null;
    this.errors = [];
    this.messages = [];
  }

  connect(room, { game, options } = {}) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      const t = setTimeout(() => reject(new Error(`${this.name} never joined`)), 8000);
      this.ws.on('open', () => this.ws.send(JSON.stringify({
        type: 'join', playerId: this.playerId, name: this.name, room, game, options,
      })));
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.type === 'joined') {
          clearTimeout(t);
          this.seat = m.seat;
          this.room = m.room;
          resolve(this);
        } else if (m.type === 'state') {
          this.state = m.state;
        } else if (m.type === 'error') {
          clearTimeout(t);
          this.errors.push(m.message);
          if (!this.room) reject(new Error(m.message));
        } else {
          this.messages.push(m);
        }
      });
      this.ws.on('error', (e) => { clearTimeout(t); reject(e); });
    });
  }

  act(action) { this.ws.send(JSON.stringify({ type: 'action', action })); }
  start() { this.ws.send(JSON.stringify({ type: 'start' })); }
  /** Drop the socket without leaving, the way a locked phone does. */
  drop() { return new Promise((r) => { this.ws.once('close', r); this.ws.terminate(); }); }
  close() { return new Promise((r) => { this.ws.once('close', r); this.ws.close(); }); }
}

/** A room with these people in it, started, everyone holding the first state. */
export async function startRoom(url, game, names, options = {}) {
  const [hostName, ...rest] = names;
  const host = new Client(url, hostName);
  await host.connect(null, { game, options });
  const others = [];
  for (const n of rest) {
    const c = new Client(url, n);
    await c.connect(host.room);
    others.push(c);
  }
  const all = [host, ...others];
  await waitFor(() => host.state?.players?.length === names.length, 'everyone in the lobby');
  host.start();
  await waitFor(() => all.every((c) => c.state && c.state.phase !== 'lobby'), 'the game to start');
  return all;
}
