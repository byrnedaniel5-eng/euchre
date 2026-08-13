// Battleships as a game module.
//
// The one thing this game asks of the room layer that no other game did: bots
// fill up to *two* players, not up to the table. Euchre needs four bodies or it
// is not euchre; battleships needs an opponent, and a fourth fleet is a choice
// rather than a requirement. Hence botCount().

import { BattleshipGame, REVEAL_MS } from './engine.js';
import { sunkShips, shipsLeft } from './rules.js';
import { chooseShot, knowledgeOf, liveHits, skillByKey, SKILLS, DEFAULT_SKILL } from './bot.js';

const BOT_POOL = ['Admiral', 'Bosun', 'Cutter'];

const FAST = process.env.EUCHRE_FAST === '1';
const BOT_THINK_MIN = FAST ? 1 : 900;
const BOT_THINK_SPREAD = FAST ? 1 : 700;

/** Who the bot should shoot at when there is more than one enemy fleet. */
function pickTarget(game, seat) {
  const targets = game.targetsFor(seat);
  const seen = targets.map((t) => ({
    seat: t,
    knowledge: knowledgeOf(game.boards[t], { sunkShips }),
    left: shipsLeft(game.boards[t]),
  }));
  // Finish what you started: a wounded ship is worth more than a fresh board.
  const wounded = seen.filter((s) => liveHits(s.knowledge).length > 0);
  const pool = wounded.length ? wounded : seen;
  const fewest = Math.min(...pool.map((s) => s.left));
  const closest = pool.filter((s) => s.left === fewest);
  return closest[Math.floor(Math.random() * closest.length)];
}

export default {
  id: 'battleship',
  name: 'Battleships',
  blurb: 'Hide your fleet, then hunt theirs down square by square.',
  icon: '🚢',
  seats: 4,
  minPlayers: 1,
  maxPlayers: 4,
  usesBots: true,

  /**
   * Bots make up the numbers only when there is nobody to play against. Two
   * people who turn up get each other, not a table of four.
   */
  botCount: (here) => (here >= 2 ? 0 : 1),

  options: {
    difficulty: {
      label: 'Bot skill',
      values: Object.values(SKILLS).map((s) => ({ value: s.key, label: s.label })),
      default: 'casual',
    },
    goAgain: {
      label: 'After a hit',
      values: [
        { value: 'pass', label: 'Pass over' },
        { value: 'again', label: 'Fire again' },
      ],
      default: 'pass',
    },
  },

  seatNames(room) {
    const names = Array.from({ length: room.humanCount }, (_, s) =>
      room.seats[s]?.name || `Player ${s + 1}`);
    const bots = this.botCount(room.humanCount);
    for (let b = 0; b < bots; b++) names.push(BOT_POOL[b]);
    return names;
  },

  create(room) {
    room.skill = skillByKey(room.options?.difficulty);
    const names = this.seatNames(room);
    return new BattleshipGame({
      names,
      playerCount: names.length,
      humanCount: room.humanCount,
      goAgain: room.options?.goAgain === 'again',
      revealMs: FAST ? 5 : REVEAL_MS,
    });
  },

  renameSeats(game, names) {
    game.names = names;
  },

  viewFor(game, seat, room) {
    return {
      ...game.viewFor(seat),
      difficulty: (room.skill || DEFAULT_SKILL).label,
    };
  },

  isBotSeat: (room, seat) => seat >= room.humanCount,

  applyAction(game, seat, action, ctx) {
    switch (action.kind) {
      case 'place':
        return game.place(seat, {
          key: action.ship, x: action.x, y: action.y, dir: action.dir,
        });
      case 'unplace':
        return game.unplace(seat, action.ship);
      case 'randomise':
        return game.randomise(seat);
      case 'clearShips':
        return game.clear(seat);
      case 'confirm':
        return game.confirm(seat);
      case 'fire':
        return game.fire(seat, Number(action.target), Number(action.cell));
      case 'newGame':
        if (game.phase !== 'gameOver') throw new Error('game is not over');
        ctx.restart();
        // startGame already broadcast; a second one makes every client act twice.
        return 'restarted';
      default:
        throw new Error(`unknown action ${action.kind}`);
    }
  },

  step(game, room) {
    if (game.phase === 'shotResult') {
      return { delay: game.revealMs, run: () => game.afterShot() };
    }
    if (game.phase !== 'playing') return null;
    if (!this.isBotSeat(room, game.turn)) return null;

    return {
      delay: BOT_THINK_MIN + Math.random() * BOT_THINK_SPREAD,
      run: () => {
        const target = pickTarget(game, game.turn);
        if (!target) return;
        const cell = chooseShot(target.knowledge, room.skill || DEFAULT_SKILL);
        game.fire(game.turn, target.seat, cell);
      },
    };
  },
};
