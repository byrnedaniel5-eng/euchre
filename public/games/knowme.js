/* Know Me renderer.
 *
 * Questions are written in the subject's voice ("What's my comfort food?"),
 * so they are shown as the subject asking them — then "my" always means the
 * same person on every phone. With two players the couples deck's "Me" and
 * "You" options become names, because "You" on the guesser's phone would
 * otherwise mean the wrong person.
 *
 * The body below the question is rebuilt for each phase; the one piece of
 * local state worth keeping is a half-typed answer, so a state arriving from
 * somebody else's tap does not wipe it.
 */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let state = null;
  let ctx = null;
  let draft = '';
  let writing = false;  // the subject is writing their own question
  let shownKey = '';    // which body is on screen, so typing survives renders

  const esc = (s) => ctx.escapeHtml(s);
  const subjectName = () => (state.youAreSubject ? 'You' : state.names[state.subject]);

  /** "Me"/"You" in a two-player couples question, as names. */
  function optionLabel(opt) {
    const s = state;
    if (s.players !== 2) return opt;
    const other = 1 - s.subject;
    if (opt === 'Me') return s.youAreSubject ? 'Me' : s.names[s.subject];
    if (opt === 'You') return s.youAreSubject ? s.names[other] : (ctx.seat === other ? 'Me' : s.names[other]);
    return opt;
  }

  function answerText(q, v) {
    if (v === null || v === undefined) return '—';
    if (q.type === 'choice') return optionLabel(q.options[v]);
    if (q.type === 'scale') return `${v} / 5`;
    return v;
  }

  const MARK = { right: '✓', close: '≈', wrong: '✗' };

  function render(s, c) {
    state = s;
    ctx = c;
    const q = s.question;

    $('km-round').textContent = `${s.round}/${s.totalRounds}`;
    $('km-status').textContent =
      s.phase === 'pick' ? (s.youAreSubject ? 'Your question' : `${s.names[s.subject]} is choosing`)
      : s.phase === 'answer' ? (s.youAreSubject ? 'Answer honestly' : `Guess ${s.names[s.subject]}'s answer`)
      : s.phase === 'judge' ? (s.youAreSubject ? 'Mark their guesses' : `${s.names[s.subject]} is marking`)
      : s.phase === 'reveal' ? 'The answer' : 'All done';

    $('km-scores').innerHTML = s.names.map((n, i) => `
      <div class="ds${i === s.subject ? ' drawing' : ''}">
        <b>${esc(i === c.seat ? 'You' : n)}</b>
        <span>${s.scores[i]}${s.phase === 'answer' && s.answered[i] ? ' ✓' : ''}</span>
      </div>`).join('');

    $('km-asker').textContent = `${s.youAreSubject ? 'You ask' : `${s.names[s.subject]} asks`}`;
    $('km-q').textContent = q.q;
    $('km-kind').textContent = q.type === 'scale' ? `1 = ${q.low} · 5 = ${q.high}` : q.custom
      ? (s.youAreSubject ? 'your own question' : `${s.names[s.subject]}'s own question`) : '';

    const key = `${s.round}:${s.phase}:${q.q}:${s.yourAnswer !== null}:${writing}`;
    const typing = shownKey === key && ['answer', 'pick'].includes(s.phase) && (q.type === 'text' || writing);
    if (!typing) {
      shownKey = key;
      $('km-body').innerHTML = body();
    } else {
      $('km-body').querySelectorAll('[data-refresh]').forEach((el) => { el.outerHTML = refreshable(el.dataset.refresh); });
    }
    $('km-foot').innerHTML = foot();
    renderOverlay();
  }

  // ------------------------------------------------------------- per phase

  function body() {
    const s = state;
    const q = s.question;

    if (s.phase === 'pick') {
      if (!s.youAreSubject) {
        return `<p class="hint">${esc(s.names[s.subject])} is picking a question about themself.</p>`;
      }
      if (writing) {
        return `<form class="km-form" data-form="custom">
          <input id="km-input" maxlength="120" placeholder="Ask about yourself…" autocomplete="off" value="${esc(draft)}">
          <div class="row"><button type="button" class="ghost" data-act="cancel-write">Cancel</button>
          <button type="submit" class="primary">Use this</button></div>
        </form>`;
      }
      return `<div class="km-pick">
        <button class="ghost" data-act="swap"${s.swapsLeft > 0 ? '' : ' disabled'}>Swap (${s.swapsLeft})</button>
        <button class="ghost" data-act="write">Write my own</button>
      </div>`;
    }

    if (s.phase === 'answer') {
      if (s.yourAnswer !== null) {
        return `<div class="km-done"><span>Your answer</span><b>${esc(answerText(q, s.yourAnswer))}</b></div>
          <div data-refresh="waiting">${refreshable('waiting')}</div>`;
      }
      if (q.type === 'choice') {
        return `<div class="km-options">${q.options.map((o, i) =>
          `<button class="km-opt" data-answer="${i}">${esc(optionLabel(o))}</button>`).join('')}</div>`;
      }
      if (q.type === 'scale') {
        return `<div class="km-scale">${[1, 2, 3, 4, 5].map((n) =>
          `<button class="km-opt" data-answer="${n}">${n}</button>`).join('')}</div>
          <div class="km-ends"><span>${esc(q.low)}</span><span>${esc(q.high)}</span></div>`;
      }
      return `<form class="km-form" data-form="answer">
        <input id="km-input" maxlength="80" placeholder="${s.youAreSubject ? 'Your answer' : `What will ${esc(s.names[s.subject])} say?`}" autocomplete="off" value="${esc(draft)}">
        <button type="submit" class="primary">Lock in</button>
      </form>`;
    }

    if (s.phase === 'judge') {
      if (!s.youAreSubject) {
        return `<p class="hint">${esc(s.names[s.subject])} is deciding whether you got it.</p>`;
      }
      const truth = s.answers[s.subject];
      return `<div class="km-done"><span>You said</span><b>${esc(truth)}</b></div>
        <div class="km-judge">${s.names.map((n, i) => {
          if (i === s.subject) return '';
          const m = s.marks[i];
          return `<div class="km-guess">
            <span><i>${esc(n)}</i>${esc(s.answers[i])}</span>
            <div class="km-marks">${['right', 'close', 'wrong'].map((k) =>
              `<button class="${k}${m === k ? ' on' : ''}" data-judge="${i}" data-mark="${k}">${MARK[k]}</button>`).join('')}</div>
          </div>`;
        }).join('')}</div>`;
    }

    // reveal / gameOver
    const truth = s.answers?.[s.subject];
    return `<div class="km-done truth"><span>${esc(subjectName())} said</span><b>${esc(answerText(q, truth))}</b></div>
      <div class="km-judge">${s.names.map((n, i) => {
        if (i === s.subject) return '';
        const m = s.marks[i];
        return `<div class="km-guess ${m}">
          <span><i>${esc(i === ctx.seat ? 'You' : n)}</i>${esc(answerText(q, s.answers[i]))}</span>
          <b>${MARK[m]} +${s.roundPoints[i]}</b>
        </div>`;
      }).join('')}</div>`;
  }

  /** Bits that change while someone types, without rebuilding the input. */
  function refreshable(which) {
    if (which === 'waiting') {
      const waiting = state.names.filter((_, i) => !state.answered[i]);
      return `<p class="hint" data-refresh="waiting">${waiting.length ? `Waiting for ${esc(waiting.join(', '))}…` : ''}</p>`;
    }
    return '';
  }

  function foot() {
    const s = state;
    if (s.phase === 'pick' && s.youAreSubject && !writing) {
      return '<button class="primary" data-act="ask">Ask this</button>';
    }
    if (s.phase === 'reveal') {
      const ready = s.ready.includes(ctx.seat);
      const last = s.round >= s.totalRounds;
      return `<button class="primary" data-act="next"${ready ? ' disabled' : ''}>${
        ready ? 'Waiting…' : last ? 'See who knows best' : 'Next question'}</button>`;
    }
    return '';
  }

  function renderOverlay() {
    const s = state;
    const ov = $('overlay');
    if (s.phase !== 'gameOver') { ov.hidden = true; return; }
    ov.hidden = false;
    const best = Math.max(...s.scores);
    const top = s.scores.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    $('ov-title').textContent = top.length > 1 ? 'Dead even'
      : top[0] === ctx.seat ? 'You know them best' : `${s.names[top[0]]} knows best`;
    $('ov-body').textContent = s.names.map((n, i) => `${i === ctx.seat ? 'You' : n} ${s.scores[i]}`).join(' · ');
    $('ov-tricks').textContent = `Out of ${2 * (s.totalRounds / s.players) * (s.players - 1)} each.`;
    $('ov-btn').hidden = false;
    $('ov-btn').disabled = false;
    $('ov-btn').textContent = 'Play again';
    $('ov-btn').onclick = () => ctx.act({ kind: 'newGame' });
  }

  // ---------------------------------------------------------------- input

  const root = $('game-knowme');
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !state) return;
    if (t.dataset.answer !== undefined) return ctx.act({ kind: 'answer', value: Number(t.dataset.answer) });
    if (t.dataset.judge !== undefined) return ctx.act({ kind: 'judge', seat: Number(t.dataset.judge), mark: t.dataset.mark });
    switch (t.dataset.act) {
      case 'swap': return ctx.act({ kind: 'swap' });
      case 'ask': return ctx.act({ kind: 'ask' });
      case 'next': return ctx.act({ kind: 'next' });
      case 'write': writing = true; draft = ''; return render(state, ctx);
      case 'cancel-write': writing = false; return render(state, ctx);
      default:
    }
  });
  root.addEventListener('input', (e) => { if (e.target.id === 'km-input') draft = e.target.value; });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('km-input')?.value.trim();
    if (!text) return ctx.toast('Write something first.');
    if (e.target.dataset.form === 'custom') {
      ctx.act({ kind: 'custom', text });
      writing = false;
    } else {
      ctx.act({ kind: 'answer', value: text });
    }
    draft = '';
  });

  window.registerGame('knowme', {
    root: 'game-knowme',
    usesCards: false,
    render,
    reset() {
      state = null;
      draft = '';
      writing = false;
      shownKey = '';
    },
  });
})();
