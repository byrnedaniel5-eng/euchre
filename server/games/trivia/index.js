// Trivia as a game module.
//
// The one thing this game needs that the others did not: fetching a question
// is asynchronous. It happens inside the wheel spin, so the network round trip
// hides behind an animation that was going to run anyway — and if it overruns,
// the wheel simply rests a moment longer rather than the game stalling.

import { TriviaGame, QUESTION_SECONDS, SPIN_MS } from './engine.js';
import { QuestionSource, CATEGORIES } from './questions.js';

const FAST = process.env.EUCHRE_FAST === '1';

export default {
  id: 'trivia',
  name: 'Quiz Wheel',
  blurb: 'Spin for a category. Fastest right answer takes it.',
  icon: '🎡',
  seats: 8,
  minPlayers: 2,
  maxPlayers: 8,
  usesBots: false,

  options: {
    questions: {
      label: 'Questions',
      values: [
        { value: '5', label: '5' },
        { value: '10', label: '10' },
        { value: '15', label: '15' },
      ],
      default: '10',
    },
  },

  seatNames(room) {
    return Array.from({ length: room.humanCount }, (_, s) =>
      room.seats[s]?.name || `Player ${s + 1}`);
  },

  create(room) {
    // One question source per room: one session token, one set of buffers.
    room.questions = new QuestionSource({ fetchImpl: room.options?._fetch || null });
    return new TriviaGame({
      names: this.seatNames(room),
      playerCount: room.humanCount,
      questionCount: Number(room.options?.questions) || 10,
      questionSeconds: FAST ? 3 : QUESTION_SECONDS,
      spinMs: FAST ? 120 : SPIN_MS,
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
      case 'answer':
        game.answer(seat, action.choice);
        return;

      case 'spin':
        game.spin(seat);
        return;

      case 'nextQuestion':
        if (game.phase !== 'reveal') throw new Error('the question is not over');
        // Everyone reads the answer before the wheel comes back round.
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

  step(game, room) {
    if (game.phase === 'spinning') {
      return {
        delay: Math.max(0, game.deadline - Date.now()),
        // Async: the room layer awaits this before broadcasting again.
        run: async () => {
          const q = await room.questions.next(game.spunCategory);
          game.beginQuestion(q);
        },
      };
    }
    if (game.phase === 'question') {
      return {
        delay: Math.max(0, game.deadline - Date.now()),
        run: () => game.endQuestion('time'),
      };
    }
    // reveal, toSpin and gameOver all wait on the players.
    return null;
  },

  CATEGORIES,
};
