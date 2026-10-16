// Know Me as a game module. Two to eight people.

import { KnowMeGame } from './engine.js';

export default {
  id: 'knowme',
  name: 'Know Me',
  blurb: 'How well do you know each other? Answer for yourself, guess for them.',
  icon: '💭',
  seats: 8,
  minPlayers: 2,
  maxPlayers: 8,
  usesBots: false,

  options: {
    deck: {
      label: 'Questions',
      values: [
        { value: 'everyone', label: 'Anyone' },
        { value: 'couples', label: 'Couples' },
      ],
      default: 'everyone',
    },
    rounds: {
      label: 'Rounds each',
      values: [
        { value: '3', label: '3' },
        { value: '5', label: '5' },
        { value: '8', label: '8' },
      ],
      default: '5',
    },
  },

  seatNames(room) {
    return Array.from({ length: room.humanCount }, (_, s) =>
      room.seats[s]?.name || `Player ${s + 1}`);
  },

  create(room) {
    return new KnowMeGame({
      names: this.seatNames(room),
      playerCount: room.humanCount,
      roundsEach: Number(room.options?.rounds) || 5,
      deck: room.options?.deck === 'couples' ? 'couples' : 'everyone',
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
    const best = Math.max(...game.scores);
    return {
      winners: game.scores.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0),
      score: game.scores.join('–'),
    };
  },

  applyAction(game, seat, action, ctx) {
    switch (action.kind) {
      case 'swap':
        return game.swap(seat);
      case 'custom':
        return game.custom(seat, action.text);
      case 'ask':
        return game.ask(seat);
      case 'answer':
        return game.answer(seat, action.value);
      case 'judge':
        return game.judge(seat, action.seat, action.mark);
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
