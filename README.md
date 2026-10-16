# Game Night

Games for people on their own phones, usually while already on a video call.
The app holds the private information — your hand, your prompt — and gets out
of the way; the talking is the game.

Five games so far:

- **Euchre** — trick-taking to ten, one to four people, bots filling any empty
  seat.
- **Draw It** — one person draws a prompt, everyone else races to guess it.
  Two to four people, no bots.
- **Quiz Wheel** — spin for a category, then everyone races the same
  multiple-choice question. Two to eight people.
- **Lava Run** — a side-scrolling race over collapsing platforms. Tap to hop,
  hold to jump further, and stay ahead of the closing edge. One to eight —
  alone it is a time trial, which is also how you learn a course.
- **Battleships** — hide five ships, then hunt somebody else's down square by
  square. Two to four fleets, or one bot to practise against.

## Looks

Every screen sets `body[data-theme]`, and the stylesheet only swaps variables —
each rule is written once against them.

| Screen | Look |
|---|---|
| Landing / setup | Neutral slate. The hub should not look like either game. |
| Euchre | Card-room green felt. |
| Draw It | Ink-and-violet studio, so the white board pops. |
| Quiz Wheel | Teal, so the coloured wheel has somewhere to sit. |
| Lava Run | Ember and dusk, lit from below. |
| Battleships | Cold open water. |

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

Everyone joins the lobby with a four-letter code and the host starts when the
room is full enough. Whoever is in at that moment is in the game. People take seats in join order and bots take the
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

**The drawer scores nothing for being guessed.** Everyone draws the same number
of times, so scoring the guess alone is fair at any table size and the winner
is simply whoever guessed best.

That is not just a simplification. With two people every turn has one drawer
and one guesser, so if the drawer is paid `k x` the guesser then over a game
`A - B = (k - 1)(P - Q)`, where P and Q are how quickly each player's drawings
were guessed. At `k = 1` every game ends level — which is exactly what the
first version did, and the end-to-end test cheerfully printed `300-300` for
several days without anyone noticing. Above 1 you win by drawing well, so
guessing slowly costs your opponent more than you; below 1 you win by drawing
badly. Every split has a hole in it, because with two people one player's score
is always produced by the other's effort. Paying only the guesser is the option
whose incentive is at least honest: guess faster than they do.

### Word difficulty

Prompts come in three tiers and you are shown one of each, with its stars, when
you choose. A harder prompt multiplies the **guesser's** points — so an easy
word tops out at 100, a medium at 130 and a hard at 170 — which on its own
would make a brave pick pure charity, since only the guesser scores.

So the drawer collects a flat bonus for a harder pick, paid only if somebody
actually gets it: nothing for easy, +15 for medium, +35 for hard. Flat rather
than a share of the guesser's score, deliberately: anything proportional puts
the drawer's points back under the guesser's control, which is what made
two-player scoring degenerate in the first place.

Harder prompts also take longer to land, which partly cancels the bigger
multiplier. Assuming an easy word is guessed with ~70% of the clock left, a
medium with ~45% and a hard with ~25%, the drawer's net position works out at
−76, −58 and −33 — so picking hard is the least costly choice, which is the
whole point. Those times are the design's premise rather than measured data,
and the test asserts the ordering so a retune cannot quietly invert it.

Guessing is forgiving about case, spacing, punctuation and stray plurals, and a
guess within two letters of the answer is flagged as close.

Strokes never travel inside the game state — a state broadcast per finger
movement would be enormous. Points are batched every 45ms into their own small
message, relayed to the other players, and the whole board is replayed to
anyone who reconnects. Coordinates are 0..1 of the board, so a drawing made on
a small phone arrives correctly on a big one.

Every ink message carries the turn it belongs to, and the client tracks which
turn its strokes are from. That is not bookkeeping for its own sake: a phone
whose screen turns off drops its socket and rejoins, and the rejoin replays the
board *before* the first state arrives. Clearing the canvas on "the turn is not
the one I last saw" wiped the replayed drawing every single time, because after
a rejoin the client had not seen any turn yet.

## Quiz Wheel

Each segment carries an icon, so the colours mean something. After every
question you both press **Next question** before the wheel comes back round.

**Whoever gets a question right spins the wheel for the next one.** They tap it
themselves; everyone else waits and watches it turn. The first spin of a game
goes to whoever made the room, and if nobody gets a question right the wheel
moves along a seat rather than sticking with the same person.

The wheel picks one of eight categories. Everyone then sees the same question
and four options, and answers independently against a 20-second clock. A correct answer is worth 100 down to 20 as the clock runs,
and the **first** correct answer takes a further 30 — being fastest is the
whole point, and without the bonus two quick answers score almost the same.

The category is decided by the server the moment the wheel is tapped, before it
starts turning; the state carries the chosen segment and a nonce, and each
phone rotates to it. The header holds the category name back until it stops,
or it gives away the landing.
Both therefore agree on the result no matter how their animations drift, and a
state resend after a reconnect does not re-spin the wheel.

Because both players face the same question independently, the roles are
symmetric — there is no drawer/guesser asymmetry to reason about, and none of
the scoring problems the drawing game had.

Questions come from the [Open Trivia Database](https://opentdb.com) — free, no
key, CC BY-SA 4.0. Requested as base64 so nothing arrives HTML-entity encoded,
with a session token per room so the same question never comes round twice.
The correct index is **withheld from the state** until the reveal, so it cannot
be read out of the socket mid-question.

That API is a third party behind a free-tier host, so every category also ships
a bundled fallback set. If the fetch fails, times out or returns an error code,
the game takes a bundled question and carries on rather than stalling. The
network round trip happens inside the wheel spin, so it hides behind an
animation that was going to run anyway.

## Lava Run

Everyone runs the same course at the same moment, on their own phone. **You can
run it alone**, in which case it is a time trial and the result screen reports
your time and your best rather than announcing you as the winner of a race you
were the only entrant in.

**One pace, everywhere, and it never stops rising.** The run used to be faster
in the air than on the ground, which made jumping gain ground on the closing
edge — but it also meant the game sped up and slowed down under you for no
visible reason. There is now a single speed that climbs for as long as you
survive.

That change has a consequence worth stating: with one speed nobody can fall
behind, so an edge that killed could only ever be a clock ending everyone at
the same instant — precisely the tie you do not want when two people both play
well. So **nothing chases you to death any more**. The lava wall sits at your
heels as pressure, and what kills you is the lava ahead or the rock above.

The course is therefore unbounded. Gaps are a share of what a jump can actually
clear at that point, and that share keeps climbing, so it stays possible for a
long time and then stops being possible — every run ends on a mistake, at a
different moment on a different course. Good play currently lasts between about
37 and 67 seconds depending on the seed, which is the spread that stops two
strong runs finishing level.
 Tap to
hop, hold to jump further. Fall in the lava, clip a rock overhead, or let the
closing left edge catch you and you are out; the last one going takes the
round.

**It is the only game here that runs its own clock.** The server hands out a
seed and a start time and nothing else — every client builds the identical
course from that seed and runs its own physics at its own frame rate. Positions
go out ten times a second as their own small message, never inside the game
state, purely so you can see each other. That is what makes 60fps workable over
a phone connection; the cost is that a player's distance is taken on trust,
which is the right trade for a game you play with your partner.

Because the camera is a pure function of elapsed time, everyone shares one
camera — so your opponent's reported position is on your screen, in your world,
running beside you.

The view follows the runner at a fixed screen position, so how far you can see
ahead never changes. It used to be pinned to the closing edge, which meant
running well pushed you towards the right of the screen and left you less time
to react — the better you played, the less you could see. The closing edge now
slides in from the left instead, with a glow warning you while it is still just
off screen.

The viewport is a fixed size in world units, so a phone with a different screen
cannot see further ahead than another. It is portrait, so it fills a phone held
normally rather than letterboxing a landscape strip into a tall empty box.

### Two things the tests forced

**It has to be a game, not a timer.** The first version had no overhead
hazards, and airborne movement is faster than grounded — so jumping was free
and more of it was always better. Holding the screen down beat careful play and
survived as long as a perfect run. The rock slabs exist to make an over-long
jump fatal, which is what turns "how long do you hold" into a decision.
`runner-e2e.js` asserts that mashing the screen loses badly, currently 18s
against 53s.

**You have to be able to fall.** Landing was "am I at or below the platform
top", with no check that you had been above it a moment earlier. So walking off
a ledge and drifting over a narrow gap snapped you up onto the next platform
through its side, and never jumping at all was a way to play — for thirty
seconds, as it turned out. Nothing caught it because the solver always jumps.
Never jumping now drops you in the first gap at three seconds, and the suite
asserts that, that you cannot arrive below a platform's lip and end up standing
on it, and — in a real browser, from a fresh page — that a run with no input at
all ends in the lava within a few seconds.

That last one exists because the first version of it lied. It waited for the
result overlay without checking the text had been rewritten, so it read the
leftover result from the previous section and passed while proving nothing.

**The course has to be possible.** A procedural runner that can emit an
unclearable gap is worthless and you would only find out mid-game.
`solver.js` plays each course by one-step lookahead — trying a spread of hold
lengths and simulating each to the next landing — so the tests can tell "this
course cannot be beaten" apart from "my formula was wrong". The first version
of the hazards failed that on 29 courses out of 30; slabs are now hung above
the arc the jump actually requires, and the suite fails if any course has a
moment where every possible jump kills you.

## Battleships

Ten by ten, five ships, one shot a turn. The rules are the ones everybody
already knows, so what follows is only the decisions the game had to make that
the boxed version never has to.

**Two to four fleets.** With two it is the classic game. With three or four you
pick whose waters you are firing into, and you are out when your last ship
goes down — the game carries on without you and you keep watching.

**Shots on a board are public.** With two players that is the classic game
exactly; there is nobody to hide them from. With three or four it stops the
table quietly re-shooting the same squares in private, and it keeps a board's
damage as one shared record instead of one per shooter, which is most of what
keeps a state small enough to send every turn.

**Sunk ships are shown.** Every square of a sunk ship is already a known hit,
so its outline gives nothing away — and being told what you just sank is half
the game.

**Placement lives on the server.** Each ship you put down is an action, not
local state. The drawing game once lost work when a phone locked; this cannot,
and the end-to-end suite drops a connection mid-setup to prove it.

**After a hit** you can have the turn pass over (the boxed rule, the default)
or fire again. Games run about a third shorter on *fire again*, and it makes a
good run feel like a good run.

### The bot cannot see through the water

The server has every ship position to hand, so an opponent that promises not to
peek is worth nothing. `bot.js` is never given a board — it is handed a
*knowledge* object built from the shots and the sunk ships, which is exactly
what a person sitting opposite could work out. Cheating is not forbidden, it is
unavailable.

That property needs testing carefully, and the obvious test is wrong. The bot
hits on its opening shot about 22% of the time, well above the 17 squares in
100 that a fleet covers — and that is correct play, not second sight: a
five-long ship dropped at random covers the middle columns far more often than
the corners, so the middle genuinely is the better guess.

What must be true instead is that the *layout cannot reach the decision*. Given
the same knowledge — an untouched board — the bot has to pick the same square
no matter what is hidden underneath. The suite runs 300 different fleets past
it and fails if the opening shot ever moves. That is exact rather than
statistical. It also checks the honest floor: seventeen squares hold ships, so
nothing short of cheating clears a board in seventeen shots, and over 200 games
its best was 25.

Two settings, and the difference is where it hunts rather than how hard it
thinks:

| | Hunting | Shots to clear a fleet |
|---|---|---|
| Casual | The odd/even lattice, plus the occasional slip | ~54 |
| Sharp | Counts how many ways each remaining ship could still lie across each square | ~45 |

A person averages somewhere around 50, so casual is a fair game and sharp is a
hard one. Both chase properly once they find something: around a lone hit, and
along the line as soon as two hits line up.

## Running it locally

```bash
npm install
npm start          # http://localhost:3000
```

Open it, enter a name, pick a game and hit **Open a lobby**. Send everyone else
the four-letter code (the **Copy invite link** button uses the phone share
sheet if there is one), then press **Start** when everyone is in.

Nobody picks a headcount up front. The table size is simply however many people
are in the lobby when the host starts, and each game decides for itself what to
do with the empty chairs:

- **Euchre** fills every remaining seat with a bot, because four hands is what
  makes it euchre, and shows you which ones it would add before you start.
- **Battleships** adds a bot only if you are on your own. Two people who turn
  up get each other, not a table of four with two machines in it.
- **Draw It**, **Quiz Wheel** and **Lava Run** take no bots at all and simply
  play with whoever came.

Seats freeze at that moment, so a latecomer is turned away rather than
appearing mid-hand.

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
- `server/battleship-e2e.js` — the rules, the bot's fairness (above), turn
  order over three and four fleets, and two full games over the wire. Asserts
  at every step of a complete game that no view carries the other fleet, that a
  ship placed before a phone drops is still there afterwards, and that both
  fleets are finally revealed when it is over.
- `server/battleship-ui.js` — lays a fleet out by tapping in a real browser and
  fires a shot. The check worth having is the last one: it is not enough for
  the server to keep the enemy fleet out of the state, so it goes and reads the
  computed background of all hundred enemy squares and fails if the untouched
  ones are not identical. A leak that only showed up as a shade would pass
  every other test in this repo.
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
  **Cancel** on the lobby, **Leave game** in the ⋯ menu, and **Back to games**
  on every overlay. That last one matters more than it looks: an overlay covers
  the ⋯ button, so between turns and at the end of a game there was no exit at
  all, and a refresh rejoined the room you were trying to leave. Leaving clears the
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
