const $ = (id) => document.getElementById(id);

const ui = {
  layout: document.querySelector('main.layout'),
  playerName: $('playerName'),
  memorySeconds: $('memorySeconds'),
  memorySecondsValue: $('memorySecondsValue'),
  difficultyToggle: $('difficultyToggle'),
  difficultyLabel: $('difficultyLabel'),
  toggleClassementBtn: $('toggleClassementBtn'),
  menuClassement: $('menuClassement'),
  closeClassementBtn: $('closeClassementBtn'),
  classementFilterSolo: $('classementFilterSolo'),
  classementFilterDaily: $('classementFilterDaily'),
  classementFilterChallenge: $('classementFilterChallenge'),
  startBtn: $('startBtn'),
  createChallengeBtn: $('createChallengeBtn'),
  copyChallengeBtn: $('copyChallengeBtn'),
  statusBanner: $('statusBanner'),
  setupStage: $('setupStage'),
  memoryStage: $('memoryStage'),
  guessStage: $('guessStage'),
  finalStage: $('finalStage'),
  memoryTimer: $('memoryTimer'),
  roundCounter: $('roundCounter'),
  guessRoundCounter: $('guessRoundCounter'),
  memoryColorCard: $('memoryColorCard'),
  previewPanel: document.querySelector('.preview-panel'),
  guessBoard: $('guessBoard'),
  guessControls: $('guessControls'),
  guessPreview: $('guessPreview'),
  guessActions: $('guessActions'),
  hueSlider: $('hueSlider'),
  satSlider: $('satSlider'),
  briSlider: $('briSlider'),
  hVal: $('hVal'),
  sVal: $('sVal'),
  bVal: $('bVal'),
  hValLabel: $('hValLabel'),
  sValLabel: $('sValLabel'),
  bValLabel: $('bValLabel'),
  submitGuessBtn: $('submitGuessBtn'),
  runningScore: $('runningScore'),
  finalSummary: $('finalSummary'),
  finalRankText: $('finalRankText'),
  finalLeaderboard: $('finalLeaderboard'),
  scoreJoke: $('scoreJoke'),
  roundBreakdown: $('roundBreakdown'),
  restartBtn: $('restartBtn'),
  mainMenuBtn: $('mainMenuBtn'),
  menuLeaderboard: $('menuLeaderboard'),
  leaderboard: $('leaderboard'),
  challengeBoard: $('challengeBoard'),
  themeToggleBtn: $('themeToggleBtn'),
  soundToggleBtn: $('soundToggleBtn'),
  roundFeedback: $('roundFeedback'),
  roundFeedbackText: $('roundFeedbackText'),
  feedbackTargetSwatch: $('feedbackTargetSwatch'),
  feedbackGuessSwatch: $('feedbackGuessSwatch'),
  feedbackSplitScore: $('feedbackSplitScore'),
  nextRoundBtn: $('nextRoundBtn'),
  resultAnalytics: $('resultAnalytics')
};

const modeRadios = Array.from(document.querySelectorAll('input[name="mode"]'));
const dailyModeRadio = modeRadios.find((radio) => radio.value === 'daily') || null;
const ID_COOKIE_KEY = 'color_recall_player_id';
const IP_COOKIE_KEY = 'color_recall_last_ip';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const SOUND_PREF_KEY = 'color_recall_sound_pref';
const CHALLENGE_CODE_REGEX = /^[A-Za-z0-9_-]{6,120}$/;

function getCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const part = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix));
  if (!part) return '';
  return decodeURIComponent(part.slice(prefix.length));
}

function setCookie(name, value, maxAgeSeconds = COOKIE_MAX_AGE_SECONDS) {
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax`;
}

function deleteCookie(name) {
  document.cookie = `${encodeURIComponent(name)}=; Max-Age=0; Path=/; SameSite=Lax`;
}

function normalizeBase(base) {
  return base ? base.replace(/\/+$/, '') : '';
}

function getApiBases() {
  const params = new URLSearchParams(window.location.search);
  const queryApi = params.get('api');
  const queryApi2 = params.get('api2');
  const queryApis = params.get('apis');
  const queryPort = params.get('apiPort');
  const queryPort2 = params.get('apiPort2');
  const bases = [];

  if (queryApis) {
    queryApis.split(',').map((v) => v.trim()).filter(Boolean).forEach((v) => bases.push(normalizeBase(v)));
  }
  if (queryApi) bases.push(normalizeBase(queryApi));
  if (queryApi2) bases.push(normalizeBase(queryApi2));
  if (queryPort) bases.push(`${window.location.protocol}//${window.location.hostname}:${queryPort}`);
  if (queryPort2) bases.push(`${window.location.protocol}//${window.location.hostname}:${queryPort2}`);
  if (!bases.length) {
    try {
      const current = new URL(window.location.href);
      if (current.hostname === 'localhost') {
        bases.push(normalizeBase(`${current.protocol}//127.0.0.1${current.port ? `:${current.port}` : ''}`));
      }
    } catch {
      // Ignore URL parsing issues and fall back to origin.
    }
    bases.push(window.location.origin);
  }

  return Array.from(new Set(bases.filter(Boolean)));
}

function getApiCandidates() {
  const candidates = new Set(getApiBases());

  const addPorts = (protocol, hostname, ports) => {
    if (!protocol || !hostname) return;
    ports.forEach((port) => {
      candidates.add(`${protocol}//${hostname}:${port}`);
    });
  };

  const fallbackPorts = ['3000', '3001'];

  try {
    const origin = new URL(window.location.origin);
    addPorts(origin.protocol, origin.hostname, fallbackPorts);
    if (origin.hostname === 'localhost' || origin.hostname === '127.0.0.1') {
      addPorts(origin.protocol, 'localhost', fallbackPorts);
      addPorts(origin.protocol, '127.0.0.1', fallbackPorts);
    }
  } catch {
    // Ignore invalid origin parsing.
  }

  if (window.location.protocol === 'file:') {
    addPorts('http:', 'localhost', fallbackPorts);
    addPorts('http:', '127.0.0.1', fallbackPorts);
  }

  return Array.from(candidates).map(normalizeBase).filter(Boolean);
}

function apiUrl(base, path) {
  return `${base}${path}`;
}

function getClusterPeerHeader() {
  return Array.from(new Set([...getApiBases(), window.location.origin].map(normalizeBase).filter(Boolean))).join(',');
}

function getPrimaryApiBase() {
  return state.apiBase || getApiCandidates()[0] || window.location.origin;
}

function updateSoundToggleButton() {
  if (!ui.soundToggleBtn) return;
  ui.soundToggleBtn.textContent = state.soundEnabled ? 'Sound on' : 'Sound off';
  ui.soundToggleBtn.setAttribute('aria-pressed', String(state.soundEnabled));
}

function loadSoundPreference() {
  const pref = String(localStorage.getItem(SOUND_PREF_KEY) || '').toLowerCase();
  state.soundEnabled = pref !== 'off';
  updateSoundToggleButton();
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
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // Ignore user-agent resume rejection until next interaction.
    }
  }
  state.audioReady = ctx.state === 'running';
}

function playTone({
  frequency = 440,
  duration = 0.12,
  type = 'sine',
  gain = 0.03,
  delay = 0
} = {}) {
  if (!state.soundEnabled) return;
  const ctx = ensureAudioContext();
  if (!ctx || ctx.state !== 'running') return;

  const startAt = ctx.currentTime + Math.max(0, delay);
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(80, Number(frequency) || 440), startAt);
  amp.gain.setValueAtTime(0.0001, startAt);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), startAt + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, startAt + Math.max(0.04, duration));
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + Math.max(0.06, duration) + 0.03);
}

function playRoundAcceptedSound(roundScore) {
  const safe = Number.isFinite(roundScore) ? roundScore : 0;
  playTone({ frequency: 320 + (safe * 40), duration: 0.13, type: 'triangle', gain: 0.03 });
  playTone({ frequency: 520 + (safe * 18), duration: 0.1, type: 'sine', gain: 0.017, delay: 0.08 });
}

function playRoundRejectedSound() {
  playTone({ frequency: 190, duration: 0.15, type: 'sawtooth', gain: 0.035 });
  playTone({ frequency: 150, duration: 0.19, type: 'triangle', gain: 0.024, delay: 0.04 });
}

function playCountdownTickSound(secondsLeft) {
  const safeLeft = Math.max(0, Number(secondsLeft) || 0);
  playTone({
    frequency: 430 + (safeLeft * 28),
    duration: 0.06,
    type: safeLeft <= 1 ? 'square' : 'sine',
    gain: safeLeft <= 1 ? 0.032 : 0.02
  });
}

function playSavedRunSound(score) {
  const safe = Number.isFinite(score) ? score : 0;
  const base = 420 + (safe * 4);
  playTone({ frequency: base, duration: 0.1, type: 'triangle', gain: 0.03 });
  playTone({ frequency: base * 1.28, duration: 0.1, type: 'sine', gain: 0.025, delay: 0.09 });
  playTone({ frequency: base * 1.56, duration: 0.16, type: 'sine', gain: 0.024, delay: 0.18 });
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  localStorage.setItem(SOUND_PREF_KEY, state.soundEnabled ? 'on' : 'off');
  updateSoundToggleButton();
  if (state.soundEnabled) {
    unlockAudio();
    setStatus('Sound enabled.');
  } else {
    setStatus('Sound muted.');
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 1800) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function applyServerCapabilities(healthPayload) {
  const version = Number(healthPayload?.apiVersion);
  const hasLeaderboardV2 = Boolean(healthPayload?.features?.leaderboardV2)
    || (Number.isFinite(version) && version >= 2);

  state.leaderboardEndpointSupported = hasLeaderboardV2;

  const scoring = String(healthPayload?.scoringModel || '').trim().toLowerCase();
  if (scoring === 'ciede2000') {
    state.serverScoreModel = 'ciede2000';
    return;
  }
  if (scoring === 'cie76') {
    state.serverScoreModel = 'cie76';
    return;
  }

  // Legacy backends do not advertise capabilities and still use CIE76.
  state.serverScoreModel = hasLeaderboardV2 ? 'ciede2000' : 'cie76';
}

async function resolveApiBase(force = false) {
  if (!force && state.apiBase) return state.apiBase;
  if (!force && state.apiResolvePromise) return state.apiResolvePromise;
  if (!force && Date.now() < state.apiRetryAfter) return null;

  const probe = (async () => {
    const candidates = getApiCandidates();
    for (const base of candidates) {
      try {
        const response = await fetchWithTimeout(apiUrl(base, '/api/health'), {}, 1300);
        if (!response.ok) continue;
        if (state.apiBase && state.apiBase !== base) {
          state.leaderboardEndpointSupported = null;
          state.serverScoreModel = 'unknown';
        }
        let healthPayload = null;
        try {
          healthPayload = await response.json();
        } catch {
          healthPayload = null;
        }
        applyServerCapabilities(healthPayload);
        state.apiBase = base;
        state.apiRetryAfter = 0;
        const activeChallengeCode = getChallengeCodeFromUrl();
        if (activeChallengeCode) {
          const difficulty = ui.difficultyToggle.checked ? 'hard' : 'easy';
          refreshChallengeShareLink(activeChallengeCode, difficulty);
        }
        return base;
      } catch {
        // Try next candidate.
      }
    }

    state.apiBase = '';
    state.apiRetryAfter = Date.now() + 10000;
    return null;
  })();

  state.apiResolvePromise = probe;
  try {
    return await probe;
  } finally {
    state.apiResolvePromise = null;
  }
}

function mergeBoards(boards) {
  const merged = [];
  const seen = new Set();

  boards.flat().forEach((entry) => {
    const normalized = {
      name: String(entry?.name || 'Player'),
      mode: String(entry?.mode || 'solo'),
      difficulty: String(entry?.difficulty || 'easy'),
      score: Number(entry?.score || 0),
      time: entry?.time || new Date(0).toISOString()
    };
    const dedupeKey = `${normalized.name}|${normalized.mode}|${normalized.difficulty}|${normalized.score.toFixed(4)}|${normalized.time}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    merged.push(normalized);
  });

  merged.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.time).localeCompare(String(b.time));
  });
  return merged;
}

const state = {
  playerName: '',
  lastKnownIp: '',
  mode: 'solo',
  difficulty: 'easy',
  memorySeconds: 5,
  activeGameId: '',
  gameStartedAt: 0,
  gameExpiresAt: 0,
  authoritativeScore: null,
  seed: '',
  colors: [],
  guesses: [],
  results: [],
  roundIndex: 0,
  totalScore: 0,
  timerHandle: null,
  challengeLink: '',
  waitingNextRound: false,
  checkpointInFlight: false,
  dailyStatus: null,
  classementFilter: 'solo',
  latestBoard: [],
  latestChallengeBoard: [],
  latestLeaderboardSummary: null,
  leaderboardEndpointSupported: null,
  serverScoreModel: 'unknown',
  apiBase: '',
  apiResolvePromise: null,
  apiRetryAfter: 0,
  soundEnabled: true,
  audioContext: null,
  audioReady: false
};

function normalizeDailyColors(rawColors) {
  if (!Array.isArray(rawColors)) return [];
  return rawColors.slice(0, 5).map((color) => ({
    h: clamp(Math.round(Number(color?.h || 0)), 0, 360),
    s: clamp(Math.round(Number(color?.s || 0)), 0, 100),
    v: clamp(Math.round(Number(color?.v || 0)), 0, 100)
  }));
}

function setDailyModeAvailability(status) {
  if (!dailyModeRadio) return;

  const isLocked = Boolean(status?.playedToday);
  const option = dailyModeRadio.closest('.mode-option');
  dailyModeRadio.disabled = isLocked;
  if (option) option.classList.toggle('is-disabled', isLocked);

  if (isLocked && dailyModeRadio.checked) {
    const fallback = modeRadios.find((radio) => radio.value === 'solo');
    if (fallback) fallback.checked = true;
  }
}

async function fetchDailyStatus(force = false) {
  const base = await resolveApiBase(force);
  if (!base) return null;

  try {
    const response = await fetchWithTimeout(apiUrl(base, '/api/daily'), {}, 2200);
    if (!response.ok) return null;
    const payload = await response.json();
    const normalized = {
      dateKey: String(payload?.dateKey || ''),
      canPlay: Boolean(payload?.canPlay),
      playedToday: Boolean(payload?.playedToday),
      playedEntry: payload?.playedEntry || null,
      colors: normalizeDailyColors(payload?.colors)
    };
    state.dailyStatus = normalized;
    setDailyModeAvailability(normalized);
    return normalized;
  } catch {
    return null;
  }
}

function syncPlayerNameCookie() {
  const safeName = (ui.playerName.value || '').trim().slice(0, 20);
  ui.playerName.value = safeName;
  state.playerName = safeName;
  if (safeName) {
    setCookie(ID_COOKIE_KEY, safeName);
  } else {
    deleteCookie(ID_COOKIE_KEY);
  }
}

function loadIdentityFromCookies() {
  const savedName = getCookie(ID_COOKIE_KEY).trim().slice(0, 20);
  const savedIp = getCookie(IP_COOKIE_KEY).trim();

  if (savedName && !ui.playerName.value.trim()) {
    ui.playerName.value = savedName;
  }
  state.playerName = ui.playerName.value.trim();
  state.lastKnownIp = savedIp;
}

function normalizeIp(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return '';
  return raw.replace(/^::ffff:/, '');
}

async function refreshIdentityIpCookie() {
  const base = await resolveApiBase();
  if (!base) return;

  try {
    const response = await fetchWithTimeout(apiUrl(base, '/api/whoami'), {}, 1600);
    if (!response.ok) return;

    const payload = await response.json();
    const normalizedIp = normalizeIp(payload?.ip);
    if (!normalizedIp) return;

    state.lastKnownIp = normalizedIp;
    setCookie(IP_COOKIE_KEY, normalizedIp);
  } catch {
    // Ignore transient network errors and keep previous cookie value.
  }
}

function hsvToRgb(h, s, v) {
  s /= 100;
  v /= 100;
  const c = v * s;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;

  if (hh >= 0 && hh < 1) {
    r = c; g = x; b = 0;
  } else if (hh < 2) {
    r = x; g = c; b = 0;
  } else if (hh < 3) {
    r = 0; g = c; b = x;
  } else if (hh < 4) {
    r = 0; g = x; b = c;
  } else if (hh < 5) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  const m = v - c;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

function rgbToCss(rgb) {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

function hsvToCss(h, s, v) {
  return rgbToCss(hsvToRgb(h, s, v));
}

function rgbToXyz(rgb) {
  let rr = rgb.r / 255;
  let gg = rgb.g / 255;
  let bb = rgb.b / 255;

  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;

  rr *= 100;
  gg *= 100;
  bb *= 100;

  return {
    x: rr * 0.4124 + gg * 0.3576 + bb * 0.1805,
    y: rr * 0.2126 + gg * 0.7152 + bb * 0.0722,
    z: rr * 0.0193 + gg * 0.1192 + bb * 0.9505
  };
}

function xyzToLab(xyz) {
  let xx = xyz.x / 95.047;
  let yy = xyz.y / 100.0;
  let zz = xyz.z / 108.883;

  const f = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + 16 / 116;
  xx = f(xx);
  yy = f(yy);
  zz = f(zz);

  return {
    l: (116 * yy) - 16,
    a: 500 * (xx - yy),
    b: 200 * (yy - zz)
  };
}

function radians(degrees) {
  return (degrees * Math.PI) / 180;
}

function degrees(radiansValue) {
  return (radiansValue * 180) / Math.PI;
}

function deltaE76(lab1, lab2) {
  return Math.sqrt(
    ((lab1.l - lab2.l) ** 2)
    + ((lab1.a - lab2.a) ** 2)
    + ((lab1.b - lab2.b) ** 2)
  );
}

function deltaE2000(lab1, lab2) {
  const L1 = lab1.l;
  const a1 = lab1.a;
  const b1 = lab1.b;
  const L2 = lab2.l;
  const a2 = lab2.a;
  const b2 = lab2.b;

  const C1 = Math.sqrt((a1 ** 2) + (b1 ** 2));
  const C2 = Math.sqrt((a2 ** 2) + (b2 ** 2));
  const avgC = (C1 + C2) / 2;
  const pow25To7 = 6103515625;
  const G = 0.5 * (1 - Math.sqrt((avgC ** 7) / ((avgC ** 7) + pow25To7)));

  const a1Prime = (1 + G) * a1;
  const a2Prime = (1 + G) * a2;
  const C1Prime = Math.sqrt((a1Prime ** 2) + (b1 ** 2));
  const C2Prime = Math.sqrt((a2Prime ** 2) + (b2 ** 2));
  const avgCPrime = (C1Prime + C2Prime) / 2;

  let h1Prime = Math.atan2(b1, a1Prime);
  let h2Prime = Math.atan2(b2, a2Prime);
  if (h1Prime < 0) h1Prime += 2 * Math.PI;
  if (h2Prime < 0) h2Prime += 2 * Math.PI;

  const deltaLPrime = L2 - L1;
  const deltaCPrime = C2Prime - C1Prime;

  let deltaHPrimeAngle = 0;
  if (C1Prime * C2Prime !== 0) {
    deltaHPrimeAngle = h2Prime - h1Prime;
    if (deltaHPrimeAngle > Math.PI) deltaHPrimeAngle -= 2 * Math.PI;
    if (deltaHPrimeAngle < -Math.PI) deltaHPrimeAngle += 2 * Math.PI;
  }

  const deltaHPrime = 2 * Math.sqrt(C1Prime * C2Prime) * Math.sin(deltaHPrimeAngle / 2);
  const avgLPrime = (L1 + L2) / 2;

  let avgHPrime = h1Prime + h2Prime;
  if (C1Prime * C2Prime === 0) {
    avgHPrime = h1Prime + h2Prime;
  } else if (Math.abs(h1Prime - h2Prime) <= Math.PI) {
    avgHPrime = (h1Prime + h2Prime) / 2;
  } else if ((h1Prime + h2Prime) < (2 * Math.PI)) {
    avgHPrime = (h1Prime + h2Prime + (2 * Math.PI)) / 2;
  } else {
    avgHPrime = (h1Prime + h2Prime - (2 * Math.PI)) / 2;
  }

  const T = 1
    - (0.17 * Math.cos(avgHPrime - radians(30)))
    + (0.24 * Math.cos(2 * avgHPrime))
    + (0.32 * Math.cos((3 * avgHPrime) + radians(6)))
    - (0.20 * Math.cos((4 * avgHPrime) - radians(63)));

  const deltaTheta = radians(30) * Math.exp(-(((degrees(avgHPrime) - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt((avgCPrime ** 7) / ((avgCPrime ** 7) + pow25To7));
  const Sl = 1 + ((0.015 * ((avgLPrime - 50) ** 2)) / Math.sqrt(20 + ((avgLPrime - 50) ** 2)));
  const Sc = 1 + (0.045 * avgCPrime);
  const Sh = 1 + (0.015 * avgCPrime * T);
  const Rt = -Math.sin(2 * deltaTheta) * Rc;

  const lightnessTerm = deltaLPrime / Sl;
  const chromaTerm = deltaCPrime / Sc;
  const hueTerm = deltaHPrime / Sh;

  return Math.sqrt(
    (lightnessTerm ** 2)
    + (chromaTerm ** 2)
    + (hueTerm ** 2)
    + (Rt * chromaTerm * hueTerm)
  );
}

function hueDifference(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatModeLabel(mode) {
  if (mode === 'solo') return 'single player';
  if (mode === 'challenge') return 'multiplayer';
  if (mode === 'daily') return 'daily';
  return mode;
}

function createLeaderRow(entry, rank) {
  const row = document.createElement('div');
  row.className = 'leader-row';
  const safeScore = Number(entry.score);
  const safeName = escapeHtml(entry?.name || 'Player');
  const safeMode = escapeHtml(formatModeLabel(String(entry?.mode || 'solo')));
  const safeDifficulty = escapeHtml(String(entry?.difficulty || 'easy'));
  row.innerHTML = `<div class="rank-badge">${rank}</div><div><strong>${safeName}</strong><div class="muted">${safeMode} | ${safeDifficulty}</div></div><strong>${(Number.isFinite(safeScore) ? safeScore : 0).toFixed(2)}</strong>`;
  return row;
}

function renderLeaderRows(target, entries, emptyMessage, limit) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const rows = Number.isFinite(limit) ? safeEntries.slice(0, limit) : safeEntries;
  target.innerHTML = rows.length ? '' : `<p class="muted">${emptyMessage}</p>`;
  rows.forEach((entry, index) => {
    target.appendChild(createLeaderRow(entry, index + 1));
  });
}

function isChallengeContextActive() {
  if (getChallengeCodeFromUrl()) return true;
  const selectedMode = getSelectedMode();
  return selectedMode === 'challenge';
}

function getClassementEntries(board) {
  if (state.classementFilter === 'challenge') {
    if (Array.isArray(state.latestChallengeBoard) && state.latestChallengeBoard.length) {
      return state.latestChallengeBoard;
    }
    if (!Array.isArray(board)) return [];
    return board.filter((entry) => String(entry?.mode || '').toLowerCase() === 'challenge');
  }

  if (!Array.isArray(board)) return [];
  if (state.classementFilter === 'daily') {
    return board.filter((entry) => String(entry?.mode || '').toLowerCase() === 'daily');
  }
  return board.filter((entry) => String(entry?.mode || '').toLowerCase() === 'solo');
}

function renderMenuClassement(board = state.latestBoard) {
  const filtered = getClassementEntries(board);
  let emptyMessage = 'No solo scores yet.';
  if (state.classementFilter === 'daily') {
    emptyMessage = 'No daily scores yet.';
  } else if (state.classementFilter === 'challenge') {
    emptyMessage = 'No multiplayer score yet for this shared page.';
  }
  renderLeaderRows(ui.menuLeaderboard, filtered, emptyMessage);
}

function setClassementFilter(filter) {
  const nextFilter = filter === 'daily'
    ? 'daily'
    : (filter === 'challenge' ? 'challenge' : 'solo');
  state.classementFilter = nextFilter;
  ui.classementFilterSolo.classList.toggle('is-active', nextFilter === 'solo');
  ui.classementFilterDaily.classList.toggle('is-active', nextFilter === 'daily');
  if (ui.classementFilterChallenge) {
    ui.classementFilterChallenge.classList.toggle('is-active', nextFilter === 'challenge');
  }
  renderMenuClassement();
}

function getSelectedMode() {
  const selected = modeRadios.find((radio) => radio.checked);
  return selected ? selected.value : 'solo';
}

function updateDifficultyText() {
  const isHard = ui.difficultyToggle.checked;
  ui.difficultyLabel.textContent = isHard ? 'Hard' : 'Easy';
  ui.memorySeconds.value = isHard ? '2' : '5';
  ui.memorySecondsValue.textContent = isHard ? '2 sec' : '5 sec';
}

function getScoreJoke(score) {
  if (score >= 45) return 'Perfect recall! The colors are clearly still in your eyeballs.';
  if (score >= 35) return 'Nice work - your color memory is almost cheating level.';
  if (score >= 25) return 'Solid run. Your brain remembered a few shades of genius.';
  if (score >= 15) return 'Good effort - the palette still loves you, even if one shade slipped.';
  return 'Hey, even the best artists start with practice. More colors tomorrow.';
}

function colorToLab(color) {
  return xyzToLab(rgbToXyz(hsvToRgb(color.h, color.s, color.v)));
}

function getActiveScoreModel() {
  return state.serverScoreModel === 'ciede2000' ? 'ciede2000' : 'cie76';
}

function scoreGuess(target, guess) {
  const targetLab = colorToLab(target);
  const guessLab = colorToLab(guess);
  const model = getActiveScoreModel();
  const dE = model === 'ciede2000'
    ? deltaE2000(targetLab, guessLab)
    : deltaE76(targetLab, guessLab);
  const base = 10 / (1 + Math.pow(dE / 38, 1.6));
  const hueDiff = hueDifference(target.h, guess.h);
  const vividness = (target.s + guess.s) / 200;
  const recovery = hueDiff <= 18 ? (1 - hueDiff / 18) * 1.15 * vividness : 0;
  const penalty = (hueDiff > 42 && vividness > 0.35) ? ((hueDiff - 42) / 138) * 2.2 * vividness : 0;
  const roundScore = clamp(base + recovery - penalty, 0, 10);
  return { dE, roundScore, model };
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const avg = average(values);
  const variance = average(values.map((value) => ((value - avg) ** 2)));
  return Math.sqrt(variance);
}

function formatSigned(value, decimals = 1) {
  const safe = Number.isFinite(value) ? value : 0;
  const fixed = safe.toFixed(decimals);
  if (safe > 0) return `+${fixed}`;
  return fixed;
}

function computeResultAnalytics() {
  const roundScores = state.results.map((result) => Number(result?.roundScore) || 0);
  const deltaEs = state.results.map((result) => Number(result?.dE) || 0);

  const hueErrors = state.colors.map((target, index) => {
    const guess = state.guesses[index];
    if (!guess) return 0;
    return hueDifference(target.h, guess.h);
  });

  const satBiasValues = state.colors.map((target, index) => {
    const guess = state.guesses[index];
    if (!guess) return 0;
    return (guess.s || 0) - (target.s || 0);
  });

  const briBiasValues = state.colors.map((target, index) => {
    const guess = state.guesses[index];
    if (!guess) return 0;
    return (guess.v || 0) - (target.v || 0);
  });

  const avgDeltaE = average(deltaEs);
  const avgHueError = average(hueErrors);
  const avgRoundScore = average(roundScores);
  const scoreSpread = roundScores.length ? (Math.max(...roundScores) - Math.min(...roundScores)) : 0;
  const consistency = clamp(100 - (standardDeviation(roundScores) * 12), 0, 100);
  const accuracyPercent = clamp((state.totalScore / 50) * 100, 0, 100);

  let bestRound = -1;
  let worstRound = -1;
  if (roundScores.length) {
    bestRound = roundScores.indexOf(Math.max(...roundScores));
    worstRound = roundScores.indexOf(Math.min(...roundScores));
  }

  return {
    accuracyPercent,
    avgDeltaE,
    avgHueError,
    avgRoundScore,
    scoreSpread,
    consistency,
    satBias: average(satBiasValues),
    briBias: average(briBiasValues),
    bestRound: bestRound >= 0 ? bestRound + 1 : null,
    bestRoundScore: bestRound >= 0 ? roundScores[bestRound] : 0,
    worstRound: worstRound >= 0 ? worstRound + 1 : null,
    worstRoundScore: worstRound >= 0 ? roundScores[worstRound] : 0
  };
}

function renderResultAnalytics({ rank = null, totalEntries = 0 } = {}) {
  if (!ui.resultAnalytics) return;
  const analytics = computeResultAnalytics();
  const cards = [
    {
      title: 'Accuracy',
      value: `${analytics.accuracyPercent.toFixed(1)}%`,
      hint: `Avg round ${analytics.avgRoundScore.toFixed(2)} / 10`
    },
    {
      title: 'Perceptual Match',
      value: `DeltaE ${analytics.avgDeltaE.toFixed(2)}`,
      hint: analytics.avgDeltaE <= 6 ? 'Excellent color proximity' : 'Improve precision with hue + value'
    },
    {
      title: 'Consistency',
      value: `${analytics.consistency.toFixed(0)}%`,
      hint: `Spread ${analytics.scoreSpread.toFixed(2)} points`
    },
    {
      title: 'Hue Precision',
      value: `${analytics.avgHueError.toFixed(1)} deg`,
      hint: analytics.avgHueError <= 14 ? 'Strong hue memory' : 'Try reducing hue drift'
    },
    {
      title: 'Saturation Bias',
      value: formatSigned(analytics.satBias, 1),
      hint: 'Positive means oversaturated guesses'
    },
    {
      title: 'Brightness Bias',
      value: formatSigned(analytics.briBias, 1),
      hint: 'Positive means brighter guesses'
    }
  ];

  if (analytics.bestRound && analytics.worstRound) {
    cards.push({
      title: 'Best vs Worst',
      value: `R${analytics.bestRound} ${analytics.bestRoundScore.toFixed(2)} / R${analytics.worstRound} ${analytics.worstRoundScore.toFixed(2)}`,
      hint: 'Use this to tune your weak rounds'
    });
  }

  if (Number.isFinite(rank) && rank > 0 && totalEntries > 0) {
    const percentile = clamp(((totalEntries - rank + 1) / totalEntries) * 100, 0, 100);
    cards.push({
      title: 'Leaderboard Position',
      value: `#${rank}`,
      hint: `Top ${percentile.toFixed(1)}% of ${totalEntries} players`
    });
  }

  ui.resultAnalytics.innerHTML = '';
  cards.forEach((card, index) => {
    const el = document.createElement('article');
    el.className = 'analytics-card';
    el.style.setProperty('--card-delay', `${index * 55}ms`);
    el.innerHTML = `
      <p class="analytics-title">${escapeHtml(card.title)}</p>
      <p class="analytics-value">${escapeHtml(card.value)}</p>
      <p class="analytics-hint">${escapeHtml(card.hint)}</p>
    `;
    ui.resultAnalytics.appendChild(el);
  });
}

function currentGuess() {
  const rawHue = Number(ui.hueSlider.value);
  const hue = (360 - rawHue + 360) % 360;
  return {
    h: hue,
    s: Number(ui.satSlider.value),
    v: Number(ui.briSlider.value)
  };
}

function syncGuessBoardMetrics() {
  const firstColumn = ui.guessControls.querySelector('.vertical-slider');
  if (!firstColumn) return;

  const span = Math.max(120, firstColumn.getBoundingClientRect().height - 28);
  ui.guessBoard.style.setProperty('--picker-span', `${span}px`);
}

function updateSliderTracks() {
  const color = currentGuess();
  const satLow = hsvToCss(color.h, 0, color.v);
  const satHigh = hsvToCss(color.h, 100, color.v);
  const briLow = hsvToCss(color.h, color.s, 0);
  const briHigh = hsvToCss(color.h, color.s, 100);

  ui.guessBoard.style.setProperty('--sat-low', satLow);
  ui.guessBoard.style.setProperty('--sat-high', satHigh);
  ui.guessBoard.style.setProperty('--bri-low', briLow);
  ui.guessBoard.style.setProperty('--bri-high', briHigh);
  ui.hueSlider.style.background = 'linear-gradient(90deg, rgb(255, 0, 0), rgb(255, 255, 0), rgb(0, 255, 0), rgb(0, 255, 255), rgb(0, 0, 255), rgb(255, 0, 255), rgb(255, 0, 0))';
  ui.satSlider.style.background = `linear-gradient(90deg, ${satLow}, ${satHigh})`;
  ui.briSlider.style.background = `linear-gradient(90deg, ${briLow}, ${briHigh})`;
}

function updateGuessPreview() {
  const color = currentGuess();
  ui.guessPreview.style.background = hsvToCss(color.h, color.s, color.v);
  ui.hVal.textContent = color.h;
  ui.sVal.textContent = color.s;
  ui.bVal.textContent = color.v;
  ui.hValLabel.textContent = color.h;
  ui.sValLabel.textContent = color.s;
  ui.bValLabel.textContent = color.v;
  updateSliderTracks();
}

function animateStageEnter(stage) {
  stage.classList.remove('stage-enter');
  void stage.offsetWidth;
  stage.classList.add('stage-enter');
}

function pulseElement(element, className = 'is-pulsing') {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function showOnly(stage) {
  [ui.setupStage, ui.memoryStage, ui.guessStage, ui.finalStage].forEach((el) => el.classList.add('hidden'));
  stage.classList.remove('hidden');
  animateStageEnter(stage);
  if (stage !== ui.setupStage) {
    setClassementVisible(false);
  }
  document.body.classList.toggle('guess-active', stage === ui.guessStage);
  document.body.dataset.stage = stage.id;
}

function setStatus(message) {
  ui.statusBanner.textContent = message;
}

function setClassementVisible(visible) {
  const shouldShow = Boolean(visible);
  if (shouldShow && isChallengeContextActive()) {
    setClassementFilter('challenge');
  }
  if (!shouldShow && ui.menuClassement.contains(document.activeElement)) {
    ui.toggleClassementBtn.focus({ preventScroll: true });
  }

  if (shouldShow) {
    ui.menuClassement.classList.remove('hidden');
    ui.menuClassement.setAttribute('aria-hidden', 'false');
    ui.menuClassement.removeAttribute('inert');
  } else {
    ui.menuClassement.setAttribute('inert', '');
    ui.menuClassement.setAttribute('aria-hidden', 'true');
    ui.menuClassement.classList.add('hidden');
  }

  ui.layout.classList.toggle('classement-open', shouldShow);
  ui.toggleClassementBtn.textContent = shouldShow ? 'Hide classement' : 'Show classement';
}

function getDisplayName() {
  return state.playerName.trim() || 'Player';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('color-recall-theme', theme);
  ui.themeToggleBtn.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

function initTheme() {
  const saved = localStorage.getItem('color-recall-theme');
  setTheme(saved === 'dark' ? 'dark' : 'light');
}

function initFromUrl() {
  const params = new URLSearchParams(location.search);
  const challengeCode = getChallengeCodeFromUrl();
  if ((params.get('mode') === 'challenge' && params.get('seed')) || challengeCode) {
    modeRadios.forEach((radio) => {
      radio.checked = radio.value === 'challenge';
    });
    if (params.get('difficulty')) {
      ui.difficultyToggle.checked = params.get('difficulty') === 'hard';
      updateDifficultyText();
    }
    if (challengeCode) {
      const difficulty = ui.difficultyToggle.checked ? 'hard' : 'easy';
      refreshChallengeShareLink(challengeCode, difficulty);
      setClassementFilter('challenge');
    }
    setStatus('Challenge detected. Start the game to play the same 5 colors.');
  }
}

function getChallengeCodeFromPath() {
  const parts = String(window.location.pathname || '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2 && parts[0].toLowerCase() === 'challenge') {
    let code = '';
    try {
      code = decodeURIComponent(parts[1] || '').trim();
    } catch {
      code = String(parts[1] || '').trim();
    }
    return CHALLENGE_CODE_REGEX.test(code) ? code : '';
  }
  return '';
}

function getChallengeCodeFromUrl() {
  const pathCode = getChallengeCodeFromPath();
  if (pathCode) return pathCode;
  const params = new URLSearchParams(location.search);
  const queryCode = String(params.get('seed') || '').trim();
  return CHALLENGE_CODE_REGEX.test(queryCode) ? queryCode : '';
}

function generateChallengeCode() {
  return `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
}

function getPreferredShareOrigin() {
  let currentOrigin = window.location.origin;
  try {
    const current = new URL(window.location.href);
    currentOrigin = current.origin;
    if (!isLoopbackHostname(current.hostname)) {
      return current.origin;
    }
  } catch {
    // Fallback to window.location.origin.
  }

  const candidateBase = state.apiBase || getApiCandidates()[0] || '';
  try {
    const api = new URL(candidateBase);
    if (!isLoopbackHostname(api.hostname)) {
      return api.origin;
    }
  } catch {
    // Ignore invalid API base candidate.
  }

  return currentOrigin;
}

function buildChallengePageUrl(challengeCode, difficulty, baseOrigin = window.location.origin) {
  const safeCode = String(challengeCode || '').trim();
  const safeDifficulty = String(difficulty || '').toLowerCase() === 'hard' ? 'hard' : 'easy';
  const url = new URL(`/challenge/${encodeURIComponent(safeCode)}`, baseOrigin);
  url.searchParams.set('mode', 'challenge');
  url.searchParams.set('difficulty', safeDifficulty);
  url.searchParams.delete('seed');
  return url;
}

function refreshChallengeShareLink(challengeCode, difficulty) {
  const safeCode = String(challengeCode || '').trim();
  if (!safeCode) {
    state.challengeLink = '';
    ui.copyChallengeBtn.disabled = true;
    return;
  }
  const shareUrl = buildChallengePageUrl(safeCode, difficulty, getPreferredShareOrigin());
  state.challengeLink = shareUrl.toString();
  ui.copyChallengeBtn.disabled = false;
}

function updateChallengePageClass() {
  const onChallengePage = Boolean(getChallengeCodeFromPath());
  document.body.classList.toggle('challenge-page', onChallengePage);
}

function syncChallengeUrl(challengeCode, difficulty) {
  const localUrl = buildChallengePageUrl(challengeCode, difficulty, window.location.origin);
  history.replaceState({}, '', localUrl.toString());
  refreshChallengeShareLink(challengeCode, difficulty);
  updateChallengePageClass();
}

function ensureChallengeCodeForStart() {
  const existing = getChallengeCodeFromUrl();
  if (existing) {
    syncChallengeUrl(existing, state.difficulty);
    return existing;
  }

  const created = generateChallengeCode();
  syncChallengeUrl(created, state.difficulty);
  setStatus('Multiplayer page created. Share this dedicated link with other players.');
  return created;
}

async function startGame() {
  unlockAudio();
  syncPlayerNameCookie();
  state.mode = getSelectedMode();
  state.difficulty = ui.difficultyToggle.checked ? 'hard' : 'easy';
  state.memorySeconds = ui.difficultyToggle.checked ? 2 : 5;

  const base = await resolveApiBase();
  if (!base) {
    setStatus('Game cannot start because API server is unavailable.');
    return;
  }
  if (state.serverScoreModel === 'unknown') {
    state.serverScoreModel = 'cie76';
  }

  const startPayload = {
    mode: state.mode,
    difficulty: state.difficulty
  };
  if (state.mode === 'challenge') {
    startPayload.challengeCode = ensureChallengeCodeForStart();
  }

  let startResponse;
  try {
    startResponse = await fetchWithTimeout(apiUrl(base, '/api/game/start'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cluster-Peers': getClusterPeerHeader()
      },
      body: JSON.stringify(startPayload)
    }, 2500);
  } catch {
    setStatus('Game cannot start because server connection failed.');
    return;
  }

  let startData = null;
  try {
    startData = await startResponse.json();
  } catch {
    startData = null;
  }

  if (!startResponse.ok) {
    if (startResponse.status === 409 && startData?.code === 'DAILY_ALREADY_PLAYED') {
      setStatus(startData?.error || 'Daily already played for this IP today.');
      await fetchDailyStatus(true);
      return;
    }
    setStatus(startData?.error || 'Game start was rejected by the server.');
    return;
  }

  const serverColors = normalizeDailyColors(startData?.colors);
  if (serverColors.length !== 5) {
    setStatus('Server returned invalid game colors. Please retry.');
    return;
  }

  state.activeGameId = String(startData?.gameId || '');
  if (!state.activeGameId) {
    setStatus('Server returned an invalid game session ID. Please retry.');
    return;
  }
  state.gameStartedAt = Number(startData?.startedAt || Date.now());
  state.gameExpiresAt = Number(startData?.expiresAt || (Date.now() + 60_000));
  state.seed = String(startData?.seed || '');
  state.mode = String(startData?.mode || state.mode);
  state.difficulty = String(startData?.difficulty || state.difficulty) === 'hard' ? 'hard' : 'easy';
  if (state.mode === 'challenge') {
    const boundCode = String(startData?.challengeCode || startPayload.challengeCode || getChallengeCodeFromUrl() || '').trim();
    if (boundCode) {
      syncChallengeUrl(boundCode, state.difficulty);
    }
  }
  state.authoritativeScore = null;
  state.colors = serverColors.map((color) => ({ ...color }));
  state.memorySeconds = state.difficulty === 'hard' ? 2 : 5;
  ui.difficultyToggle.checked = state.difficulty === 'hard';
  updateDifficultyText();

  state.guesses = [];
  state.results = [];
  state.roundIndex = 0;
  state.totalScore = 0;
  state.waitingNextRound = false;
  state.checkpointInFlight = false;
  ui.runningScore.textContent = '0.00 / 50';
  setStatus('Memorize each color one by one, then rebuild it with the sliders.');
  startMemoryRound();
}

function startMemoryRound() {
  showOnly(ui.memoryStage);
  const target = state.colors[state.roundIndex];
  ui.roundCounter.textContent = `${state.roundIndex + 1} / 5`;
  ui.memoryColorCard.style.background = hsvToCss(target.h, target.s, target.v);

  clearInterval(state.timerHandle);
  let left = state.memorySeconds;
  ui.memoryTimer.textContent = `${left}s`;
  state.timerHandle = setInterval(() => {
    left -= 1;
    ui.memoryTimer.textContent = `${left}s`;
    if (left >= 0 && left <= 3) {
      playCountdownTickSound(left);
    }
    if (left <= 0) {
      clearInterval(state.timerHandle);
      startGuessRound();
    }
  }, 1000);
}

function startGuessRound() {
  showOnly(ui.guessStage);
  state.waitingNextRound = false;
  ui.guessBoard.classList.remove('hidden');
  ui.roundFeedback.classList.add('hidden');
  ui.submitGuessBtn.disabled = false;

  ui.guessRoundCounter.textContent = `${state.roundIndex + 1} / 5`;
  ui.hueSlider.value = 180;
  ui.satSlider.value = 80;
  ui.briSlider.value = 90;
  ui.guessPreview.classList.remove('hidden');
  ui.guessActions.classList.remove('hidden');
  ui.guessControls.classList.remove('hidden');
  syncGuessBoardMetrics();
  updateGuessPreview();
  setStatus(`Color ${state.roundIndex + 1} of 5. Adjust hue, saturation, and brightness. The preview updates in real time.`);
}

async function sendRoundCheckpoint(round, guess, score) {
  if (!state.activeGameId) {
    return { ok: false, error: 'Missing active game session.', code: 'GAME_MISSING' };
  }

  const primaryBase = await resolveApiBase();
  if (!primaryBase) {
    return { ok: false, error: 'API server not found.', code: 'API_UNAVAILABLE' };
  }

  const payload = {
    gameId: state.activeGameId,
    round,
    guess: {
      h: Math.round(Number(guess?.h || 0)),
      s: Math.round(Number(guess?.s || 0)),
      v: Math.round(Number(guess?.v || 0))
    },
    score: Number(score.toFixed(2))
  };

  let response;
  try {
    response = await fetchWithTimeout(apiUrl(primaryBase, '/api/game/checkpoint'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cluster-Peers': getClusterPeerHeader()
      },
      body: JSON.stringify(payload)
    }, 2200);
  } catch {
    return { ok: false, error: 'Checkpoint request failed.', code: 'CHECKPOINT_NETWORK_ERROR' };
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (response.status === 404) {
      state.apiBase = '';
      await resolveApiBase(true);
    }
    return {
      ok: false,
      error: data?.error || 'Checkpoint rejected by server.',
      code: data?.code || null
    };
  }

  return {
    ok: true,
    acceptedScore: Number(data?.acceptedScore),
    runningScore: Number(data?.runningScore),
    payload: data
  };
}

async function submitGuess() {
  if (state.waitingNextRound || state.checkpointInFlight) return;
  unlockAudio();

  const target = state.colors[state.roundIndex];
  const guess = currentGuess();
  const result = scoreGuess(target, guess);
  const round = state.roundIndex + 1;

  state.checkpointInFlight = true;
  ui.submitGuessBtn.disabled = true;
  setStatus(`Checking round ${round} with server...`);

  const checkpoint = await sendRoundCheckpoint(round, guess, result.roundScore);
  state.checkpointInFlight = false;

  if (!checkpoint.ok) {
    playRoundRejectedSound();
    ui.submitGuessBtn.disabled = false;
    if (checkpoint.code === 'GAME_EXPIRED') {
      returnToMainMenu('Run expired. Start a new game.');
      return;
    }
    if (checkpoint.code === 'GAME_BLOCKED' || checkpoint.code === 'SCORE_MISMATCH_ROUND') {
      returnToMainMenu('Run blocked by server due to score mismatch. Start a fresh run.');
      return;
    }
    setStatus(checkpoint.error || 'Round could not be verified by server.');
    return;
  }

  const acceptedRoundScore = Number.isFinite(checkpoint.acceptedScore)
    ? checkpoint.acceptedScore
    : Number(result.roundScore.toFixed(2));
  const runningScore = Number.isFinite(checkpoint.runningScore)
    ? checkpoint.runningScore
    : Number((state.totalScore + acceptedRoundScore).toFixed(2));

  state.guesses.push(guess);
  state.results.push({
    dE: result.dE,
    roundScore: acceptedRoundScore
  });
  state.totalScore = runningScore;
  ui.runningScore.textContent = `${runningScore.toFixed(2)} / 50`;
  pulseElement(ui.runningScore);
  pulseElement(ui.feedbackSplitScore);
  playRoundAcceptedSound(acceptedRoundScore);

  state.waitingNextRound = true;
  ui.feedbackTargetSwatch.style.background = hsvToCss(target.h, target.s, target.v);
  ui.feedbackGuessSwatch.style.background = hsvToCss(guess.h, guess.s, guess.v);
  ui.feedbackSplitScore.textContent = acceptedRoundScore.toFixed(2);
  const scoreModelLabel = result.model === 'ciede2000' ? 'CIEDE2000' : 'CIE76';
  ui.roundFeedbackText.textContent = `Round ${round} score: ${acceptedRoundScore.toFixed(2)} / 10 (DeltaE ${result.dE.toFixed(2)} ${scoreModelLabel}).`;
  ui.guessBoard.classList.add('hidden');
  ui.roundFeedback.classList.remove('hidden');
  ui.guessPreview.classList.add('hidden');
  ui.guessActions.classList.add('hidden');
  ui.guessControls.classList.add('hidden');
  ui.submitGuessBtn.disabled = true;
  setStatus(`Validated round ${round}. Compare your color with the original, then continue.`);
}

function goNextRound() {
  if (!state.waitingNextRound) return;
  unlockAudio();
  playTone({ frequency: 360, duration: 0.07, type: 'sine', gain: 0.016 });
  state.roundIndex += 1;
  if (state.roundIndex < 5) {
    startMemoryRound();
  } else {
    finishRun();
  }
}

function finishRun() {
  showOnly(ui.finalStage);
  ui.runningScore.textContent = `${state.totalScore.toFixed(2)} / 50`;
  pulseElement(ui.runningScore);
  ui.finalSummary.textContent = `${getDisplayName()} finished ${formatModeLabel(state.mode)} on ${state.difficulty} with ${state.totalScore.toFixed(2)} / 50.`;
  ui.finalRankText.textContent = 'Classement: calculating...';
  ui.finalLeaderboard.innerHTML = '';
  ui.roundBreakdown.innerHTML = '';
  if (ui.resultAnalytics) ui.resultAnalytics.innerHTML = '';

  state.colors.forEach((target, index) => {
    const guess = state.guesses[index];
    const result = state.results[index];
    const tile = document.createElement('div');
    tile.className = 'comparison-tile';
    tile.style.setProperty('--tile-delay', `${index * 65}ms`);
    tile.innerHTML = `
      <div class="tile-score">${result.roundScore.toFixed(2)} / 10</div>
      <div class="tile-compare" aria-label="Round ${index + 1} original and your color comparison">
        <div class="tile-half tile-original" style="background:${hsvToCss(target.h, target.s, target.v)}"></div>
        <div class="tile-half tile-guess" style="background:${hsvToCss(guess.h, guess.s, guess.v)}"></div>
        <div class="tile-diagonal" aria-hidden="true"></div>
      </div>
      <div class="tile-metric">DeltaE ${result.dE.toFixed(2)}</div>
    `;
    ui.roundBreakdown.appendChild(tile);
    requestAnimationFrame(() => {
      tile.classList.add('is-revealed');
    });
  });

  renderResultAnalytics();

  saveScoreToServer().then((result) => {
    const serverScore = Number(result?.savedEntry?.score);
    if (Number.isFinite(serverScore)) {
      state.totalScore = serverScore;
      state.authoritativeScore = serverScore;
      ui.runningScore.textContent = `${serverScore.toFixed(2)} / 50`;
      ui.finalSummary.textContent = `${getDisplayName()} finished ${formatModeLabel(state.mode)} on ${state.difficulty} with ${serverScore.toFixed(2)} / 50.`;
      ui.scoreJoke.textContent = getScoreJoke(serverScore);
      pulseElement(ui.runningScore);
      playSavedRunSound(serverScore);
    } else {
      ui.scoreJoke.textContent = getScoreJoke(state.totalScore);
    }
    renderFinalClassement(result?.board, result?.rank);
    const totalEntries = Number(state.latestLeaderboardSummary?.totalEntries);
    renderResultAnalytics({
      rank: Number(result?.rank),
      totalEntries: Number.isFinite(totalEntries) && totalEntries > 0
        ? totalEntries
        : (Array.isArray(result?.board) ? result.board.length : 0)
    });
  });
  ui.scoreJoke.textContent = 'Verifying score with server...';
  setStatus('Finished. This page compares all 5 colors and shows the sum of the scores.');
}

function returnToMainMenu(statusMessage = 'Choose the game details, then start the run.') {
  showOnly(ui.setupStage);
  ui.roundFeedback.classList.add('hidden');
  ui.guessBoard.classList.remove('hidden');
  ui.guessPreview.classList.remove('hidden');
  ui.guessActions.classList.remove('hidden');
  ui.guessControls.classList.remove('hidden');
  state.waitingNextRound = false;
  state.checkpointInFlight = false;
  state.activeGameId = '';
  state.gameStartedAt = 0;
  state.gameExpiresAt = 0;
  state.authoritativeScore = null;
  ui.finalRankText.textContent = 'Classement: -';
  ui.finalLeaderboard.innerHTML = '';
  if (ui.resultAnalytics) ui.resultAnalytics.innerHTML = '';
  setStatus(statusMessage);
}

async function refreshChallengeBoard(primaryBase) {
  const challengeCode = getChallengeCodeFromUrl();
  if (!challengeCode) {
    state.latestChallengeBoard = [];
    if (state.classementFilter === 'challenge') {
      renderMenuClassement(state.latestBoard);
    }
    ui.challengeBoard.innerHTML = '<p class="muted">Create a multiplayer page to get a dedicated challenge classement.</p>';
    return [];
  }

  if (!primaryBase) {
    state.latestChallengeBoard = [];
    if (state.classementFilter === 'challenge') {
      renderMenuClassement(state.latestBoard);
    }
    ui.challengeBoard.innerHTML = '<p class="muted">Challenge classement unavailable: API server not found.</p>';
    return [];
  }

  try {
    const response = await fetchWithTimeout(
      apiUrl(primaryBase, `/api/challenges/${encodeURIComponent(challengeCode)}/scores?limit=100`),
      {
        headers: {
          'X-Cluster-Peers': getClusterPeerHeader()
        }
      }
    );

    if (!response.ok) {
      ui.challengeBoard.innerHTML = '<p class="muted">This backend does not support dedicated challenge pages yet.</p>';
      state.latestChallengeBoard = [];
      if (state.classementFilter === 'challenge') {
        renderMenuClassement(state.latestBoard);
      }
      return [];
    }

    const payload = await response.json();
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    state.latestChallengeBoard = entries;
    ui.challengeBoard.innerHTML = entries.length ? '' : '<p class="muted">No score yet for this multiplayer page.</p>';
    entries.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'leader-row';
      const safeName = escapeHtml(entry?.name || 'Player');
      const safeScore = Number(entry?.score);
      row.innerHTML = `<div class="rank-badge">${i + 1}</div><div><strong>${safeName}</strong><div class="muted">Multiplayer page</div></div><strong>${(Number.isFinite(safeScore) ? safeScore : 0).toFixed(2)}</strong>`;
      ui.challengeBoard.appendChild(row);
    });
    if (state.classementFilter === 'challenge') {
      renderMenuClassement(state.latestBoard);
    }
    return entries;
  } catch {
    state.latestChallengeBoard = [];
    if (state.classementFilter === 'challenge') {
      renderMenuClassement(state.latestBoard);
    }
    ui.challengeBoard.innerHTML = '<p class="muted">Challenge classement unavailable right now.</p>';
    return [];
  }
}

async function refreshBoards() {
  const primaryBase = await resolveApiBase();
  let board = [];
  state.latestLeaderboardSummary = null;
  if (primaryBase) {
    try {
      if (state.leaderboardEndpointSupported === true) {
        const response = await fetchWithTimeout(apiUrl(primaryBase, '/api/leaderboard?limit=100'), {
          headers: {
            'X-Cluster-Peers': getClusterPeerHeader()
          }
        });
        if (response.ok) {
          state.leaderboardEndpointSupported = true;
          const payload = await response.json();
          const rows = Array.isArray(payload?.entries) ? payload.entries : [];
          board = mergeBoards([rows]);
          state.latestLeaderboardSummary = payload?.summary || null;
        } else if (response.status === 404) {
          state.leaderboardEndpointSupported = false;
        }
      }

      if (!board.length) {
        const fallback = await fetchWithTimeout(apiUrl(primaryBase, '/api/scores?limit=100'), {
          headers: {
            'X-Cluster-Peers': getClusterPeerHeader()
          }
        });
        if (!fallback.ok) {
          if (fallback.status === 404) {
            state.apiBase = '';
            await resolveApiBase(true);
          }
          throw new Error('leaderboard request failed');
        }
        const rows = await fallback.json();
        board = mergeBoards([rows]);
      }
    } catch {
      board = [];
      state.latestLeaderboardSummary = null;
    }
  }

  const publicBoard = board.filter((entry) => String(entry?.mode || '').toLowerCase() !== 'challenge');
  state.latestBoard = publicBoard;
  renderLeaderRows(ui.leaderboard, publicBoard, 'No scores yet.', 10);
  renderMenuClassement(publicBoard);
  await refreshChallengeBoard(primaryBase);

  if (!primaryBase) {
    setStatus('API not found. Start the backend server on port 3000 or 3001, or open with ?api=http://192.168.1.32:3000');
  }

  return publicBoard;
}

async function ensurePlayerNameForSave() {
  let name = state.playerName.trim();
  while (!name) {
    const typed = window.prompt('Please enter your name to save your score:', '');
    if (typed === null) {
      setStatus('Score was not saved. A player name is required.');
      return null;
    }
    name = typed.trim();
  }
  state.playerName = name;
  ui.playerName.value = name;
  syncPlayerNameCookie();
  return name;
}

async function saveScoreToServer() {
  const boardForCurrentMode = (board) => (
    state.mode === 'challenge' ? state.latestChallengeBoard : board
  );

  const name = await ensurePlayerNameForSave();
  if (!name) {
    const board = await refreshBoards();
    return { board: boardForCurrentMode(board), rank: null, saved: false };
  }

  if (!state.activeGameId) {
    setStatus('Score was not saved because no active server game session exists.');
    const board = await refreshBoards();
    return { board: boardForCurrentMode(board), rank: null, saved: false };
  }

  const payload = {
    gameId: state.activeGameId,
    name
  };

  const primaryBase = await resolveApiBase();
  if (!primaryBase) {
    setStatus('Score was not saved. API server not found.');
    const board = await refreshBoards();
    return { board: boardForCurrentMode(board), rank: null, saved: false };
  }

  try {
    const response = await fetchWithTimeout(apiUrl(primaryBase, '/api/game/submit'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cluster-Peers': getClusterPeerHeader()
      },
      body: JSON.stringify(payload)
    }, 2000);
    if (!response.ok) {
      let payloadError = null;
      try {
        payloadError = await response.json();
      } catch {
        payloadError = null;
      }

      if (response.status === 404) {
        state.apiBase = '';
        await resolveApiBase(true);
      }
      if (response.status === 409 && payloadError?.code === 'DAILY_ALREADY_PLAYED') {
        setStatus(payloadError.error || 'Daily already played for this IP today.');
        await fetchDailyStatus(true);
        const board = await refreshBoards();
        return { board: boardForCurrentMode(board), rank: null, saved: false };
      }
      if (payloadError?.code === 'GAME_EXPIRED') {
        setStatus('Run expired before submit. Please start a new game.');
        const board = await refreshBoards();
        return { board: boardForCurrentMode(board), rank: null, saved: false };
      }
      if (payloadError?.code === 'GAME_ALREADY_SUBMITTED') {
        setStatus('This run was already submitted.');
        const board = await refreshBoards();
        return { board: boardForCurrentMode(board), rank: null, saved: false };
      }
      if (payloadError?.code === 'GAME_INCOMPLETE') {
        setStatus('Run is incomplete. Every round must be validated first.');
        const board = await refreshBoards();
        return { board: boardForCurrentMode(board), rank: null, saved: false };
      }
      if (payloadError?.code === 'SCORE_MISMATCH_FINAL' || payloadError?.code === 'GAME_BLOCKED') {
        playRoundRejectedSound();
        setStatus('Server blocked this run because scores do not match checkpoints.');
        const board = await refreshBoards();
        return { board: boardForCurrentMode(board), rank: null, saved: false };
      }
      playRoundRejectedSound();
      throw new Error(payloadError?.error || 'save failed');
    }
    const savedPayload = await response.json();
    state.activeGameId = '';
    setStatus('Score verified by server and saved to classement.');
    if (state.mode === 'daily') {
      await fetchDailyStatus(true);
    }
    const board = await refreshBoards();
    const scopedBoard = boardForCurrentMode(board);
    const apiRank = Number(savedPayload?.rank);
    if (Number.isFinite(apiRank) && apiRank > 0) {
      return { board: scopedBoard, rank: apiRank, saved: true, savedEntry: savedPayload };
    }
    const rank = scopedBoard.findIndex((entry) =>
      entry.name === name && Number(entry.score) === Number(savedPayload?.score)
    );
    return { board: scopedBoard, rank: rank >= 0 ? rank + 1 : null, saved: true, savedEntry: savedPayload };
  } catch {
    playRoundRejectedSound();
    setStatus('Score was not saved. Server is unavailable.');
    const board = await refreshBoards();
    return { board: boardForCurrentMode(board), rank: null, saved: false };
  }
}

function renderFinalClassement(board, rank) {
  const safeBoard = Array.isArray(board) ? board : [];
  const top = safeBoard.slice(0, 10);
  ui.finalLeaderboard.innerHTML = top.length ? '' : '<p class="muted">No classement available yet.</p>';

  top.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'leader-row';
    const safeScore = Number(entry.score);
    const safeName = escapeHtml(entry?.name || 'Player');
    const safeMode = escapeHtml(formatModeLabel(String(entry?.mode || 'solo')));
    const safeDifficulty = escapeHtml(String(entry?.difficulty || 'easy'));
    row.innerHTML = `<div class="rank-badge">${i + 1}</div><div><strong>${safeName}</strong><div class="muted">${safeMode} | ${safeDifficulty}</div></div><strong>${(Number.isFinite(safeScore) ? safeScore : 0).toFixed(2)}</strong>`;
    ui.finalLeaderboard.appendChild(row);
  });

  if (Number.isFinite(rank) && rank > 0) {
    ui.finalRankText.textContent = `Classement: #${rank}`;
    return;
  }

  const fallbackRank = safeBoard.findIndex((entry) =>
    entry.name === state.playerName && Number(entry.score) === Number(state.totalScore.toFixed(2))
  );
  ui.finalRankText.textContent = fallbackRank >= 0 ? `Classement: #${fallbackRank + 1}` : 'Classement: saved';
}

function createChallengeLink() {
  const difficulty = ui.difficultyToggle.checked ? 'hard' : 'easy';
  const code = generateChallengeCode();
  const url = buildChallengePageUrl(code, difficulty);
  modeRadios.forEach((radio) => {
    radio.checked = radio.value === 'challenge';
  });
  history.replaceState({}, '', url.toString());
  refreshChallengeShareLink(code, difficulty);
  updateChallengePageClass();
  refreshBoards();
  setStatus('Multiplayer page created. Copy and share this dedicated link.');
}

function toggleMenuClassement() {
  const willShow = ui.menuClassement.classList.contains('hidden');
  setClassementVisible(willShow);
  if (willShow) {
    renderMenuClassement();
  }
}

async function copyChallenge() {
  if (!state.challengeLink) {
    createChallengeLink();
  }
  if (!state.challengeLink) return;
  try {
    await navigator.clipboard.writeText(state.challengeLink);
    setStatus('Challenge link copied to clipboard.');
  } catch {
    setStatus(`Copy failed. Link: ${state.challengeLink}`);
  }
}

[ui.hueSlider, ui.satSlider, ui.briSlider].forEach((el) => el.addEventListener('input', updateGuessPreview));
window.addEventListener('resize', syncGuessBoardMetrics);
ui.playerName.addEventListener('input', syncPlayerNameCookie);

ui.difficultyToggle.addEventListener('change', updateDifficultyText);
modeRadios.forEach((radio) => radio.addEventListener('change', () => {
  if (radio.value === 'daily') {
    setStatus('Daily mode locks in one game per calendar day.');
  } else if (radio.value === 'challenge' && radio.checked) {
    setStatus('Challenge mode uses a dedicated multiplayer page with its own leaderboard.');
    setClassementFilter('challenge');
  } else if (radio.value === 'solo' && radio.checked) {
    if (state.classementFilter === 'challenge') {
      setClassementFilter('solo');
    }
  }
}));

ui.startBtn.addEventListener('click', startGame);
ui.toggleClassementBtn.addEventListener('click', toggleMenuClassement);
ui.closeClassementBtn.addEventListener('click', () => setClassementVisible(false));
ui.classementFilterSolo.addEventListener('click', () => setClassementFilter('solo'));
ui.classementFilterDaily.addEventListener('click', () => setClassementFilter('daily'));
if (ui.classementFilterChallenge) {
  ui.classementFilterChallenge.addEventListener('click', () => setClassementFilter('challenge'));
}
ui.submitGuessBtn.addEventListener('click', submitGuess);
ui.nextRoundBtn.addEventListener('click', goNextRound);
ui.restartBtn.addEventListener('click', startGame);
ui.mainMenuBtn.addEventListener('click', returnToMainMenu);
ui.createChallengeBtn.addEventListener('click', createChallengeLink);
ui.copyChallengeBtn.addEventListener('click', copyChallenge);
ui.themeToggleBtn.addEventListener('click', toggleTheme);
if (ui.soundToggleBtn) {
  ui.soundToggleBtn.addEventListener('click', toggleSound);
}

initFromUrl();
updateChallengePageClass();
loadIdentityFromCookies();
loadSoundPreference();
updateDifficultyText();
initTheme();
setClassementFilter(isChallengeContextActive() ? 'challenge' : 'solo');
refreshBoards();
refreshIdentityIpCookie();
fetchDailyStatus();
updateGuessPreview();
document.body.dataset.stage = ui.setupStage.id;
syncGuessBoardMetrics();
