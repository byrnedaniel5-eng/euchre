// Wavelength as a game module. Two to eight; with two it is co-op.

import { WavelengthGame } from './engine.js';

export default {
  id: 'wavelength',
  name: 'Wavelength',
  blurb: 'One of you sees the target. Give a clue; they turn the dial.',
  icon: '📡',
  seats: 8,
  minPlayers: 2,
  maxPlayers: 8,
  usesBots: false,

  options: {
    rounds: {
      label: 'Rounds each',
      values: [
        { value: '2', label: '2' },
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
    return new WavelengthGame({
      names: this.seatNames(room),
      playerCount: room.humanCount,
      roundsEach: Number(room.options?.rounds) || 3,
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
    if (game.coop) {
      // Together, a "win" is being more in sync than not.
      return {
        winners: game.syncPercent() >= 50 ? [0, 1] : [],
        coop: true,
        score: `${game.team}/${game.totalRounds * 4}`,
      };
    }
    return { winners: game.winners(), score: game.scores.join('–') };
  },

  applyAction(game, seat, action, ctx) {
    switch (action.kind) {
      case 'skip':
        return game.skip(seat);
      case 'clue':
        return game.giveClue(seat, action.text);
      case 'dial':
        game.setDial(seat, action.value);
        // Guessers never see each other's dials before the reveal, but the
        // psychic watches every one move — keeping a straight face while
        // your partner drifts the wrong way is half of the boxed game.
        ctx.sendTo(game.psychic, { type: 'wl-dial', seat, value: game.dials[seat], round: game.round });
        return 'quiet';
      case 'lock':
        return game.lock(seat, action.value);
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
