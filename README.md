# Euchre

Two people, two bot partners, ten points. Both humans play from their own
phones; each is partnered with a bot, so you and your opponent are always on
opposite teams.

```
        Robo (bot)          <- your partner
  Sam                Chip   <- your opponent, their bot partner
        You
```

Seats 0 and 2 are one team, seats 1 and 3 the other. You take seat 0, whoever
joins your room takes seat 1.

## Running it locally

```bash
npm install
npm start          # http://localhost:3000
```

Open it, enter a name, hit **Start a new game**, and send the other person the
four-letter code (the **Copy invite link** button uses the phone share sheet if
there is one).

## Putting it online

The repo has a `render.yaml`, so on [render.com](https://render.com):

1. Push this folder to a GitHub repo.
2. **New → Blueprint**, point it at the repo, apply.
3. You get `https://euchre-something.onrender.com`. That URL works from
   anywhere, on mobile data, on both phones.

Nothing needs configuring — the server reads `PORT` from the environment and
serves the client itself, so there is no separate frontend deploy and no CORS.

**Free-tier caveat, worth knowing before you rely on it:** Render's free plan
spins the service down after ~15 minutes with no traffic, and the first request
afterwards takes 30–60 seconds to wake it. Games live in memory, so a spin-down
ends whatever hand you were in. For sitting down and playing a session together
that is fine; if you want to leave a game paused overnight, use a paid instance
or add persistence.

Fly.io and Railway work the same way — one Node process, no build step.

## Rules as implemented

Standard 24-card euchre, first team to 10.

- Right bower, left bower, then A K Q 10 9 of trump. The left bower **is** a
  trump — it follows trump and does not follow its printed suit.
- Dealer deals 5 each and turns one up. Round one: order it up (dealer takes it
  into hand and discards). Round two, if all four pass: name any suit except the
  one turned down.
- **Going alone** is in. Your partner sits the hand out and their cards are dead.
- If all four pass twice the hand is thrown in and the next player deals.
  There is no stick-the-dealer — flip `STICK_THE_DEALER` in
  `server/euchre.js` if you decide you want it.

Scoring: makers take 3 or 4 → 1 point; all 5 → 2; all 5 alone → 4; euchred → 2
to the other side.

## The bots

`server/bot.js`. They count trump, remember what has been played, and know
whether a card is the boss of its suit. They lead trump when their side called
it, cash certain winners, duck when their partner already has the trick, ruff
with the cheapest card that wins, and pitch to make voids.

Bidding thresholds live in `PROFILE` at the top of that file, expressed in
expected tricks. They were fitted, not guessed — `npm run tune` plays one
profile against another 4000 games a side with the seats swapped halfway:

```
--- order ---
  1.85   44.9%
  2.15   50.4%   <- first guess
  2.45   52.9%   <- best
  2.9    49.3%
  3.4    42.3%
```

`call`, `alone` and `dealerLastCall` were flat within noise, so they sit at
their starting values. To make the bots softer or nastier, raise or lower
`order` — that is the parameter that actually moves the needle.

## Tests

```bash
npm test           # rules soak + end-to-end over websockets
npm run test:ui    # drives real Chrome, writes screenshots to shots/
```

- `server/selftest.js` — 2000 full bot games. Asserts the card logic (left
  bower follows trump, right beats left beats ace, you must follow suit), that
  deals account for all 24 cards, that hands stay level, and that the resulting
  statistics land in a plausible band. Current output: 11.3 hands per game, 14%
  euchre rate, and no advantage to either seat pair.
- `server/e2e.js` — boots the real server and plays complete games through the
  wire protocol with two socket clients making random legal moves. Covers hand
  privacy, rejection of illegal moves, chat, rematch, a third person being
  turned away, and dropping a phone mid-hand and rejoining into the same seat.
- `server/uicheck.js` — drives headless Chrome at 390×844 as player one against
  a scripted player two, screenshotting each stage and failing on console
  errors or horizontal overflow.
- `server/tagcheck.js` — measures the seat name tag in every combination of
  dealer / maker / alone / trick dots, at two phone widths, in both a roomy
  and a cramped seat. Catches clipped badges and collisions with the trick
  pile, which are invisible until the one hand where they happen.
- `server/smoke-remote.js` — the same idea as the end-to-end test but pointed
  at a deployed URL: `npm run smoke https://your-app.onrender.com`.

## Layout

```
server/
  cards.js     card primitives, trump/bower logic, trick resolution
  euchre.js    the game state machine — no networking, no timers
  bot.js       bidding, discarding, card play
  index.js     express + ws, rooms, reconnect, bot scheduling
public/
  index.html   one screen, three states (join / lobby / table)
  style.css
  app.js       renders server state, sends intents
```

The server is authoritative. The browser never holds a hand it hasn't been
sent, never decides what is legal, and can be closed and reopened at any point
without affecting the game — which is what makes locking your phone mid-hand
safe.

## Notes

- Reconnecting is automatic and keyed to a UUID in `localStorage`, so a refresh,
  a lock screen, or a walk out of wifi range all resume the same seat. The seat
  is never given away, so nobody can take it while you're gone.
- Rooms are reaped six hours after the last person leaves.
- **The next hand is dealt only when both players have pressed "Next hand."**
  There is no timer on the result screen, so neither of you gets rushed past
  the score. If one phone is locked or offline the game simply waits — that
  seat is held, and they land back on the same result screen when they
  reconnect and can press it themselves.
- The trick pause and bot "thinking" delays are at the top of
  `server/index.js`; `EUCHRE_FAST=1` collapses them, which is how the
  end-to-end test plays a full game in a few seconds.
