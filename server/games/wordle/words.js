// The two word lists. `valid` is every five-letter word a guess may be — a
// big list, so plurals and odd words are allowed. `answers` is the much
// shorter list the hidden word comes from: common words only, because losing
// to XYLYL is not a game anybody enjoys. Every answer is also a valid guess.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8').split(/\s+/).filter(Boolean);

export const ANSWERS = read('answers.txt');
export const VALID = new Set([...read('valid.txt'), ...ANSWERS]);
