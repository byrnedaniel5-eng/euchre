// The room layer: everything that is true of any game played on this site.
//
// Room codes, seats, rejoining by stored id, leaving, chat, the ready gate,
// keep-alives and reaping. It knows nothing about cards or drawings — it asks
// the game module what to build, what each seat may see, and whether anything
// should happen on a timer.
//
// A room is a lobby first. People join it up to the game's capacity, and the
// person who created it decides when to start. Only then is the table size
// fixed: euchre fills whatever seats are left with bots, while the drawing and
// trivia games simply play with however many turned up.

import { randomUUID } from 'node:crypto';
import { games, getGame } from './registry.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const ROOM_TTL = 6 * 60 * 60 * 1000; // rooms survive a long lunch break

/** @type {Map<string, Room>} */
export const rooms = new Map();

/** Seats with a person in them, in order. */
export const occupiedSeats = (room) =>
  room.seats.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);

/**
 * Seats the game considers human. Before the start that is whoever is here;
 * afterwards it is frozen, so bots cannot appear or vanish mid-game.
 */
export const humanSeats = (room) =>
  (room.started
    ? Array.from({ length: room.humanCount }, (_, i) => i)
    : occupiedSeats(room));

function newRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

export function createRoom({ gameId, options }) {
  const mod = getGame(gameId);
  if (!mod) throw new Error(`no such game: ${gameId}`);
  const code = newRoomCode();
  const room = {
    code,
    gameId: mod.id,
    mod,
    capacity: mod.seats,
    // Set when the host starts; null while it is still a lobby.
    humanCount: null,
    started: false,
    hostId: null,
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

const isHostSeat = (room, seat) =>
  !!room.seats[seat] && room.seats[seat].playerId === room.hostId;

export const canStart = (room) =>
  !room.started && occupiedSeats(room).length >= room.mod.minPlayers;

/** Squash gaps so seats stay 0..n-1 — euchre's teams depend on the order. */
function compact(room) {
  const people = room.seats.filter(Boolean);
  for (let i = 0; i < room.seats.length; i++) room.seats[i] = people[i] || null;
}

export function startGame(room) {
  clearTimeout(room.timer);
  room.timer = null;
  room.ready.clear();
  compact(room);
  room.humanCount = Math.min(room.mod.maxPlayers, occupiedSeats(room).length);
  room.started = true;
  room.game = room.mod.create(room);
  advance(room);
}

// -------------------------------------------------------------- broadcasting

const send = (ws, msg) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

const connectionFlags = (room) =>
  humanSeats(room).map((s) => !!(room.seats[s] && room.seats[s].sockets.size > 0));

function lobbyState(room, seat) {
  const here = occupiedSeats(room);
  return {
    phase: 'lobby',
    game: room.gameId,
    gameName: room.mod.name,
    room: room.code,
    capacity: room.capacity,
    minPlayers: room.mod.minPlayers,
    maxPlayers: room.mod.maxPlayers,
    usesBots: !!room.mod.usesBots,
    players: here.map((s) => ({
      seat: s,
      name: room.seats[s].name,
      host: isHostSeat(room, s),
      connected: room.seats[s].sockets.size > 0,
    })),
    youAreHost: isHostSeat(room, seat),
    canStart: canStart(room),
    // What the table would look like if it started right now.
    bots: room.mod.usesBots ? Math.max(0, room.mod.seats - here.length) : 0,
  };
}

export function stateFor(room, seat) {
  if (!room.game) return { ...lobbyState(room, seat), yourSeat: seat };
  return {
    ...room.mod.viewFor(room.game, seat, room),
    yourSeat: seat,
    game: room.gameId,
    room: room.code,
    humans: room.humanCount,
    connected: connectionFlags(room),
    ready: humanSeats(room).filter((s) => room.ready.has(s)),
  };
}

export function broadcast(room) {
  room.lastActivity = Date.now();
  for (const seat of occupiedSeats(room)) {
    const p = room.seats[seat];
    if (!p) continue;
    const state = stateFor(room, seat);
    for (const ws of p.sockets) send(ws, { type: 'state', state });
  }
}

/** Send anything else (ink, notices) to every seat except optionally one. */
export function broadcastRaw(room, msg, exceptSeat = null) {
  for (const seat of occupiedSeats(room)) {
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
  // already pushed out itself.
  if (result === 'restarted' || result === 'quiet') return;
  advance(room);
}

/** The host says go. Everyone in the lobby at this moment is in the game. */
export function hostStart(room, seat) {
  if (room.started) throw new Error('the game has already started');
  if (!isHostSeat(room, seat)) throw new Error('only the host can start the game');
  const here = occupiedSeats(room).length;
  if (here < room.mod.minPlayers) {
    throw new Error(`${room.mod.name} needs at least ${room.mod.minPlayers} players`);
  }
  startGame(room);
}

// ------------------------------------------------------------------ joining

export function joinRoom(ws, msg) {
  const playerId = msg.playerId || randomUUID();
  const name = String(msg.name || '').trim().slice(0, 14) || 'Player';

  let room;
  let creating = false;
  if (msg.room) {
    room = rooms.get(String(msg.room).toUpperCase().trim());
    if (!room) return { error: 'No game with that code.' };
  } else {
    try {
      room = createRoom({ gameId: msg.game || 'euchre', options: msg.options });
      creating = true;
    } catch {
      return { error: 'That game is not available.' };
    }
  }

  // Rejoin the seat this player already holds, otherwise take a free one.
  let seat = room.seats.findIndex((p) => p?.playerId === playerId);
  if (seat < 0) {
    // Seats are frozen once play begins: only the people who were here may
    // come back, and only into their own seat.
    if (room.started) return { error: 'That game has already started.' };
    seat = room.seats.findIndex((p) => !p);
    if (seat < 0) return { error: `That lobby is full (${room.capacity} players).` };
  }

  if (room.seats[seat]) {
    room.seats[seat].sockets.add(ws);
    room.seats[seat].name = name;
  } else {
    room.seats[seat] = { playerId, name, sockets: new Set([ws]) };
  }
  if (creating || !room.hostId) room.hostId = playerId;
  if (room.game) room.mod.renameSeats(room.game, room.mod.seatNames(room));

  return { room, seat, playerId, isHost: room.hostId === playerId };
}

/**
 * Give a seat up for good. Different from a dropped socket, which keeps the
 * seat so a locked phone can come back to it.
 */
export function leaveRoom(room, seat, exceptWs = null) {
  const who = room.seats[seat]?.name || 'A player';
  const wasHost = isHostSeat(room, seat);
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

  if (!occupiedSeats(room).length) {
    rooms.delete(room.code);
    return;
  }

  // Whoever is left goes back to the lobby holding the same code, so somebody
  // can take the empty seat rather than everyone starting over.
  compact(room);
  room.game = null;
  room.started = false;
  room.humanCount = null;
  if (wasHost) room.hostId = room.seats[occupiedSeats(room)[0]].playerId;
  broadcastChat(room, { from: 'Table', seat: -1, text: `${who} left.`, ts: Date.now() });
  broadcast(room);
}

export function reapRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const live = occupiedSeats(room).some((s) => room.seats[s]?.sockets.size > 0);
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
