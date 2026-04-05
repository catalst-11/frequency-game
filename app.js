const $ = (id) => document.getElementById(id);

const ui = {
  statusBanner: $("statusBanner"),
  setupHint: $("setupHint"),
  toggleClassementBtn: $("toggleClassementBtn"),
  setupClassementModal: $("setupClassementModal"),
  closeClassementBtn: $("closeClassementBtn"),
  classementFilterSolo: $("classementFilterSolo"),
  classementFilterDaily: $("classementFilterDaily"),
  classementFilterChallenge: $("classementFilterChallenge"),
  menuLeaderboard: $("menuLeaderboard"),
  soundToggleBtn: $("soundToggleBtn"),
  playerName: $("playerName"),
  difficultyToggle: $("difficultyToggle"),
  difficultyLabel: $("difficultyLabel"),
  startBtn: $("startBtn"),
  setupStage: $("setupStage"),
  listenStage: $("listenStage"),
  guessStage: $("guessStage"),
  feedbackStage: $("feedbackStage"),
  finalStage: $("finalStage"),
  roundCounter: $("roundCounter"),
  memoryTimer: $("memoryTimer"),
  listenHint: $("listenHint"),
  guessFreqSlider: $("guessFreqSlider"),
  guessReadout: $("guessReadout"),
  guessMinLabel: $("guessMinLabel"),
  guessMaxLabel: $("guessMaxLabel"),
  freqVibeCanvas: $("freqVibeCanvas"),
  submitGuessBtn: $("submitGuessBtn"),
  runningScore: $("runningScore"),
  feedbackText: $("feedbackText"),
  targetValue: $("targetValue"),
  guessValue: $("guessValue"),
  errorValue: $("errorValue"),
  roundScoreValue: $("roundScoreValue"),
  nextRoundBtn: $("nextRoundBtn"),
  finalSummary: $("finalSummary"),
  finalRankText: $("finalRankText"),
  finalScore: $("finalScore"),
  finalLeaderboard: $("finalLeaderboard"),
  roundBreakdown: $("roundBreakdown"),
  resultAnalytics: $("resultAnalytics"),
  mainMenuBtn: $("mainMenuBtn"),
  restartBtn: $("restartBtn")
};

const modeRadios = Array.from(document.querySelectorAll('input[name="mode"]'));

const ROUND_COUNT = 5;
const MEMORY_SECONDS = 5;
const SOUND_PREF_KEY = "frequency_guess_sound_pref";

const DIFFICULTY_CONFIG = {
  easy: {
    label: "Easy",
    min: 180,
    max: 1200,
    tolerance: 0.36
  },
  hard: {
    label: "Hard",
    min: 70,
    max: 2600,
    tolerance: 0.22
  }
};

const state = {
  apiBase: "",
  apiCandidates: [],
  audioContext: null,
  soundEnabled: true,
  difficulty: "easy",
  mode: "solo",
  playerName: "Player",
  gameSession: null,
  targets: [],
  results: [],
  roundIndex: 0,
  currentGuess: 440,
  totalScore: 0,
  leaderboardEntries: [],
  dailyStatus: null,
  currentStage: "setup",
  memoryCountdownInterval: null,
  memoryPhaseTimeout: null,
  continuousOscillator: null,
  continuousGain: null,
  vibeRenderer: null,
  busy: false,
  classementOpen: false,
  classementFilter: "solo"
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function getApiBase() {
  if (window.location.protocol === "file:") {
    return "http://localhost:3000";
  }
  return window.location.origin;
}

function normalizeBase(base) {
  return String(base || "").trim().replace(/\/+$/, "");
}

function getApiCandidates() {
  const params = new URLSearchParams(window.location.search);
  const queryApi = params.get("api");
  const queryApis = params.get("apis");
  const queryPort = params.get("apiPort");
  const bases = [];

  if (queryApis) {
    queryApis
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => bases.push(normalizeBase(value)));
  }
  if (queryApi) {
    bases.push(normalizeBase(queryApi));
  }
  if (queryPort) {
    bases.push(`${window.location.protocol}//${window.location.hostname}:${queryPort}`);
  }

  bases.push(normalizeBase(getApiBase()));

  const host = String(window.location.hostname || "").toLowerCase();
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLocalHost || window.location.protocol === "file:") {
    const proto = window.location.protocol === "file:" ? "http:" : window.location.protocol;
    ["3000", "3001", "3002"].forEach((port) => {
      bases.push(`${proto}//localhost:${port}`);
      bases.push(`${proto}//127.0.0.1:${port}`);
    });
  }

  return Array.from(new Set(bases.map(normalizeBase).filter(Boolean)));
}

async function detectApiBase() {
  const candidates = getApiCandidates();
  state.apiCandidates = candidates.slice();

  for (const base of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1800);
      const response = await fetch(`${base}/api/health`, {
        method: "GET",
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!response.ok) continue;
      const data = await response.json().catch(() => null);
      if (data && data.ok) {
        state.apiBase = base;
        return;
      }
    } catch {
      // Try next candidate.
    }
  }

  state.apiBase = normalizeBase(getApiBase());
}

function setStatus(message) {
  if (ui.statusBanner) {
    ui.statusBanner.textContent = message;
  }
  if (ui.setupHint && state.currentStage === "setup") {
    ui.setupHint.textContent = message;
  }
}

function getSelectedDifficulty() {
  return ui.difficultyToggle && ui.difficultyToggle.checked ? "hard" : "easy";
}

function getSelectedMode() {
  const selected = modeRadios.find((radio) => radio.checked);
  const value = String(selected?.value || "solo").toLowerCase();
  if (value === "daily") return "daily";
  if (value === "challenge") return "challenge";
  return "solo";
}

function getDifficultyConfig() {
  return DIFFICULTY_CONFIG[state.difficulty] || DIFFICULTY_CONFIG.easy;
}

async function fetchJson(path, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${state.apiBase}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const error = new Error(data?.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = data?.code || "";
      error.detail = data?.detail || "";
      throw error;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

function getApiErrorMessage(error, fallback) {
  if (!error) return fallback;
  const parts = [String(error.message || fallback)];
  if (error.detail) parts.push(String(error.detail));
  return parts.join(" ");
}

function ensureAudioContext() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!state.audioContext) {
    state.audioContext = new AudioCtor();
  }
  return state.audioContext;
}

async function unlockAudio() {
  if (!state.soundEnabled) return;
  const ctx = ensureAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      // Ignore user-agent resume rejection until next interaction.
    }
  }
}

function playTone({
  frequency = 440,
  duration = 0.8,
  type = "sine",
  gain = 0.05,
  delay = 0
} = {}) {
  if (!state.soundEnabled) return;
  const ctx = ensureAudioContext();
  if (!ctx || ctx.state !== "running") return;

  const safeFrequency = clamp(Number(frequency) || 440, 40, 4000);
  const safeDuration = clamp(Number(duration) || 0.08, 0.06, 6);
  const safeGain = clamp(Number(gain) || 0.05, 0.001, 0.12);
  const startAt = ctx.currentTime + Math.max(0, Number(delay) || 0);

  const oscillator = ctx.createOscillator();
  const amp = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(safeFrequency, startAt);

  amp.gain.setValueAtTime(0.0001, startAt);
  amp.gain.exponentialRampToValueAtTime(safeGain, startAt + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, startAt + safeDuration);

  oscillator.connect(amp);
  amp.connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + safeDuration + 0.04);
}

function playPositiveTone(score) {
  const base = 320 + Math.max(0, score) * 28;
  playTone({ frequency: base, duration: 0.11, type: "triangle", gain: 0.04 });
  playTone({ frequency: base * 1.24, duration: 0.11, type: "sine", gain: 0.03, delay: 0.09 });
}

function playNegativeTone() {
  playTone({ frequency: 185, duration: 0.16, type: "sawtooth", gain: 0.035 });
  playTone({ frequency: 140, duration: 0.19, type: "triangle", gain: 0.028, delay: 0.05 });
}

function stopContinuousGuessTone() {
  const osc = state.continuousOscillator;
  const gainNode = state.continuousGain;
  const ctx = state.audioContext;
  state.continuousOscillator = null;
  state.continuousGain = null;
  if (!osc || !gainNode || !ctx) return;

  try {
    const now = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setTargetAtTime(0.0001, now, 0.02);
    osc.stop(now + 0.08);
  } catch {
    // Ignore stop failures if oscillator already ended.
  }
}

function startContinuousGuessTone() {
  if (!state.soundEnabled) return;
  const ctx = ensureAudioContext();
  if (!ctx || ctx.state !== "running") return;

  stopContinuousGuessTone();
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(clamp(Number(state.currentGuess) || 440, 40, 4000), ctx.currentTime);
  gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.04, ctx.currentTime + 0.04);
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.start();

  state.continuousOscillator = osc;
  state.continuousGain = gainNode;
}

function updateContinuousGuessTone() {
  if (!state.soundEnabled) return;
  const ctx = state.audioContext;
  const osc = state.continuousOscillator;
  if (!ctx || !osc) return;

  const safeFrequency = clamp(Number(state.currentGuess) || 440, 40, 4000);
  try {
    osc.frequency.setTargetAtTime(safeFrequency, ctx.currentTime, 0.01);
  } catch {
    // Ignore if oscillator has already stopped.
  }
}

function updateSoundButton() {
  if (!ui.soundToggleBtn) return;
  ui.soundToggleBtn.textContent = state.soundEnabled ? "Sound on" : "Sound off";
  ui.soundToggleBtn.setAttribute("aria-pressed", String(state.soundEnabled));
}

function loadSoundPreference() {
  if (!ui.soundToggleBtn) {
    state.soundEnabled = true;
    return;
  }
  try {
    const pref = String(localStorage.getItem(SOUND_PREF_KEY) || "").toLowerCase();
    state.soundEnabled = pref !== "off";
  } catch {
    state.soundEnabled = true;
  }
  updateSoundButton();
}

function toggleSoundPreference() {
  state.soundEnabled = !state.soundEnabled;
  try {
    localStorage.setItem(SOUND_PREF_KEY, state.soundEnabled ? "on" : "off");
  } catch {
    // Ignore storage write failures.
  }
  updateSoundButton();

  if (!state.soundEnabled) {
    stopContinuousGuessTone();
    return;
  }

  unlockAudio().then(() => {
    playTone({ frequency: 520, duration: 0.09, type: "sine", gain: 0.03 });
    if (state.currentStage === "guess") {
      startContinuousGuessTone();
    }
  });
}

function clearMemoryPhaseTimers() {
  if (state.memoryCountdownInterval) {
    clearInterval(state.memoryCountdownInterval);
    state.memoryCountdownInterval = null;
  }
  if (state.memoryPhaseTimeout) {
    clearTimeout(state.memoryPhaseTimeout);
    state.memoryPhaseTimeout = null;
  }
}

function showStage(stageName) {
  const map = {
    setup: ui.setupStage,
    listen: ui.listenStage,
    guess: ui.guessStage,
    feedback: ui.feedbackStage,
    final: ui.finalStage
  };

  Object.entries(map).forEach(([name, element]) => {
    if (!element) return;
    element.classList.toggle("hidden", name !== stageName);
  });

  state.currentStage = stageName;
  if (state.vibeRenderer) {
    state.vibeRenderer.setActive(stageName === "guess");
    if (stageName === "guess" && typeof state.vibeRenderer.resize === "function") {
      state.vibeRenderer.resize();
      window.requestAnimationFrame(() => {
        if (state.currentStage === "guess" && state.vibeRenderer && typeof state.vibeRenderer.resize === "function") {
          state.vibeRenderer.resize();
        }
      });
    }
  }

  if (stageName !== "guess") {
    stopContinuousGuessTone();
  }
  if (stageName !== "listen") {
    clearMemoryPhaseTimers();
  }
  if (stageName !== "setup" && state.classementOpen) {
    setClassementOpen(false);
  }
}

function setGuessFrequency(rawValue) {
  const config = getDifficultyConfig();
  const fallback = Math.round(Math.sqrt(config.min * config.max));
  const parsed = Number(rawValue);
  const base = Number.isFinite(parsed) ? parsed : state.currentGuess || fallback;
  const value = clamp(Math.round(base), config.min, config.max);
  state.currentGuess = value;
  ui.guessFreqSlider.value = String(value);
  ui.guessReadout.textContent = `${value} Hz`;
  if (state.vibeRenderer) {
    state.vibeRenderer.setFrequency(value);
  }
  return value;
}

function updateGuessBounds() {
  const config = getDifficultyConfig();
  ui.guessFreqSlider.min = String(config.min);
  ui.guessFreqSlider.max = String(config.max);
  ui.guessMinLabel.textContent = `${config.min} Hz`;
  ui.guessMaxLabel.textContent = `${config.max} Hz`;
  const midpoint = Math.round(Math.sqrt(config.min * config.max));
  setGuessFrequency(Number.isFinite(state.currentGuess) ? state.currentGuess : midpoint);
}

function normalizeModeValue(rawMode) {
  const value = String(rawMode || "").toLowerCase();
  if (value === "daily") return "daily";
  if (value === "challenge") return "challenge";
  return "solo";
}

function formatModeLabel(rawMode) {
  const mode = normalizeModeValue(rawMode);
  if (mode === "daily") return "DAILY";
  if (mode === "challenge") return "MULTI";
  return "SOLO";
}

function normalizeClassementFilter(rawFilter) {
  const value = String(rawFilter || "").toLowerCase();
  if (value === "daily") return "daily";
  if (value === "challenge") return "challenge";
  return "solo";
}

function getFilteredLeaderboardEntries(entries = state.leaderboardEntries) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  return safeEntries.filter((entry) => normalizeModeValue(entry?.mode) === state.classementFilter);
}

function getLeaderboardEmptyMessage() {
  if (state.classementFilter === "daily") return "No daily scores yet.";
  if (state.classementFilter === "challenge") return "No multi scores yet.";
  return "No solo scores yet.";
}

function formatDateLabel(dateString) {
  const value = new Date(dateString);
  if (Number.isNaN(value.getTime())) return "unknown date";
  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function renderLeaderboard(targetElement, entries, emptyMessage = "No scores yet for this filter.") {
  if (!targetElement) return;
  targetElement.innerHTML = "";

  if (!entries || !entries.length) {
    const empty = document.createElement("div");
    empty.className = "leaderboard-empty";
    empty.textContent = emptyMessage;
    targetElement.append(empty);
    return;
  }

  entries.slice(0, 10).forEach((entry, index) => {
    const item = document.createElement("article");
    item.className = "leaderboard-item";

    const rank = document.createElement("div");
    rank.className = "leaderboard-rank";
    rank.textContent = String(index + 1);

    const main = document.createElement("div");
    main.className = "leaderboard-main";
    const name = document.createElement("strong");
    name.textContent = String(entry.name || "Player");
    const meta = document.createElement("span");
    const diff = String(entry.difficulty || "easy").toUpperCase();
    const mode = formatModeLabel(entry.mode);
    meta.textContent = `${mode} | ${diff} | ${formatDateLabel(entry.time)}`;
    main.append(name, meta);

    const score = document.createElement("div");
    score.className = "leaderboard-score";
    score.textContent = Number(entry.score || 0).toFixed(2);

    item.append(rank, main, score);
    targetElement.append(item);
  });
}

function renderAllLeaderboards(entries = state.leaderboardEntries) {
  const filtered = getFilteredLeaderboardEntries(entries);
  const emptyMessage = getLeaderboardEmptyMessage();
  renderLeaderboard(ui.finalLeaderboard, filtered, emptyMessage);
  renderLeaderboard(ui.menuLeaderboard, filtered, emptyMessage);
}

function setClassementFilter(filter) {
  const next = normalizeClassementFilter(filter);
  state.classementFilter = next;
  if (ui.classementFilterSolo) {
    ui.classementFilterSolo.classList.toggle("is-active", next === "solo");
  }
  if (ui.classementFilterDaily) {
    ui.classementFilterDaily.classList.toggle("is-active", next === "daily");
  }
  if (ui.classementFilterChallenge) {
    ui.classementFilterChallenge.classList.toggle("is-active", next === "challenge");
  }
  renderAllLeaderboards();
}

async function loadLeaderboardFromServer() {
  try {
    const params = new URLSearchParams();
    params.set("limit", "100");
    const data = await fetchJson(`/api/frequency/leaderboard?${params.toString()}`, {}, 7000);
    state.leaderboardEntries = Array.isArray(data?.entries) ? data.entries : [];
    renderAllLeaderboards(state.leaderboardEntries);
  } catch (error) {
    state.leaderboardEntries = [];
    renderAllLeaderboards([]);
    setStatus(getApiErrorMessage(error, "Leaderboard is unavailable right now."));
  }
}

function setClassementOpen(open) {
  const next = Boolean(open);
  state.classementOpen = next;
  if (!ui.setupClassementModal) return;
  ui.setupClassementModal.classList.toggle("hidden", !next);
  ui.setupClassementModal.setAttribute("aria-hidden", String(!next));
}

async function openClassementFromMenu() {
  setClassementOpen(true);
  await loadLeaderboardFromServer();
}

async function refreshDailyStatus() {
  try {
    const params = new URLSearchParams();
    params.set("difficulty", state.difficulty);
    const status = await fetchJson(`/api/frequency/daily?${params.toString()}`, {}, 7000);
    state.dailyStatus = status;
  } catch {
    state.dailyStatus = null;
  }
}

function updateSetupHintAndActions() {
  const mode = state.mode;
  const config = getDifficultyConfig();
  let hint = `Mode ${formatModeLabel(mode)} | ${config.label} range ${config.min}-${config.max} Hz.`;

  const dailyLocked = mode === "daily" && state.dailyStatus && !state.dailyStatus.canPlay;
  if (dailyLocked) {
    const played = state.dailyStatus.playedEntry;
    const scoreText = played ? Number(played.score || 0).toFixed(2) : "0.00";
    hint = `Daily already played today on this connection. Last score: ${scoreText} / 50.`;
  }

  if (ui.setupHint) {
    ui.setupHint.textContent = hint;
  }
  if (ui.startBtn) {
    ui.startBtn.disabled = Boolean(state.busy || dailyLocked);
  }
}

function computeRoundScoreLocal(target, guess) {
  const config = getDifficultyConfig();
  const errorHz = Math.abs(guess - target);
  const errorPercent = (errorHz / target) * 100;
  const normalizedError = (errorHz / target) / config.tolerance;
  const normalized = clamp(1 - normalizedError, 0, 1);
  const curved = Math.pow(normalized, 0.82);
  const score = roundTo(curved * 10, 2);

  return {
    target,
    guess,
    errorHz: roundTo(errorHz, 2),
    errorPercent: roundTo(errorPercent, 2),
    score
  };
}

function getFeedbackLine(result) {
  if (result.score >= 9.5) return "Excellent ear. That was extremely close.";
  if (result.score >= 7.5) return "Strong guess. You are locked in.";
  if (result.score >= 5) return "Good try. You are getting warmer.";
  if (result.score > 0) return "Close enough to learn from it. Keep adjusting.";
  return "Wide miss this round, but your next one can bounce back.";
}

function playTargetToneOnce() {
  const target = state.targets[state.roundIndex];
  if (!Number.isFinite(target)) return;
  playTone({
    frequency: target,
    duration: MEMORY_SECONDS,
    type: "sine",
    gain: 0.045
  });
}

function startMemoryPhase() {
  clearMemoryPhaseTimers();
  const finishAt = Date.now() + MEMORY_SECONDS * 1000;
  ui.memoryTimer.textContent = `${MEMORY_SECONDS}s`;
  ui.listenHint.textContent = `Listen carefully for ${MEMORY_SECONDS} seconds. Replay is disabled.`;
  playTargetToneOnce();

  state.memoryCountdownInterval = setInterval(() => {
    const remainingMs = Math.max(0, finishAt - Date.now());
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    ui.memoryTimer.textContent = `${remainingSeconds}s`;
  }, 100);

  state.memoryPhaseTimeout = setTimeout(() => {
    clearMemoryPhaseTimers();
    enterGuessRound();
  }, MEMORY_SECONDS * 1000);
}

function enterListenRound() {
  const round = state.roundIndex + 1;
  ui.roundCounter.textContent = `${round} / ${ROUND_COUNT}`;
  showStage("listen");
  setStatus(`Round ${round}: target tone plays once for ${MEMORY_SECONDS} seconds.`);
  startMemoryPhase();
}

function enterGuessRound() {
  showStage("guess");
  setStatus("Move the frequency bar. Live guess sound stays on until you submit.");
  startContinuousGuessTone();
}

async function submitGuess() {
  if (!state.gameSession?.gameId) {
    setStatus("Missing game session. Start a new run.");
    return;
  }

  const target = state.targets[state.roundIndex];
  const guess = setGuessFrequency(ui.guessFreqSlider.value);
  if (!Number.isFinite(target) || !Number.isFinite(guess)) return;

  stopContinuousGuessTone();
  const local = computeRoundScoreLocal(target, guess);
  const round = state.roundIndex + 1;

  try {
    const checkpoint = await fetchJson("/api/frequency/game/checkpoint", {
      method: "POST",
      body: JSON.stringify({
        gameId: state.gameSession.gameId,
        round,
        guess: { frequency: guess },
        score: local.score
      })
    }, 10_000);

    const acceptedScore = Number(checkpoint?.acceptedScore ?? local.score);
    const runningScore = Number(checkpoint?.runningScore ?? (state.totalScore + acceptedScore));
    const result = {
      round,
      target,
      guess,
      errorHz: Number.isFinite(Number(checkpoint?.errorHz))
        ? Number(checkpoint.errorHz)
        : local.errorHz,
      errorPercent: Number.isFinite(Number(checkpoint?.errorPercent))
        ? Number(checkpoint.errorPercent)
        : local.errorPercent,
      score: roundTo(acceptedScore, 2)
    };

    state.results.push(result);
    state.totalScore = roundTo(runningScore, 2);
    ui.runningScore.textContent = `${state.totalScore.toFixed(2)} / 50`;

    ui.feedbackText.textContent = getFeedbackLine(result);
    ui.targetValue.textContent = `${Math.round(result.target)} Hz`;
    ui.guessValue.textContent = `${Math.round(result.guess)} Hz`;
    ui.errorValue.textContent = `${result.errorHz.toFixed(2)} Hz (${result.errorPercent.toFixed(2)}%)`;
    ui.roundScoreValue.textContent = `${result.score.toFixed(2)} / 10`;

    showStage("feedback");
    setStatus(`Round ${result.round} complete. Score: ${result.score.toFixed(2)} / 10.`);

    if (result.score > 0) {
      playPositiveTone(result.score);
    } else {
      playNegativeTone();
    }
  } catch (error) {
    setStatus(getApiErrorMessage(error, "Failed to verify checkpoint. Run was blocked."));
    showStage("setup");
    state.gameSession = null;
  }
}

function nextRound() {
  if (state.roundIndex < ROUND_COUNT - 1) {
    state.roundIndex += 1;
    enterListenRound();
    return;
  }
  finishRun();
}

function renderRoundBreakdown() {
  if (!ui.roundBreakdown) return;
  ui.roundBreakdown.innerHTML = "";
  state.results.forEach((round) => {
    const card = document.createElement("article");
    card.className = "freq-round-card";
    card.innerHTML = `
      <p class="eyebrow">Round ${round.round}</p>
      <h3>${round.score.toFixed(2)} / 10</h3>
      <p class="muted">Target ${Math.round(round.target)} Hz</p>
      <p class="muted">Guess ${Math.round(round.guess)} Hz</p>
      <p class="muted">Error ${round.errorHz.toFixed(2)} Hz (${round.errorPercent.toFixed(2)}%)</p>
    `;
    ui.roundBreakdown.append(card);
  });
}

function renderAnalytics() {
  if (!ui.resultAnalytics) return;
  const rounds = state.results;
  const avgError = rounds.length
    ? rounds.reduce((sum, round) => sum + round.errorPercent, 0) / rounds.length
    : 0;
  const bestRound = rounds.reduce((best, round) => {
    if (!best || round.score > best.score) return round;
    return best;
  }, null);
  const worstRound = rounds.reduce((worst, round) => {
    if (!worst || round.score < worst.score) return round;
    return worst;
  }, null);
  const meanScore = rounds.length
    ? rounds.reduce((sum, round) => sum + round.score, 0) / rounds.length
    : 0;
  const variance = rounds.length
    ? rounds.reduce((sum, round) => sum + ((round.score - meanScore) ** 2), 0) / rounds.length
    : 0;
  const consistency = Math.sqrt(variance);

  const cards = [
    { label: "Average error", value: `${avgError.toFixed(2)}%` },
    { label: "Best round", value: bestRound ? `R${bestRound.round} | ${bestRound.score.toFixed(2)}` : "-" },
    { label: "Worst round", value: worstRound ? `R${worstRound.round} | ${worstRound.score.toFixed(2)}` : "-" },
    { label: "Consistency", value: `${consistency.toFixed(2)} score SD` }
  ];

  ui.resultAnalytics.innerHTML = "";
  cards.forEach((card) => {
    const el = document.createElement("article");
    el.className = "freq-analytics-card";
    el.innerHTML = `<span>${card.label}</span><strong>${card.value}</strong>`;
    ui.resultAnalytics.append(el);
  });
}

async function finishRun() {
  if (!state.gameSession?.gameId) {
    setStatus("Missing game session. Start a new run.");
    return;
  }

  try {
    const submit = await fetchJson("/api/frequency/game/submit", {
      method: "POST",
      body: JSON.stringify({
        gameId: state.gameSession.gameId,
        name: state.playerName
      })
    }, 12_000);

    const finalScore = Number(submit?.score || state.totalScore || 0);
    state.totalScore = roundTo(finalScore, 2);
    ui.finalScore.textContent = `${state.totalScore.toFixed(2)} / 50`;
    ui.runningScore.textContent = `${state.totalScore.toFixed(2)} / 50`;

    const averageError = state.results.length
      ? state.results.reduce((sum, round) => sum + round.errorPercent, 0) / state.results.length
      : 0;
    const bestRound = state.results.reduce((best, round) => {
      if (!best || round.score > best.score) return round;
      return best;
    }, null);

    ui.finalSummary.textContent = `Average error ${averageError.toFixed(2)}%. Best round ${bestRound ? bestRound.round : "-"} with ${bestRound ? bestRound.score.toFixed(2) : "0.00"} points.`;
    ui.finalRankText.textContent = `Rank #${Number(submit?.rank || 0) || "-"} in ${formatModeLabel(submit?.mode || state.mode)} | ${String(submit?.difficulty || state.difficulty).toUpperCase()}.`;

    setClassementFilter(submit?.mode || state.mode);
    renderRoundBreakdown();
    renderAnalytics();
    await loadLeaderboardFromServer();
    showStage("final");
    setStatus("Run complete. Check your rank and replay when ready.");

    if (state.mode === "daily") {
      await refreshDailyStatus();
      updateSetupHintAndActions();
    }

    if (state.totalScore >= 30) {
      playPositiveTone(9.8);
      playTone({ frequency: 780, duration: 0.12, type: "sine", gain: 0.03, delay: 0.2 });
    } else {
      playNegativeTone();
    }
  } catch (error) {
    setStatus(getApiErrorMessage(error, "Failed to submit final score."));
    showStage("setup");
  } finally {
    state.gameSession = null;
  }
}

async function startGame() {
  state.playerName = (ui.playerName.value || "").trim() || "Player";
  state.mode = getSelectedMode();
  state.difficulty = getSelectedDifficulty();
  updateSetupHintAndActions();

  if (state.mode === "daily" && state.dailyStatus && !state.dailyStatus.canPlay) {
    setStatus("Daily run is already completed for this IP today.");
    return;
  }

  state.busy = true;
  updateSetupHintAndActions();

  try {
    const payload = {
      mode: state.mode,
      difficulty: state.difficulty
    };
    const startData = await fetchJson("/api/frequency/game/start", {
      method: "POST",
      body: JSON.stringify(payload)
    }, 10_000);

    const targets = Array.isArray(startData?.frequencies)
      ? startData.frequencies.map((value) => Number(value))
      : [];
    if (targets.length !== ROUND_COUNT || targets.some((value) => !Number.isFinite(value))) {
      throw new Error("Server returned invalid target frequencies.");
    }

    state.gameSession = {
      gameId: String(startData.gameId || ""),
      mode: String(startData.mode || state.mode),
      difficulty: String(startData.difficulty || state.difficulty)
    };
    state.targets = targets;
    state.results = [];
    state.roundIndex = 0;
    state.totalScore = 0;
    state.currentGuess = Math.round(Math.sqrt(getDifficultyConfig().min * getDifficultyConfig().max));
    ui.runningScore.textContent = "0.00 / 50";
    updateGuessBounds();
    enterListenRound();
  } catch (error) {
    setStatus(getApiErrorMessage(error, "Failed to start game."));
  } finally {
    state.busy = false;
    updateSetupHintAndActions();
  }
}

function returnToMenu() {
  showStage("setup");
  setClassementOpen(false);
  setStatus("Select mode and difficulty, then start your 5-round run.");
  updateSetupHintAndActions();
}

async function onDifficultyChanged() {
  state.difficulty = getSelectedDifficulty();
  ui.difficultyLabel.textContent = state.difficulty === "hard" ? "Hard" : "Easy";
  updateGuessBounds();
  await refreshDailyStatus();
  updateSetupHintAndActions();
}

async function onModeChanged() {
  state.mode = getSelectedMode();
  setClassementFilter(state.mode);
  await refreshDailyStatus();
  updateSetupHintAndActions();
}

function initVibeRenderer() {
  if (!ui.freqVibeCanvas) return;
  const RendererCtor = window.WhiteFrequencyWaveRenderer || window.FrequencyVibeRenderer;
  if (typeof RendererCtor !== "function") return;
  state.vibeRenderer = new RendererCtor(ui.freqVibeCanvas);
  state.vibeRenderer.setFrequency(state.currentGuess);
  state.vibeRenderer.setActive(false);
  state.vibeRenderer.start();
}

function bindEvents() {
  document.addEventListener("pointerdown", unlockAudio);
  document.addEventListener("keydown", unlockAudio);

  if (ui.soundToggleBtn) {
    ui.soundToggleBtn.addEventListener("click", toggleSoundPreference);
  }

  if (ui.difficultyToggle) {
    ui.difficultyToggle.addEventListener("change", () => {
      onDifficultyChanged();
    });
  }

  modeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      onModeChanged();
    });
  });

  ui.startBtn.addEventListener("click", () => {
    unlockAudio();
    startGame();
  });

  if (ui.toggleClassementBtn) {
    ui.toggleClassementBtn.addEventListener("click", () => {
      openClassementFromMenu();
    });
  }
  if (ui.closeClassementBtn) {
    ui.closeClassementBtn.addEventListener("click", () => {
      setClassementOpen(false);
    });
  }
  if (ui.classementFilterSolo) {
    ui.classementFilterSolo.addEventListener("click", () => {
      setClassementFilter("solo");
    });
  }
  if (ui.classementFilterDaily) {
    ui.classementFilterDaily.addEventListener("click", () => {
      setClassementFilter("daily");
    });
  }
  if (ui.classementFilterChallenge) {
    ui.classementFilterChallenge.addEventListener("click", () => {
      setClassementFilter("challenge");
    });
  }
  if (ui.setupClassementModal) {
    ui.setupClassementModal.addEventListener("click", (event) => {
      if (event.target === ui.setupClassementModal) {
        setClassementOpen(false);
      }
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.classementOpen) {
      setClassementOpen(false);
    }
  });

  ui.guessFreqSlider.addEventListener("input", (event) => {
    setGuessFrequency(event.target.value);
    updateContinuousGuessTone();
  });

  ui.submitGuessBtn.addEventListener("click", () => {
    unlockAudio();
    submitGuess();
  });

  ui.nextRoundBtn.addEventListener("click", nextRound);
  ui.mainMenuBtn.addEventListener("click", returnToMenu);
  ui.restartBtn.addEventListener("click", () => {
    unlockAudio();
    startGame();
  });
}

async function init() {
  state.apiBase = getApiBase();
  state.mode = getSelectedMode();
  state.difficulty = getSelectedDifficulty();
  ui.difficultyLabel.textContent = state.difficulty === "hard" ? "Hard" : "Easy";
  loadSoundPreference();
  initVibeRenderer();
  updateGuessBounds();
  bindEvents();
  setClassementFilter(state.mode);

  await detectApiBase();
  await refreshDailyStatus();
  updateSetupHintAndActions();
  showStage("setup");
  if (state.apiBase !== normalizeBase(window.location.origin)) {
    setStatus(`Connected to API ${state.apiBase}. Select mode and difficulty, then start your 5-round run.`);
  } else {
    setStatus("Select mode and difficulty, then start your 5-round run.");
  }
}

init();
