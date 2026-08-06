// Euchre as a game module.
//
// A game module tells the room layer four things: who can sit at it, how to
// build a game, what each seat is allowed to see, and — via step() — whether
// anything should happen on its own after a moment (a bot thinking, a trick
// being swept). Everything else, from room codes to reconnects, is the room
// layer's problem.

import { EuchreGame } from './engine.js';
import { botAct, botDiscard, skillByKey, SKILLS, DEFAULT_SKILL } from './bot.js';

const BOT_POOL = ['Robo', 'Chip', 'Nova', 'Pip'];

const FAST = process.env.EUCHRE_FAST === '1';
const BOT_THINK_MIN = FAST ? 1 : 650;
const BOT_THINK_SPREAD = FAST ? 1 : 500;
const TRICK_SWEEP = FAST ? 2 : 2800;

export default {
  id: 'euchre',
  name: 'Euchre',
  blurb: 'Trick-taking to ten. Bots fill any empty seat.',
  icon: '♠',
  seats: 4,
  defaultPlayers: 2,
  minPlayers: 1,
  maxPlayers: 4,
  usesBots: true,

  /** Options the creator picks, surfaced to the client's setup screen. */
  options: {
    difficulty: {
      label: 'Bot difficulty',
      values: Object.values(SKILLS).map((s) => ({ value: s.key, label: s.label })),
      default: 'solid',
    },
  },

  seatNames(room) {
    const names = [];
    let bot = 0;
    for (let s = 0; s < 4; s++) {
      if (s < room.humanCount) names.push(room.seats[s]?.name || `Player ${s + 1}`);
      else names.push(BOT_POOL[bot++]);
    }
    return names;
  },

  create(room) {
    room.skill = skillByKey(room.options?.difficulty);
    return new EuchreGame({ names: this.seatNames(room) });
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
      case 'bid1':
        return game.bid1(seat, { order: !!action.order, alone: !!action.alone });
      case 'bid2':
        return game.bid2(seat, { suit: action.suit || null, alone: !!action.alone });
      case 'discard':
        return game.discard(seat, action.card);
      case 'play':
        return game.playCard(seat, action.card);
      case 'nextHand': {
        if (game.phase !== 'handOver') throw new Error('hand is not over');
        // Everyone looks up from the result before the next deal.
        if (ctx.markReady(seat)) game.nextHand();
        return;
      }
      case 'newGame':
        if (game.phase !== 'gameOver') throw new Error('game is not over');
        ctx.restart();
        // Tell the room layer not to advance again — a second broadcast of the
        // same state makes every client take its turn twice.
        return 'restarted';
      default:
        throw new Error(`unknown action ${action.kind}`);
    }
  },

  /**
   * What should happen by itself, and after how long. Returning null means the
   * game is waiting on a person.
   */
  step(game, room) {
    if (game.phase === 'trickComplete') {
      return { delay: TRICK_SWEEP, run: () => game.finishTrick() };
    }
    if (game.phase === 'handOver' || game.phase === 'gameOver') return null;

    // A dealer sitting out a loner still discards, but the hand is dead —
    // don't make a person click through a meaningless choice.
    if (game.phase === 'discard' && game.dealer === game.sittingOut &&
        !this.isBotSeat(room, game.dealer)) {
      return { delay: 400, run: () => game.discard(game.dealer, botDiscard(game, game.dealer)) };
    }

    if (this.isBotSeat(room, game.turn)) {
      return {
        delay: BOT_THINK_MIN + Math.random() * BOT_THINK_SPREAD,
        run: () => botAct(game, game.turn, room.skill || DEFAULT_SKILL),
      };
    }
    return null;
  },
};
