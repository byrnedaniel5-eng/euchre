// Dots and Boxes engine.
//
// Take turns drawing one line between two dots. Close the fourth side of a
// box and it is yours, and you go again. Most boxes when the lines run out
// wins.
//
// Lines are numbered: every horizontal one first, row by row, then every
// vertical one. A line touches one box on the edge of the board and two
// anywhere else.
//
// Phases:
//   'playing'  - waiting on whoever's turn it is
//   'gameOver' - every line drawn

export function geometry(rows, cols) {
  const H = (rows + 1) * cols;
  const V = rows * (cols + 1);
  const h = (r, c) => r * cols + c;
  const v = (r, c) => H + r * (cols + 1) + c;
  const boxEdges = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) boxEdges.push([h(r, c), h(r + 1, c), v(r, c), v(r, c + 1)]);
  }
  const edgeBoxes = Array.from({ length: H + V }, () => []);
  boxEdges.forEach((edges, b) => { for (const e of edges) edgeBoxes[e].push(b); });
  return { rows, cols, H, V, edges: H + V, boxes: rows * cols, boxEdges, edgeBoxes };
}

export class DotsGame {
  constructor({ names = [], playerCount = 2, rows = 4, cols = 4, first = 0 } = {}) {
    this.names = names;
    this.playerCount = playerCount;
    this.geo = geometry(rows, cols);
    this.lines = new Array(this.geo.edges).fill(-1);  // who drew it
    this.owner = new Array(this.geo.boxes).fill(-1);  // who closed it
    this.scores = new Array(playerCount).fill(0);
    this.turn = first;
    this.first = first;
    this.phase = 'playing';
    this.lastLine = null;
    this.moves = 0;
    this.log = [`--- ${names[first]} draws first ---`];
  }

  sides(box) {
    return this.geo.boxEdges[box].filter((e) => this.lines[e] !== -1).length;
  }

  draw(seat, edge) {
    if (this.phase !== 'playing') throw new Error('the game is over');
    if (seat !== this.turn) throw new Error('not your turn');
    edge = Number(edge);
    if (!Number.isInteger(edge) || edge < 0 || edge >= this.geo.edges) throw new Error('no such line');
    if (this.lines[edge] !== -1) throw new Error('that line is already drawn');

    this.lines[edge] = seat;
    this.moves++;
    const closed = [];
    for (const b of this.geo.edgeBoxes[edge]) {
      if (this.sides(b) === 4) {
        this.owner[b] = seat;
        this.scores[seat]++;
        closed.push(b);
      }
    }
    this.lastLine = { edge, seat, closed, n: this.moves };

    if (this.moves === this.geo.edges) {
      this.phase = 'gameOver';
      const best = Math.max(...this.scores);
      const top = this.scores.map((v, i) => (v === best ? this.names[i] : null)).filter(Boolean);
      this.log.push(top.length > 1 ? `*** A tie on ${best} ***` : `*** ${top[0]} wins with ${best} ***`);
      return;
    }
    // Closing a box earns another line.
    if (!closed.length) this.turn = (this.turn + 1) % this.playerCount;
  }

  winners() {
    const best = Math.max(...this.scores);
    return this.scores.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
  }

  viewFor(seat) {
    return {
      phase: this.phase,
      game: 'dots',
      names: this.names,
      players: this.playerCount,
      rows: this.geo.rows,
      cols: this.geo.cols,
      lines: this.lines,
      owner: this.owner,
      scores: this.scores,
      turn: this.turn,
      yourTurn: this.phase === 'playing' && this.turn === seat,
      lastLine: this.lastLine,
      log: this.log.slice(-12),
    };
  }
}
