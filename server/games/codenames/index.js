// Codenames Duet as a game module. Two people, on the same side.

import { CodenamesGame } from './engine.js';

export default {
  id: 'codenames',
  name: 'Codenames Duet',
  blurb: 'Co-op word clues. Find all fifteen agents, dodge the assassins.',
  icon: '🕵️',
  seats: 2,
  minPlayers: 2,
  maxPlayers: 2,
  usesBots: false,

  options: {
    turns: {
      label: 'Turns',
      values: [
        { value: '11', label: '11 · gentle' },
        { value: '9', label: '9 · standard' },
        { value: '7', label: '7 · tough' },
      ],
      default: '9',
    },
  },

  seatNames(room) {
    return Array.from({ length: room.humanCount }, (_, s) =>
      room.seats[s]?.name || `Player ${s + 1}`);
  },

  create(room) {
    return new CodenamesGame({
      names: this.seatNames(room),
      turns: Number(room.options?.turns) || 9,
    });
  },

  renameSeats(game, names) {
    game.names = names;
  },

  viewFor(game, seat) {
    return game.viewFor(seat);
  },

  isBotSeat: () => false,

  outcome(game) {
    if (game.phase !== 'gameOver') return null;
    return {
      winners: game.result.won ? [0, 1] : [],
      coop: true,
      score: game.result.won
        ? `${game.turnsTotal - game.turnsLeft} turns`
        : `${game.agentsFound}/15`,
    };
  },

  applyAction(game, seat, action, ctx) {
    switch (action.kind) {
      case 'clue':
        return game.giveClue(seat, action.word, action.number);
      case 'guess':
        return game.guess(seat, action.card);
      case 'stop':
        return game.stop(seat);
      case 'newGame':
        if (game.phase !== 'gameOver') throw new Error('game is not over');
        ctx.restart();
        return 'restarted';
      default:
        throw new Error(`unknown action ${action.kind}`);
    }
  },

  step() {
    return null;
  },
};
