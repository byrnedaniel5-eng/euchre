// The drawing game as a game module.
//
// Two differences from euchre worth knowing: there are no bots (nothing to
// draw against), and strokes never travel inside the game state. A state
// broadcast on every finger movement would be enormous, so ink is pushed as
// its own small message and the full board is only replayed to someone who
// has just joined or reconnected.

import { DrawGame, CHOOSE_SECONDS, DRAW_SECONDS } from './engine.js';

const FAST = process.env.EUCHRE_FAST === '1';

export default {
  id: 'draw',
  name: 'Draw It',
  blurb: 'One of you draws, the rest guess against the clock.',
  icon: '✏️',
  seats: 4,
  defaultPlayers: 2,
  minPlayers: 2,
  maxPlayers: 4,
  usesBots: false,

  options: {
    turns: {
      label: 'Turns each',
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
    return new DrawGame({
      names: this.seatNames(room),
      playerCount: room.humanCount,
      turnsEach: Number(room.options?.turns) || 3,
      chooseSeconds: FAST ? 3 : CHOOSE_SECONDS,
      drawSeconds: FAST ? 5 : DRAW_SECONDS,
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
      case 'choose':
        game.chooseWord(seat, action.word);
        return;

      case 'stroke': {
        const stroke = game.addStroke(seat, action.stroke);
        // Straight out to the other players, bypassing the state broadcast.
        if (stroke) ctx.broadcastRaw({ type: 'ink', op: 'add', stroke }, seat);
        return 'quiet';
      }

      case 'clear':
        game.clearBoard(seat);
        ctx.broadcastRaw({ type: 'ink', op: 'clear' }, seat);
        return 'quiet';

      case 'undo':
        game.undoStroke(seat);
        ctx.broadcastRaw({ type: 'ink', op: 'replace', strokes: game.strokes }, seat);
        return 'quiet';

      case 'guess': {
        const result = game.guess(seat, action.text);
        if (!result.correct) {
          // Wrong guesses are chat: everyone sees them, including the drawer.
          ctx.broadcastRaw({
            type: 'guess',
            entry: { seat, name: game.names[seat], text: String(action.text).slice(0, 60),
                     near: result.near },
          });
        }
        return;
      }

      case 'giveUp':
        if (seat !== game.drawer) throw new Error('only the drawer can give up');
        game.endTurn('gave up');
        return;

      case 'nextTurn':
        if (game.phase !== 'reveal') throw new Error('turn is not over');
        if (ctx.markReady(seat)) game.nextTurn();
        return;

      case 'newGame':
        if (game.phase !== 'gameOver') throw new Error('game is not over');
        ctx.restart();
        return 'restarted';

      default:
        throw new Error(`unknown action ${action.kind}`);
    }
  },

  /** The only thing that happens by itself here is the clock running out. */
  step(game) {
    if (game.phase === 'choosing') {
      return {
        delay: Math.max(0, game.deadline - Date.now()),
        run: () => game.autoChooseWord(),
      };
    }
    if (game.phase === 'drawing') {
      return {
        delay: Math.max(0, game.deadline - Date.now()),
        run: () => game.endTurn('time'),
      };
    }
    return null; // reveal and gameOver wait on the players
  },

  /** Replay the board to someone who just connected. */
  onJoin(game, seat, sendToSocket) {
    // The first player to arrive joins before there is a game at all.
    if (game?.strokes?.length) {
      sendToSocket({ type: 'ink', op: 'replace', strokes: game.strokes });
    }
  },

  CHOOSE_SECONDS,
};
