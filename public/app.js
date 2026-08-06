/* The shell. Owns the socket, the home screen, the lobby, the menu drawer and
   leaving. It knows nothing about any particular game: each game registers a
   renderer with window.registerGame() and gets handed state as it arrives. */

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ persistence

  const store = {
    get(k, d = null) {
      try { return JSON.parse(localStorage.getItem('euchre.' + k)) ?? d; } catch { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('euchre.' + k, JSON.stringify(v)); } catch { /* private mode */ }
    },
  };

  let playerId = store.get('playerId');
  if (!playerId) {
    playerId = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now());
    store.set('playerId', playerId);
  }

  // -------------------------------------------------------- game renderers

  const RENDERERS = {};
  let active = null; // the renderer currently on screen

  window.registerGame = (id, renderer) => { RENDERERS[id] = renderer; };

  // -------------------------------------------------------------- app state

  let ws = null;
  let mySeat = null;
  let roomCode = null;
  let state = null;
  let retries = 0;
  let pendingJoin = null;
  let catalogue = [];
  let chosenGame = store.get('game', 'euchre') || 'euchre';
  let playerCount = store.get('playerCount', 2) || 2;
  let gameOptions = store.get('gameOptions', {}) || {};

  const ctx = {
    get state() { return state; },
    get seat() { return mySeat; },
    $,
    act: (action) => send({ type: 'action', action }),
    send: (msg) => send(msg),
    escapeHtml,
    store,
  };

  // ------------------------------------------------------------- networking

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onopen = () => {
      retries = 0;
      $('conn-banner').hidden = true;
      if (pendingJoin) ws.send(JSON.stringify({ type: 'join', playerId, ...pendingJoin }));
    };

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'joined') {
        mySeat = msg.seat;
        roomCode = msg.room;
        pendingJoin = { room: msg.room, name: pendingJoin?.name || 'Player' };
        store.set('lastRoom', { code: msg.room, at: Date.now() });
        history.replaceState(null, '', `?room=${msg.room}`);
        $('chat').innerHTML = '';
        (msg.chat || []).forEach(addChat);
        active = RENDERERS[msg.game] || null;
        active?.reset?.(ctx);
      } else if (msg.type === 'state') {
        state = msg.state;
        render();
      } else if (msg.type === 'chat') {
        addChat(msg.entry);
        if ($('drawer').hidden) flashMenu();
      } else if (msg.type === 'error') {
        if (state) {
          toast(msg.message);
        } else {
          // The join failed — usually a stored room the server no longer has.
          // Forget it, or every refresh retries the same dead code.
          store.set('lastRoom', null);
          pendingJoin = null;
          history.replaceState(null, '', location.pathname);
          showScreen('join');
          showJoinError(msg.message);
        }
      } else {
        active?.handleMessage?.(msg, ctx);
      }
    };

    ws.onclose = () => {
      if (pendingJoin) {
        $('conn-banner').hidden = false;
        setTimeout(connect, Math.min(1000 * 2 ** retries++, 10000));
      }
    };

    ws.onerror = () => ws.close();
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // ------------------------------------------------------------ home screen

  const gameDef = () => catalogue.find((g) => g.id === chosenGame) || catalogue[0];

  const PLAYER_HINTS = {
    euchre: {
      1: 'Just you and 3 bots. Your partner sits across from you.',
      2: 'Two people on opposite teams, each partnered by a bot.',
      3: 'Three people and 1 bot. The bot partners whoever joins second.',
      4: 'Four people, no bots.',
    },
    draw: {
      2: 'One draws, one guesses, swapping every turn.',
      3: 'One draws, two race to guess it first.',
      4: 'One draws, three race to guess it first.',
    },
  };

  function renderHome() {
    const def = gameDef();
    if (!def) return;

    $('game-list').innerHTML = catalogue.map((g) => `
      <button class="game-card${g.id === chosenGame ? ' on' : ''}" data-game="${g.id}">
        <span class="gc-icon">${g.icon || '🎲'}</span>
        <span class="gc-text"><b>${escapeHtml(g.name)}</b><i>${escapeHtml(g.blurb)}</i></span>
      </button>`).join('');

    // Clamp the table size to what this game allows.
    playerCount = Math.min(def.maxPlayers, Math.max(def.minPlayers, playerCount));
    const counts = [];
    for (let n = def.minPlayers; n <= def.maxPlayers; n++) counts.push(n);
    $('opt-players').innerHTML = counts
      .map((n) => `<button data-v="${n}"${n === playerCount ? ' class="on"' : ''}>${n}</button>`)
      .join('');
    $('players-hint').textContent = (PLAYER_HINTS[def.id] || {})[playerCount] || '';

    // Option rows come from the server, so a new game needs no client changes.
    const opts = def.options || {};
    $('game-options').innerHTML = Object.entries(opts).map(([key, o]) => {
      const current = gameOptions[key] ?? o.default;
      return `<div class="opt-row" data-opt="${key}">
        <label>${escapeHtml(o.label)}</label>
        <div class="seg spread">${o.values.map((v) =>
          `<button data-v="${escapeHtml(String(v.value))}"${
            String(v.value) === String(current) ? ' class="on"' : ''}>${escapeHtml(v.label)}</button>`
        ).join('')}</div>
      </div>`;
    }).join('');
  }

  $('game-list').onclick = (e) => {
    const id = e.target.closest('[data-game]')?.dataset.game;
    if (!id) return;
    chosenGame = id;
    store.set('game', id);
    renderHome();
  };
  $('opt-players').onclick = (e) => {
    const v = Number(e.target.closest('button')?.dataset.v);
    if (!v) return;
    playerCount = v;
    store.set('playerCount', v);
    renderHome();
  };
  $('game-options').onclick = (e) => {
    const btn = e.target.closest('button');
    const row = e.target.closest('[data-opt]');
    if (!btn || !row) return;
    gameOptions = { ...gameOptions, [row.dataset.opt]: btn.dataset.v };
    store.set('gameOptions', gameOptions);
    renderHome();
  };

  function showJoinError(text) {
    const el = $('join-error');
    el.textContent = text;
    el.hidden = false;
  }

  function doJoin(room) {
    const name = $('name').value.trim() || 'Player';
    store.set('name', name);
    pendingJoin = { room: room || null, name };
    if (!room) {
      // Table size, game and its options belong to the room, so only the
      // person creating it gets a say; everyone else inherits what they join.
      pendingJoin.game = chosenGame;
      pendingJoin.players = playerCount;
      pendingJoin.options = gameOptions;
    }
    $('join-error').hidden = true;
    if (ws && ws.readyState === WebSocket.OPEN) send({ type: 'join', playerId, ...pendingJoin });
    else connect();
  }

  $('name').value = store.get('name', '') || '';
  $('create').onclick = () => doJoin(null);
  $('join-btn').onclick = () => {
    const code = $('code').value.trim().toUpperCase();
    if (code.length !== 4) return showJoinError('A game code is 4 characters.');
    doJoin(code);
  };
  $('code').oninput = (e) => { e.target.value = e.target.value.toUpperCase(); };
  $('code').onkeydown = (e) => { if (e.key === 'Enter') $('join-btn').click(); };
  $('name').onkeydown = (e) => { if (e.key === 'Enter') $('create').click(); };

  $('copy-link').onclick = async () => {
    const url = `${location.origin}/?room=${roomCode}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Game Night', text: `Code ${roomCode}`, url });
      else await navigator.clipboard.writeText(url);
      $('copy-link').textContent = 'Copied!';
      setTimeout(() => ($('copy-link').textContent = 'Copy invite link'), 1600);
    } catch { /* user dismissed the share sheet */ }
  };

  // ------------------------------------------------------------- screens

  const SCREENS = ['join', 'lobby', 'game-euchre', 'game-draw'];
  function showScreen(id) {
    for (const s of SCREENS) $(s).hidden = s !== id;
  }

  function render() {
    if (!state) return;

    if (state.phase === 'lobby') {
      showScreen('lobby');
      $('room-code').textContent = state.room;
      const inSoFar = state.seated.filter(Boolean).length;
      const total = state.humans ?? 2;
      const missing = total - inSoFar;
      document.querySelector('#lobby h2').textContent =
        missing === 1 ? 'Waiting for one more' : `Waiting for ${missing} more`;
      const here = state.seated.map((ok, s) => (ok ? state.names[s] : null))
        .filter(Boolean).join(', ');
      $('lobby-status').textContent =
        missing > 0 ? `${inSoFar} of ${total} here — ${here}` : 'Starting…';
      return;
    }

    active = RENDERERS[state.game] || active;
    if (!active) return;
    showScreen(active.root);
    // The card appearance panel only means anything to a card game.
    $('card-settings').hidden = !active.usesCards;
    active.render(state, ctx);
    renderDrawer();
  }

  // -------------------------------------------------------------- drawer

  const humanSeats = () => Array.from({ length: state?.humans ?? 2 }, (_, i) => i);
  const otherHumans = () => humanSeats().filter((s) => s !== mySeat);

  function renderDrawer() {
    $('drawer-room').textContent = state.room || roomCode || '';
    const others = otherHumans();
    const who = others.length === 0
      ? 'solo against 3 bots'
      : others
          .map((s) => `${state.names[s]} ${state.connected?.[s] === false ? 'offline' : 'online'}`)
          .join(' · ');
    const bots = 4 - (state.humans ?? 2);
    $('drawer-conn').textContent =
      who + (bots > 0 && state.difficulty ? ` · bots: ${state.difficulty}` : '');

    const log = $('log');
    log.innerHTML = (state.log || []).map((l) => `<div>${escapeHtml(l)}</div>`).join('');
    log.scrollTop = log.scrollHeight;
  }

  for (const btn of document.querySelectorAll('.menu-btn')) {
    btn.onclick = () => {
      $('drawer').hidden = false;
      $('chat').scrollTop = $('chat').scrollHeight;
      $('log').scrollTop = $('log').scrollHeight;
    };
  }
  $('drawer-close').onclick = () => ($('drawer').hidden = true);
  $('chat-form').onsubmit = (e) => {
    e.preventDefault();
    const text = $('chat-input').value.trim();
    if (!text) return;
    send({ type: 'chat', text });
    $('chat-input').value = '';
  };

  function addChat(entry) {
    const el = document.createElement('div');
    el.className = 'msg' + (entry.seat === mySeat ? ' mine' : '');
    el.innerHTML = `<span class="who">${escapeHtml(entry.from)}</span>${escapeHtml(entry.text)}`;
    const box = $('chat');
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  // --------------------------------------------------------------- leaving

  /**
   * Get out of a room for good. Rejoining is deliberately sticky — a refresh
   * or a lock screen must land you back in your seat — so leaving has to clear
   * every trace of it: the stored room, the URL, and the socket.
   */
  function leaveGame() {
    send({ type: 'leave' });
    pendingJoin = null; // must precede close(), or onclose reconnects us
    if (ws) ws.close();
    ws = null;
    active?.reset?.(ctx);
    active = null;
    state = null;
    mySeat = null;
    roomCode = null;
    store.set('lastRoom', null);
    history.replaceState(null, '', location.pathname);
    $('code').value = '';
    $('chat').innerHTML = '';
    $('drawer').hidden = true;
    $('overlay').hidden = true;
    $('conn-banner').hidden = true;
    $('join-error').hidden = true;
    showScreen('join');
  }

  $('lobby-cancel').onclick = leaveGame;
  $('leave-game').onclick = () => {
    const mid = state && !['gameOver', 'lobby'].includes(state.phase);
    if (mid && !confirm('Leave this game? It will end for everyone.')) return;
    leaveGame();
  };

  // ---------------------------------------------------------------- helpers

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function toast(text) {
    const b = $('conn-banner');
    b.textContent = text;
    b.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      b.hidden = true;
      b.textContent = 'Reconnecting…';
    }, 2200);
  }
  ctx.toast = toast;

  function flashMenu() {
    for (const btn of document.querySelectorAll('.menu-btn')) {
      btn.style.color = 'var(--gold)';
      setTimeout(() => (btn.style.color = ''), 2500);
    }
  }

  // --------------------------------------------------------------- start up

  // Phones suspend sockets when the screen locks; wake straight back up.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && pendingJoin && (!ws || ws.readyState > WebSocket.OPEN)) connect();
  });

  window.__gamesReady = async () => {
    try {
      catalogue = await (await fetch('/games')).json();
    } catch {
      catalogue = [{ id: 'euchre', name: 'Euchre', blurb: '', icon: '♠',
                     minPlayers: 1, maxPlayers: 4, options: {} }];
    }
    if (!catalogue.some((g) => g.id === chosenGame)) chosenGame = catalogue[0].id;
    renderHome();

    const urlRoom = new URLSearchParams(location.search).get('room');
    const last = store.get('lastRoom');
    const savedName = store.get('name', '');

    if (urlRoom) {
      $('code').value = urlRoom.toUpperCase();
      if (savedName) doJoin(urlRoom.toUpperCase());
    } else if (last && savedName && Date.now() - last.at < 12 * 60 * 60 * 1000) {
      doJoin(last.code);
    }
  };
})();
