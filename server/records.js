// The running score: who has beaten whom, at what, across every session.
//
// Each finished game with at least two people in it becomes one entry — the
// game, who played, who won. Tallies are worked out from the entries on
// demand rather than kept as counters, so a mistake in the tallying can be
// fixed after the fact without losing anything.
//
// People are known by name, compared without case or surrounding space. That
// is the only identity this site has that survives a new phone or a cleared
// browser; the per-device player id does not. Bots are never on the record.
//
// Storage is one JSON blob. Locally it is a file. Render's free tier wipes
// its disk on every restart, so online it wants Upstash Redis (free, no card)
// — set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN and it is used
// instead. Either way the copy in memory is the truth and saving trails it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'records.json');
const REDIS_KEY = 'gamenight:records';
const MAX_ENTRIES = 5000;

export const normName = (name) => String(name || '').trim().toLowerCase();

/** The same group of people, in any order, gives the same key. */
export const groupKey = (names) => [...new Set(names.map(normName))].sort().join('|');

// ------------------------------------------------------------------ storage

function fileStore(file) {
  return {
    kind: 'file',
    async load() {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    },
    async save(data) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Write then rename, so a crash mid-write cannot leave half a file.
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    },
  };
}

function redisStore(url, token) {
  const call = async (pathname, body) => {
    const res = await fetch(`${url.replace(/\/$/, '')}/${pathname}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    if (!res.ok) throw new Error(`redis ${res.status}`);
    return res.json();
  };
  return {
    kind: 'redis',
    async load() {
      const { result } = await call(`get/${REDIS_KEY}`);
      return result ? JSON.parse(result) : null;
    },
    async save(data) {
      await call(`set/${REDIS_KEY}`, JSON.stringify(data));
    },
  };
}

/** Nothing kept. What the test suites use, so they cannot touch the real record. */
export function memoryStore(initial = null) {
  let data = initial;
  return {
    kind: 'memory',
    async load() { return data; },
    async save(d) { data = JSON.parse(JSON.stringify(d)); },
  };
}

function defaultStore() {
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
  if (url && token) return redisStore(url, token);
  if (process.env.RECORDS_FILE) return fileStore(process.env.RECORDS_FILE);
  // EUCHRE_FAST is how every test suite boots the server. Without this, each
  // `npm test` would leave a few dozen games between bots called Alice and Bob
  // on the real scoreboard.
  if (process.env.EUCHRE_FAST === '1') return memoryStore();
  return fileStore(DEFAULT_FILE);
}

// ------------------------------------------------------------------ records

export class Records {
  constructor(store = defaultStore()) {
    this.store = store;
    this.entries = [];
    this.saving = Promise.resolve();
    this.ready = store.load()
      .then((data) => { this.entries = Array.isArray(data?.entries) ? data.entries : []; })
      .catch((err) => console.error('records: could not load, starting empty:', err.message));
  }

  /**
   * Put a finished game on the record.
   *   players  display names of the people (not bots) who played
   *   winners  the subset of them who won; all of them is a draw
   *   coop     everyone was on one side, against the game or the bots
   */
  add({ game, players, winners, coop = false, score = null, at = Date.now() }) {
    if (players.length < 2) return null;
    const entry = { g: game, t: at, p: players, w: winners };
    if (coop) entry.c = 1;
    if (score) entry.s = score;
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.persist();
    return entry;
  }

  persist() {
    // Chained, so two games ending together cannot save out of order.
    this.saving = this.saving
      .then(() => this.store.save({ entries: this.entries }))
      .catch((err) => console.error('records: save failed:', err.message));
    return this.saving;
  }

  /** Everything this exact group has played together. */
  forGroup(names) {
    const key = groupKey(names);
    return this.entries.filter((e) => groupKey(e.p) === key);
  }

  /**
   * The head-to-head for a group: wins each, draws, and the same per game,
   * plus how co-op games have gone. Display names come from the most recent
   * entry, so whoever typed "dan" once and "Dan" ever since shows as Dan.
   */
  summary(names, { recent = 5 } = {}) {
    const entries = this.forGroup(names);
    const display = new Map(names.map((n) => [normName(n), String(n).trim()]));
    for (const e of entries) for (const p of e.p) display.set(normName(p), p);
    const people = [...display.keys()];

    const blank = () => ({
      played: 0, draws: 0, wins: Object.fromEntries(people.map((p) => [p, 0])),
      coop: { played: 0, won: 0 },
    });
    const total = blank();
    const byGame = {};
    let streak = null; // { who, n } — consecutive outright wins, newest first

    for (const e of entries) {
      const row = (byGame[e.g] ||= blank());
      for (const bucket of [total, row]) {
        if (e.c) {
          bucket.coop.played++;
          if (e.w.length) bucket.coop.won++;
          continue;
        }
        bucket.played++;
        const winners = e.w.map(normName);
        if (winners.length === 0 || winners.length === e.p.length) bucket.draws++;
        else for (const w of winners) if (w in bucket.wins) bucket.wins[w]++;
      }
    }

    // Streak: walk back from the newest competitive game while one person
    // keeps winning it outright.
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.c) continue;
      const winners = e.w.map(normName);
      if (winners.length !== 1) break;
      if (!streak) streak = { who: winners[0], n: 1 };
      else if (streak.who === winners[0]) streak.n++;
      else break;
    }

    const named = (b) => ({
      ...b,
      wins: Object.fromEntries(Object.entries(b.wins).map(([k, v]) => [display.get(k), v])),
    });

    return {
      names: people.map((p) => display.get(p)),
      total: named(total),
      byGame: Object.fromEntries(Object.entries(byGame).map(([g, b]) => [g, named(b)])),
      streak: streak && streak.n >= 2 ? { who: display.get(streak.who), n: streak.n } : null,
      recent: entries.slice(-recent).reverse().map((e) => ({
        game: e.g, at: e.t, players: e.p, winners: e.w, coop: !!e.c, score: e.s || null,
      })),
    };
  }

  /** Every group a person has played in, most recently active first. */
  groupsFor(name) {
    const me = normName(name);
    // Entries are in the order they finished, so position is the tiebreak a
    // timestamp cannot be when two games end in the same millisecond.
    const last = new Map();
    this.entries.forEach((e, i) => {
      if (e.p.some((p) => normName(p) === me)) last.set(groupKey(e.p), { e, i });
    });
    return [...last.values()]
      .sort((a, b) => b.i - a.i)
      .map(({ e }) => this.summary(e.p, { recent: 8 }));
  }
}

/**
 * Turn a module's outcome into an entry. Seats below humanCount are people;
 * anything else is a bot and stays off the record.
 */
export function entryFor(room, outcome) {
  const humans = Array.from({ length: room.humanCount }, (_, s) => s);
  const name = (s) => room.seats[s]?.name || `Player ${s + 1}`;
  const players = humans.map(name);
  const winners = outcome.winners.filter((s) => s < room.humanCount).map(name);
  return {
    game: room.gameId,
    players,
    winners,
    // A team game where every person ended up on the same side was really
    // all of them against the bots.
    coop: !!outcome.coop ||
      (!!outcome.team && (winners.length === 0 || winners.length === players.length)),
    score: outcome.score || null,
  };
}
