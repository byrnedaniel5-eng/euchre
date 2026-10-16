// Cribbage: counting hands, pegging, the go, the order of the show, pegging
// out mid-hand, what each phone may see, and whole games over the wire.
//
//   node server/cribbage-e2e.js

import { countHand, pegPoints, makeDeck, value } from './games/cribbage/rules.js';
import { CribbageGame, TARGET } from './games/cribbage/engine.js';
import { chooseDiscard, choosePlay, SKILLS } from './games/cribbage/bot.js';
import { assert, section, finish, bootServer, startRoom, waitFor, sleep } from './testkit.js';

section('1. counting a hand');
{
  const t = (hand, starter, want, why, crib = false) => {
    const got = countHand(hand, starter, { crib }).total;
    assert(got === want, `${hand.join(' ')} + ${starter}${crib ? ' (crib)' : ''}: ${got} — ${why}`);
  };
  t(['5H', '5C', '5S', 'JD'], '5D', 29, 'the perfect hand');
  t(['5H', '5C', '5S', '5D'], 'JD', 28, 'four fives, the jack cut');
  t(['3H', '3S', '4C', '5D'], '5S', 20, 'a double double run');
  t(['4H', '5H', '6H', '6C'], '7S', 14, 'a double run of four');
  t(['7H', '8H', '9H', 'TH'], '2H', 11, 'a five-card flush');
  t(['7H', '8H', '9H', 'TH'], '2S', 10, 'a four-card flush in the hand');
  t(['7H', '8H', '9H', 'TH'], '2S', 6, 'but not in the crib', true);
  t(['JH', '2C', '4D', '9S'], 'KH', 3, 'his nob');
  t(['2C', '4D', '6S', '8H'], 'TC', 0, 'nineteen — nothing');
}

section('2. pegging');
{
  const t = (pile, want, why) => assert(pegPoints(pile).total === want, `${pile.join(' ')}: ${pegPoints(pile).total} — ${why}`);
  t(['7H', '8C'], 2, 'fifteen');
  t(['5H', '5C', '5D'], 8, 'fifteen and a pair royal');
  t(['5H', '5C', '5D', '5S'], 12, 'a double pair royal');
  t(['3H', '5C', '4D'], 3, 'a run in any order');
  t(['3H', '5C', '5D', '4S'], 0, 'a pair in the middle breaks the run');
  t(['TH', 'TC', 'KD', 'AS'], 2, 'thirty-one');
}

/** A game with known hands, straight into the play. */
function rigged(hands, starter, dealer = 0) {
  const g = new CribbageGame({ names: ['Dan', 'Sam'], dealer });
  const used = new Set([...hands.flat(), starter]);
  const spare = makeDeck().filter((c) => !used.has(c));
  g.hands = [[...hands[0], spare[0], spare[1]], [...hands[1], spare[2], spare[3]]];
  g.deck = [starter];
  g.rng = () => 0;
  g.discard(0, [spare[0], spare[1]]);
  g.discard(1, [spare[2], spare[3]]);
  return g;
}

section('3. the play, the go and thirty-one');
{
  // Dan deals; Sam leads. K, 10, Q is thirty, and Dan has nothing that fits.
  const g = rigged([['TH', 'TC', '4D', '3S'], ['KH', 'QC', 'AD', '2S']], '6C', 0);
  assert(g.turn === 1, 'the non-dealer leads');
  g.play(1, 'KH');
  g.play(0, 'TH');
  g.play(1, 'QC');
  assert(g.count === 30 && g.turn === 1 && g.saidGo[0], 'Dan cannot go on, says go, and Sam carries on');
  let err = '';
  try { g.play(0, '3S'); } catch (e) { err = e.message; }
  assert(/not your turn/.test(err), 'Dan cannot play out of turn');
  g.play(1, 'AD');
  assert(g.scores[1] === 2 && g.count === 0 && g.turn === 0, 'the ace makes thirty-one for two, and the count starts again with Dan');
  g.play(0, 'TC');
  g.play(1, '2S');
  g.play(0, '4D');
  assert(g.turn === 0, 'Sam is out of cards, so Dan plays on');
  g.play(0, '3S');
  // 2, 4, 3 is a run of three, and the 3 is the last card — and the last card
  // ends the play, so the show is counted straight after.
  assert(g.phase === 'show', 'the last card goes straight to the show');
  assert(g.show.pone.total === 0 && g.show.dealer.total === 2, 'Sam counts nothing, Dan a pair of tens');
  const pegged = g.scores[0] - g.show.dealer.total - g.show.crib.total;
  assert(pegged === 4, `Dan pegged a run of three and one for last card (${pegged})`);
  assert(g.scores[1] === 2, 'Sam pegged only the thirty-one');
  try { g.play(0, 'TH'); } catch (e) { err = e.message; }
  assert(/not time to play/.test(err), 'nothing more to play');
}

section('4. his heels, and pegging out');
{
  const g = rigged([['2H', '3C', '4D', '5S'], ['6H', '7C', '8D', '9S']], 'JD', 0);
  assert(g.scores[0] === 2, 'a jack cut is two for the dealer');

  const h = rigged([['8C', '2H', '3H', '4H'], ['7H', 'KC', 'QC', 'TC']], '9D', 0);
  h.scores[0] = 119;
  h.play(1, '7H');
  h.play(0, '8C');
  assert(h.phase === 'gameOver' && h.winner === 0 && h.scores[0] === TARGET,
    'a fifteen at 119 ends it there and then, mid-play');
  assert(h.show === null, 'there is no show after a game is won');
}

section('5. the show goes in order');
{
  // Sam (pone) holds 29; Dan (dealer) holds 24. Both start near the end.
  const g = rigged([['4H', '4C', '6S', '6D'], ['5H', '5C', '5S', 'JD']], '5D', 0);
  g.scores = [95, 95];
  while (g.phase === 'play') g.play(g.turn, g.inHand[g.turn].find((c) => g.count + value(c) <= 31));
  assert(g.phase === 'gameOver' && g.winner === 1, 'the non-dealer counts first, and wins with it');
  assert(g.scores[0] < TARGET, `the dealer never got to count a hand that would also have won (${g.scores[0]})`);
}

section('6. what each phone sees');
{
  const g = new CribbageGame({ names: ['Dan', 'Sam'], dealer: 0 });
  const theirs = g.hands[1];
  const seen = JSON.stringify(g.viewFor(0));
  assert(theirs.every((c) => !seen.includes(`"${c}"`)), 'none of their six cards is sent to you');
  g.discard(0, g.hands[0].slice(0, 2));
  g.discard(1, g.hands[1].slice(0, 2));
  const now = JSON.stringify(g.viewFor(0));
  assert(g.thrown[1].every((c) => !now.includes(`"${c}"`)), 'nor what they threw to the crib');
  assert(g.viewFor(0).cribSize === 4 && g.viewFor(0).starter, 'only that the crib has four, and the starter');
}

section('7. the bot');
{
  const play = (a, b) => {
    const g = new CribbageGame({ names: ['a', 'b'], dealer: Math.floor(Math.random() * 2) });
    const sk = [a, b];
    let guard = 0;
    while (g.phase !== 'gameOver' && guard++ < 3000) {
      if (g.phase === 'discard') {
        for (const s of [0, 1]) if (!g.thrown[s]) g.discard(s, chooseDiscard(g.hands[s], g.dealer === s, sk[s]));
      } else if (g.phase === 'play') {
        g.play(g.turn, choosePlay(g.inHand[g.turn], g.pile, g.count, sk[g.turn]));
      } else g.nextHand();
    }
    return g;
  };
  let sharp = 0;
  let hands = 0;
  for (let i = 0; i < 80; i++) {
    const flip = i % 2 === 1;
    const g = flip ? play(SKILLS.sharp, SKILLS.casual) : play(SKILLS.casual, SKILLS.sharp);
    if (g.winner === (flip ? 0 : 1)) sharp++;
    hands += g.hand;
  }
  assert(sharp > 48, `sharp beats casual (${sharp} of 80)`);
  assert(hands / 80 > 6 && hands / 80 < 13, `games last a believable number of hands (${(hands / 80).toFixed(1)})`);
}

const srv = await bootServer(4001);
try {
  section('8. two phones, a whole game');
  {
    const [a, b] = await startRoom(srv.url, 'cribbage', ['Dan', 'Sam']);
    const players = [a, b];
    let guard = 0;
    while (a.state.phase !== 'gameOver' && guard++ < 2000) {
      const st = a.state.phase;
      if (st === 'discard') {
        for (const p of players) if (!p.state.youThrew) p.act({ kind: 'discard', cards: p.state.yourHand.slice(0, 2) });
        await waitFor(() => a.state.phase !== 'discard', 'both to throw');
      } else if (st === 'play') {
        const mover = players.find((p) => p.state.yourTurn);
        if (mover) {
          const n = mover.state.played.length;
          mover.act({ kind: 'play', card: mover.state.canPlay[0] });
          await waitFor(() => a.state.played.length > n || a.state.phase !== 'play', 'the card');
        } else await sleep(5);
      } else if (st === 'show') {
        const hand = a.state.hand;
        for (const p of players) p.act({ kind: 'next' });
        await waitFor(() => a.state.hand > hand || a.state.phase === 'gameOver', 'the next hand');
      }
    }
    await waitFor(() => b.state.phase === 'gameOver', 'both phones to finish');
    const w = a.state.winner;
    assert(a.state.scores[w] === TARGET && a.state.scores.join() === b.state.scores.join(),
      `someone pegs out and both phones agree (${a.state.scores.join('–')} after ${a.state.hand} hands)`);
    assert(a.state.rivalry?.byGame.cribbage?.played === 1, 'on the record');
    await Promise.all([a.close(), b.close()]);
  }

  section('9. against the bot');
  {
    const [a] = await startRoom(srv.url, 'cribbage', ['Ann'], { difficulty: 'sharp' });
    let guard = 0;
    while (a.state.phase !== 'gameOver' && guard++ < 3000) {
      if (a.state.phase === 'discard' && !a.state.youThrew) a.act({ kind: 'discard', cards: a.state.yourHand.slice(0, 2) });
      else if (a.state.yourTurn) a.act({ kind: 'play', card: a.state.canPlay[0] });
      else if (a.state.phase === 'show' && !a.state.ready.includes(0)) a.act({ kind: 'next' });
      await sleep(8);
    }
    assert(a.state.phase === 'gameOver', `a whole game against the bot (${a.state.scores.join('–')})`);
    await a.close();
  }
  assert(srv.errors.length === 0, `the server logged nothing alarming (${srv.errors.join('').slice(0, 200)})`);
} catch (err) {
  assert(false, err.message);
} finally {
  srv.stop();
}
finish('CRIBBAGE END-TO-END');
