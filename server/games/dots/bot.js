// The Dots and Boxes bot.
//
// The whole game turns on one idea: never draw the third side of a box,
// because that hands it to the next player. So the bot takes any box that is
// sitting there, then draws a "safe" line that gives nothing away while any
// are left. When none are, every move gives something away — the sharp bot
// works out how many boxes each move would hand over and gives the least.

export const SKILLS = {
  // `safe` is how often it remembers the rule about third sides.
  easy: { key: 'easy', label: 'Easy', takes: 0.85, safe: 0.55, counts: false },
  casual: { key: 'casual', label: 'Casual', takes: 1, safe: 1, counts: false },
  sharp: { key: 'sharp', label: 'Sharp', takes: 1, safe: 1, counts: true },
};
export const DEFAULT_SKILL = SKILLS.casual;
export const skillByKey = (k) => SKILLS[k] || DEFAULT_SKILL;

const open = (lines) => lines.map((v, i) => (v === -1 ? i : -1)).filter((i) => i >= 0);

function sides(geo, lines, box) {
  let n = 0;
  for (const e of geo.boxEdges[box]) if (lines[e] !== -1) n++;
  return n;
}

/** Lines that close a box right now. */
const takers = (geo, lines) => open(lines).filter((e) =>
  geo.edgeBoxes[e].some((b) => sides(geo, lines, b) === 3));

/** Lines that leave every neighbouring box with at most two sides. */
const safe = (geo, lines) => open(lines).filter((e) =>
  geo.edgeBoxes[e].every((b) => sides(geo, lines, b) < 2));

/** If this line is drawn, how many boxes can the next player then take in a row? */
function giveaway(geo, linesIn, edge) {
  const lines = linesIn.slice();
  lines[edge] = 0;
  let taken = 0;
  for (;;) {
    const t = takers(geo, lines);
    if (!t.length) return taken;
    const e = t[0];
    lines[e] = 1;
    for (const b of geo.edgeBoxes[e]) if (sides(geo, lines, b) === 4) taken++;
  }
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

export function chooseLine(geo, lines, skill = DEFAULT_SKILL, rng = Math.random) {
  const t = takers(geo, lines);
  if (t.length && rng() < skill.takes) return pick(t, rng);

  if (rng() < skill.safe) {
    const s = safe(geo, lines);
    if (s.length) return pick(s, rng);
  }
  const all = open(lines);
  if (!skill.counts) return pick(all, rng);

  let best = Infinity;
  let choices = [];
  for (const e of all) {
    const g = giveaway(geo, lines, e);
    if (g < best) { best = g; choices = [e]; }
    else if (g === best) choices.push(e);
  }
  return pick(choices, rng);
}
