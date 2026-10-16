// Connect Four as a game module. Two people, or one against the bot.

import { ConnectFourGame } from './engine.js';
import { chooseColumn, skillByKey, SKILLS, DEFAULT_SKILL } from './bot.js';

const FAST = process.env.EUCHRE_FAST === '1';
const BOT_THINK_MIN = FAST ? 1 : 500;
const BOT_THINK_SPREAD = FAST ? 1 : 500;

export default {
  id: 'connect4',
  name: 'Connect Four',
  blurb: 'Drop discs, line up four. Quick, and harder than it looks.',
  icon: '🔴',
  seats: 2,
  minPlayers: 1,
  maxPlayers: 2,
  usesBots: true,
  botCount: (here) => (here >= 2 ? 0 : 1),

  options: {
    difficulty: {
      label: 'Bot skill',
      values: Object.values(SKILLS).map((s) => ({ value: s.key, label: s.label })),
      default: 'casual',
    },
  },

  seatNames(room) {
    const names = Array.from({ length: room.humanCount }, (_, s) =>
      room.seats[s]?.name || `Player ${s + 1}`);
    if (names.length < 2) names.push('Bot');
    return names;
  },

  create(room) {
    room.skill = skillByKey(room.options?.difficulty);
    // The first player has the edge, so it swaps every game in the room.
    room.c4Games = (room.c4Games ?? -1) + 1;
    return new ConnectFourGame({ names: this.seatNames(room), first: room.c4Games % 2 });
  },

  renameSeats(game, names) {
    game.names = names;
  },

  viewFor(game, seat, room) {
    return {
      ...game.viewFor(seat),
      botCount: room.humanCount < 2 ? 1 : 0,
      difficulty: (room.skill || DEFAULT_SKILL).label,
    };
  },

  isBotSeat: (room, seat) => seat >= room.humanCount,

  outcome(game) {
    if (game.phase !== 'gameOver') return null;
    return { winners: game.winner === null ? [] : [game.winner] };
  },

  applyAction(game, seat, action, ctx) {
    switch (action.kind) {
      case 'drop':
        return game.drop(seat, action.col);
      case 'newGame':
        if (game.phase !== 'gameOver') throw new Error('game is not over');
        ctx.restart();
        return 'restarted';
      default:
        throw new Error(`unknown action ${action.kind}`);
    }
  },

  step(game, room) {
    if (game.phase !== 'playing' || !this.isBotSeat(room, game.turn)) return null;
    return {
      delay: BOT_THINK_MIN + Math.random() * BOT_THINK_SPREAD,
      run: () => game.drop(game.turn, chooseColumn(game.board, game.turn, room.skill || DEFAULT_SKILL)),
    };
  },
};
