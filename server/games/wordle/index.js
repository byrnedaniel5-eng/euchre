// Word Race as a game module: everyone, the same hidden word, at once.

import { WordRaceGame } from './engine.js';

export default {
  id: 'wordle',
  name: 'Word Race',
  blurb: 'Same five-letter word, six guesses each. Fewer guesses wins.',
  icon: '🟩',
  seats: 8,
  minPlayers: 1,
  maxPlayers: 8,
  usesBots: false,

  options: {
    words: {
      label: 'Words',
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
    // Kept on the room, so a rematch never serves a word you have just had.
    room.wordleUsed ||= new Set();
    return new WordRaceGame({
      names: this.seatNames(room),
      playerCount: room.humanCount,
      words: Number(room.options?.words) || 3,
      used: room.wordleUsed,
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
    return { winners: game.winners(), score: game.scores.join('–') };
  },

  applyAction(game, seat, action, ctx) {
    switch (action.kind) {
      case 'guess':
        return game.guess(seat, action.word);
      case 'next':
        if (game.phase !== 'reveal') throw new Error('the round is not over');
        if (ctx.markReady(seat)) game.afterReveal();
        return;
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
