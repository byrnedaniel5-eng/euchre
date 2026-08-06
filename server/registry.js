// Every game the site can host. Adding one is: write a module under
// server/games/<id>/ that exports the interface described in
// server/games/euchre/index.js, then add it here.

import euchre from './games/euchre/index.js';
import draw from './games/draw/index.js';

const MODULES = [euchre, draw];
const BY_ID = new Map(MODULES.map((m) => [m.id, m]));

export const games = () => MODULES;
export const getGame = (id) => BY_ID.get(id);
export const DEFAULT_GAME = euchre.id;
