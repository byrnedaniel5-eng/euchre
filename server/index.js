// Euchre server: static client + WebSocket game rooms.
//
// The server owns the game state. Clients send intents ("play this card") and
// render whatever state comes back. Nothing about a hand lives in the browser,
// so a phone can lock, sleep, or drop wifi and rejoin exactly where it was.

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { EuchreGame } from './euchre.js';
import { botAct, botDiscard } from './bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const BOT_NAMES = ['Robo', 'Chip']; // seat 2 partners seat 0; seat 3 partners seat 1
const HUMAN_SEATS = [0, 1];
const isBotSeat = (seat) => seat === 2 || seat === 3;

// Timings, in ms. EUCHRE_FAST collapses them for the end-to-end test.
const FAST = process.env.EUCHRE_FAST === '1';
const BOT_THINK_MIN = FAST ? 1 : 650;
const BOT_THINK_SPREAD = FAST ? 1 : 500;
// Long enough to read four cards and see who took them before they clear.
const TRICK_SWEEP = FAST ? 2 : 2800;
const ROOM_TTL = 6 * 60 * 60 * 1000; // rooms survive a long lunch break

// ------------------------------------------------------------------- rooms

/** @type {Map<string, Room>} */
const rooms = new Map();

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

function newRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = newRoomCode();
  const room = {
    code,
    // seats[0] and seats[1] are the humans: {playerId, name, sockets:Set}
    seats: [null, null],
    game: null,
    timer: null,
    chat: [],
    // Seats that have pressed "next hand". The hand only advances once both
    // humans have, so neither of you gets rushed past the result.
    ready: new Set(),
    lastActivity: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function seatNames(room) {
  return [
    room.seats[0]?.name || 'Player 1',
    room.seats[1]?.name || 'Player 2',
    BOT_NAMES[0],
    BOT_NAMES[1],
  ];
}

function bothSeated(room) {
  return !!(room.seats[0] && room.seats[1]);
}

function startGame(room) {
  clearTimeout(room.timer);
  room.timer = null;
  room.ready.clear();
  room.game = new EuchreGame({ names: seatNames(room) });
  advance(room);
}

// -------------------------------------------------------------- broadcasting

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function lobbyState(room) {
  return {
    phase: 'lobby',
    room: room.code,
    names: seatNames(room),
    seated: [!!room.seats[0], !!room.seats[1]],
  };
}

function broadcast(room) {
  room.lastActivity = Date.now();
  for (const seat of HUMAN_SEATS) {
    const p = room.seats[seat];
    if (!p) continue;
    const state = room.game
      ? {
          ...room.game.viewFor(seat),
          room: room.code,
          connected: connectionFlags(room),
          ready: HUMAN_SEATS.filter((s) => room.ready.has(s)),
        }
      : lobbyState(room);
    for (const ws of p.sockets) send(ws, { type: 'state', state });
  }
}

function connectionFlags(room) {
  return HUMAN_SEATS.map((s) => !!(room.seats[s] && room.seats[s].sockets.size > 0));
}

function broadcastChat(room, entry) {
  room.chat.push(entry);
  if (room.chat.length > 50) room.chat.shift();
  for (const seat of HUMAN_SEATS) {
    for (const ws of room.seats[seat]?.sockets || []) send(ws, { type: 'chat', entry });
  }
}

// ------------------------------------------------------------- game driving

function schedule(room, ms, fn) {
  clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    room.timer = null;
    try {
      fn();
    } catch (err) {
      console.error(`[${room.code}] scheduled step failed:`, err);
    }
  }, ms);
}

/**
 * Push the game forward until it needs a human. Called after every state
 * change; re-entrant via setTimeout rather than recursion.
 */
function advance(room) {
  const g = room.game;
  if (!g) return broadcast(room);
  broadcast(room);

  if (g.phase === 'trickComplete') {
    return schedule(room, TRICK_SWEEP, () => {
      g.finishTrick();
      advance(room);
    });
  }

  // handOver and gameOver both wait on the players, not on a clock.
  if (g.phase === 'handOver' || g.phase === 'gameOver') return;

  // A dealer who is sitting out a loner still picks up and discards, but the
  // hand is dead — don't make a human click through a meaningless choice.
  if (g.phase === 'discard' && g.dealer === g.sittingOut && !isBotSeat(g.dealer)) {
    return schedule(room, 400, () => {
      g.discard(g.dealer, botDiscard(g, g.dealer));
      advance(room);
    });
  }

  if (isBotSeat(g.turn)) {
    return schedule(room, BOT_THINK_MIN + Math.random() * BOT_THINK_SPREAD, () => {
      botAct(g, g.turn);
      advance(room);
    });
  }
}

/** Apply a human action. Throws on anything illegal; the caller reports it. */
function applyAction(room, seat, action) {
  const g = room.game;
  if (!g) throw new Error('no game in progress');

  switch (action.kind) {
    case 'bid1':
      g.bid1(seat, { order: !!action.order, alone: !!action.alone });
      break;
    case 'bid2':
      g.bid2(seat, { suit: action.suit || null, alone: !!action.alone });
      break;
    case 'discard':
      g.discard(seat, action.card);
      break;
    case 'play':
      g.playCard(seat, action.card);
      break;
    case 'nextHand': {
      if (g.phase !== 'handOver') throw new Error('hand is not over');
      room.ready.add(seat);
      // Both humans have to look up from the result before the next deal.
      // A seat is held even while its phone is offline, so a lock screen
      // pauses the game rather than skipping someone past the score — they
      // reconnect into this same overlay and press it themselves.
      if (HUMAN_SEATS.every((s) => room.ready.has(s))) {
        room.ready.clear();
        g.nextHand();
      }
      break;
    }
    case 'newGame':
      if (g.phase !== 'gameOver') throw new Error('game is not over');
      startGame(room);
      return;
    default:
      throw new Error(`unknown action ${action.kind}`);
  }
  advance(room);
}

// ------------------------------------------------------------------- server

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
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

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
      const playerId = msg.playerId || randomUUID();
      const name = String(msg.name || '').trim().slice(0, 14) || 'Player';

      if (msg.room) {
        room = rooms.get(String(msg.room).toUpperCase().trim());
        if (!room) return send(ws, { type: 'error', message: 'No game with that code.' });
      } else {
        room = createRoom();
      }

      // Rejoin the seat this player already holds, otherwise take a free one.
      seat = HUMAN_SEATS.find((s) => room.seats[s]?.playerId === playerId);
      if (seat === undefined) seat = HUMAN_SEATS.find((s) => !room.seats[s]);
      if (seat === undefined) {
        room = null;
        return send(ws, { type: 'error', message: 'That game already has two players.' });
      }

      if (room.seats[seat]) {
        room.seats[seat].sockets.add(ws);
        room.seats[seat].name = name;
      } else {
        room.seats[seat] = { playerId, name, sockets: new Set([ws]) };
      }
      if (room.game) room.game.names = seatNames(room);

      send(ws, { type: 'joined', room: room.code, seat, playerId, chat: room.chat });

      if (!room.game && bothSeated(room)) startGame(room);
      else broadcast(room);
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
        if (room.game) {
          send(ws, {
            type: 'state',
            state: { ...room.game.viewFor(seat), room: room.code, connected: connectionFlags(room) },
          });
        }
      }
      return;
    }

    // Leaving is different from dropping. A dropped socket keeps the seat so
    // a locked phone can come back to it; saying "leave" gives the seat up.
    if (msg.type === 'leave') {
      const who = room.seats[seat]?.name || 'A player';
      for (const s of room.seats[seat]?.sockets || []) if (s !== ws) s.close();
      room.seats[seat] = null;
      room.ready.delete(seat);
      clearTimeout(room.timer);
      room.timer = null;

      if (!HUMAN_SEATS.some((s) => room.seats[s])) {
        rooms.delete(room.code);
      } else {
        // Whoever is left goes back to the lobby holding the same code, so a
        // replacement can join without starting over.
        room.game = null;
        broadcastChat(room, { from: 'Table', seat: -1, text: `${who} left.`, ts: Date.now() });
        broadcast(room);
      }
      room = null;
      seat = null;
      return;
    }

    if (msg.type === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 200);
      if (text) {
        broadcastChat(room, { from: room.seats[seat].name, seat, text, ts: Date.now() });
      }
      return;
    }
  });

  ws.on('close', () => {
    if (!room || seat === null) return;
    room.seats[seat]?.sockets.delete(ws);
    // The seat is kept: a locked phone or a dropped signal should not forfeit
    // the hand. Rooms are reaped on the TTL sweep instead.
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

const reaper = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const live = HUMAN_SEATS.some((s) => room.seats[s]?.sockets.size > 0);
    if (!live && now - room.lastActivity > ROOM_TTL) {
      clearTimeout(room.timer);
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000);

server.on('close', () => {
  clearInterval(heartbeat);
  clearInterval(reaper);
});

server.listen(PORT, () => {
  console.log(`Euchre running on http://localhost:${PORT}`);
});
