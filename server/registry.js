// Every game the site can host. Adding one is: write a module under
// server/games/<id>/ that exports the interface described in
// server/games/euchre/index.js, then add it here.

import euchre from './games/euchre/index.js';
import draw from './games/draw/index.js';
import trivia from './games/trivia/index.js';
import runner from './games/runner/index.js';
import battleship from './games/battleship/index.js';
import connect4 from './games/connect4/index.js';
import codenames from './games/codenames/index.js';
import wavelength from './games/wavelength/index.js';
import knowme from './games/knowme/index.js';
import dots from './games/dots/index.js';

const MODULES = [euchre, draw, trivia, runner, battleship, connect4, codenames, wavelength, knowme, dots];
const BY_ID = new Map(MODULES.map((m) => [m.id, m]));

export const games = () => MODULES;
export const getGame = (id) => BY_ID.get(id);
export const DEFAULT_GAME = euchre.id;
