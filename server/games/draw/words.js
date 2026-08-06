// Prompts for the drawing game, in three difficulties. Chosen to be drawable
// with a finger on a phone in about a minute — concrete nouns and vivid
// actions, nothing that needs fine detail or writing.

export const WORDS = {
  easy: [
    'cat', 'house', 'tree', 'sun', 'boat', 'fish', 'star', 'car', 'hat', 'moon',
    'apple', 'key', 'cup', 'shoe', 'clock', 'ladder', 'snake', 'balloon', 'cloud',
    'flower', 'bridge', 'guitar', 'pizza', 'chair', 'door', 'egg', 'glasses',
    'heart', 'mountain', 'pencil', 'rainbow', 'sock', 'spider', 'train', 'umbrella',
    'banana', 'bed', 'bell', 'book', 'bone', 'bucket', 'cake', 'candle', 'carrot',
    'crown', 'drum', 'duck', 'eye', 'fork', 'ghost', 'hammer', 'ice cream',
    'island', 'kite', 'lamp', 'leaf', 'lock', 'mushroom', 'nest', 'owl', 'phone',
    'rabbit', 'ring', 'robot', 'sandwich', 'ship', 'snowman', 'sword', 'teapot',
    'tent', 'tooth', 'whale', 'window', 'worm', 'zebra',
  ],
  medium: [
    'lighthouse', 'octopus', 'telescope', 'volcano', 'windmill', 'skeleton',
    'waterfall', 'hedgehog', 'submarine', 'scarecrow', 'chandelier', 'campfire',
    'jellyfish', 'motorbike', 'penguin', 'pineapple', 'roller coaster', 'sunflower',
    'treasure map', 'typewriter', 'vending machine', 'wheelbarrow', 'accordion',
    'anchor', 'avalanche', 'beehive', 'binoculars', 'birdcage', 'blender',
    'cactus', 'cathedral', 'chess board', 'compass', 'dragonfly', 'escalator',
    'fireplace', 'fountain', 'greenhouse', 'harp', 'helicopter', 'igloo',
    'kangaroo', 'lantern', 'microscope', 'parachute', 'pirate', 'porcupine',
    'sandcastle', 'satellite', 'seahorse', 'shipwreck', 'snail', 'stethoscope',
    'sundial', 'tornado', 'trampoline', 'walrus', 'wheelchair', 'xylophone',
  ],
  hard: [
    'gravity', 'jealousy', 'nostalgia', 'deja vu', 'rush hour', 'spring cleaning',
    'stage fright', 'time travel', 'writer’s block', 'cold feet', 'brain freeze',
    'butterflies', 'chain reaction', 'culture shock', 'double trouble',
    'eavesdropping', 'first impression', 'growing pains', 'hangover',
    'inside joke', 'last minute', 'long distance', 'lost in translation',
    'midlife crisis', 'mixed signals', 'overthinking', 'paper cut', 'peer pressure',
    'plot twist', 'procrastination', 'road trip', 'second guessing',
    'sleep walking', 'small talk', 'stalemate', 'sweet tooth', 'tug of war',
    'wild goose chase', 'winging it', 'awkward silence',
  ],
};

export const ALL_WORDS = [...WORDS.easy, ...WORDS.medium, ...WORDS.hard];

/** Three prompts to choose from, one of each difficulty, none repeated. */
export function offerWords(used = new Set(), rng = Math.random) {
  const pick = (list) => {
    const fresh = list.filter((w) => !used.has(w));
    const pool = fresh.length ? fresh : list;
    return pool[Math.floor(rng() * pool.length)];
  };
  const out = [];
  for (const tier of ['easy', 'medium', 'hard']) {
    let w = pick(WORDS[tier]);
    let guard = 0;
    while (out.includes(w) && guard++ < 20) w = pick(WORDS[tier]);
    out.push(w);
  }
  return out;
}

/**
 * Is a typed guess right? Forgiving about case, spacing, punctuation and a
 * trailing plural, because people type fast on a phone and being pedantic
 * about "lighthouses" would just be annoying.
 */
export function matchesWord(guess, word) {
  const norm = (s) => String(s)
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const a = norm(guess);
  const b = norm(word);
  if (!a) return false;
  if (a === b) return true;
  // Compare every plural form of both sides rather than trying to strip one
  // side down: "lighthouse" does not end in s, but "lighthouses" ends in "es",
  // so stripping alone turns them into different words.
  const forms = (s) => new Set([
    s,
    s.replace(/ies$/, 'y'),
    s.replace(/es$/, ''),
    s.replace(/s$/, ''),
    s + 's',
    s + 'es',
    s.replace(/y$/, 'ies'),
  ]);
  const fa = forms(a);
  return [...forms(b)].some((f) => fa.has(f));
}

/** How close a wrong guess is, so the UI can say "very close". */
export function isNearMiss(guess, word) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const a = norm(guess);
  const b = norm(word);
  if (!a || !b || a === b) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  // Levenshtein distance, capped at 2 — a typo, not a different answer.
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return d[a.length][b.length] <= 2;
}
