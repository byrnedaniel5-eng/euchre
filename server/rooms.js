// The room layer: everything that is true of any game played on this site.
//
// Room codes, seat allocation, rejoining by stored id, leaving, chat, the
// ready gate between rounds, keep-alives and reaping. It knows nothing about
// cards or drawings — it asks the game module what to build, what each seat
// may see, and whether anything should happen on a timer.

import { randomUUID } from 'node:crypto';
import { games, getGame } from './registry.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const ROOM_TTL = 6 * 60 * 60 * 1000; // rooms survive a long lunch break

/** @type {Map<string, Room>} */
export const rooms = new Map();

export const humanSeats = (room) =>
  Array.from({ length: room.humanCount }, (_, i) => i);

function newRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

export function createRoom({ gameId, humanCount, options }) {
  const mod = getGame(gameId);
  if (!mod) throw new Error(`no such game: ${gameId}`);
  const wanted = Number(humanCount) || mod.defaultPlayers || mod.minPlayers;
  const code = newRoomCode();
  const room = {
    code,
    gameId: mod.id,
    mod,
    humanCount: Math.min(mod.maxPlayers, Math.max(mod.minPlayers, wanted | 0)),
    options: options && typeof options === 'object' ? options : {},
    seats: Array.from({ length: mod.seats }, () => null),
    game: null,
    timer: null,
    chat: [],
    // Seats that have pressed "next". A round only advances once everyone has,
    // so nobody gets rushed past a result.
    ready: new Set(),
    lastActivity: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

const allSeated = (room) => humanSeats(room).every((s) => room.seats[s]);

export function startGame(room) {
  clearTimeout(room.timer);
  room.timer = null;
  room.ready.clear();
  room.game = room.mod.create(room);
  advance(room);
}

// -------------------------------------------------------------- broadcasting

const send = (ws, msg) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

const connectionFlags = (room) =>
  humanSeats(room).map((s) => !!(room.seats[s] && room.seats[s].sockets.size > 0));

function lobbyState(room) {
  return {
    phase: 'lobby',
    game: room.gameId,
    room: room.code,
    humans: room.humanCount,
    names: room.mod.seatNames(room),
    seated: humanSeats(room).map((s) => !!room.seats[s]),
  };
}

export function stateFor(room, seat) {
  if (!room.game) return lobbyState(room);
  return {
    ...room.mod.viewFor(room.game, seat, room),
    game: room.gameId,
    room: room.code,
    humans: room.humanCount,
    connected: connectionFlags(room),
    ready: humanSeats(room).filter((s) => room.ready.has(s)),
  };
}

export function broadcast(room) {
  room.lastActivity = Date.now();
  for (const seat of humanSeats(room)) {
    const p = room.seats[seat];
    if (!p) continue;
    const state = stateFor(room, seat);
    for (const ws of p.sockets) send(ws, { type: 'state', state });
  }
}

/** Send anything else (ink, notices) to every seat except optionally one. */
export function broadcastRaw(room, msg, exceptSeat = null) {
  for (const seat of humanSeats(room)) {
    if (seat === exceptSeat) continue;
    for (const ws of room.seats[seat]?.sockets || []) send(ws, msg);
  }
}

export function broadcastChat(room, entry) {
  room.chat.push(entry);
  if (room.chat.length > 50) room.chat.shift();
  broadcastRaw(room, { type: 'chat', entry });
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
 * Push the game forward until it needs a person. Re-entrant via setTimeout
 * rather than recursion, so a long chain of bot moves can't blow the stack.
 */
export function advance(room) {
  broadcast(room);
  if (!room.game) return;
  const next = room.mod.step(room.game, room);
  if (!next) return;
  // run() may be async — the trivia game fetches its question inside the wheel
  // spin. Awaiting keeps the state broadcast after the work, not before it.
  schedule(room, Math.max(0, next.delay), async () => {
    try {
      await next.run();
    } catch (err) {
      console.error(`[${room.code}] step failed:`, err);
    }
    advance(room);
  });
}

/** Context handed to a game module while it applies someone's action. */
function actionContext(room) {
  return {
    room,
    humanSeats: humanSeats(room),
    /** Mark a seat ready; true once everyone is, which also clears the gate. */
    markReady(seat) {
      room.ready.add(seat);
      if (!humanSeats(room).every((s) => room.ready.has(s))) return false;
      room.ready.clear();
      return true;
    },
    clearReady: () => room.ready.clear(),
    restart: () => startGame(room),
    broadcastRaw: (msg, except) => broadcastRaw(room, msg, except),
    chat: (entry) => broadcastChat(room, entry),
  };
}

export function applyAction(room, seat, action) {
  if (!room.game) throw new Error('no game in progress');
  const result = room.mod.applyAction(room.game, seat, action, actionContext(room));
  // 'restarted': startGame already advanced, don't do it twice.
  // 'quiet': high-frequency traffic like drawing strokes, which the module has
  // already pushed out itself. Broadcasting full state per finger movement
  // would swamp the socket for no gain.
  if (result === 'restarted' || result === 'quiet') return;
  advance(room);
}

// ------------------------------------------------------------------ joining

export function joinRoom(ws, msg) {
  const playerId = msg.playerId || randomUUID();
  const name = String(msg.name || '').trim().slice(0, 14) || 'Player';

  let room;
  if (msg.room) {
    room = rooms.get(String(msg.room).toUpperCase().trim());
    if (!room) return { error: 'No game with that code.' };
  } else {
    try {
      room = createRoom({
        gameId: msg.game || 'euchre',
        humanCount: msg.players,
        options: msg.options,
      });
    } catch {
      return { error: 'That game is not available.' };
    }
  }

  const seats = humanSeats(room);
  let seat = seats.find((s) => room.seats[s]?.playerId === playerId);
  if (seat === undefined) seat = seats.find((s) => !room.seats[s]);
  if (seat === undefined) {
    const n = room.humanCount;
    return { error: `That game is full (${n} ${n === 1 ? 'player' : 'players'}).` };
  }

  if (room.seats[seat]) {
    room.seats[seat].sockets.add(ws);
    room.seats[seat].name = name;
  } else {
    room.seats[seat] = { playerId, name, sockets: new Set([ws]) };
  }
  if (room.game) room.mod.renameSeats(room.game, room.mod.seatNames(room));

  return { room, seat, playerId };
}

/**
 * Give a seat up for good. Different from a dropped socket, which keeps the
 * seat so a locked phone can come back to it.
 */
export function leaveRoom(room, seat, exceptWs = null) {
  const who = room.seats[seat]?.name || 'A player';
  // Close this player's other tabs, but never the socket that asked to leave —
  // it is mid-message, and closing it here trips a libuv assertion.
  for (const s of room.seats[seat]?.sockets || []) {
    if (s !== exceptWs && s.readyState === s.OPEN) {
      try { s.close(); } catch { /* already going */ }
    }
  }
  room.seats[seat] = null;
  room.ready.delete(seat);
  clearTimeout(room.timer);
  room.timer = null;

  if (!humanSeats(room).some((s) => room.seats[s])) {
    rooms.delete(room.code);
    return;
  }
  // Whoever is left keeps the code so a replacement can join.
  room.game = null;
  broadcastChat(room, { from: 'Table', seat: -1, text: `${who} left.`, ts: Date.now() });
  broadcast(room);
}

export function maybeStart(room) {
  if (!room.game && allSeated(room)) startGame(room);
  else broadcast(room);
}

export function reapRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const live = humanSeats(room).some((s) => room.seats[s]?.sockets.size > 0);
    if (!live && now - room.lastActivity > ROOM_TTL) {
      clearTimeout(room.timer);
      rooms.delete(code);
    }
  }
}

export const catalogue = () =>
  games().map((g) => ({
    id: g.id, name: g.name, blurb: g.blurb, icon: g.icon,
    minPlayers: g.minPlayers, maxPlayers: g.maxPlayers,
    usesBots: g.usesBots, options: g.options || {},
  }));
