// The running score, without a server: tallies, draws, co-op games, streaks,
// names that differ only in case, and how a room's result becomes an entry.
//
//   node server/records-test.js

import { Records, memoryStore, entryFor, groupKey } from './records.js';
import euchre from './games/euchre/index.js';
import battleship from './games/battleship/index.js';
import trivia from './games/trivia/index.js';

let failures = 0;
const assert = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

console.log('\n1. tallies');
{
  const r = new Records(memoryStore());
  await r.ready;
  const two = ['Dan', 'Sam'];
  r.add({ game: 'euchre', players: two, winners: ['Dan'] });
  r.add({ game: 'euchre', players: two, winners: ['Sam'] });
  r.add({ game: 'trivia', players: two, winners: ['Sam'] });
  r.add({ game: 'trivia', players: two, winners: ['Dan', 'Sam'] }); // a tie
  r.add({ game: 'connect4', players: two, winners: [] });           // a draw
  r.add({ game: 'codenames', players: two, winners: two, coop: true });
  r.add({ game: 'codenames', players: two, winners: [], coop: true });

  const s = r.summary(['sam', 'DAN ']);
  assert(s.total.played === 5, `five competitive games (${s.total.played})`);
  assert(s.total.wins.Dan === 1 && s.total.wins.Sam === 2, 'Dan 1, Sam 2');
  assert(s.total.draws === 2, 'a tie and a no-winner both count as draws');
  assert(s.total.coop.played === 2 && s.total.coop.won === 1,
    'co-op games are kept apart from the score');
  assert(s.byGame.trivia.wins.Sam === 1 && s.byGame.trivia.draws === 1, 'per-game rows');
  assert(s.recent[0].game === 'codenames', 'recent results are newest first');
}

console.log('\n2. names');
{
  assert(groupKey(['Dan', 'sam']) === groupKey([' SAM', 'dan']), 'case and order do not matter');
  const r = new Records(memoryStore());
  await r.ready;
  r.add({ game: 'euchre', players: ['Dan', 'Sam'], winners: ['Dan'] });
  r.add({ game: 'euchre', players: ['Dan', 'Sam', 'Ali'], winners: ['Ali'] });
  r.add({ game: 'euchre', players: ['Dan'], winners: ['Dan'] });
  assert(r.forGroup(['Dan', 'Sam']).length === 1, 'a three-way game is its own group');
  assert(r.entries.length === 2, 'a game with one person is never recorded');
  assert(r.groupsFor('dan').length === 2 && r.groupsFor('dan')[0].names.length === 3,
    'everyone Dan has played, most recent first');
}

console.log('\n3. streaks');
{
  const r = new Records(memoryStore());
  await r.ready;
  const two = ['Dan', 'Sam'];
  r.add({ game: 'euchre', players: two, winners: ['Dan'] });
  r.add({ game: 'euchre', players: two, winners: ['Sam'] });
  r.add({ game: 'trivia', players: two, winners: ['Sam'] });
  r.add({ game: 'codenames', players: two, winners: two, coop: true });
  r.add({ game: 'battleship', players: two, winners: ['Sam'] });
  const s = r.summary(two);
  assert(s.streak?.who === 'Sam' && s.streak.n === 3, 'three in a row, co-op games skipped');
  r.add({ game: 'battleship', players: two, winners: ['Dan'] });
  assert(r.summary(two).streak === null, 'one win is not a streak');
}

console.log('\n4. saving');
{
  const store = memoryStore();
  const r = new Records(store);
  await r.ready;
  r.add({ game: 'euchre', players: ['Dan', 'Sam'], winners: ['Dan'] });
  await r.saving;
  const again = new Records(store);
  await again.ready;
  assert(again.entries.length === 1, 'a fresh start reads back what was saved');
}

console.log('\n5. from a room to an entry');
{
  const room = (gameId, humanCount, names) => ({
    gameId, humanCount, seats: names.map((name) => ({ name })),
  });

  // Two people at euchre sit on opposite teams, each with a bot partner.
  let e = entryFor(room('euchre', 2, ['Dan', 'Sam']),
    euchre.outcome({ phase: 'gameOver', score: [7, 10] }));
  assert(e.winners.length === 1 && e.winners[0] === 'Sam' && !e.coop,
    'euchre: two people, the bot partners are not named');
  assert(e.score === '10–7', 'the winning score first');

  // Seats 0 and 2 are people, seat 1 is a person, seat 3 a bot.
  e = entryFor(room('euchre', 3, ['Dan', 'Sam', 'Ali']),
    euchre.outcome({ phase: 'gameOver', score: [10, 4] }));
  assert(e.winners.join() === 'Dan,Ali' && !e.coop, 'euchre: three people, a team of two wins');

  // Four seats, but only one person — all people on one side: co-op.
  e = entryFor(room('euchre', 2, ['Dan', 'Sam']), { winners: [0, 1], team: true });
  assert(e.coop, 'a team game with every person on the winning side is co-op');

  assert(euchre.outcome({ phase: 'play', score: [3, 2] }) === null, 'no outcome mid-game');

  e = entryFor(room('battleship', 1, ['Dan']), battleship.outcome({ phase: 'gameOver', winner: 1 }));
  assert(e.winners.length === 0, 'a bot winning credits nobody');

  e = entryFor(room('trivia', 2, ['Dan', 'Sam']),
    trivia.outcome({ phase: 'gameOver', scores: [310, 310] }));
  assert(e.winners.length === 2, 'a tie at trivia names both');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nRECORDS PASSED');
process.exit(failures ? 1 : 0);
