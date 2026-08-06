// Prompts for the drawing game, in three difficulties. Chosen to be drawable
// with a finger on a phone in about a minute — concrete nouns and vivid
// actions, nothing that needs fine detail or writing.

export const WORDS = {
  easy: [
    'cat', 'house', 'tree', 'sun', 'boat', 'fish', 'star', 'car', 'hat',
    'moon', 'apple', 'key', 'cup', 'shoe', 'clock', 'ladder', 'snake',
    'balloon', 'cloud', 'flower', 'bridge', 'guitar', 'pizza', 'chair',
    'door', 'egg', 'glasses', 'heart', 'mountain', 'pencil', 'rainbow',
    'sock', 'spider', 'train', 'umbrella', 'banana', 'bed', 'bell', 'book',
    'bone', 'bucket', 'cake', 'candle', 'carrot', 'crown', 'drum', 'duck',
    'eye', 'fork', 'ghost', 'hammer', 'ice cream', 'island', 'kite', 'lamp',
    'leaf', 'lock', 'mushroom', 'nest', 'owl', 'phone', 'rabbit', 'ring',
    'robot', 'sandwich', 'ship', 'snowman', 'sword', 'teapot', 'tent',
    'tooth', 'whale', 'window', 'worm', 'zebra', 'axe', 'baby', 'backpack',
    'ball', 'bat', 'beach', 'bee', 'belt', 'bicycle', 'bird', 'bowl', 'box',
    'bread', 'brick', 'broom', 'bus', 'butterfly', 'button', 'camera',
    'candy', 'cannon', 'cap', 'castle', 'chain', 'cheese', 'cherry',
    'chicken', 'chimney', 'coat', 'coin', 'comb', 'cow', 'crab', 'dice',
    'dog', 'dolphin', 'donut', 'dragon', 'dress', 'ear', 'elephant',
    'envelope', 'fan', 'feather', 'fence', 'finger', 'fire', 'flag', 'foot',
    'frog', 'glove', 'grapes', 'hand', 'helmet', 'hill', 'hook', 'horse',
    'hourglass', 'jar', 'kettle', 'keyboard', 'knife', 'lemon', 'lightning',
    'lion', 'lips', 'magnet', 'map', 'medal', 'mirror', 'monkey', 'mouse',
    'mug', 'nail', 'needle', 'nose', 'onion', 'paintbrush', 'pan', 'pear',
    'pen', 'pig', 'pillow', 'plane', 'plate', 'pot', 'pumpkin', 'rain',
    'river', 'road', 'rocket', 'rope', 'ruler', 'sail', 'saw', 'scarf',
    'scissors', 'seed', 'sheep', 'shell', 'shirt', 'shovel', 'skull', 'sled',
    'slide', 'snowflake', 'sofa', 'spoon', 'squirrel', 'stairs', 'stamp',
    'starfish', 'stool', 'swan', 'swing', 'table', 'tail', 'tie', 'tiger',
    'toaster', 'tomato', 'torch', 'tractor', 'traffic light', 'tray', 'truck',
    'trumpet', 'turtle', 'van', 'vase', 'violin', 'watch', 'wave', 'well',
    'wheel', 'whistle', 'wolf', 'wrench',
  ],
  medium: [
    'lighthouse', 'octopus', 'telescope', 'volcano', 'windmill', 'skeleton',
    'waterfall', 'hedgehog', 'submarine', 'scarecrow', 'chandelier',
    'campfire', 'jellyfish', 'motorbike', 'penguin', 'pineapple',
    'roller coaster', 'sunflower', 'treasure map', 'typewriter',
    'vending machine', 'wheelbarrow', 'accordion', 'anchor', 'avalanche',
    'beehive', 'binoculars', 'birdcage', 'blender', 'cactus', 'cathedral',
    'chess board', 'compass', 'dragonfly', 'escalator', 'fireplace',
    'fountain', 'greenhouse', 'harp', 'helicopter', 'igloo', 'kangaroo',
    'lantern', 'microscope', 'parachute', 'pirate', 'porcupine', 'sandcastle',
    'satellite', 'seahorse', 'shipwreck', 'snail', 'stethoscope', 'sundial',
    'tornado', 'trampoline', 'walrus', 'wheelchair', 'xylophone', 'ambulance',
    'aquarium', 'armchair', 'astronaut', 'bagpipes', 'ballerina', 'barbecue',
    'barn', 'bathtub', 'beaver', 'birdhouse', 'bobsleigh', 'bookshelf',
    'bulldozer', 'cable car', 'camel', 'canoe', 'carousel', 'chameleon',
    'clothes line', 'cobweb', 'combine harvester', 'conveyor belt',
    'coral reef', 'crane', 'crocodile', 'dartboard', 'deckchair',
    'diving board', 'dominoes', 'drawbridge', 'drum kit', 'easel', 'eclipse',
    'elevator', 'ferris wheel', 'fire hydrant', 'firework', 'fishing rod',
    'flamingo', 'flute', 'fossil', 'gargoyle', 'gondola', 'gramophone',
    'grandfather clock', 'hammock', 'hang glider', 'haystack',
    'hot air balloon', 'jackhammer', 'juggler', 'kayak', 'koala', 'lawnmower',
    'lifeboat', 'lizard', 'locomotive', 'magnifying glass', 'mailbox',
    'meteor', 'microphone', 'moose', 'mosaic', 'mousetrap', 'narwhal',
    'observatory', 'otter', 'pelican', 'periscope', 'pier', 'piggy bank',
    'playground', 'pogo stick', 'postbox', 'pretzel', 'pyramid', 'quicksand',
    'raft', 'record player', 'rhinoceros', 'rocking chair', 'rollerblades',
    'rowing boat', 'saxophone', 'scuba diver', 'seesaw', 'sewing machine',
    'shopping trolley', 'skateboard', 'ski lift', 'skyscraper', 'sleigh',
    'sloth', 'snorkel', 'spacesuit', 'sphinx', 'spinning top', 'sprinkler',
    'steamroller', 'stopwatch', 'surfboard', 'suspension bridge',
    'tambourine', 'thermometer', 'tightrope', 'toolbox', 'totem pole',
    'treehouse', 'trombone', 'tuba', 'tugboat', 'tumbleweed', 'unicycle',
    'vacuum cleaner', 'vineyard', 'watchtower', 'water slide', 'weather vane',
    'wind turbine', 'wishing well', 'woodpecker', 'yacht', 'zeppelin',
  ],
  hard: [
    'gravity', 'jealousy', 'nostalgia', 'deja vu', 'rush hour',
    'spring cleaning', 'stage fright', 'time travel', 'writer’s block',
    'cold feet', 'brain freeze', 'butterflies', 'chain reaction',
    'culture shock', 'double trouble', 'eavesdropping', 'first impression',
    'growing pains', 'hangover', 'inside joke', 'last minute',
    'long distance', 'lost in translation', 'midlife crisis', 'mixed signals',
    'overthinking', 'paper cut', 'peer pressure', 'plot twist',
    'procrastination', 'road trip', 'second guessing', 'sleep walking',
    'small talk', 'stalemate', 'sweet tooth', 'tug of war',
    'wild goose chase', 'winging it', 'awkward silence', 'back to square one',
    'bad hair day', 'ball and chain', 'barking up the wrong tree',
    'beating around thebush', 'bite the bullet', 'blessing in disguise',
    'break the ice', 'bucket list', 'burning bridges', 'cabin fever',
    'cutting corners', 'dead end', 'dodging a bullet', 'down to earth',
    'dress rehearsal', 'elephant in the room', 'falsealarm', 'food coma',
    'fresh start', 'glass half full', 'gut feeling', 'hidden talent',
    'high maintenance', 'home sweethome', 'in hot water',
    'information overload', 'jet lag', 'jumping the gun',
    'keeping up appearances', 'letting offsteam', 'light bulb moment',
    'love at first sight', 'missing the point', 'mind reading',
    'needle in a haystack', 'offthe record', 'on thin ice', 'out of the blue',
    'over the moon', 'raining cats and dogs', 'reading between the lines',
    'rose tinted glasses', 'running on empty', 'saved by the bell',
    'seeing double', 'selective hearing', 'sensoryoverload',
    'sibling rivalry', 'silver lining', 'sinking feeling', 'sixth sense',
    'sleep deprivation', 'slippery slope', 'spilling the beans',
    'split personality', 'stuck in a rut', 'sugar rush', 'taking the plunge',
    'the last straw', 'thirdwheel', 'throwing shade', 'tip of the iceberg',
    'tunnel vision', 'turning over a new leaf', 'under the weather',
    'walking on eggshells', 'wearing many hats', 'white lie',
    'wishful thinking', 'worst case scenario',
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

// --------------------------------------------------------------- difficulty

export const TIERS = ['easy', 'medium', 'hard'];
export const STARS = { easy: '★', medium: '★★', hard: '★★★' };

/** Which tier a prompt came from. The lists share no words, so this is exact. */
const TIER_OF = new Map();
for (const tier of TIERS) for (const w of WORDS[tier]) TIER_OF.set(w, tier);
export const tierOf = (word) => TIER_OF.get(word) || 'easy';

/**
 * What a harder prompt is worth.
 *
 * The guesser's points are multiplied, so a hard word can pay 170 rather than
 * 100. On its own that would make picking hard pure charity — you hand your
 * opponent a bigger prize and take nothing — so the drawer collects a flat
 * bonus for a harder pick, paid only if somebody actually gets it.
 *
 * The bonus is deliberately flat rather than a share of the guesser's score.
 * Anything proportional puts the drawer's points back under the guesser's
 * control, which is what made two-player scoring degenerate in the first
 * place. A fixed amount depends only on the drawer's own choice and whether
 * the drawing landed, so there is nothing to game.
 */
export const GUESS_MULTIPLIER = { easy: 1, medium: 1.3, hard: 1.7 };
export const DRAWER_BONUS = { easy: 0, medium: 15, hard: 35 };
