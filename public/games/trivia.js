/* Trivia renderer.
 *
 * The wheel is decoration over a decision the server already made: the state
 * carries the chosen category and a nonce, and the wheel rotates to land on
 * that segment. Both phones therefore agree on the result even though their
 * animations run independently. */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  let state = null;
  let ctx = null;
  let clockTimer = null;
  let paintedWheel = false;
  let lastNonce = null;
  let turns = 0; // accumulated rotation, so the wheel only ever spins forwards

  // --------------------------------------------------------------- wheel

  function paintWheel(categories) {
    if (paintedWheel) return;
    const slice = 360 / categories.length;
    const stops = categories.map((c, i) =>
      `${c.color} ${i * slice}deg ${(i + 1) * slice}deg`).join(', ');
    const el = $('wheel');
    el.style.background = `conic-gradient(from -${slice / 2}deg, ${stops})`;
    // An icon per segment, so the colours mean something. They ride round with
    // the wheel and point outwards the way markings on a real one do, which
    // leaves whichever lands under the pointer sitting upright.
    el.innerHTML = categories.map((c, i) =>
      `<span class="wseg" style="--a:${i * slice}deg" title="${ctx?.escapeHtml?.(c.name) || c.name}">` +
      `<i>${c.icon || '?'}</i></span>`).join('');
    paintedWheel = true;
  }

  /** Rotate so the chosen segment sits under the pointer at the top. */
  function spinTo(categories, categoryId, ms) {
    const i = Math.max(0, categories.findIndex((c) => c.id === categoryId));
    const slice = 360 / categories.length;
    // Segment i is centred at i*slice from the top; rotate it back to zero,
    // plus whole turns so it always reads as a spin rather than a nudge.
    turns += 4;
    const target = turns * 360 - i * slice;
    const el = $('wheel');
    el.style.transitionDuration = `${Math.max(0.1, ms / 1000)}s`;
    el.style.transform = `rotate(${target}deg)`;
  }

  // -------------------------------------------------------------- render

  function render(s, c) {
    state = s;
    ctx = c;
    paintWheel(s.categories);

    $('tv-index').textContent = `${s.index}/${s.questionCount}`;
    // Hold the name back while the wheel is turning — otherwise the header
    // gives away where it is going to land before it lands.
    const cat = s.categories.find((x) => x.id === s.category);
    // Named only while its question is live. Showing it during the spin gives
    // away the landing, and showing it while waiting to spin leaves the last
    // question's category sitting over a wheel that has not turned yet.
    const naming = s.phase === 'question' || s.phase === 'reveal';
    $('tv-category').textContent = (cat && naming)
      ? `${cat.icon || ''} ${cat.name}`.trim() : '';
    renderScores();
    renderClock();

    // A new spin is signalled by a fresh nonce, not by the phase, so a state
    // resend after a reconnect does not re-spin the wheel.
    if (s.spinNonce !== lastNonce) {
      lastNonce = s.spinNonce;
      spinTo(s.categories, s.category, s.spinMs || 2600);
    }

    const onWheel = s.phase === 'spinning' || s.phase === 'toSpin';
    $('wheel-stage').hidden = !onWheel;
    $('tv-question').hidden = onWheel;

    const yours = s.phase === 'toSpin' && s.youSpin;
    $('wheel').classList.toggle('tappable', yours);
    $('wheel-label').textContent =
      s.phase === 'spinning' ? 'Spinning…'
      : yours ? 'Your spin — tap the wheel'
      : s.phase === 'toSpin' ? `${s.names[s.spinner]} spins next…`
      : '';

    if (!onWheel && s.question) renderQuestion(s);
    renderOverlay();
  }

  function renderScores() {
    $('tv-scores').innerHTML = state.names.slice(0, state.humans).map((n, i) => {
      const locked = (state.answered || []).includes(i);
      const streak = state.streaks?.[i] || 0;
      return `<div class="ds${locked ? ' solved' : ''}">
        <b>${ctx.escapeHtml(i === ctx.seat ? 'You' : n)}</b>
        <span>${state.scores[i]}${streak >= 2 ? `<i class="streak"> ${streak}🔥</i>` : ''}</span>
      </div>`;
    }).join('');
  }

  const MIN_POINTS = 20;
  const MAX_POINTS = 100;
  const worthAt = (left, total) => (left <= 0 ? 0
    : MIN_POINTS + Math.round((MAX_POINTS - MIN_POINTS) * Math.min(1, left / total)));

  function renderClock() {
    clearInterval(clockTimer);
    const el = $('tv-clock');
    const worth = $('tv-worth');
    const pill = $('tv-clock-pill');
    if (state.phase !== 'question') {
      el.textContent = '–';
      worth.textContent = '';
      pill.className = 'clock';
      return;
    }
    const total = state.questionSeconds || 20;
    const answered = state.yourAnswer !== null && state.yourAnswer !== undefined;
    const tick = () => {
      const left = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
      el.textContent = left;
      worth.textContent = answered ? '' : `${worthAt(left, total)} pts`;
      pill.className = 'clock' + (left <= 5 ? ' urgent' : '');
    };
    tick();
    clockTimer = setInterval(tick, 200);
  }

  function renderQuestion(s) {
    $('tv-text').innerHTML = s.question.text;

    const revealing = s.phase === 'reveal' || s.phase === 'gameOver';
    const mine = s.yourAnswer;
    const locked = mine !== null && mine !== undefined;

    $('tv-options').innerHTML = s.question.options.map((opt, i) => {
      let cls = '';
      if (revealing) {
        if (i === s.question.answer) cls = 'right';
        else if (i === mine) cls = 'wrong';
        else cls = 'faded';
      } else if (i === mine) {
        cls = 'chosen';
      }
      return `<button data-i="${i}" class="${cls}"${locked || revealing ? ' disabled' : ''}>` +
        `${opt}</button>`;
    }).join('');

    const others = Array.from({ length: s.humans }, (_, i) => i)
      .filter((i) => i !== ctx.seat && !(s.answered || []).includes(i));
    $('tv-status').textContent = revealing ? ''
      : locked
        ? (others.length ? `Locked in — waiting for ${others.map((i) => s.names[i]).join(', ')}…`
                         : 'Locked in…')
        : 'Answer as fast as you can';
  }

  $('wheel-stage').onclick = () => {
    if (state?.phase === 'toSpin' && state.youSpin) ctx.act({ kind: 'spin' });
  };

  $('tv-options').onclick = (e) => {
    const btn = e.target.closest('button[data-i]');
    if (!btn || btn.disabled) return;
    ctx.act({ kind: 'answer', choice: Number(btn.dataset.i) });
  };

  function renderOverlay() {
    const ov = $('overlay');

    if (state.phase === 'gameOver') {
      const best = Math.max(...state.scores.slice(0, state.humans));
      const iWon = state.scores[ctx.seat] === best;
      ov.hidden = false;
      $('ov-title').textContent = iWon ? 'You win!' : 'Good game';
      $('ov-body').textContent = state.names.slice(0, state.humans)
        .map((n, i) => `${i === ctx.seat ? 'You' : n}: ${state.scores[i]}`).join(' · ');
      $('ov-tricks').textContent = state.names.slice(0, state.humans)
        .map((n, i) => `${i === ctx.seat ? 'You' : n} ${state.correctCounts[i]}/${state.questionCount} right`)
        .join(' · ');
      $('ov-btn').disabled = false;
      $('ov-btn').textContent = 'Play again';
      $('ov-btn').onclick = () => ctx.act({ kind: 'newGame' });
      return;
    }

    if (state.phase === 'reveal' && state.revealed) {
      const r = state.revealed;
      const mine = r.answers.find((a) => a.seat === ctx.seat);
      ov.hidden = false;

      if (!mine) $('ov-title').textContent = 'Out of time';
      else if (!mine.correct) $('ov-title').textContent = 'Wrong';
      else if (mine.first) $('ov-title').textContent = `First! +${mine.points}`;
      else $('ov-title').textContent = `Correct +${mine.points}`;

      $('ov-body').textContent = `Answer: ${r.question.options[r.question.answer]}`;

      const scoreLine = r.answers.length
        ? r.answers
            .slice()
            .sort((a, b) => b.secondsLeft - a.secondsLeft)
            .map((a) => `${a.seat === ctx.seat ? 'You' : state.names[a.seat]} ` +
              (a.correct ? `+${a.points}` : '✗'))
            .join(' · ')
        : 'Nobody answered';
      const next = r.nextSpinner === ctx.seat ? 'You spin next'
        : `${state.names[r.nextSpinner]} spins next`;
      $('ov-tricks').textContent = `${scoreLine} — ${next}`;

      // Everyone reads the answer before the wheel comes back round.
      const ready = state.ready || [];
      const iAmReady = ready.includes(ctx.seat);
      const waiting = Array.from({ length: state.humans }, (_, i) => i)
        .filter((i) => i !== ctx.seat && !ready.includes(i));
      const waitText = waiting.length === 1
        ? `Waiting for ${state.names[waiting[0]]}…`
        : `Waiting for ${waiting.length} others…`;

      const btn = $('ov-btn');
      btn.hidden = false;
      btn.disabled = iAmReady;
      btn.textContent = iAmReady
        ? (waiting.length ? waitText : 'Next…')
        : (state.index >= state.questionCount ? 'See the result' : 'Next question');
      btn.onclick = () => {
        btn.disabled = true;
        btn.textContent = waiting.length ? waitText : 'Next…';
        ctx.act({ kind: 'nextQuestion' });
      };
      return;
    }

    $('ov-btn').hidden = false;
    ov.hidden = true;
  }

  window.registerGame('trivia', {
    root: 'game-trivia',
    usesCards: false,
    render,
    reset() {
      state = null;
      lastNonce = null;
      clearInterval(clockTimer);
    },
  });
})();
