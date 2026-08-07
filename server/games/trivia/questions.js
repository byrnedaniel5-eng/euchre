// Questions for the trivia game.
//
// Live questions come from the Open Trivia Database (opentdb.com) — free, no
// key, CC BY-SA 4.0. We ask for base64 so nothing arrives HTML-entity encoded,
// and we hold a session token so a room never sees the same question twice.
//
// The API is a third party on the far side of a free-tier host, so every
// category also ships with a bundled fallback. A game must never stall because
// somebody else's server is having a bad afternoon.

const API = 'https://opentdb.com';
const FETCH_TIMEOUT = 6000;
const BUFFER_TARGET = 5; // questions fetched per call, to hide latency

/** The wheel. Eight is as many segments as a phone can read at a glance. */
export const CATEGORIES = [
  { id: 9, name: 'General', color: '#3fa8c9', icon: '💡' },
  { id: 11, name: 'Film', color: '#c2569b', icon: '🎬' },
  { id: 12, name: 'Music', color: '#e0722c', icon: '🎵' },
  { id: 15, name: 'Games', color: '#6f7fe0', icon: '🎮' },
  { id: 17, name: 'Science', color: '#43a86b', icon: '🔬' },
  { id: 22, name: 'Geography', color: '#2f8fd8', icon: '🌍' },
  { id: 23, name: 'History', color: '#b8813a', icon: '🏛️' },
  { id: 21, name: 'Sport', color: '#cc4f52', icon: '⚽' },
];

export const categoryById = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];

const b64 = (s) => Buffer.from(String(s), 'base64').toString('utf8');

function shuffle(list, rng = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Turn one API row into what the game needs: a prompt and four options. */
function toQuestion(row, categoryId, rng) {
  const correct = b64(row.correct_answer);
  const options = shuffle([correct, ...row.incorrect_answers.map(b64)], rng);
  return {
    category: categoryId,
    difficulty: b64(row.difficulty),
    text: b64(row.question),
    options,
    answer: options.indexOf(correct),
  };
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * A per-room supply of questions: one session token, a small buffer per
 * category, and the bundled set to fall back on.
 */
export class QuestionSource {
  constructor({ rng = Math.random, fetchImpl = null } = {}) {
    this.rng = rng;
    this.fetch = fetchImpl; // tests inject a stub rather than hitting the net
    this.token = null;
    this.buffers = new Map(); // categoryId -> question[]
    this.usedFallback = new Set(); // so the bundled set does not repeat either
    this.liveCount = 0;
    this.fallbackCount = 0;
  }

  async ensureToken() {
    if (this.token || this.fetch) return;
    try {
      const data = await getJson(`${API}/api_token.php?command=request`);
      if (data.response_code === 0) this.token = data.token;
    } catch {
      // No token just means we may repeat a question. Not worth failing over.
    }
  }

  async fill(categoryId) {
    const url = `${API}/api.php?amount=${BUFFER_TARGET}&category=${categoryId}` +
      `&type=multiple&encode=base64${this.token ? `&token=${this.token}` : ''}`;
    const data = this.fetch ? await this.fetch(url) : await getJson(url);

    // 4 means this token has served every question it has; start it over.
    if (data.response_code === 4 && this.token) {
      await getJson(`${API}/api_token.php?command=reset&token=${this.token}`).catch(() => {});
      this.token = null;
      throw new Error('token exhausted');
    }
    if (data.response_code !== 0 || !Array.isArray(data.results) || !data.results.length) {
      throw new Error(`response_code ${data.response_code}`);
    }
    this.buffers.set(categoryId,
      data.results.map((r) => toQuestion(r, categoryId, this.rng)));
  }

  /** Never throws: falls back to the bundled set rather than stalling a game. */
  async next(categoryId) {
    const buffer = this.buffers.get(categoryId) || [];
    if (buffer.length) {
      this.liveCount++;
      return buffer.shift();
    }
    try {
      await this.ensureToken();
      await this.fill(categoryId);
      const filled = this.buffers.get(categoryId);
      if (filled && filled.length) {
        this.liveCount++;
        return filled.shift();
      }
    } catch {
      // fall through to the bundled set
    }
    this.fallbackCount++;
    return this.fromFallback(categoryId);
  }

  fromFallback(categoryId) {
    const pool = FALLBACK.filter((q) => q.category === categoryId);
    const fresh = pool.filter((q) => !this.usedFallback.has(q.text));
    const pick = (fresh.length ? fresh : pool)[
      Math.floor(this.rng() * (fresh.length ? fresh.length : pool.length))
    ];
    this.usedFallback.add(pick.text);
    const options = shuffle(pick.options, this.rng);
    return {
      category: categoryId,
      difficulty: pick.difficulty || 'medium',
      text: pick.text,
      options,
      answer: options.indexOf(pick.options[pick.answer]),
      bundled: true,
    };
  }
}

// --------------------------------------------------------------- fallback

/** Enough per category to carry a full game if the API is unreachable. */
export const FALLBACK = [
  { category: 9, difficulty: 'easy', text: 'How many sides does a hexagon have?',
    options: ['Six', 'Five', 'Seven', 'Eight'], answer: 0 },
  { category: 9, difficulty: 'medium', text: 'What is the most widely spoken first language in the world?',
    options: ['Mandarin Chinese', 'English', 'Spanish', 'Hindi'], answer: 0 },
  { category: 9, difficulty: 'easy', text: 'What is the currency of Japan?',
    options: ['Yen', 'Won', 'Yuan', 'Ringgit'], answer: 0 },
  { category: 9, difficulty: 'medium', text: 'Which blood type is the universal donor?',
    options: ['O negative', 'AB positive', 'A negative', 'B positive'], answer: 0 },

  { category: 11, difficulty: 'easy', text: 'Who directed the film "Jaws"?',
    options: ['Steven Spielberg', 'George Lucas', 'Ridley Scott', 'Martin Scorsese'], answer: 0 },
  { category: 11, difficulty: 'medium', text: 'Which film won the first Academy Award for Best Picture?',
    options: ['Wings', 'Sunrise', 'The Jazz Singer', 'Metropolis'], answer: 0 },
  { category: 11, difficulty: 'easy', text: 'In "The Wizard of Oz", what colour are Dorothy’s slippers in the film?',
    options: ['Ruby red', 'Silver', 'Emerald green', 'Gold'], answer: 0 },
  { category: 11, difficulty: 'medium', text: 'Which actor played Forrest Gump?',
    options: ['Tom Hanks', 'Kevin Costner', 'Bill Murray', 'Robin Williams'], answer: 0 },

  { category: 12, difficulty: 'easy', text: 'How many strings does a standard violin have?',
    options: ['Four', 'Five', 'Six', 'Three'], answer: 0 },
  { category: 12, difficulty: 'medium', text: 'Which band released the album "Rumours"?',
    options: ['Fleetwood Mac', 'The Eagles', 'Queen', 'ABBA'], answer: 0 },
  { category: 12, difficulty: 'easy', text: 'Which instrument did Louis Armstrong famously play?',
    options: ['Trumpet', 'Saxophone', 'Piano', 'Clarinet'], answer: 0 },
  { category: 12, difficulty: 'medium', text: 'What does the musical term "forte" mean?',
    options: ['Loud', 'Fast', 'Soft', 'Slow'], answer: 0 },

  { category: 15, difficulty: 'easy', text: 'What is the name of the plumber in Nintendo’s flagship series?',
    options: ['Mario', 'Luigi', 'Wario', 'Toad'], answer: 0 },
  { category: 15, difficulty: 'medium', text: 'Which game popularised the "battle royale" genre in 2017?',
    options: ['PUBG', 'Fortnite', 'Apex Legends', 'Warzone'], answer: 0 },
  { category: 15, difficulty: 'easy', text: 'What colour is Sonic the Hedgehog?',
    options: ['Blue', 'Red', 'Green', 'Yellow'], answer: 0 },
  { category: 15, difficulty: 'medium', text: 'Which company created the PlayStation?',
    options: ['Sony', 'Sega', 'Microsoft', 'Atari'], answer: 0 },

  { category: 17, difficulty: 'easy', text: 'What is the chemical symbol for gold?',
    options: ['Au', 'Ag', 'Gd', 'Go'], answer: 0 },
  { category: 17, difficulty: 'medium', text: 'How many bones are there in an adult human body?',
    options: ['206', '198', '224', '186'], answer: 0 },
  { category: 17, difficulty: 'easy', text: 'Which planet is closest to the Sun?',
    options: ['Mercury', 'Venus', 'Mars', 'Earth'], answer: 0 },
  { category: 17, difficulty: 'medium', text: 'What gas do plants absorb from the atmosphere?',
    options: ['Carbon dioxide', 'Oxygen', 'Nitrogen', 'Hydrogen'], answer: 0 },

  { category: 22, difficulty: 'easy', text: 'What is the capital of Australia?',
    options: ['Canberra', 'Sydney', 'Melbourne', 'Perth'], answer: 0 },
  { category: 22, difficulty: 'medium', text: 'Which is the longest river in the world?',
    options: ['The Nile', 'The Amazon', 'The Yangtze', 'The Mississippi'], answer: 0 },
  { category: 22, difficulty: 'easy', text: 'Which country has the most time zones?',
    options: ['France', 'Russia', 'The United States', 'China'], answer: 0 },
  { category: 22, difficulty: 'medium', text: 'On which continent is the Atacama Desert?',
    options: ['South America', 'Africa', 'Asia', 'Australia'], answer: 0 },

  { category: 23, difficulty: 'easy', text: 'In which year did the Second World War end?',
    options: ['1945', '1944', '1946', '1939'], answer: 0 },
  { category: 23, difficulty: 'medium', text: 'Who was the first woman to win a Nobel Prize?',
    options: ['Marie Curie', 'Rosalind Franklin', 'Dorothy Hodgkin', 'Ada Lovelace'], answer: 0 },
  { category: 23, difficulty: 'easy', text: 'Which civilisation built Machu Picchu?',
    options: ['The Inca', 'The Aztec', 'The Maya', 'The Olmec'], answer: 0 },
  { category: 23, difficulty: 'medium', text: 'The Berlin Wall fell in which year?',
    options: ['1989', '1991', '1987', '1993'], answer: 0 },

  { category: 21, difficulty: 'easy', text: 'How many players are on the pitch per side in football?',
    options: ['Eleven', 'Ten', 'Twelve', 'Nine'], answer: 0 },
  { category: 21, difficulty: 'medium', text: 'How often are the Summer Olympic Games held?',
    options: ['Every four years', 'Every two years', 'Every three years', 'Every five years'], answer: 0 },
  { category: 21, difficulty: 'easy', text: 'In tennis, what is a score of zero called?',
    options: ['Love', 'Nil', 'Duck', 'Blank'], answer: 0 },
  { category: 21, difficulty: 'medium', text: 'Which country has won the most FIFA World Cups?',
    options: ['Brazil', 'Germany', 'Italy', 'Argentina'], answer: 0 },
];
