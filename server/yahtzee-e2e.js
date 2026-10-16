// Yahtzee: every box, the bonuses and the joker rule, turn limits, the bot,
// and a whole game between two phones.
//
//   node server/yahtzee-e2e.js

import { rawScore, options, newSheet, totals, CATEGORIES } from './games/yahtzee/rules.js';
import { YahtzeeGame } from './games/yahtzee/engine.js';
import { decide, SKILLS } from './games/yahtzee/bot.js';
import { assert, section, finish, bootServer, startRoom, waitFor, sleep } from './testkit.js';

section('1. the boxes');
{
  const t = (cat, dice, want, why) => {
    const got = rawScore(cat, dice);
    assert(got === want, `${why}: ${got}`);
  };
  t('threes', [3, 3, 1, 3, 6], 9, 'threes counts only the threes');
  t('threeKind', [4, 4, 4, 2, 1], 15, 'three of a kind is all five dice');
  t('fourKind', [4, 4, 4, 2, 1], 0, 'three is not four');
  t('fourKind', [5, 5, 5, 5, 5], 25, 'five of a kind is also four');
  t('fullHouse', [2, 2, 3, 3, 3], 25, 'full house');
  t('fullHouse', [6, 6, 6, 6, 6], 0, 'five alike is not a full house without the joker');
  t('smallStraight', [1, 2, 3, 4, 4], 30, 'small straight with a repeat');
  t('smallStraight', [3, 4, 5, 6, 1], 30, 'small straight at the top end');
  t('smallStraight', [1, 2, 3, 5, 6], 0, 'a gap breaks it');
  t('largeStraight', [2, 3, 4, 5, 6], 40, 'large straight');
  t('largeStraight', [1, 2, 3, 4, 6], 0, 'four in a row is not five');
  t('yahtzee', [2, 2, 2, 2, 2], 50, 'Yahtzee');
  t('chance', [1, 2, 3, 4, 6], 16, 'chance is the sum');
}

section('2. bonuses and the joker');
{
  const s = newSheet();
  Object.assign(s, { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 });
  assert(totals(s).bonus === 35, 'three of every face is exactly 63, and the bonus');
  s.sixes = 12;
  assert(totals(s).bonus === 0, 'one short and there is none');

  const j = newSheet();
  j.yahtzee = 50;
  let o = options(j, [4, 4, 4, 4, 4]);
  assert(Object.keys(o).join() === 'fours' && o.fours === 20, 'a second Yahtzee must go in its own upper box if open');
  j.fours = 12;
  o = options(j, [4, 4, 4, 4, 4]);
  assert(o.fullHouse === 25 && o.largeStraight === 40 && !('ones' in o),
    'if that is full, any lower box at full value');
  for (const c of ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'chance']) j[c] = 0;
  o = options(j, [4, 4, 4, 4, 4]);
  assert(Object.values(o).every((v) => v === 0) && 'ones' in o, 'and failing that, an upper box for nothing');

  const g = new YahtzeeGame({ names: ['A', 'B'], playerCount: 2, rng: () => 0.5 }); // every die a 4
  g.sheets[0].yahtzee = 50;
  g.roll(0);
  g.score(0, 'fours');
  assert(g.sheets[0].bonusYahtzees === 1 && totals(g.sheets[0]).yBonus === 100, 'and it is worth a hundred more');
  const z = new YahtzeeGame({ names: ['A', 'B'], playerCount: 2, rng: () => 0.5 });
  z.sheets[0].yahtzee = 0;
  z.roll(0);
  z.score(0, 'fours');
  assert(z.sheets[0].bonusYahtzees === 0, 'but not if the Yahtzee box was scratched');
}

section('3. turns');
{
  const g = new YahtzeeGame({ names: ['A', 'B'], playerCount: 2 });
  let err = '';
  try { g.score(0, 'chance'); } catch (e) { err = e.message; }
  assert(/roll first/.test(err), 'you cannot score before rolling');
  try { g.roll(1); } catch (e) { err = e.message; }
  assert(/not your turn/.test(err), 'or roll out of turn');
  g.roll(0);
  const kept = g.dice[0];
  g.roll(0, [true, false, false, false, false]);
  assert(g.dice[0] === kept, 'a held die stays put');
  g.roll(0);
  try { g.roll(0); } catch (e) { err = e.message; }
  assert(/no rolls left/.test(err), 'three rolls and no more');
  g.score(0, 'chance');
  try { g.roll(1); g.score(1, 'chance'); g.roll(0); g.score(0, 'chance'); } catch (e) { err = e.message; }
  assert(/cannot score that box/.test(err), 'a box is filled once');
}

section('4. the bot');
{
  const play = (skill) => {
    const g = new YahtzeeGame({ names: ['b'], playerCount: 1 });
    while (g.phase === 'playing') {
      const d = decide(g, 0, skill);
      if (d.kind === 'roll') g.roll(0, d.held); else g.score(0, d.cat);
    }
    return totals(g.sheets[0]).total;
  };
  const mean = (skill, n) => Array.from({ length: n }, () => play(skill)).reduce((a, b) => a + b) / n;
  const sharp = mean(SKILLS.sharp, 60);
  const casual = mean(SKILLS.casual, 60);
  assert(sharp > 175, `sharp plays a sensible game (averages ${sharp.toFixed(0)})`);
  assert(sharp > casual + 8, `and beats casual (${casual.toFixed(0)})`);
}

const srv = await bootServer(4000);
try {
  section('5. two phones, a whole game');
  {
    const [a, b] = await startRoom(srv.url, 'yahtzee', ['Dan', 'Sam']);
    const players = [a, b];
    let guard = 0;
    let sawHold = false;
    while (a.state.phase !== 'gameOver' && guard++ < 200) {
      const me = players.find((p) => p.state.yourTurn);
      const other = me === a ? b : a;
      const n = me.state.lastScore?.n ?? 0;
      me.act({ kind: 'roll' });
      await waitFor(() => me.state.rollsLeft === 2, 'the roll');
      me.act({ kind: 'hold', index: 0, on: true });
      await waitFor(() => other.state.held[0] === true, 'the hold to show on the other phone');
      sawHold = true;
      const cat = Object.keys(me.state.options)[0];
      me.act({ kind: 'score', cat });
      await waitFor(() => (a.state.lastScore?.n ?? 0) > n, 'the score');
    }
    assert(sawHold, 'a die held on one phone shows as held on the other');
    await waitFor(() => b.state.phase === 'gameOver', 'both phones to finish');
    assert(a.state.sheets.every((s) => CATEGORIES.every((c) => s[c] !== null)), 'twenty-six turns fill both sheets');
    assert(a.state.totals.map((t) => t.total).join() === b.state.totals.map((t) => t.total).join(), 'both phones agree');
    assert(a.state.rivalry?.byGame.yahtzee?.played === 1, 'on the record');
    await Promise.all([a.close(), b.close()]);
  }

  section('6. against the bot');
  {
    const [a] = await startRoom(srv.url, 'yahtzee', ['Ann'], { difficulty: 'sharp' });
    assert(a.state.names[1] === 'Bot', 'a bot to play');
    let guard = 0;
    while (a.state.phase !== 'gameOver' && guard++ < 400) {
      if (a.state.yourTurn) {
        const n = a.state.lastScore?.n ?? 0;
        a.act({ kind: 'roll' });
        await waitFor(() => a.state.rollsLeft < 3, 'the roll');
        a.act({ kind: 'score', cat: Object.keys(a.state.options)[0] });
        await waitFor(() => (a.state.lastScore?.n ?? 0) > n, 'the score');
      }
      await sleep(5);
    }
    assert(a.state.phase === 'gameOver', 'the bot plays its thirteen turns');
    await a.close();
  }
  assert(srv.errors.length === 0, `the server logged nothing alarming (${srv.errors.join('').slice(0, 200)})`);
} catch (err) {
  assert(false, err.message);
} finally {
  srv.stop();
}
finish('YAHTZEE END-TO-END');
