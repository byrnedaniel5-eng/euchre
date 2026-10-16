// Cribbage as a game module. Two people, or one against the bot.

import { CribbageGame } from './engine.js';
import { chooseDiscard, choosePlay, skillByKey, SKILLS, DEFAULT_SKILL } from './bot.js';

const FAST = process.env.EUCHRE_FAST === '1';
const BOT_THINK_MIN = FAST ? 1 : 700;
const BOT_THINK_SPREAD = FAST ? 1 : 500;

export default {
  id: 'cribbage',
  name: 'Cribbage',
  blurb: 'Fifteen two, fifteen four. Two players to 121.',
  icon: '♣',
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
    // The first deal alternates game to game, as cutting for it would.
    room.cribGames = (room.cribGames ?? Math.floor(Math.random() * 2) - 1) + 1;
    return new CribbageGame({ names: this.seatNames(room), dealer: room.cribGames % 2 });
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
    return { winners: [game.winner], score: `${game.scores[game.winner]}–${game.scores[1 - game.winner]}` };
  },

  applyAction(game, seat, action, ctx) {
    switch (action.kind) {
      case 'discard':
        return game.discard(seat, action.cards);
      case 'play':
        return game.play(seat, action.card);
      case 'next':
        if (game.phase !== 'show') throw new Error('nothing to move on from');
        if (ctx.markReady(seat)) game.nextHand();
        return;
      case 'newGame':
        if (game.phase !== 'gameOver') throw new Error('game is not over');
        ctx.restart();
        return 'restarted';
      default:
        throw new Error(`unknown action ${action.kind}`);
    }
  },

  step(game, room) {
    const skill = room.skill || DEFAULT_SKILL;
    const bot = 1;
    if (!this.isBotSeat(room, bot)) return null;
    if (game.phase === 'discard' && !game.thrown[bot]) {
      return {
        delay: BOT_THINK_MIN,
        run: () => game.discard(bot, chooseDiscard(game.hands[bot], game.dealer === bot, skill)),
      };
    }
    if (game.phase === 'play' && game.turn === bot) {
      return {
        delay: BOT_THINK_MIN + Math.random() * BOT_THINK_SPREAD,
        run: () => game.play(bot, choosePlay(game.inHand[bot], game.pile, game.count, skill)),
      };
    }
    // The show waits only on people — the ready gate never counts the bot.
    return null;
  },
};
