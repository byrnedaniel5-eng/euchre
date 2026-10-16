// The Connect Four bot: negamax with alpha-beta, searching a fixed number of
// moves ahead and scoring the board it reaches by its open lines.
//
// Difficulty is how far it looks and how often it fumbles. Even the easy one
// takes a win that is sitting there and blocks one that is about to happen —
// a bot that walks past a four-in-a-row is not easy, it is broken.

import { COLS, ROWS, LINES, at, landingRow, winningLine } from './engine.js';

export const SKILLS = {
  easy: { key: 'easy', label: 'Easy', depth: 2, slip: 0.35 },
  casual: { key: 'casual', label: 'Casual', depth: 4, slip: 0.1 },
  sharp: { key: 'sharp', label: 'Sharp', depth: 8, slip: 0 },
};
export const DEFAULT_SKILL = SKILLS.casual;
export const skillByKey = (k) => SKILLS[k] || DEFAULT_SKILL;

// Centre columns first: they sit in the most lines, so searching them first
// makes the pruning bite much earlier.
const ORDER = [3, 2, 4, 1, 5, 0, 6];
const WIN = 1_000_000;

/** A static guess at how good a board is for `me`: open threes and twos. */
function evaluate(board, me) {
  let score = 0;
  for (const line of LINES) {
    let mine = 0;
    let theirs = 0;
    for (const c of line) {
      if (board[c] === me) mine++;
      else if (board[c] !== -1) theirs++;
    }
    if (mine && theirs) continue;
    if (mine === 3) score += 50;
    else if (mine === 2) score += 5;
    else if (theirs === 3) score -= 60;
    else if (theirs === 2) score -= 5;
  }
  // The centre column is worth a little on its own.
  for (let r = 0; r < ROWS; r++) if (board[at(3, r)] === me) score += 3;
  return score;
}

const legal = (board) => ORDER.filter((c) => landingRow(board, c) >= 0);

function negamax(board, depth, alpha, beta, me, moves) {
  const options = legal(board);
  if (!options.length) return 0;
  if (depth === 0) return evaluate(board, me);

  let best = -Infinity;
  for (const col of options) {
    const cell = at(col, landingRow(board, col));
    board[cell] = me;
    let score;
    if (winningLine(board)) score = WIN - moves; // sooner is better
    else score = -negamax(board, depth - 1, -beta, -alpha, 1 - me, moves + 1);
    board[cell] = -1;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** Wins now, else blocks a loss now; otherwise null. Never skipped. */
function forced(board, me) {
  for (const who of [me, 1 - me]) {
    for (const col of legal(board)) {
      const cell = at(col, landingRow(board, col));
      board[cell] = who;
      const won = !!winningLine(board);
      board[cell] = -1;
      if (won) return col;
    }
  }
  return null;
}

export function chooseColumn(boardIn, me, skill = DEFAULT_SKILL, rng = Math.random) {
  const board = boardIn.slice();
  const must = forced(board, me);
  if (must !== null) return must;

  const options = legal(board);
  if (rng() < skill.slip) return options[Math.floor(rng() * options.length)];

  let best = -Infinity;
  let picks = [];
  for (const col of options) {
    const cell = at(col, landingRow(board, col));
    board[cell] = me;
    const score = winningLine(board)
      ? WIN
      : -negamax(board, skill.depth - 1, -Infinity, Infinity, 1 - me, 1);
    board[cell] = -1;
    if (score > best) { best = score; picks = [col]; }
    else if (score === best) picks.push(col);
  }
  // Equal moves are broken at random, so two games never play out the same.
  return picks[Math.floor(rng() * picks.length)];
}

export { COLS };
