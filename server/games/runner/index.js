// Lava Run as a game module.
//
// The one genuinely new thing here: position updates are high-frequency and go
// out as their own small message, never through the state broadcast — the same
// treatment the drawing game gives its ink, for the same reason.

import { RunnerGame, COUNTDOWN_MS, ROUND_CAP_SECONDS } from './engine.js';

const FAST = process.env.EUCHRE_FAST === '1';

export default {
  id: 'runner',
  name: 'Lava Run',
  blurb: 'Tap to jump, hold to jump further. Last one out of the lava wins.',
  icon: '🌋',
  seats: 8,
  // Solo is a time trial against the closing edge, which is a real game in
  // itself and the only way to practise a course without an audience.
  minPlayers: 1,
  maxPlayers: 8,
  usesBots: false,

  options: {
    rounds: {
      label: 'Rounds',
      values: [
        { value: '1', label: '1' },
        { value: '3', label: '3' },
        { value: '5', label: '5' },
      ],
      default: '3',
    },
  },

  seatNames(room) {
    return Array.from({ length: room.humanCount }, (_, s) =>
      room.seats[s]?.name || `Player ${s + 1}`);
  },

  create(room) {
    return new RunnerGame({
      names: this.seatNames(room),
      playerCount: room.humanCount,
      rounds: Number(room.options?.rounds) || 3,
    });
  },

  renameSeats(game, names) {
    game.names = names;
  },

  viewFor(game, seat) {
    return game.viewFor(seat);
  },

  isBotSeat: () => false,

  applyAction(game, seat, action, ctx) {
    switch (action.kind) {
      case 'pos': {
        // Where this runner is, relayed straight to the others so they can see
        // each other on the same course. Never part of the game state: at ten
        // a second per player it would swamp the socket for no gain.
        if (game.phase !== 'running') return 'quiet';
        ctx.broadcastRaw({
          type: 'runners',
          seat,
          x: Number(action.x) || 0,
          y: Number(action.y) || 0,
          alive: !!action.alive,
        }, seat);
        return 'quiet';
      }

      case 'died':
        game.reportDeath(seat, action);
        return;

      case 'nextRound':
        if (game.phase !== 'results') throw new Error('the round is not over');
        if (ctx.markReady(seat)) game.nextRound();
        return;

      case 'newGame':
        if (game.phase !== 'gameOver') throw new Error('the game is not over');
        ctx.restart();
        return 'restarted';

      default:
        throw new Error(`unknown action ${action.kind}`);
    }
  },

  step(game) {
    if (game.phase === 'countdown') {
      return {
        delay: Math.max(0, game.startAt - Date.now()),
        run: () => game.begin(),
      };
    }
    if (game.phase === 'running') {
      // A backstop only. Every course ends on its own because the left edge
      // accelerates, but a client that goes silent must not hang the room.
      const cap = FAST ? 8 : ROUND_CAP_SECONDS;
      return {
        delay: Math.max(0, game.startAt + cap * 1000 - Date.now()),
        run: () => game.endRound('time'),
      };
    }
    return null; // results and gameOver wait on the players
  },

  COUNTDOWN_MS,
};
