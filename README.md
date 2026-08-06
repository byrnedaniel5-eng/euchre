# Game Night

Games for people on their own phones, usually while already on a video call.
The app holds the private information — your hand, your prompt — and gets out
of the way; the talking is the game.

Two games so far:

- **Euchre** — trick-taking to ten, one to four people, bots filling any empty
  seat.
- **Draw It** — one person draws a prompt, everyone else races to guess it.
  Two to four people, no bots.

## Looks

Every screen sets `body[data-theme]`, and the stylesheet only swaps variables —
each rule is written once against them.

| Screen | Look |
|---|---|
| Landing / setup | Neutral slate. The hub should not look like either game. |
| Euchre | Card-room green felt. |
| Draw It | Ink-and-violet studio, so the white board pops. |

The mobile browser chrome colour follows too, and the landing screen carries a
colour stripe per game so the card you tap matches where you land.

## Adding a game

The room layer (`server/rooms.js`) handles codes, seats, rejoining, leaving,
chat and the ready gate. A game is a module under `server/games/<id>/` that
exports four things — how many can play, how to build a game, what each seat
may see, and a `step()` saying whether anything should happen on a timer — plus
a renderer under `public/games/<id>.js` registered with `registerGame()`.
Register the module in `server/registry.js` and it appears on the home screen,
setup options and all, with no other client changes.

`server/games/euchre/index.js` is the reference: it is the interface with
comments.

## Euchre

Euchre for one to four people, with bots filling whatever seats are left.
First team to ten.

Pick how many people are playing when you create the game; everyone else joins
with a four-letter code. People take seats in join order and bots take the
rest, so the table works out as:

| People | Seats | Result |
|---|---|---|
| 1 | 0 | You, a bot partner, two bot opponents |
| 2 | 0, 1 | Two people on **opposite** teams, each with a bot partner |
| 3 | 0, 1, 2 | Seats 0 and 2 partner each other; the bot partners seat 1 |
| 4 | 0–3 | Four people, no bots |

```
        Robo (bot)          <- your partner
  Sam                Chip   <- your opponent, their bot partner
        You
```

Seats 0 and 2 are one team, seats 1 and 3 the other.

## Draw It

One person gets three prompts and picks one, then has 80 seconds to draw it
with a finger while everyone else types guesses. Everyone draws the same number
of times, then the highest score wins.

**Scoring runs down with the clock.** A guess is worth 100 points landed
instantly and falls in a straight line to 20 at the buzzer, so every second you
take costs you something rather than nothing until you cross a threshold. The
current value sits under the countdown, so you can watch it drain.

| Time left | Worth |
|---|---|
| 80s | 100 |
| 60s | 80 |
| 40s | 60 |
| 20s | 40 |
| 1s | 21 |

Getting there late still beats not getting there, which is why the floor is 20
rather than 0.

The drawer is paid once, at the end of the turn, the **average** of what
everyone who solved it scored. Paying on the first correct guess would ignore
the rest of the table, and a drawing two people solve is a better drawing than
one only the quickest guesser saw. With two players there is exactly one
guesser, so you both score the same and are pulling in the same direction.

Guessing is forgiving about case, spacing, punctuation and stray plurals, and a
guess within two letters of the answer is flagged as close.

Strokes never travel inside the game state — a state broadcast per finger
movement would be enormous. Points are batched every 45ms into their own small
message, relayed to the other players, and the whole board is replayed to
anyone who reconnects. Coordinates are 0..1 of the board, so a drawing made on
a small phone arrives correctly on a big one.

## Running it locally

```bash
npm install
npm start          # http://localhost:3000
```

Open it, enter a name, choose how many people are playing, and hit **Start a
new game**. Send everyone else the four-letter code (the **Copy invite link**
button uses the phone share sheet if there is one). The game deals as soon as
every human seat is filled — a one-player game skips the lobby entirely.

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
  `server/games/euchre/engine.js` if you decide you want it.

Scoring: makers take 3 or 4 → 1 point; all 5 → 2; all 5 alone → 4; euchred → 2
to the other side.

## The bots

`server/games/euchre/bot.js`. They count trump, remember what has been played, and know
whether a card is the boss of its suit. They lead trump when their side called
it, cash certain winners, duck when their partner already has the trick, ruff
with the cheapest card that wins, and pitch to make voids.

### Difficulty

Chosen by whoever creates the game, and it applies to every bot at that table.
Difficulty is not just bid thresholds — each level moves four dials together,
because a weak player also forgets what has been played and misplays cards:

| | Bids | Hand judgement | Card memory | Misplays |
|---|---|---|---|---|
| **Easy** | loose | ±0.6 tricks | none | 35% of turns |
| **Casual** | slightly loose | ±0.3 tricks | none | 15% of turns |
| **Solid** | tuned | exact | every card, plus who has shown out | never |

`npm run ladder` plays each level against every other, seats swapped halfway,
and fails if the ladder is not real:

```
         easy     casual   solid
easy     —        32.6%    24.1%
casual   67.3%    —        40.0%
solid    76.0%    60.0%    —
```

### Fitting the numbers

`npm run tune` sweeps one bid threshold at a time, 4000 games a side:

```
--- order ---
  1.85   44.9%
  2.15   50.4%   <- first guess
  2.45   52.9%   <- best
  2.9    49.3%
  3.4    42.3%
```

`call`, `alone` and `dealerLastCall` came back flat within noise, so they sit
at their starting values. `order` is the one that moves the needle.

**A tier that did not survive testing.** There was a fourth level above Solid
that read who had shown out of each suit and steered its leads accordingly. Over
3000 games it won 49.8% against Solid — dead inside the noise. In a five-trick
hand you learn who is void too late for it to pay. The void reading is kept
switched on in Solid because it is correct play and costs nothing, but it did
not earn a difficulty step, and a setting that does not change your odds is a
lie. Beating Solid properly needs search, not more heuristics.

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
- `server/draw-e2e.js` — the drawing game over the wire: that only the drawer
  sees the word, that a guesser cannot draw or choose, that ink reaches the
  other phone, that the clock ends a turn by itself, and that the board is
  replayed to someone who reconnects mid-drawing.
- `server/draw-ui.js` — drives a real browser: picks a word, draws on the
  canvas with synthetic pointer events, and confirms both that the pixels
  landed and that the strokes reached the second player.
- `server/leavecheck.js` — drives a browser through leaving a room from the
  lobby and from mid-hand, and asserts a refresh afterwards stays out. Rejoining
  is deliberately sticky, so the way out needs its own test. Also covers the
  player-count picker and that a solo game skips the lobby.

  The end-to-end suite plays a **complete game at all four table sizes**, which
  is what catches the awkward cases — a lone human who is also the dealer, and
  a four-person table where nothing is ever waiting on a bot.
- `server/cardshots.js` — renders the sample hand in all six card-style and
  suit-colour combinations, at both in-hand and on-table size, screenshots
  each, and asserts the styles are actually distinct and that four-colour mode
  yields four different colours.
- `server/tagcheck.js` — measures the seat name tag in every combination of
  dealer / maker / alone / trick dots, at two phone widths, in both a roomy
  and a cramped seat. Catches clipped badges and collisions with the trick
  pile, which are invisible until the one hand where they happen.
- `server/smoke-remote.js` — the same idea as the end-to-end test but pointed
  at a deployed URL: `npm run smoke https://your-app.onrender.com`.

## Layout

```
server/
  index.js          express + ws wiring
  rooms.js          codes, seats, rejoin, leave, chat, ready gate  (game-agnostic)
  registry.js       which games exist
  games/
    euchre/
      cards.js      card primitives, trump/bower logic, trick resolution
      engine.js     the game state machine — no networking, no timers
      bot.js        bidding, discarding, card play, difficulty levels
      index.js      the game-module interface, with comments
    draw/
      words.js      prompts, guess matching
      engine.js     turns, clock, scoring
      index.js      module; relays ink outside the state broadcast
public/
  index.html        landing / setup / lobby / one section per game
  app.js            the shell: socket, home screen, lobby, menu, leaving
  style.css
  games/
    euchre.js       renderer
    draw.js         renderer + canvas
```

The server is authoritative. The browser never holds a hand it hasn't been
sent, never decides what is legal, and can be closed and reopened at any point
without affecting the game — which is what makes locking your phone mid-hand
safe.

## Card looks

The ⋯ menu has a **Card style** and **Suit colours** switcher with a live
preview. Choices are per-device and remembered.

- **Bold** — big centred rank and suit. Most legible on a small phone.
- **Classic** — corner indices on warm card stock with a serif face, and a
  large centre pip. The second, rotated index only appears on the larger
  in-hand cards; on a played card it collides with the centre.
- **Jumbo** — oversized corner index with a big suit opposite it.

**Four colour** keeps hearts and diamonds both warm (red / orange) and spades
and clubs both dark (near-black / teal). That distinguishes all four suits
while preserving the same-colour pairing the left bower depends on — a plain
four-colour deck would break that cue.

Styles live entirely in the stylesheet under `[data-cards=…]` and
`[data-suits=…]`; every card renders one markup shape carrying corner indices,
a centre rank and a centre pip, and each theme shows the parts it wants. Card
sizes come from a single `--cs` scale factor, so a new theme is written once
and works at every size.

## Notes

- Reconnecting is automatic and keyed to a UUID in `localStorage`, so a refresh,
  a lock screen, or a walk out of wifi range all resume the same seat. The seat
  is never given away, so nobody can take it while you're gone.
- Because rejoining is that sticky, there has to be a deliberate way out:
  **Cancel** on the lobby and **Leave game** in the ⋯ menu. Leaving clears the
  stored room, the URL and the socket, and gives the seat up server-side — the
  one case where a seat is released rather than held. Whoever is left keeps the
  same code so a replacement can join. Without this, every refresh drops you
  back into the room you were trying to escape.
- Rooms are reaped six hours after the last person leaves.
- **The next hand is dealt only when both players have pressed "Next hand."**
  There is no timer on the result screen, so neither of you gets rushed past
  the score. If one phone is locked or offline the game simply waits — that
  seat is held, and they land back on the same result screen when they
  reconnect and can press it themselves.
- The trick pause and bot "thinking" delays are at the top of
  `server/index.js`; `EUCHRE_FAST=1` collapses them, which is how the
  end-to-end test plays a full game in a few seconds.
