/* =========================================================
   INDOVINA CHI È L'INTRUSO — App logic
   Nessun server, nessun database online: tutto locale.
   ========================================================= */

(() => {
  'use strict';

  /* ---------------- Stato applicazione ---------------- */

  const state = {
    numPlayers: 6,
    numSpies: 1,
    jolly: false,
    selectedCategories: [],
    timerDuration: 60, // secondi, 0 = nessun timer
    players: [],       // nomi
    game: null         // stato della partita corrente
  };

  const STORAGE_KEY = 'secretAgent.stats.v1';
  const SETTINGS_KEY = 'secretAgent.settings.v1';
  const PLAYERS_KEY = 'secretAgent.lastPlayers.v1';
  const FINAL_COUNTDOWN_SECONDS = 5; // soglia per l'impulso aptico + bip finali del timer

  /* ---------------- Utility ---------------- */

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function vibrate(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) { /* ignora */ }
    }
  }

  /* ---------------- Audio sintetico (Web Audio API) ----------------
     Nessun file audio esterno: tutti gli effetti sono generati al volo
     con oscillatori. L'AudioContext viene creato solo al primo gesto
     dell'utente (i browser lo richiedono) e riutilizzato in seguito. */

  const AUDIO_KEY = 'secretAgent.audioEnabled.v1';
  let audioCtx = null;
  let audioEnabled = true;

  function loadAudioSetting() {
    try {
      const raw = localStorage.getItem(AUDIO_KEY);
      audioEnabled = raw === null ? true : raw === 'true';
    } catch (e) { audioEnabled = true; }
    const toggle = $('#audioToggle');
    if (toggle) toggle.checked = audioEnabled;
  }

  function saveAudioSetting() {
    try { localStorage.setItem(AUDIO_KEY, String(audioEnabled)); } catch (e) { /* non disponibile */ }
  }

  function getAudioContext() {
    if (!audioEnabled) return null;
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null; // browser senza supporto: nessun suono, nessun errore
      try { audioCtx = new AudioCtx(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // Riproduce un singolo tono con un breve inviluppo (attacco/decadimento)
  // per evitare click sgradevoli in apertura/chiusura del suono.
  function playTone({ freq = 440, duration = 0.12, type = 'sine', volume = 0.12, delay = 0 } = {}) {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + delay + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + duration + 0.02);
    } catch (e) { /* mai bloccare l'app per un suono */ }
  }

  // Click leggero sui pulsanti principali
  function playClick() {
    playTone({ freq: 720, duration: 0.05, type: 'square', volume: 0.05 });
  }

  // Conferma (due note ascendenti) — usata per voti, conferme, avanzamenti
  function playConfirm() {
    playTone({ freq: 520, duration: 0.09, type: 'sine', volume: 0.09 });
    playTone({ freq: 780, duration: 0.11, type: 'sine', volume: 0.09, delay: 0.06 });
  }

  // Suono del reveal: VOLUTAMENTE identico per ogni ruolo. Il telefono
  // passa di mano in mano tra persone vicine tra loro: un suono diverso
  // per l'infiltrato sarebbe udibile da chi sta accanto e lo tradirebbe
  // subito. La vibrazione, invece, resta differenziata perché la sente
  // solo chi tiene il telefono in mano.
  function playRoleReveal() {
    playTone({ freq: 480, duration: 0.14, type: 'sine', volume: 0.08 });
  }

  // Bip ritmico per gli ultimi secondi del timer di discussione
  function playCountdownBeep() {
    playTone({ freq: 880, duration: 0.09, type: 'square', volume: 0.07 });
  }

  let toastTimer = null;
  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  /* ---------------- Navigazione tra schermate ---------------- */

  function showScreen(name) {
    $$('.screen').forEach(s => s.classList.remove('is-active'));
    const target = document.querySelector(`.screen[data-screen="${name}"]`);
    if (target) target.classList.add('is-active');
    window.scrollTo(0, 0);
  }

  $$('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      const dest = el.getAttribute('data-nav');
      if (dest === 'setup-players') ensurePlayersUI();
      if (dest === 'setup-roles') { renderCategoryChips(); syncSpiesConstraints(); }
      if (dest === 'setup-timer') renderBrief();
      if (dest === 'rules') { /* niente da fare */ }
      if (dest === 'stats') renderStats();
      showScreen(dest);
    });
  });

  /* ---------------- FASE 1: numero giocatori ---------------- */

  function ensurePlayersUI() {
    // Adegua l'array nomi alla lunghezza corrente, mantenendo i nomi già inseriti
    const prev = state.players.slice();
    state.players = Array.from({ length: state.numPlayers }, (_, i) => prev[i] || `Giocatore ${i + 1}`);
    $('#playersValue').textContent = state.numPlayers;
    $('#playersSlider').value = state.numPlayers;
    renderNamesList();
  }

  function renderNamesList() {
    const container = $('#namesList');
    container.innerHTML = '';
    state.players.forEach((name, i) => {
      const row = document.createElement('div');
      row.className = 'name-input';
      row.innerHTML = `
        <span class="name-input__num">${i + 1}</span>
        <input type="text" maxlength="16" value="${escapeHtml(name)}" placeholder="Giocatore ${i + 1}" data-idx="${i}">
      `;
      container.appendChild(row);
    });
    $$('.name-input input', container).forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = Number(e.target.dataset.idx);
        state.players[idx] = e.target.value.trim() || `Giocatore ${idx + 1}`;
        saveLastPlayers();
      });
    });
  }

  // Memorizza automaticamente l'ultimo elenco giocatori, per poterlo
  // ricaricare all'inizio della prossima partita senza doverlo riscrivere.
  function saveLastPlayers() {
    try { localStorage.setItem(PLAYERS_KEY, JSON.stringify(state.players)); }
    catch (e) { /* storage non disponibile: nessun problema, si può giocare comunque */ }
  }

  function loadLastPlayers() {
    try {
      const raw = localStorage.getItem(PLAYERS_KEY);
      const list = raw ? JSON.parse(raw) : null;
      return (Array.isArray(list) && list.length >= 3) ? list : null;
    } catch (e) { return null; }
  }

  $('#reloadPlayersBtn').addEventListener('click', () => {
    const saved = loadLastPlayers();
    if (!saved) { showToast('Nessuna partita precedente salvata'); return; }
    state.numPlayers = clamp(saved.length, 3, 20);
    state.players = saved.slice(0, state.numPlayers);
    while (state.players.length < state.numPlayers) {
      state.players.push(`Giocatore ${state.players.length + 1}`);
    }
    $('#playersValue').textContent = state.numPlayers;
    $('#playersSlider').value = state.numPlayers;
    renderNamesList();
    syncSpiesConstraints();
    showToast('Giocatori ricaricati');
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function setPlayers(n) {
    state.numPlayers = clamp(n, 3, 20);
    ensurePlayersUI();
    syncSpiesConstraints();
    saveLastPlayers();
  }

  $('#playersMinus').addEventListener('click', () => setPlayers(state.numPlayers - 1));
  $('#playersPlus').addEventListener('click', () => setPlayers(state.numPlayers + 1));
  $('#playersSlider').addEventListener('input', (e) => setPlayers(Number(e.target.value)));

  /* ---------------- FASE 2: infiltrati, jolly, categorie ---------------- */

  function maxSpiesAllowed() {
    const reserved = state.jolly ? 2 : 1; // almeno 1 civile + eventuale jolly
    return Math.max(1, state.numPlayers - reserved);
  }

  function syncSpiesConstraints() {
    const max = maxSpiesAllowed();
    state.numSpies = clamp(state.numSpies, 1, max);
    $('#spiesValue').textContent = state.numSpies;
    $('#spiesHint').textContent = `${state.numSpies} infiltrat${state.numSpies > 1 ? 'i' : 'o'} su ${state.numPlayers} giocatori`;
  }

  function setSpies(n) {
    state.numSpies = clamp(n, 1, maxSpiesAllowed());
    syncSpiesConstraints();
  }

  $('#spiesMinus').addEventListener('click', () => setSpies(state.numSpies - 1));
  $('#spiesPlus').addEventListener('click', () => setSpies(state.numSpies + 1));

  $('#jollyToggle').addEventListener('change', (e) => {
    state.jolly = e.target.checked;
    syncSpiesConstraints();
  });

  function renderCategoryChips() {
    const container = $('#categoryChips');
    container.innerHTML = '';
    Object.keys(WORD_PAIRS).forEach(cat => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = cat;
      chip.dataset.cat = cat;
      if (state.selectedCategories.includes(cat)) chip.classList.add('is-selected');
      chip.addEventListener('click', () => {
        const i = state.selectedCategories.indexOf(cat);
        if (i >= 0) { state.selectedCategories.splice(i, 1); chip.classList.remove('is-selected'); }
        else { state.selectedCategories.push(cat); chip.classList.add('is-selected'); }
        updateCategoryCount();
      });
      container.appendChild(chip);
    });
    updateCategoryCount();
  }

  // Mostra quante categorie sono selezionate e quante parole ne derivano,
  // così è subito visibile che la selezione multipla funziona davvero.
  function updateCategoryCount() {
    const allCats = Object.keys(WORD_PAIRS);
    const activeCats = state.selectedCategories.length ? state.selectedCategories : allCats;
    const totalPairs = activeCats.reduce((sum, cat) => sum + (WORD_PAIRS[cat]?.length || 0), 0);
    const label = state.selectedCategories.length
      ? `${activeCats.length} categorie selezionate · ${totalPairs} parole nel mazzo`
      : `${allCats.length} categorie disponibili · ${totalPairs} parole nel mazzo`;
    $('#categoryCount').textContent = label;
  }

  $('#selectAllCategoriesBtn').addEventListener('click', () => {
    state.selectedCategories = Object.keys(WORD_PAIRS);
    renderCategoryChips();
  });

  $('#clearCategoriesBtn').addEventListener('click', () => {
    state.selectedCategories = [];
    renderCategoryChips();
  });

  /* ---------------- FASE 3: timer ---------------- */

  $$('#timerChips .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('#timerChips .chip').forEach(c => c.classList.remove('is-selected'));
      chip.classList.add('is-selected');
      state.timerDuration = Number(chip.dataset.timer);
    });
  });

  function initTimerChipsDefault() {
    const target = $(`#timerChips .chip[data-timer="${state.timerDuration}"]`);
    $$('#timerChips .chip').forEach(c => c.classList.remove('is-selected'));
    if (target) target.classList.add('is-selected');
  }

  function renderBrief() {
    $('#briefPlayers').textContent = state.numPlayers;
    $('#briefSpies').textContent = state.numSpies + (state.jolly ? ' + 1 jolly' : '');
    $('#briefCategories').textContent = state.selectedCategories.length ? state.selectedCategories.join(', ') : 'Tutte';
    initTimerChipsDefault();
  }

  /* ---------------- Avvio partita: assegnazione ruoli ---------------- */

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Tiene traccia delle ultime coppie uscite per evitare ripetizioni immediate
  // quando si rigioca più volte di fila (utile soprattutto con poche categorie
  // selezionate, dove altrimenti la stessa parola potrebbe ripresentarsi subito).
  const recentPairsHistory = [];
  const MAX_HISTORY = 6;

  function pickPairAvoidingRepeats() {
    let attempt = getRandomPair(state.selectedCategories);
    let tries = 0;
    // Ritenta finché non trova una coppia non recente, con un tetto di
    // tentativi per non entrare in loop quando il mazzo disponibile è piccolo.
    while (
      recentPairsHistory.some(p => p.civil === attempt.civil && p.category === attempt.category) &&
      tries < 12
    ) {
      attempt = getRandomPair(state.selectedCategories);
      tries++;
    }
    recentPairsHistory.push(attempt);
    if (recentPairsHistory.length > MAX_HISTORY) recentPairsHistory.shift();
    return attempt;
  }

  function startNewGame() {
    const picked = pickPairAvoidingRepeats();
    const order = shuffle(state.players.map((name, i) => i));

    const roles = new Array(state.players.length).fill('civilian');
    for (let i = 0; i < state.numSpies; i++) roles[order[i]] = 'spy';
    if (state.jolly) roles[order[state.numSpies]] = 'jolly';

    state.game = {
      word: picked.civil,
      undercoverWord: picked.undercover,
      category: picked.category,
      roles: state.players.map((name, i) => ({ name, role: roles[i] })),
      revealIndex: 0,
      voterIndex: 0,
      votes: {}, // nome sospettato -> numero voti
      timer: { duration: state.timerDuration, remaining: state.timerDuration, running: false, intervalId: null }
    };

    beginReveal();
  }

  $('#startGameBtn').addEventListener('click', () => {
    if (state.players.length < 3) { showToast('Servono almeno 3 giocatori'); return; }
    startNewGame();
    showScreen('reveal');
  });

  $('#playAgainBtn').addEventListener('click', () => {
    startNewGame();
    showScreen('reveal');
  });

  /* ---------------- FASE 2 (schermata): distribuzione ruoli ---------------- */

  // Il contenuto del dossier viene preparato per il giocatore corrente ma
  // resta nascosto via CSS finché non si tiene premuto: così la copertura
  // al rilascio è istantanea, senza dover ricalcolare nulla.
  let hasRevealedCurrentPlayer = false;

  function beginReveal() {
    state.game.revealIndex = 0;
    $('#revealSingle').style.display = 'flex';
    $('#revealFooter').style.display = 'none';
    prepareDossierForCurrentPlayer();
  }

  function prepareDossierForCurrentPlayer() {
    const g = state.game;
    const player = g.roles[g.revealIndex];

    $('#passIndex').textContent = `Agente ${g.revealIndex + 1} di ${g.roles.length}`;
    $('#passName').textContent = player.name;

    const label = $('#roleLabel');
    const word = $('#roleWord');
    const note = $('#roleNote');
    word.classList.remove('is-spy');

    if (player.role === 'spy') {
      label.textContent = 'INFILTRATO';
      word.textContent = g.undercoverWord;
      word.classList.add('is-spy');
      note.textContent = "Sei l'infiltrato: la tua parola è simile a quella vera ma non identica. Usala per bluffare senza farti scoprire.";
    } else if (player.role === 'jolly') {
      label.textContent = `CATEGORIA: ${g.category.toUpperCase()}`;
      word.textContent = '???';
      note.textContent = "Conosci solo la categoria. Bluffa con astuzia: non sei l'infiltrato, ma non conosci la parola esatta.";
    } else {
      label.textContent = 'CIVILE';
      word.textContent = g.word;
      note.textContent = "Descrivi la parola con un indizio, senza mai dirla. Trova l'infiltrato.";
    }

    hasRevealedCurrentPlayer = false;
    $('#confirmSeenBtn').disabled = true;
    $('#dossier').classList.remove('is-revealed');
    $('#dossier').setAttribute('aria-pressed', 'false');
  }

  // Mostra il ruolo (chiamato da pointerdown e dalla tastiera). Il feedback
  // aptico/sonoro è differenziato: doppio impulso deciso + tono cupo per
  // l'infiltrato, impulso leggero + tono chiaro per tutti gli altri ruoli.
  function revealDossier() {
    const dossier = $('#dossier');
    if (dossier.classList.contains('is-revealed')) return; // già visibile
    dossier.classList.add('is-revealed');
    dossier.setAttribute('aria-pressed', 'true');

    const g = state.game;
    const player = g.roles[g.revealIndex];
    // La vibrazione è privata (la sente solo chi tiene il telefono in
    // mano) e può restare differenziata; il suono invece è udibile da chi
    // sta vicino, quindi è sempre lo stesso per ogni ruolo — vedi playRoleReveal().
    if (player.role === 'spy') {
      vibrate([40, 40, 40]); // doppia vibrazione intensa: sei l'infiltrato
    } else {
      vibrate(25);
    }
    playRoleReveal();

    if (!hasRevealedCurrentPlayer) {
      hasRevealedCurrentPlayer = true;
      $('#confirmSeenBtn').disabled = false;
    }
  }

  function hideDossier() {
    const dossier = $('#dossier');
    dossier.classList.remove('is-revealed');
    dossier.setAttribute('aria-pressed', 'false');
  }

  const dossierEl = $('#dossier');
  // Pointer Events coprono touch, mouse e pen con un'unica API.
  dossierEl.addEventListener('pointerdown', (e) => { e.preventDefault(); revealDossier(); });
  dossierEl.addEventListener('pointerup', hideDossier);
  dossierEl.addEventListener('pointercancel', hideDossier);
  dossierEl.addEventListener('pointerleave', hideDossier);
  // Accessibilità da tastiera: Invio/Spazio mostrano il ruolo finché premuti
  dossierEl.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      e.preventDefault();
      revealDossier();
    }
  });
  dossierEl.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') hideDossier();
  });

  $('#confirmSeenBtn').addEventListener('click', () => {
    const g = state.game;
    g.revealIndex++;
    if (g.revealIndex < g.roles.length) {
      prepareDossierForCurrentPlayer();
    } else {
      $('#revealSingle').style.display = 'none';
      $('#revealFooter').style.display = 'flex';
    }
  });

  $('#goToDiscussionBtn').addEventListener('click', () => {
    setupDiscussionScreen();
    showScreen('discussion');
  });

  /* ---------------- FASE 3: discussione + timer ---------------- */

  const RING_CIRC = 2 * Math.PI * 90; // 565.48

  // Sceglie chi parla per primo. Non è mai un infiltrato: se dovesse
  // aprire lui la discussione, non avendo nessun indizio in mano
  // rischierebbe di esitare e tradirsi subito.
  function pickStarter() {
    const g = state.game;
    const eligible = g.roles.filter(p => p.role !== 'spy');
    const pool = eligible.length ? eligible : g.roles; // fallback di sicurezza, non dovrebbe mai servire
    const starter = pool[Math.floor(Math.random() * pool.length)];
    g.starterName = starter.name;
    $('#starterName').textContent = starter.name;
  }

  function setupDiscussionScreen() {
    const g = state.game;
    pickStarter();
    g.timer.duration = state.timerDuration;
    g.timer.remaining = state.timerDuration;
    g.timer.running = false;
    clearInterval(g.timer.intervalId);

    const ring = $('#timerRing');
    const controls = $('#timerControls');
    if (g.timer.duration === 0) {
      ring.style.display = 'none';
      controls.style.display = 'none';
    } else {
      ring.style.display = 'block';
      controls.style.display = 'flex';
      updateTimerDisplay();
      setPlayIcon(false);
    }
  }

  function updateTimerDisplay() {
    const g = state.game;
    $('#timerValue').textContent = g.timer.remaining;
    const circle = $('#timerCircle');
    const ratio = g.timer.duration > 0 ? g.timer.remaining / g.timer.duration : 0;
    circle.style.strokeDashoffset = String(RING_CIRC * (1 - ratio));
    circle.classList.toggle('is-warning', g.timer.remaining <= 10 && g.timer.remaining > 0);
  }

  function setPlayIcon(isPlaying) {
    const icon = $('#playIcon');
    icon.innerHTML = isPlaying
      ? '<rect x="6" y="5" width="4" height="14" fill="currentColor"/><rect x="14" y="5" width="4" height="14" fill="currentColor"/>'
      : '<path d="M8 5v14l11-7z" fill="currentColor"/>';
  }

  $('#timerPlayPause').addEventListener('click', () => {
    const g = state.game;
    if (!g.timer.duration) return;
    if (g.timer.running) {
      clearInterval(g.timer.intervalId);
      g.timer.running = false;
      setPlayIcon(false);
    } else {
      g.timer.running = true;
      setPlayIcon(true);
      g.timer.intervalId = setInterval(() => {
        g.timer.remaining--;
        if (g.timer.remaining <= 0) {
          g.timer.remaining = 0;
          updateTimerDisplay();
          clearInterval(g.timer.intervalId);
          g.timer.running = false;
          setPlayIcon(false);
          vibrate([80, 60, 80]);
          showToast('Tempo scaduto!');
          return;
        }
        // Ultimi secondi: piccolo impulso + bip ad ogni tick, per sentire
        // che il tempo sta per scadere anche senza guardare lo schermo.
        if (g.timer.remaining <= FINAL_COUNTDOWN_SECONDS) {
          vibrate(15);
          playCountdownBeep();
        }
        updateTimerDisplay();
      }, 1000);
    }
  });

  $('#timerReset').addEventListener('click', () => {
    const g = state.game;
    clearInterval(g.timer.intervalId);
    g.timer.running = false;
    g.timer.remaining = g.timer.duration;
    setPlayIcon(false);
    updateTimerDisplay();
  });

  /* ---------------- FASE 4: votazione ---------------- */

  function setupVoteScreen() {
    const g = state.game;
    g.voterIndex = 0;
    g.votes = {};
    g.roles.forEach(p => { g.votes[p.name] = 0; });
    renderVoterTurn();
  }

  document.querySelector('[data-nav="vote-setup"]').addEventListener('click', () => {
    setupVoteScreen();
  });

  function renderVoterTurn() {
    const g = state.game;
    const voter = g.roles[g.voterIndex];
    $('#voterPrompt').textContent = `Passa il telefono a ${voter.name}`;
    const grid = $('#suspectGrid');
    grid.innerHTML = '';
    g.roles.forEach((p) => {
      if (p.name === voter.name) return; // non si può votare se stessi
      const btn = document.createElement('button');
      btn.className = 'suspect-btn';
      btn.textContent = p.name;
      btn.addEventListener('click', () => castVote(p.name, btn));
      grid.appendChild(btn);
    });
  }

  let voteLock = false;
  function castVote(suspectName, btnEl) {
    if (voteLock) return;
    voteLock = true;
    const g = state.game;
    $$('.suspect-btn', $('#suspectGrid')).forEach(b => b.classList.remove('is-picked', 'is-vote-confirmed'));
    btnEl.classList.add('is-picked', 'is-vote-confirmed');
    g.votes[suspectName] = (g.votes[suspectName] || 0) + 1;
    vibrate(30);
    playConfirm();

    setTimeout(() => {
      g.voterIndex++;
      voteLock = false;
      if (g.voterIndex < g.roles.length) {
        renderVoterTurn();
      } else {
        finishGame();
      }
    }, 450);
  }

  /* ---------------- FASE 5: rivelazione + statistiche ---------------- */

  function finishGame() {
    const g = state.game;

    // trova il sospettato più votato
    let topName = null, topVotes = -1;
    Object.entries(g.votes).forEach(([name, count]) => {
      if (count > topVotes) { topVotes = count; topName = name; }
    });

    const eliminated = g.roles.find(p => p.name === topName);
    const civiliansWin = !eliminated || eliminated.role !== 'spy';

    renderResult(eliminated);
    recordStats(g, civiliansWin);
    showScreen('result');
    launchConfetti();
  }

  // Frasi ironiche puramente decorative: descrivono solo il fatto verificato
  // (chi è stato eliminato), non un verdetto sull'intera partita — così
  // restano corrette anche con più infiltrati in gioco.
  const FLAVOR_SPY_CAUGHT = [
    'Copertura saltata. L\'infiltrato può togliersi il trench.',
    'Smascherato. Il satellite registra un altro successo.',
    'Beccato con le mani nel dossier sbagliato.',
    'La sua parola "simile" non era poi così simile.',
    'Missione compromessa per l\'infiltrato. Si torna in centrale.'
  ];
  const FLAVOR_INNOCENT_ELIMINATED = [
    'Un civile innocente finisce nel fascicolo per errore.',
    'L\'infiltrato ringrazia e resta in incognito.',
    'Indagine indirizzata male: il vero bersaglio se la ride.',
    'Voto sbagliato: l\'infiltrato guadagna un altro giro.',
    'Il vero sospettato osserva tutto da un angolo, tranquillo.'
  ];
  const FLAVOR_NO_ELIMINATION = [
    'Nessun accordo sul sospettato: il fascicolo resta aperto.',
    'Voti troppo divisi per un verdetto.'
  ];

  function pickFlavorCaption(eliminated) {
    let pool;
    if (!eliminated) pool = FLAVOR_NO_ELIMINATION;
    else if (eliminated.role === 'spy') pool = FLAVOR_SPY_CAUGHT;
    else pool = FLAVOR_INNOCENT_ELIMINATED;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function renderResult(eliminated) {
    const g = state.game;

    $('#resultWord').textContent = g.word;
    $('#resultUndercoverWord').textContent = g.undercoverWord;
    $('#resultFlavor').textContent = pickFlavorCaption(eliminated);

    // tabellone voti, ordinato per numero di voti decrescente
    const tally = $('#voteTally');
    tally.innerHTML = '';
    Object.entries(g.votes)
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, count]) => {
        const row = document.createElement('div');
        row.className = 'vote-tally__row' + (eliminated && name === eliminated.name ? ' is-eliminated' : '');
        row.innerHTML = `<span class="vote-tally__name">${escapeHtml(name)}</span><span class="vote-tally__count">${count} vot${count === 1 ? 'o' : 'i'}</span>`;
        tally.appendChild(row);
      });

    // fascicolo completo dei ruoli
    const list = $('#roleRevealList');
    list.innerHTML = '';
    g.roles.forEach(p => {
      const item = document.createElement('div');
      item.className = 'role-reveal-item';
      const tagClass = p.role === 'spy' ? 'spy' : (p.role === 'jolly' ? 'jolly' : 'civ');
      const tagLabel = p.role === 'spy' ? 'Infiltrato' : (p.role === 'jolly' ? 'Jolly' : 'Civile');
      item.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="role-reveal-item__tag role-reveal-item__tag--${tagClass}">${tagLabel}</span>`;
      list.appendChild(item);
    });
  }

  function launchConfetti() {
    const layer = $('#confettiLayer');
    layer.innerHTML = '';
    const colors = ['#C9A227', '#E4C158', '#3E8E63', '#ECEFF3'];
    for (let i = 0; i < 40; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = (Math.random() * 0.4) + 's';
      piece.style.animationDuration = (2 + Math.random() * 1.2) + 's';
      layer.appendChild(piece);
    }
    setTimeout(() => { layer.innerHTML = ''; }, 4200);
  }

  /* ---------------- Statistiche (localStorage) ---------------- */

  function loadStats() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignora dati corrotti */ }
    return { gamesPlayed: 0, spyWins: 0, civilianWins: 0, roleCounts: { civilian: 0, spy: 0, jolly: 0 } };
  }

  function saveStats(stats) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); } catch (e) { /* storage pieno o non disponibile */ }
  }

  function recordStats(g, civiliansWin) {
    const stats = loadStats();
    stats.gamesPlayed++;
    if (civiliansWin) stats.civilianWins++; else stats.spyWins++;
    g.roles.forEach(p => { stats.roleCounts[p.role] = (stats.roleCounts[p.role] || 0) + 1; });
    saveStats(stats);
  }

  function renderStats() {
    const stats = loadStats();
    $('#statGames').textContent = stats.gamesPlayed;
    $('#statSpyWins').textContent = stats.spyWins;
    $('#statCivilianWins').textContent = stats.civilianWins;

    const roleNames = { civilian: 'Civile', spy: 'Infiltrato', jolly: 'Jolly' };
    const entries = Object.entries(stats.roleCounts);
    let favRole = '—';
    if (entries.some(([, v]) => v > 0)) {
      const top = entries.sort((a, b) => b[1] - a[1])[0];
      favRole = roleNames[top[0]] || '—';
    }
    $('#statFavRole').textContent = favRole;

    const totalWins = stats.civilianWins + stats.spyWins;
    const civPct = totalWins ? Math.round((stats.civilianWins / totalWins) * 100) : 0;
    const spyPct = totalWins ? Math.round((stats.spyWins / totalWins) * 100) : 0;
    $('#civBar').style.width = civPct + '%';
    $('#spyBar').style.width = spyPct + '%';
  }

  $('#resetStatsBtn').addEventListener('click', () => {
    saveStats({ gamesPlayed: 0, spyWins: 0, civilianWins: 0, roleCounts: { civilian: 0, spy: 0, jolly: 0 } });
    renderStats();
    showToast('Statistiche azzerate');
  });

  /* ---------------- Tema colore ---------------- */

  const THEME_KEY = 'secretAgent.theme.v1';

  function applyTheme(themeName) {
    if (themeName && themeName !== 'brass') {
      document.documentElement.setAttribute('data-theme', themeName);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    $$('.theme-swatch').forEach(sw => {
      sw.classList.toggle('is-active', sw.dataset.theme === (themeName || 'brass'));
    });
  }

  function loadTheme() {
    let theme = 'brass';
    try { theme = localStorage.getItem(THEME_KEY) || 'brass'; } catch (e) { /* non disponibile */ }
    applyTheme(theme);
  }

  $$('.theme-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      const theme = sw.dataset.theme;
      applyTheme(theme);
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* storage non disponibile */ }
      vibrate(20);
    });
  });

  /* ---------------- Registrazione Service Worker (PWA offline) ---------------- */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline al primo avvio: nessun problema */ });
    });
  }

/* ---------------- Prevenzione Zoom iOS / Safari ---------------- */
  // Disabilita lo zoom pinch-to-zoom (due dita) su Safari
  document.addEventListener('gesturestart', (e) => {
    e.preventDefault();
  }, { passive: false });

  // Previene lo zoom da doppio tap su Safari iOS SENZA bloccare i click rapidi
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
      e.preventDefault(); // Blocca lo zoom se si usano più dita contemporaneamente
    }
  }, { passive: false });
  /* ---------------- Feedback su pulsanti principali ----------------
     Click sonoro leggero + vibrazione leggera su tutti i controlli
     interattivi principali. Il voto e il reveal del ruolo hanno un
     feedback dedicato più marcato, quindi sono esclusi da qui per
     evitare di sovrapporre due suoni sullo stesso tocco. */
  document.addEventListener('click', (e) => {
    const control = e.target.closest(
      '.btn, .iconbtn, .counter__btn, .chip, .theme-swatch, .link-btn'
    );
    if (!control || control.disabled) return;
    if (control.closest('#suspectGrid')) return; // il voto ha già il suo feedback
    playClick();
    vibrate(8);
  });

  $('#audioToggle').addEventListener('change', (e) => {
    audioEnabled = e.target.checked;
    saveAudioSetting();
    if (audioEnabled) playConfirm(); // piccola conferma udibile riattivando l'audio
  });

  /* ---------------- Inizializzazione ---------------- */

  loadAudioSetting();
  loadTheme();
  ensurePlayersUI();
  syncSpiesConstraints();
  renderCategoryChips();
  initTimerChipsDefault();
  showScreen('home');

})();
