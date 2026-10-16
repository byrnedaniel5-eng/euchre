// Connect Four engine.
//
// Seven columns, six rows, drop a disc, four in a line wins. The only decision
// worth writing down is who goes first: the first player has a forced win with
// perfect play, so a rematch hands the opening move to the other side rather
// than letting whoever made the room start every game.
//
// Phases:
//   'playing'  - waiting on whoever's turn it is
//   'gameOver' - four in a row, or a full board

export const COLS = 7;
export const ROWS = 6;
export const CELLS = COLS * ROWS;

/** Cell index from column and row, row 0 at the bottom. */
export const at = (c, r) => r * COLS + c;

// Every line of four on the board, worked out once.
export const LINES = (() => {
  const lines = [];
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      for (const [dc, dr] of dirs) {
        const ec = c + dc * 3;
        const er = r + dr * 3;
        if (ec < 0 || ec >= COLS || er < 0 || er >= ROWS) continue;
        lines.push([0, 1, 2, 3].map((k) => at(c + dc * k, r + dr * k)));
      }
    }
  }
  return lines;
})();

/** The row a disc dropped in this column would land on, or -1 if it is full. */
export function landingRow(board, col) {
  for (let r = 0; r < ROWS; r++) if (board[at(col, r)] === -1) return r;
  return -1;
}

/** The winning line through the board, if there is one. */
export function winningLine(board) {
  for (const line of LINES) {
    const v = board[line[0]];
    if (v !== -1 && v === board[line[1]] && v === board[line[2]] && v === board[line[3]]) {
      return line;
    }
  }
  return null;
}

export class ConnectFourGame {
  constructor({ names = [], first = 0 } = {}) {
    this.names = names;
    this.board = new Array(CELLS).fill(-1);
    this.turn = first;
    this.first = first;
    this.phase = 'playing';
    this.winner = null;
    this.line = null;
    this.lastMove = null;
    this.moves = 0;
    this.log = [`--- ${names[first]} goes first ---`];
  }

  drop(seat, col) {
    if (this.phase !== 'playing') throw new Error('the game is over');
    if (seat !== this.turn) throw new Error('not your turn');
    col = Number(col);
    if (!Number.isInteger(col) || col < 0 || col >= COLS) throw new Error('no such column');
    const row = landingRow(this.board, col);
    if (row < 0) throw new Error('that column is full');

    const cell = at(col, row);
    this.board[cell] = seat;
    this.moves++;
    this.lastMove = { seat, col, row, cell, n: this.moves };

    const line = winningLine(this.board);
    if (line) {
      this.phase = 'gameOver';
      this.winner = seat;
      this.line = line;
      this.log.push(`*** ${this.names[seat]} connects four ***`);
      return;
    }
    if (this.moves === CELLS) {
      this.phase = 'gameOver';
      this.log.push('*** Board full — a draw ***');
      return;
    }
    this.turn = 1 - seat;
  }

  viewFor(seat) {
    return {
      phase: this.phase,
      game: 'connect4',
      names: this.names,
      cols: COLS,
      rows: ROWS,
      board: this.board.slice(),
      turn: this.turn,
      first: this.first,
      yourTurn: this.phase === 'playing' && this.turn === seat,
      winner: this.winner,
      line: this.line,
      lastMove: this.lastMove,
      log: this.log.slice(-12),
    };
  }
}
