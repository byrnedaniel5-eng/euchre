// Game site server: static client + WebSocket rooms.
//
// The server owns every game's state. Clients send intents ("play this card",
// "this stroke") and render whatever comes back. Nothing authoritative lives in
// the browser, so a phone can lock, sleep or drop wifi and rejoin exactly where
// it was. Room and seat handling lives in rooms.js; the games themselves are
// modules under games/, registered in registry.js.

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  rooms, joinRoom, leaveRoom, maybeStart, applyAction, broadcast, broadcastChat,
  stateFor, reapRooms, catalogue,
} from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const app = express();

// "no-cache" still lets the browser keep a copy — it just has to revalidate
// with us first, so an ETag match costs one 304 and nothing else. Never use a
// max-age here: a phone that cached the old client keeps playing the old
// client for that long after a deploy, with no way for the player to tell.
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  lastModified: true,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('/games', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json(catalogue());
});
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const send = (ws, msg) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let room = null;
  let seat = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'join') {
      const result = joinRoom(ws, msg);
      if (result.error) return send(ws, { type: 'error', message: result.error });
      ({ room, seat } = result);

      send(ws, {
        type: 'joined',
        room: room.code,
        game: room.gameId,
        seat,
        playerId: result.playerId,
        humans: room.humanCount,
        chat: room.chat,
      });
      // Anything the game wants to hand a returning player — a drawing board,
      // for instance — that is too big to live in every state broadcast.
      room.mod.onJoin?.(room.game, seat, (m) => send(ws, m));
      maybeStart(room);
      return;
    }

    if (!room || seat === null) return;
    room.lastActivity = Date.now();

    if (msg.type === 'action') {
      try {
        applyAction(room, seat, msg.action || {});
      } catch (err) {
        send(ws, { type: 'error', message: err.message });
        // Resync the offender so a rejected tap can't leave their UI wrong.
        send(ws, { type: 'state', state: stateFor(room, seat) });
      }
      return;
    }

    // Leaving is different from dropping. A dropped socket keeps the seat so a
    // locked phone can come back to it; saying "leave" gives the seat up.
    if (msg.type === 'leave') {
      leaveRoom(room, seat, ws);
      room = null;
      seat = null;
      return;
    }

    if (msg.type === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 200);
      if (text) {
        broadcastChat(room, { from: room.seats[seat].name, seat, text, ts: Date.now() });
      }
    }
  });

  ws.on('close', () => {
    if (!room || seat === null) return;
    room.seats[seat]?.sockets.delete(ws);
    // The seat is kept: a locked phone or a dropped signal should not forfeit
    // the game. Rooms are reaped on the TTL sweep instead.
    broadcast(room);
  });
});

// Keep-alive: mobile browsers and free-tier proxies both drop idle sockets.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

const reaper = setInterval(reapRooms, 10 * 60 * 1000);

server.on('close', () => {
  clearInterval(heartbeat);
  clearInterval(reaper);
});

server.listen(PORT, () => {
  console.log(`Euchre running on http://localhost:${PORT}`);
});
