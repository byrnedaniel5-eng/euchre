// Dots and Boxes as a game module. Two to four, or one against the bot.

import { DotsGame } from './engine.js';
import { chooseLine, skillByKey, SKILLS, DEFAULT_SKILL } from './bot.js';

const FAST = process.env.EUCHRE_FAST === '1';
const BOT_THINK_MIN = FAST ? 1 : 450;
const BOT_THINK_SPREAD = FAST ? 1 : 450;

const SIZES = { small: [3, 3], medium: [4, 4], large: [5, 5] };

export default {
  id: 'dots',
  name: 'Dots & Boxes',
  blurb: 'Draw lines, close boxes. Never draw the third side.',
  icon: '⬚',
  seats: 4,
  minPlayers: 1,
  maxPlayers: 4,
  usesBots: true,
  botCount: (here) => (here >= 2 ? 0 : 1),

  options: {
    size: {
      label: 'Board',
      values: [
        { value: 'small', label: '3×3' },
        { value: 'medium', label: '4×4' },
        { value: 'large', label: '5×5' },
      ],
      default: 'medium',
    },
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
    const [rows, cols] = SIZES[room.options?.size] || SIZES.medium;
    const names = this.seatNames(room);
    // Whoever starts moves round the table each game in the room.
    room.dotsGames = (room.dotsGames ?? -1) + 1;
    return new DotsGame({ names, playerCount: names.length, rows, cols, first: room.dotsGames % names.length });
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
    return { winners: game.winners(), score: game.scores.join('–') };
  },

  applyAction(game, seat, action, ctx) {
    switch (action.kind) {
      case 'line':
        return game.draw(seat, action.edge);
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
      run: () => game.draw(game.turn, chooseLine(game.geo, game.lines, room.skill || DEFAULT_SKILL)),
    };
  },
};
