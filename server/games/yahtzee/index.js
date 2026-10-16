// Yahtzee as a game module. One to four; on your own you get a bot.

import { YahtzeeGame } from './engine.js';
import { totals } from './rules.js';
import { decide, skillByKey, SKILLS, DEFAULT_SKILL } from './bot.js';

const FAST = process.env.EUCHRE_FAST === '1';
const BOT_THINK_MIN = FAST ? 1 : 700;
const BOT_THINK_SPREAD = FAST ? 1 : 500;

export default {
  id: 'yahtzee',
  name: 'Yahtzee',
  blurb: 'Five dice, three rolls, thirteen boxes. Everyone watches every roll.',
  icon: '🎲',
  seats: 4,
  minPlayers: 1,
  maxPlayers: 4,
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
    const names = this.seatNames(room);
    room.yahtzeeGames = (room.yahtzeeGames ?? -1) + 1;
    return new YahtzeeGame({ names, playerCount: names.length, first: room.yahtzeeGames % names.length });
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
    return { winners: game.winners(), score: game.sheets.map((s) => totals(s).total).join('–') };
  },

  applyAction(game, seat, action, ctx) {
    switch (action.kind) {
      case 'roll':
        return game.roll(seat, action.held);
      case 'hold':
        return game.hold(seat, action.index, action.on);
      case 'score':
        return game.score(seat, action.cat);
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
      run: () => {
        const d = decide(game, game.turn, room.skill || DEFAULT_SKILL);
        if (d.kind === 'roll') game.roll(game.turn, d.held);
        else game.score(game.turn, d.cat);
      },
    };
  },
};
