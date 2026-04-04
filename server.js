
const path = require('path');
const { createHash, randomBytes, randomUUID } = require('crypto');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const {
  createRandomDailyColors,
  getUtcDayKey,
  parseDailyColors,
  serializeDailyColors
} = require('./daily-service');

const app = express();

const INITIAL_PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PORT_SCAN_LIMIT = Math.max(1, Number(process.env.PORT_SCAN_LIMIT) || 20);
const EXPLICIT_PORT = typeof process.env.PORT === 'string' && process.env.PORT.trim() !== '';
const SQLITE_DB_PATH = path.resolve(
  process.env.SCORE_DB_PATH
  || process.env.ACCESS_DB_PATH
  || path.join(__dirname, 'scores.db')
);

const SCORE_ALLOWED_MODES = new Set(['solo', 'challenge', 'daily']);
const SCORE_ALLOWED_DIFFICULTIES = new Set(['easy', 'hard']);
const PLAYER_NAME_REGEX = /^[A-Za-z0-9 _-]+$/;
const PLAYER_NAME_MIN_LENGTH = 2;
const PLAYER_NAME_MAX_LENGTH = 20;
const SCORE_MIN = 0;
const SCORE_MAX = 50;
const SCORE_MAX_DECIMALS = 2;

const GAME_ROUND_COUNT = 5;
const GAME_START_ALLOWED_FIELDS = new Set(['mode', 'difficulty', 'challengeCode']);
const GAME_START_REQUIRED_FIELDS = ['mode', 'difficulty'];
const GAME_CHECKPOINT_ALLOWED_FIELDS = new Set(['gameId', 'round', 'guess', 'score']);
const GAME_CHECKPOINT_REQUIRED_FIELDS = ['gameId', 'round', 'guess', 'score'];
const GAME_SUBMIT_ALLOWED_FIELDS = new Set(['gameId', 'name']);
const GAME_SUBMIT_REQUIRED_FIELDS = ['gameId', 'name'];
const CHALLENGE_CODE_REGEX = /^[A-Za-z0-9_-]{6,120}$/;
const GAME_ID_REGEX = /^[A-Za-z0-9-]{16,128}$/;
const ROUND_SCORE_MIN = 0;
const ROUND_SCORE_MAX = 10;

const RAW_GAME_TTL_MS = Number(process.env.GAME_SESSION_TTL_MS || 10 * 60_000);
const GAME_TTL_MS = Math.max(30_000, Math.min(60 * 60_000, RAW_GAME_TTL_MS));
const GAME_EXPIRED_GRACE_MS = Math.max(60_000, Number(process.env.GAME_EXPIRED_GRACE_MS) || 5 * 60_000);
const GAME_STORE_MAX_ACTIVE = Math.max(100, Number(process.env.GAME_STORE_MAX_ACTIVE) || 5000);

const GAME_START_WINDOW_MS = Number(process.env.GAME_START_WINDOW_MS || 60_000);
const GAME_START_MAX_REQUESTS = Number(process.env.GAME_START_MAX_REQUESTS || 20);
const GAME_CHECKPOINT_WINDOW_MS = Number(process.env.GAME_CHECKPOINT_WINDOW_MS || 60_000);
const GAME_CHECKPOINT_MAX_REQUESTS = Number(process.env.GAME_CHECKPOINT_MAX_REQUESTS || 60);
const GAME_SUBMIT_WINDOW_MS = Number(process.env.GAME_SUBMIT_WINDOW_MS || 60_000);
const GAME_SUBMIT_MAX_REQUESTS = Number(process.env.GAME_SUBMIT_MAX_REQUESTS || 30);

let activePort = INITIAL_PORT;
let db;
const schemaState = {
  hasCreatedAt: false,
  hasChallengeCode: false
};

const activeGameSessions = new Map();
const gameStartRateLimitStore = new Map();
const gameCheckpointRateLimitStore = new Map();
const gameSubmitRateLimitStore = new Map();

const configuredCorsOrigins = new Set(
  String(process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

app.use(express.json({ limit: '10kb' }));
app.use(express.static(__dirname));

function isAllowedCorsOrigin(origin, req) {
  if (!origin) return true;

  const sameOrigin = `${req.protocol}://${req.get('host')}`;
  if (origin === sameOrigin) return true;

  if (configuredCorsOrigins.size > 0) {
    return configuredCorsOrigins.has(origin);
  }

  // Secure default: allow only same-origin unless FRONTEND_ORIGIN(S) is configured.
  return false;
}

function sendJsonError(res, statusCode, error, detail, code = null) {
  res.status(statusCode).json({
    error: String(error || 'Request failed'),
    code: code || null,
    detail: detail ? String(detail) : ''
  });
}

function createValidationError(error, detail) {
  const issue = new Error(error);
  issue.statusCode = 400;
  issue.code = 'VALIDATION_ERROR';
  issue.detail = detail || '';
  return issue;
}

function assertObjectPayload(payload, payloadLabel) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createValidationError(
      `Invalid ${payloadLabel} payload.`,
      'Body must be a JSON object.'
    );
  }
}

function assertFieldPolicy(payload, { allowedFields, requiredFields, payloadLabel }) {
  const keys = Object.keys(payload);
  const missing = requiredFields.filter((field) => !keys.includes(field));
  if (missing.length) {
    throw createValidationError(
      `Missing required field(s) in ${payloadLabel} payload.`,
      `Required fields: ${requiredFields.join(', ')}. Missing: ${missing.join(', ')}`
    );
  }

  const unexpected = keys.filter((field) => !allowedFields.has(field));
  if (unexpected.length) {
    throw createValidationError(
      `Unexpected field(s) in ${payloadLabel} payload.`,
      `Allowed fields: ${Array.from(allowedFields).join(', ')}. Unexpected: ${unexpected.join(', ')}`
    );
  }
}

function normalizeSafeName(rawName) {
  const trimmed = String(rawName || '').trim();
  if (trimmed.length < PLAYER_NAME_MIN_LENGTH || trimmed.length > PLAYER_NAME_MAX_LENGTH) {
    throw createValidationError(
      'Invalid player name length.',
      `Name length must be between ${PLAYER_NAME_MIN_LENGTH} and ${PLAYER_NAME_MAX_LENGTH}.`
    );
  }

  if (!PLAYER_NAME_REGEX.test(trimmed)) {
    throw createValidationError(
      'Invalid player name characters.',
      'Allowed characters: letters, digits, spaces, underscores, hyphens.'
    );
  }

  return trimmed;
}

function normalizeSafeMode(rawMode) {
  const value = String(rawMode || '').trim().toLowerCase();
  if (!SCORE_ALLOWED_MODES.has(value)) {
    throw createValidationError(
      'Invalid mode.',
      `Mode must be one of: ${Array.from(SCORE_ALLOWED_MODES).join(', ')}.`
    );
  }
  return value;
}

function normalizeSafeDifficulty(rawDifficulty) {
  const value = String(rawDifficulty || '').trim().toLowerCase();
  if (!SCORE_ALLOWED_DIFFICULTIES.has(value)) {
    throw createValidationError(
      'Invalid difficulty.',
      `Difficulty must be one of: ${Array.from(SCORE_ALLOWED_DIFFICULTIES).join(', ')}.`
    );
  }
  return value;
}

function normalizeOptionalMode(rawMode) {
  const value = String(rawMode || '').trim().toLowerCase();
  if (!value) return '';
  if (!SCORE_ALLOWED_MODES.has(value)) {
    throw createValidationError(
      'Invalid mode filter.',
      `mode must be one of: ${Array.from(SCORE_ALLOWED_MODES).join(', ')}.`
    );
  }
  return value;
}

function normalizeOptionalDifficulty(rawDifficulty) {
  const value = String(rawDifficulty || '').trim().toLowerCase();
  if (!value) return '';
  if (!SCORE_ALLOWED_DIFFICULTIES.has(value)) {
    throw createValidationError(
      'Invalid difficulty filter.',
      `difficulty must be one of: ${Array.from(SCORE_ALLOWED_DIFFICULTIES).join(', ')}.`
    );
  }
  return value;
}

function normalizeSafeScore(rawScore) {
  const numeric = Number(rawScore);
  if (!Number.isFinite(numeric)) {
    throw createValidationError('Invalid score.', 'Score must be numeric.');
  }

  if (numeric < SCORE_MIN || numeric > SCORE_MAX) {
    throw createValidationError(
      'Score out of bounds.',
      `Score must be between ${SCORE_MIN} and ${SCORE_MAX}.`
    );
  }

  const rounded = roundTo(numeric, SCORE_MAX_DECIMALS);
  if (Math.abs(rounded - numeric) > Number.EPSILON) {
    throw createValidationError(
      'Invalid score precision.',
      `Score can have at most ${SCORE_MAX_DECIMALS} decimal places.`
    );
  }

  return rounded;
}

function normalizeSafeRoundScore(rawScore) {
  const numeric = Number(rawScore);
  if (!Number.isFinite(numeric)) {
    throw createValidationError('Invalid round score.', 'Round score must be numeric.');
  }

  if (numeric < ROUND_SCORE_MIN || numeric > ROUND_SCORE_MAX) {
    throw createValidationError(
      'Round score out of bounds.',
      `Round score must be between ${ROUND_SCORE_MIN} and ${ROUND_SCORE_MAX}.`
    );
  }

  const rounded = roundTo(numeric, SCORE_MAX_DECIMALS);
  if (Math.abs(rounded - numeric) > Number.EPSILON) {
    throw createValidationError(
      'Invalid round score precision.',
      `Round score can have at most ${SCORE_MAX_DECIMALS} decimal places.`
    );
  }

  return rounded;
}

function normalizeRoundNumber(rawRound) {
  const round = Number(rawRound);
  if (!Number.isInteger(round) || round < 1 || round > GAME_ROUND_COUNT) {
    throw createValidationError(
      'Invalid round index.',
      `round must be an integer between 1 and ${GAME_ROUND_COUNT}.`
    );
  }
  return round;
}

function normalizeSafeGameId(rawGameId) {
  const value = String(rawGameId || '').trim();
  if (!GAME_ID_REGEX.test(value)) {
    throw createValidationError(
      'Invalid gameId format.',
      'gameId is malformed.'
    );
  }
  return value;
}

function normalizeChallengeCode(rawCode) {
  const value = String(rawCode || '').trim();
  if (!value) return '';
  if (!CHALLENGE_CODE_REGEX.test(value)) {
    throw createValidationError(
      'Invalid challengeCode format.',
      'challengeCode must be 6-120 chars with letters, digits, underscores, or hyphens.'
    );
  }
  return value;
}

function normalizeRequiredChallengeCode(rawCode, label = 'challengeCode') {
  const value = normalizeChallengeCode(rawCode);
  if (!value) {
    throw createValidationError(
      `Missing ${label}.`,
      `${label} is required for multiplayer challenge pages.`
    );
  }
  return value;
}

function sanitizeStoredName(rawName) {
  const trimmed = String(rawName || '').trim().slice(0, PLAYER_NAME_MAX_LENGTH);
  if (!trimmed) return 'Player';
  if (PLAYER_NAME_REGEX.test(trimmed)) return trimmed;
  const scrubbed = trimmed.replace(/[^A-Za-z0-9 _-]/g, '').trim();
  return scrubbed.length >= PLAYER_NAME_MIN_LENGTH ? scrubbed : 'Player';
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeColor(color, label) {
  const h = Number(color?.h);
  const s = Number(color?.s);
  const v = Number(color?.v);

  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(v)) {
    throw createValidationError(
      `Invalid ${label}.`,
      `${label} must include numeric h, s, and v channels.`
    );
  }

  if (!Number.isInteger(h) || h < 0 || h > 360) {
    throw createValidationError(
      `Invalid ${label}.h`,
      `${label}.h must be an integer between 0 and 360.`
    );
  }
  if (!Number.isInteger(s) || s < 0 || s > 100) {
    throw createValidationError(
      `Invalid ${label}.s`,
      `${label}.s must be an integer between 0 and 100.`
    );
  }
  if (!Number.isInteger(v) || v < 0 || v > 100) {
    throw createValidationError(
      `Invalid ${label}.v`,
      `${label}.v must be an integer between 0 and 100.`
    );
  }

  return { h, s, v };
}

function normalizeStrictGuess(rawGuess, round) {
  assertObjectPayload(rawGuess, `guess #${round}`);
  const keys = Object.keys(rawGuess);
  const required = ['h', 's', 'v'];
  const allowed = new Set(required);
  const missing = required.filter((field) => !keys.includes(field));
  if (missing.length) {
    throw createValidationError(
      `Missing guess field(s) at round ${round}.`,
      `Missing: ${missing.join(', ')}`
    );
  }
  const unexpected = keys.filter((field) => !allowed.has(field));
  if (unexpected.length) {
    throw createValidationError(
      `Unexpected guess field(s) at round ${round}.`,
      `Unexpected: ${unexpected.join(', ')}`
    );
  }
  return normalizeColor(rawGuess, `guess #${round}`);
}

function mulberry32(seed) {
  return function nextRand() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(rawSeed) {
  let h = 2166136261;
  for (let i = 0; i < rawSeed.length; i += 1) {
    h ^= rawSeed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createSeededColors(seed, difficulty) {
  const rand = mulberry32(hashSeed(`${seed}|${difficulty}`));
  return Array.from({ length: GAME_ROUND_COUNT }, () => {
    const h = Math.floor(rand() * 361);
    let s = difficulty === 'easy' ? 42 + Math.floor(rand() * 54) : 18 + Math.floor(rand() * 78);
    let v = difficulty === 'easy' ? 45 + Math.floor(rand() * 45) : 22 + Math.floor(rand() * 70);
    if (difficulty === 'hard' && rand() > 0.55) {
      s = 5 + Math.floor(rand() * 22);
    }
    return { h, s, v };
  });
}

function hsvToRgb(h, s, v) {
  const scaledS = s / 100;
  const scaledV = v / 100;
  const c = scaledV * scaledS;
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

  const m = scaledV - c;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

function rgbToXyz(rgb) {
  let rr = rgb.r / 255;
  let gg = rgb.g / 255;
  let bb = rgb.b / 255;

  rr = rr > 0.04045 ? ((rr + 0.055) / 1.055) ** 2.4 : rr / 12.92;
  gg = gg > 0.04045 ? ((gg + 0.055) / 1.055) ** 2.4 : gg / 12.92;
  bb = bb > 0.04045 ? ((bb + 0.055) / 1.055) ** 2.4 : bb / 12.92;

  rr *= 100;
  gg *= 100;
  bb *= 100;

  return {
    x: (rr * 0.4124) + (gg * 0.3576) + (bb * 0.1805),
    y: (rr * 0.2126) + (gg * 0.7152) + (bb * 0.0722),
    z: (rr * 0.0193) + (gg * 0.1192) + (bb * 0.9505)
  };
}

function xyzToLab(xyz) {
  let xx = xyz.x / 95.047;
  let yy = xyz.y / 100.0;
  let zz = xyz.z / 108.883;

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : ((7.787 * t) + (16 / 116)));
  xx = f(xx);
  yy = f(yy);
  zz = f(zz);

  return {
    l: (116 * yy) - 16,
    a: 500 * (xx - yy),
    b: 200 * (yy - zz)
  };
}

function colorToLab(color) {
  return xyzToLab(rgbToXyz(hsvToRgb(color.h, color.s, color.v)));
}

function radians(degrees) {
  return (degrees * Math.PI) / 180;
}

function degrees(radiansValue) {
  return (radiansValue * 180) / Math.PI;
}

function deltaE2000(lab1, lab2) {
  // CIEDE2000 implementation (kL = kC = kH = 1 for graphics use).
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

function computeRoundScore(target, guess) {
  const dE = deltaE2000(colorToLab(target), colorToLab(guess));
  const base = 10 / (1 + ((dE / 38) ** 1.6));
  const hueDiff = hueDifference(target.h, guess.h);
  const vividness = (target.s + guess.s) / 200;
  const recovery = hueDiff <= 18 ? (1 - (hueDiff / 18)) * 1.15 * vividness : 0;
  const penalty = (hueDiff > 42 && vividness > 0.35)
    ? ((hueDiff - 42) / 138) * 2.2 * vividness
    : 0;
  const roundScore = clamp(base + recovery - penalty, 0, 10);

  return {
    dE,
    roundScore
  };
}

function createGameId() {
  if (typeof randomUUID === 'function') {
    return randomUUID();
  }
  return randomBytes(16).toString('hex');
}

function createServerSeed({ mode, difficulty, challengeCode }) {
  if (mode === 'daily') {
    const dateKey = getUtcDayKey();
    const digest = createHash('sha256')
      .update(`daily|${dateKey}|${difficulty}`)
      .digest('hex');
    return `daily|${dateKey}|${digest.slice(0, 16)}`;
  }

  if (mode === 'challenge' && challengeCode) {
    const digest = createHash('sha256')
      .update(`challenge|${difficulty}|${challengeCode}`)
      .digest('hex');
    return `challenge|${digest.slice(0, 24)}`;
  }

  return `${mode}|${randomBytes(16).toString('hex')}`;
}

function normalizeTargetColors(rawColors) {
  if (!Array.isArray(rawColors) || rawColors.length !== GAME_ROUND_COUNT) {
    throw new Error(`Target colors must contain exactly ${GAME_ROUND_COUNT} entries.`);
  }
  return rawColors.map((color, index) => normalizeColor(color, `target #${index + 1}`));
}

function pruneRateLimitStore(store, nowMs) {
  if (store.size <= 1000) return;
  for (const [key, value] of store) {
    if (nowMs >= value.resetAt) {
      store.delete(key);
    }
  }
}

function createIpRateLimitMiddleware({
  store,
  windowMs,
  maxRequests,
  errorMessage,
  code
}) {
  const safeWindowMs = Math.max(1_000, Number(windowMs) || 60_000);
  const safeMaxRequests = Math.max(1, Number(maxRequests) || 10);

  return (req, res, next) => {
    const ip = getClientIp(req);
    const nowMs = Date.now();
    const active = store.get(ip);

    if (!active || nowMs >= active.resetAt) {
      store.set(ip, { count: 1, resetAt: nowMs + safeWindowMs });
    } else {
      active.count += 1;
      if (active.count > safeMaxRequests) {
        const retryAfterSeconds = Math.max(1, Math.ceil((active.resetAt - nowMs) / 1000));
        res.setHeader('Retry-After', String(retryAfterSeconds));
        sendJsonError(
          res,
          429,
          errorMessage,
          `Rate limit: ${safeMaxRequests} requests per ${Math.floor(safeWindowMs / 1000)} seconds.`,
          code
        );
        return;
      }
    }

    pruneRateLimitStore(store, nowMs);
    next();
  };
}

const applyGameStartRateLimit = createIpRateLimitMiddleware({
  store: gameStartRateLimitStore,
  windowMs: GAME_START_WINDOW_MS,
  maxRequests: GAME_START_MAX_REQUESTS,
  errorMessage: 'Too many game start requests. Please wait and try again.',
  code: 'GAME_START_RATE_LIMITED'
});

const applyGameCheckpointRateLimit = createIpRateLimitMiddleware({
  store: gameCheckpointRateLimitStore,
  windowMs: GAME_CHECKPOINT_WINDOW_MS,
  maxRequests: GAME_CHECKPOINT_MAX_REQUESTS,
  errorMessage: 'Too many round checkpoint requests. Please wait and try again.',
  code: 'GAME_CHECKPOINT_RATE_LIMITED'
});

const applyGameSubmitRateLimit = createIpRateLimitMiddleware({
  store: gameSubmitRateLimitStore,
  windowMs: GAME_SUBMIT_WINDOW_MS,
  maxRequests: GAME_SUBMIT_MAX_REQUESTS,
  errorMessage: 'Too many game submit requests. Please wait and try again.',
  code: 'GAME_SUBMIT_RATE_LIMITED'
});

function pruneExpiredGameSessions(nowMs = Date.now()) {
  for (const [gameId, session] of activeGameSessions) {
    if (nowMs >= (session.expiresAtMs + GAME_EXPIRED_GRACE_MS)) {
      activeGameSessions.delete(gameId);
    }
  }

  if (activeGameSessions.size <= GAME_STORE_MAX_ACTIVE) return;

  const ordered = Array.from(activeGameSessions.entries())
    .sort((a, b) => a[1].startedAtMs - b[1].startedAtMs);

  const toRemove = activeGameSessions.size - GAME_STORE_MAX_ACTIVE;
  for (let i = 0; i < toRemove; i += 1) {
    activeGameSessions.delete(ordered[i][0]);
  }
}

function validateGameStartPayload(payload) {
  assertObjectPayload(payload, 'game start');
  assertFieldPolicy(payload, {
    allowedFields: GAME_START_ALLOWED_FIELDS,
    requiredFields: GAME_START_REQUIRED_FIELDS,
    payloadLabel: 'game start'
  });

  const safeMode = normalizeSafeMode(payload.mode);
  const safeDifficulty = normalizeSafeDifficulty(payload.difficulty);
  const challengeCode = normalizeChallengeCode(payload.challengeCode);

  if (safeMode !== 'challenge' && challengeCode) {
    throw createValidationError(
      'Invalid challengeCode usage.',
      'challengeCode can only be provided when mode is challenge.'
    );
  }

  if (safeMode === 'challenge' && !challengeCode) {
    throw createValidationError(
      'Missing challengeCode for challenge mode.',
      'challengeCode is required to bind the run to a dedicated multiplayer page.'
    );
  }

  return {
    mode: safeMode,
    difficulty: safeDifficulty,
    challengeCode
  };
}

function validateGameSubmitPayload(payload) {
  assertObjectPayload(payload, 'game submit');
  assertFieldPolicy(payload, {
    allowedFields: GAME_SUBMIT_ALLOWED_FIELDS,
    requiredFields: GAME_SUBMIT_REQUIRED_FIELDS,
    payloadLabel: 'game submit'
  });

  const gameId = normalizeSafeGameId(payload.gameId);
  const name = normalizeSafeName(payload.name);

  return {
    gameId,
    name
  };
}

function validateGameCheckpointPayload(payload) {
  assertObjectPayload(payload, 'game checkpoint');
  assertFieldPolicy(payload, {
    allowedFields: GAME_CHECKPOINT_ALLOWED_FIELDS,
    requiredFields: GAME_CHECKPOINT_REQUIRED_FIELDS,
    payloadLabel: 'game checkpoint'
  });

  const gameId = normalizeSafeGameId(payload.gameId);
  const round = normalizeRoundNumber(payload.round);
  const guess = normalizeStrictGuess(payload.guess, round);
  const score = normalizeSafeRoundScore(payload.score);

  return {
    gameId,
    round,
    guess,
    score
  };
}

function createRequestError(statusCode, error, detail, code) {
  const issue = new Error(error);
  issue.statusCode = statusCode;
  issue.detail = detail || '';
  issue.code = code || null;
  return issue;
}

function requireActiveGameSession({ gameId, clientIp, nowMs }) {
  const session = activeGameSessions.get(gameId);
  if (!session) {
    throw createRequestError(
      404,
      'Game session not found.',
      'gameId does not exist or already expired.',
      'GAME_NOT_FOUND'
    );
  }

  if (nowMs >= session.expiresAtMs) {
    throw createRequestError(
      410,
      'Game session expired.',
      'Start a new game and submit again.',
      'GAME_EXPIRED'
    );
  }

  if (session.submitted) {
    throw createRequestError(
      409,
      'Game session already submitted.',
      'A gameId can be used only once.',
      'GAME_ALREADY_SUBMITTED'
    );
  }

  if (session.blocked) {
    throw createRequestError(
      409,
      'Game session is blocked.',
      String(session.blockedReason || 'Score mismatch detected.'),
      'GAME_BLOCKED'
    );
  }

  if (session.clientIp !== clientIp) {
    throw createRequestError(
      403,
      'Game session IP mismatch.',
      'This game session does not belong to the current client IP.',
      'GAME_IP_MISMATCH'
    );
  }

  return session;
}

app.use((req, res, next) => {
  const origin = String(req.headers.origin || '').trim();
  if (origin) {
    if (!isAllowedCorsOrigin(origin, req)) {
      sendJsonError(res, 403, 'CORS origin is not allowed.', origin, 'CORS_FORBIDDEN');
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cluster-Peers');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

function normalizeMode(mode) {
  const value = String(mode || '').toLowerCase();
  if (value === 'daily') return 'daily';
  if (value === 'challenge') return 'challenge';
  return 'solo';
}

function normalizeDifficulty(difficulty) {
  return String(difficulty || '').toLowerCase() === 'hard' ? 'hard' : 'easy';
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const socketIp = String(req.socket?.remoteAddress || req.ip || '').trim();
  const value = (forwarded || socketIp || 'unknown').replace(/^::ffff:/, '');
  return value || 'unknown';
}

function getStoredTimeExpr() {
  return schemaState.hasCreatedAt ? `COALESCE(NULLIF(time,''), created_at)` : 'time';
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
    });
  });
}

async function ensureSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'solo',
      difficulty TEXT NOT NULL DEFAULT 'easy',
      score REAL NOT NULL,
      time TEXT NOT NULL
    )
  `);

  const columns = await all('PRAGMA table_info(scores)');
  const columnNames = new Set(columns.map((column) => String(column.name || '').toLowerCase()));
  schemaState.hasCreatedAt = columnNames.has('created_at');
  schemaState.hasChallengeCode = columnNames.has('challenge_code');

  if (!columnNames.has('mode')) {
    await run(`ALTER TABLE scores ADD COLUMN mode TEXT NOT NULL DEFAULT 'solo'`);
  }
  if (!columnNames.has('difficulty')) {
    await run(`ALTER TABLE scores ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'easy'`);
  }
  if (!columnNames.has('time')) {
    await run(`ALTER TABLE scores ADD COLUMN time TEXT NOT NULL DEFAULT ''`);
  }
  if (!columnNames.has('challenge_code')) {
    await run(`ALTER TABLE scores ADD COLUMN challenge_code TEXT NOT NULL DEFAULT ''`);
    schemaState.hasChallengeCode = true;
  }

  await run(`
    CREATE TABLE IF NOT EXISTS daily_challenges (
      date_key TEXT PRIMARY KEY,
      colors_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS daily_plays (
      date_key TEXT NOT NULL,
      ip TEXT NOT NULL,
      player_name TEXT NOT NULL,
      score REAL NOT NULL,
      played_at TEXT NOT NULL,
      PRIMARY KEY(date_key, ip)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS score_check_sessions (
      game_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      seed TEXT NOT NULL,
      ip TEXT NOT NULL,
      started_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      expected_rounds INTEGER NOT NULL,
      checkpoint_count INTEGER NOT NULL DEFAULT 0,
      ui_round_total REAL NOT NULL DEFAULT 0,
      server_round_total REAL NOT NULL DEFAULT 0,
      ui_final_score REAL,
      server_final_score REAL,
      status TEXT NOT NULL DEFAULT 'active',
      blocked_reason TEXT NOT NULL DEFAULT '',
      submitted_at TEXT,
      promoted_at TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS score_check_rounds (
      game_id TEXT NOT NULL,
      round_no INTEGER NOT NULL,
      guess_h INTEGER NOT NULL,
      guess_s INTEGER NOT NULL,
      guess_v INTEGER NOT NULL,
      client_score REAL NOT NULL,
      server_score REAL NOT NULL,
      delta_e REAL NOT NULL,
      checked_at TEXT NOT NULL,
      PRIMARY KEY(game_id, round_no)
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores(score DESC, time ASC)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_scores_challenge ON scores(mode, challenge_code, score DESC, time ASC)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_daily_plays_date ON daily_plays(date_key)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_score_check_sessions_status ON score_check_sessions(status, started_at)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_score_check_rounds_game ON score_check_rounds(game_id, round_no)`);

  if (schemaState.hasCreatedAt) {
    await run(`UPDATE scores SET time = created_at WHERE (time IS NULL OR trim(time)='') AND created_at IS NOT NULL`);
  }
  await run(`UPDATE scores SET mode='solo' WHERE mode IS NULL OR trim(mode)=''`);
  await run(`UPDATE scores SET difficulty='easy' WHERE difficulty IS NULL OR trim(difficulty)=''`);
  await run(`UPDATE scores SET time = datetime('now') WHERE time IS NULL OR trim(time)=''`);
  if (schemaState.hasChallengeCode) {
    await run(`UPDATE scores SET challenge_code='' WHERE challenge_code IS NULL`);
  }
}

async function cleanupDailyData(dateKey) {
  await run(`DELETE FROM daily_plays WHERE date_key <> ?`, [dateKey]);
  await run(`DELETE FROM daily_challenges WHERE date_key <> ?`, [dateKey]);
}

async function ensureDailyChallenge(dateKey) {
  const row = await get(`SELECT colors_json FROM daily_challenges WHERE date_key = ?`, [dateKey]);
  const parsed = parseDailyColors(row?.colors_json);
  if (parsed) return parsed;

  const colors = createRandomDailyColors();
  const colorsJson = serializeDailyColors(colors);
  const createdAt = new Date().toISOString();

  await run(
    `
      INSERT INTO daily_challenges (date_key, colors_json, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(date_key) DO UPDATE SET
        colors_json=excluded.colors_json,
        created_at=excluded.created_at
    `,
    [dateKey, colorsJson, createdAt]
  );

  return colors;
}

async function getDailyStatus(ip) {
  const dateKey = getUtcDayKey();
  await cleanupDailyData(dateKey);
  const colors = await ensureDailyChallenge(dateKey);
  const play = await get(
    `SELECT player_name, score, played_at FROM daily_plays WHERE date_key = ? AND ip = ?`,
    [dateKey, ip]
  );

  return {
    dateKey,
    colors: normalizeTargetColors(colors),
    ip,
    playedToday: Boolean(play),
    canPlay: !play,
    playedEntry: play ? {
      name: sanitizeStoredName(play.player_name),
      score: Number(play.score || 0),
      playedAt: String(play.played_at || '')
    } : null
  };
}

function openDatabase(filePath) {
  return new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(filePath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(connection);
    });
  });
}

async function readScores(limit) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 10));
  const rows = await all(
    `
      SELECT name, mode, difficulty, score, ${getStoredTimeExpr()} AS stored_time, COALESCE(challenge_code, '') AS challenge_code
      FROM scores
      ORDER BY score DESC, stored_time ASC
      LIMIT ?
    `,
    [safeLimit]
  );

  return rows.map((row, index) => {
    const rawScore = Number(row.score);
    const when = row.stored_time ? new Date(row.stored_time) : new Date();

    return {
      name: sanitizeStoredName(row.name),
      mode: normalizeMode(row.mode),
      difficulty: normalizeDifficulty(row.difficulty),
      score: Number.isFinite(rawScore) ? rawScore : 0,
      time: Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString(),
      challengeCode: normalizeMode(row.mode) === 'challenge' ? normalizeChallengeCode(row.challenge_code) : '',
      rank: index + 1
    };
  });
}

function buildLeaderboardFilter(mode, difficulty) {
  const conditions = [];
  const params = [];
  if (mode) {
    conditions.push('mode = ?');
    params.push(mode);
  }
  if (difficulty) {
    conditions.push('difficulty = ?');
    params.push(difficulty);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

async function readScoresFiltered(limit, { mode = '', difficulty = '' } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 10));
  const filter = buildLeaderboardFilter(mode, difficulty);
  const rows = await all(
    `
      SELECT name, mode, difficulty, score, ${getStoredTimeExpr()} AS stored_time, COALESCE(challenge_code, '') AS challenge_code
      FROM scores
      ${filter.whereClause}
      ORDER BY score DESC, stored_time ASC
      LIMIT ?
    `,
    [...filter.params, safeLimit]
  );

  return rows.map((row, index) => {
    const rawScore = Number(row.score);
    const when = row.stored_time ? new Date(row.stored_time) : new Date();

    return {
      name: sanitizeStoredName(row.name),
      mode: normalizeMode(row.mode),
      difficulty: normalizeDifficulty(row.difficulty),
      score: Number.isFinite(rawScore) ? rawScore : 0,
      time: Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString(),
      challengeCode: normalizeMode(row.mode) === 'challenge' ? normalizeChallengeCode(row.challenge_code) : '',
      rank: index + 1
    };
  });
}

async function readChallengeScores(challengeCode, limit) {
  const safeCode = normalizeRequiredChallengeCode(challengeCode, 'challengeCode');
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));

  const rows = await all(
    `
      SELECT name, mode, difficulty, score, ${getStoredTimeExpr()} AS stored_time
      FROM scores
      WHERE mode = 'challenge' AND challenge_code = ?
      ORDER BY score DESC, stored_time ASC
      LIMIT ?
    `,
    [safeCode, safeLimit]
  );

  return rows.map((row, index) => {
    const rawScore = Number(row.score);
    const when = row.stored_time ? new Date(row.stored_time) : new Date();
    return {
      name: sanitizeStoredName(row.name),
      mode: 'challenge',
      challengeCode: safeCode,
      difficulty: normalizeDifficulty(row.difficulty),
      score: Number.isFinite(rawScore) ? rawScore : 0,
      time: Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString(),
      rank: index + 1
    };
  });
}

async function readLeaderboardSummary({ mode = '', difficulty = '' } = {}) {
  const filter = buildLeaderboardFilter(mode, difficulty);
  const summaryRow = await get(
    `
      SELECT
        COUNT(*) AS total_entries,
        COUNT(DISTINCT name) AS unique_players,
        COALESCE(AVG(score), 0) AS average_score,
        COALESCE(MAX(score), 0) AS top_score,
        MIN(${getStoredTimeExpr()}) AS first_score_at,
        MAX(${getStoredTimeExpr()}) AS last_score_at
      FROM scores
      ${filter.whereClause}
    `,
    filter.params
  );

  const modeRows = await all(
    `
      SELECT mode, COUNT(*) AS entry_count
      FROM scores
      ${filter.whereClause}
      GROUP BY mode
      ORDER BY entry_count DESC
    `,
    filter.params
  );

  return {
    totalEntries: Number(summaryRow?.total_entries) || 0,
    uniquePlayers: Number(summaryRow?.unique_players) || 0,
    averageScore: roundTo(Number(summaryRow?.average_score) || 0, 2),
    topScore: roundTo(Number(summaryRow?.top_score) || 0, 2),
    firstScoreAt: summaryRow?.first_score_at ? String(summaryRow.first_score_at) : '',
    lastScoreAt: summaryRow?.last_score_at ? String(summaryRow.last_score_at) : '',
    byMode: modeRows.map((row) => ({
      mode: normalizeMode(row.mode),
      count: Number(row.entry_count) || 0
    }))
  };
}

async function insertScore({ name, score, mode, difficulty, clientIp, challengeCode = '' }) {
  const safeName = normalizeSafeName(name);
  const safeScore = normalizeSafeScore(score);
  const safeMode = normalizeSafeMode(mode);
  const safeDifficulty = normalizeSafeDifficulty(difficulty);
  const normalizedChallengeCode = normalizeChallengeCode(challengeCode);
  const safeChallengeCode = safeMode === 'challenge'
    ? normalizeRequiredChallengeCode(normalizedChallengeCode, 'challengeCode')
    : '';
  const savedAt = new Date();
  const safeTime = savedAt.toISOString();

  if (safeMode === 'daily') {
    const daily = await getDailyStatus(clientIp);
    if (!daily.canPlay) {
      const error = new Error('Daily already played for this IP today.');
      error.code = 'DAILY_ALREADY_PLAYED';
      error.statusCode = 409;
      error.detail = `date=${daily.dateKey} ip=${clientIp}`;
      throw error;
    }
  }

  if (schemaState.hasCreatedAt) {
    await run(
      `
        INSERT INTO scores (name, mode, difficulty, score, time, challenge_code, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [safeName, safeMode, safeDifficulty, safeScore, safeTime, safeChallengeCode, safeTime]
    );
  } else {
    await run(
      `
        INSERT INTO scores (name, mode, difficulty, score, time, challenge_code)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [safeName, safeMode, safeDifficulty, safeScore, safeTime, safeChallengeCode]
    );
  }

  if (safeMode === 'daily') {
    await run(
      `
        INSERT INTO daily_plays (date_key, ip, player_name, score, played_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [getUtcDayKey(savedAt), clientIp, safeName, safeScore, safeTime]
    );
  }

  const rankRow = safeMode === 'challenge'
    ? await get(
      `
        SELECT COUNT(*) AS totalHigher
        FROM scores
        WHERE mode = 'challenge'
          AND challenge_code = ?
          AND (
            score > ?
            OR (score = ? AND ${getStoredTimeExpr()} < ?)
          )
      `,
      [safeChallengeCode, safeScore, safeScore, safeTime]
    )
    : await get(
      `
        SELECT COUNT(*) AS totalHigher
        FROM scores
        WHERE score > ?
           OR (score = ? AND ${getStoredTimeExpr()} < ?)
      `,
      [safeScore, safeScore, safeTime]
    );

  const rank = (Number(rankRow?.totalHigher) || 0) + 1;
  return {
    name: safeName,
    mode: safeMode,
    difficulty: safeDifficulty,
    challengeCode: safeChallengeCode,
    score: safeScore,
    time: safeTime,
    rank
  };
}

function isSqliteUniqueConstraint(error) {
  return /UNIQUE constraint failed/i.test(String(error?.message || ''));
}

async function createScoreCheckSessionRecord({
  gameId,
  mode,
  difficulty,
  seed,
  clientIp,
  startedAtMs,
  expiresAtMs,
  expectedRounds
}) {
  await run(
    `
      INSERT INTO score_check_sessions (
        game_id, mode, difficulty, seed, ip,
        started_at, expires_at, expected_rounds,
        checkpoint_count, ui_round_total, server_round_total,
        status, blocked_reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'active', '')
    `,
    [
      gameId,
      mode,
      difficulty,
      seed,
      clientIp,
      new Date(startedAtMs).toISOString(),
      new Date(expiresAtMs).toISOString(),
      expectedRounds
    ]
  );
}

async function readScoreCheckRoundSummary(gameId) {
  const row = await get(
    `
      SELECT
        COUNT(*) AS checkpoint_count,
        COALESCE(SUM(client_score), 0) AS ui_round_total,
        COALESCE(SUM(server_score), 0) AS server_round_total
      FROM score_check_rounds
      WHERE game_id = ?
    `,
    [gameId]
  );

  return {
    checkpointCount: Number(row?.checkpoint_count) || 0,
    uiRoundTotal: roundTo(Number(row?.ui_round_total) || 0, 2),
    serverRoundTotal: roundTo(Number(row?.server_round_total) || 0, 2)
  };
}

async function updateScoreCheckSessionProgress(gameId) {
  const summary = await readScoreCheckRoundSummary(gameId);
  await run(
    `
      UPDATE score_check_sessions
      SET checkpoint_count = ?, ui_round_total = ?, server_round_total = ?
      WHERE game_id = ?
    `,
    [summary.checkpointCount, summary.uiRoundTotal, summary.serverRoundTotal, gameId]
  );
  return summary;
}

async function markScoreCheckSessionBlocked(gameId, reason) {
  await run(
    `
      UPDATE score_check_sessions
      SET status = 'blocked', blocked_reason = ?
      WHERE game_id = ?
    `,
    [String(reason || 'Score mismatch detected.'), gameId]
  );
}

async function markScoreCheckSessionSubmitted(gameId, uiFinalScore, serverFinalScore, submittedAtIso) {
  await run(
    `
      UPDATE score_check_sessions
      SET ui_final_score = ?, server_final_score = ?, submitted_at = ?
      WHERE game_id = ?
    `,
    [uiFinalScore, serverFinalScore, submittedAtIso, gameId]
  );
}

async function markScoreCheckSessionPromoted(gameId, promotedAtIso) {
  await run(
    `
      UPDATE score_check_sessions
      SET status = 'promoted', promoted_at = ?
      WHERE game_id = ?
    `,
    [promotedAtIso, gameId]
  );
}

async function readScoreCheckRounds(gameId) {
  return all(
    `
      SELECT round_no, server_score, delta_e
      FROM score_check_rounds
      WHERE game_id = ?
      ORDER BY round_no ASC
    `,
    [gameId]
  );
}

app.get('/challenge/:challengeCode', (req, res, next) => {
  const code = String(req.params.challengeCode || '').trim();
  if (!CHALLENGE_CODE_REGEX.test(code)) {
    next();
    return;
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/health', (_req, res) => {
  pruneExpiredGameSessions();
  res.json({
    ok: true,
    apiVersion: 2,
    scoringModel: 'ciede2000',
    features: {
      leaderboardV2: true,
      checkpointGate: true,
      challengeDedicatedPages: true
    },
    host: HOST,
    port: activePort,
    dbType: 'sqlite',
    dbPath: SQLITE_DB_PATH,
    utcDay: getUtcDayKey(),
    activeGameSessions: activeGameSessions.size
  });
});

app.get('/favicon.ico', (_req, res) => {
  res.status(204).end();
});

app.get('/api/whoami', (req, res) => {
  res.json({ ip: getClientIp(req) });
});

app.get('/api/daily', async (req, res) => {
  try {
    const status = await getDailyStatus(getClientIp(req));
    res.json(status);
  } catch (error) {
    sendJsonError(
      res,
      500,
      'Failed to load daily challenge.',
      String(error?.message || error),
      'DAILY_STATUS_ERROR'
    );
  }
});

app.get('/api/challenges/:challengeCode/scores', async (req, res) => {
  const parsedLimit = Number(req.query.limit);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 100;
  let challengeCode = '';

  try {
    challengeCode = normalizeRequiredChallengeCode(req.params.challengeCode, 'challengeCode');
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 400,
      error?.message || 'Invalid challenge code.',
      error?.detail || '',
      error?.code || null
    );
    return;
  }

  try {
    const entries = await readChallengeScores(challengeCode, limit);
    res.json({
      challengeCode,
      entries,
      totalEntries: entries.length
    });
  } catch (error) {
    sendJsonError(
      res,
      500,
      'Failed to read challenge leaderboard.',
      String(error?.message || error),
      'CHALLENGE_SCORES_READ_ERROR'
    );
  }
});

app.get('/api/scores', async (req, res) => {
  const parsedLimit = Number(req.query.limit);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 10;
  let modeFilter = '';
  let difficultyFilter = '';

  try {
    modeFilter = normalizeOptionalMode(req.query.mode);
    difficultyFilter = normalizeOptionalDifficulty(req.query.difficulty);
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 400,
      error?.message || 'Invalid score query.',
      error?.detail || '',
      error?.code || null
    );
    return;
  }

  try {
    const rows = await readScoresFiltered(limit, {
      mode: modeFilter,
      difficulty: difficultyFilter
    });
    res.json(rows);
  } catch (error) {
    sendJsonError(
      res,
      500,
      'Failed to read scores from SQLite.',
      String(error?.message || error),
      'SCORES_READ_ERROR'
    );
  }
});

app.get('/api/leaderboard', async (req, res) => {
  const parsedLimit = Number(req.query.limit);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 100;
  let modeFilter = '';
  let difficultyFilter = '';

  try {
    modeFilter = normalizeOptionalMode(req.query.mode);
    difficultyFilter = normalizeOptionalDifficulty(req.query.difficulty);
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 400,
      error?.message || 'Invalid leaderboard query.',
      error?.detail || '',
      error?.code || null
    );
    return;
  }

  try {
    const [entries, summary] = await Promise.all([
      readScoresFiltered(limit, { mode: modeFilter, difficulty: difficultyFilter }),
      readLeaderboardSummary({ mode: modeFilter, difficulty: difficultyFilter })
    ]);
    res.json({
      entries,
      summary,
      filters: {
        mode: modeFilter || null,
        difficulty: difficultyFilter || null
      }
    });
  } catch (error) {
    sendJsonError(
      res,
      500,
      'Failed to read leaderboard summary.',
      String(error?.message || error),
      'LEADERBOARD_READ_ERROR'
    );
  }
});

app.post('/api/game/start', applyGameStartRateLimit, async (req, res) => {
  let safeInput;
  try {
    safeInput = validateGameStartPayload(req.body);
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 400,
      error?.message || 'Invalid game start payload.',
      error?.detail || '',
      error?.code || null
    );
    return;
  }

  const clientIp = getClientIp(req);
  const nowMs = Date.now();
  pruneExpiredGameSessions(nowMs);

  try {
    let dailyColors = null;
    if (safeInput.mode === 'daily') {
      const daily = await getDailyStatus(clientIp);
      if (!daily.canPlay) {
        sendJsonError(
          res,
          409,
          'Daily already played for this IP today.',
          `date=${daily.dateKey} ip=${clientIp}`,
          'DAILY_ALREADY_PLAYED'
        );
        return;
      }
      dailyColors = daily.colors;
    }

    const seed = createServerSeed({
      mode: safeInput.mode,
      difficulty: safeInput.difficulty,
      challengeCode: safeInput.challengeCode
    });
    const normalizedColors = safeInput.mode === 'daily'
      ? normalizeTargetColors(dailyColors)
      : normalizeTargetColors(createSeededColors(seed, safeInput.difficulty));
    const gameId = createGameId();
    const startedAtMs = nowMs;
    const expiresAtMs = startedAtMs + GAME_TTL_MS;

    activeGameSessions.set(gameId, {
      id: gameId,
      mode: safeInput.mode,
      difficulty: safeInput.difficulty,
      challengeCode: safeInput.challengeCode || '',
      seed,
      targets: normalizedColors,
      clientIp,
      startedAtMs,
      expiresAtMs,
      submitted: false,
      blocked: false,
      blockedReason: '',
      checkpoints: [],
      runningRawScore: 0,
      runningScore: 0,
      nextRound: 1
    });

    await createScoreCheckSessionRecord({
      gameId,
      mode: safeInput.mode,
      difficulty: safeInput.difficulty,
      seed,
      clientIp,
      startedAtMs,
      expiresAtMs,
      expectedRounds: normalizedColors.length
    });

    res.status(201).json({
      gameId,
      seed,
      mode: safeInput.mode,
      difficulty: safeInput.difficulty,
      challengeCode: safeInput.challengeCode || '',
      startedAt: startedAtMs,
      expiresAt: expiresAtMs,
      roundCount: normalizedColors.length,
      colors: normalizedColors
    });
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 500,
      error?.message || 'Failed to start game session.',
      error?.detail || String(error?.message || error),
      error?.code || 'GAME_START_ERROR'
    );
  }
});

app.post('/api/game/checkpoint', applyGameCheckpointRateLimit, async (req, res) => {
  let safeInput;
  try {
    safeInput = validateGameCheckpointPayload(req.body);
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 400,
      error?.message || 'Invalid game checkpoint payload.',
      error?.detail || '',
      error?.code || null
    );
    return;
  }

  const clientIp = getClientIp(req);
  const nowMs = Date.now();
  pruneExpiredGameSessions(nowMs);

  let session;
  try {
    session = requireActiveGameSession({
      gameId: safeInput.gameId,
      clientIp,
      nowMs
    });
  } catch (error) {
    if (error?.code === 'GAME_EXPIRED') {
      activeGameSessions.delete(safeInput.gameId);
    }
    sendJsonError(
      res,
      Number(error?.statusCode) || 400,
      error?.message || 'Invalid game session.',
      error?.detail || '',
      error?.code || null
    );
    return;
  }

  try {
    const expectedRound = session.nextRound;
    if (safeInput.round !== expectedRound) {
      throw createRequestError(
        409,
        'Round checkpoint out of order.',
        `Expected round ${expectedRound} but received round ${safeInput.round}.`,
        'GAME_ROUND_OUT_OF_ORDER'
      );
    }

    const target = session.targets[safeInput.round - 1];
    const computed = computeRoundScore(target, safeInput.guess);
    const serverRoundScore = roundTo(computed.roundScore, 2);
    const checkedAtIso = new Date(nowMs).toISOString();

    try {
      await run(
        `
          INSERT INTO score_check_rounds (
            game_id, round_no, guess_h, guess_s, guess_v,
            client_score, server_score, delta_e, checked_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          session.id,
          safeInput.round,
          safeInput.guess.h,
          safeInput.guess.s,
          safeInput.guess.v,
          safeInput.score,
          serverRoundScore,
          roundTo(computed.dE, 2),
          checkedAtIso
        ]
      );
    } catch (error) {
      if (isSqliteUniqueConstraint(error)) {
        throw createRequestError(
          409,
          'Round checkpoint already recorded.',
          `Round ${safeInput.round} has already been checkpointed for this game.`,
          'GAME_ROUND_ALREADY_CHECKPOINTED'
        );
      }
      throw error;
    }

    const summary = await updateScoreCheckSessionProgress(session.id);

    if (safeInput.score !== serverRoundScore) {
      session.blocked = true;
      session.blockedReason = `Round ${safeInput.round} mismatch (client=${safeInput.score}, server=${serverRoundScore}).`;
      await markScoreCheckSessionBlocked(session.id, session.blockedReason);
      throw createRequestError(
        409,
        'Round score mismatch detected.',
        session.blockedReason,
        'SCORE_MISMATCH_ROUND'
      );
    }

    session.checkpoints.push({
      round: safeInput.round,
      guess: safeInput.guess,
      clientScore: safeInput.score,
      serverScore: serverRoundScore,
      serverRawScore: computed.roundScore,
      deltaE: roundTo(computed.dE, 2),
      checkedAtMs: nowMs
    });
    session.runningRawScore = summary.serverRoundTotal;
    session.runningScore = summary.serverRoundTotal;
    session.nextRound = safeInput.round + 1;

    res.status(201).json({
      ok: true,
      gameId: session.id,
      round: safeInput.round,
      acceptedScore: serverRoundScore,
      runningScore: session.runningScore,
      remainingRounds: Math.max(0, session.targets.length - summary.checkpointCount)
    });
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 500,
      error?.message || 'Failed to checkpoint round.',
      error?.detail || String(error?.message || error),
      error?.code || 'GAME_CHECKPOINT_ERROR'
    );
  }
});

app.post('/api/game/submit', applyGameSubmitRateLimit, async (req, res) => {
  let safeInput;
  try {
    safeInput = validateGameSubmitPayload(req.body);
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 400,
      error?.message || 'Invalid game submit payload.',
      error?.detail || '',
      error?.code || null
    );
    return;
  }

  const clientIp = getClientIp(req);
  const nowMs = Date.now();
  pruneExpiredGameSessions(nowMs);

  let session;
  try {
    session = requireActiveGameSession({
      gameId: safeInput.gameId,
      clientIp,
      nowMs
    });
  } catch (error) {
    if (error?.code === 'GAME_EXPIRED') {
      activeGameSessions.delete(safeInput.gameId);
    }
    sendJsonError(
      res,
      Number(error?.statusCode) || 400,
      error?.message || 'Invalid game session.',
      error?.detail || '',
      error?.code || null
    );
    return;
  }

  try {
    const summary = await readScoreCheckRoundSummary(session.id);
    if (summary.checkpointCount !== session.targets.length) {
      throw createRequestError(
        409,
        'Game is not complete.',
        `Expected ${session.targets.length} checkpoint rounds but received ${summary.checkpointCount}.`,
        'GAME_INCOMPLETE'
      );
    }

    const serverFinalScore = summary.serverRoundTotal;
    const submittedAtIso = new Date(nowMs).toISOString();
    const stagedUiFinalScore = summary.uiRoundTotal;

    await markScoreCheckSessionSubmitted(session.id, stagedUiFinalScore, serverFinalScore, submittedAtIso);

    if (stagedUiFinalScore !== serverFinalScore) {
      session.blocked = true;
      session.blockedReason = `Final score mismatch (staged_ui=${stagedUiFinalScore}, server=${serverFinalScore}).`;
      await markScoreCheckSessionBlocked(session.id, session.blockedReason);
      throw createRequestError(
        409,
        'Final score mismatch detected.',
        session.blockedReason,
        'SCORE_MISMATCH_FINAL'
      );
    }

    const saved = await insertScore({
      name: safeInput.name,
      score: serverFinalScore,
      mode: session.mode,
      difficulty: session.difficulty,
      clientIp,
      challengeCode: session.challengeCode || ''
    });

    session.submitted = true;
    session.submittedAtMs = nowMs;
    session.score = serverFinalScore;
    session.runningRawScore = serverFinalScore;
    session.runningScore = serverFinalScore;
    await markScoreCheckSessionPromoted(session.id, submittedAtIso);
    const roundRows = await readScoreCheckRounds(session.id);

    // TODO(security-hardening): migrate activeGameSessions to Redis/DB for
    // multi-instance deployments and durable anti-replay checks.
    res.status(201).json({
      ...saved,
      gameId: session.id,
      startedAt: session.startedAtMs,
      expiresAt: session.expiresAtMs,
      submittedAt: nowMs,
      roundCount: roundRows.length,
      rounds: roundRows.map((round) => ({
        round: Number(round.round_no),
        score: Number(round.server_score),
        deltaE: Number(round.delta_e)
      }))
    });
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 500,
      error?.message || 'Failed to submit game result.',
      error?.detail || String(error?.message || error),
      error?.code || 'GAME_SUBMIT_ERROR'
    );
  }
});

app.post('/api/scores', (_req, res) => {
  sendJsonError(
    res,
    410,
    'Direct score submission is disabled.',
    'Use POST /api/game/start and POST /api/game/submit.',
    'LEGACY_SCORE_ROUTE_DISABLED'
  );
});

function startServer() {
  let attempt = 0;

  const tryListen = () => {
    const port = INITIAL_PORT + attempt;
    const server = app.listen(port, HOST, () => {
      activePort = port;
      if (attempt > 0) {
        console.warn(`Port ${INITIAL_PORT} was unavailable, using ${port} instead.`);
      }
      console.log(`Color Recall server listening on http://${HOST}:${port}`);
      console.log(`SQLite DB: ${SQLITE_DB_PATH}`);
    });

    server.on('error', (error) => {
      const recoverable = !EXPLICIT_PORT
        && attempt < PORT_SCAN_LIMIT - 1
        && (error?.code === 'EADDRINUSE' || error?.code === 'EACCES');

      if (recoverable) {
        attempt += 1;
        setTimeout(tryListen, 0);
        return;
      }

      console.error(`Failed to start server on http://${HOST}:${port}`);
      console.error(error?.message || String(error));
      process.exit(1);
    });
  };

  tryListen();
}

async function bootstrap() {
  db = await openDatabase(SQLITE_DB_PATH);
  await ensureSchema();
  startServer();
}

bootstrap().catch((error) => {
  console.error('Failed to initialize SQLite backend.');
  console.error(error?.message || String(error));
  process.exit(1);
});
