const path = require('path');
const { createHash, randomUUID, randomInt } = require('crypto');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();

const VERSION = '2.0.0';
const INITIAL_PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PORT_SCAN_LIMIT = Math.max(1, Number(process.env.PORT_SCAN_LIMIT) || 20);
const EXPLICIT_PORT = typeof process.env.PORT === 'string' && process.env.PORT.trim() !== '';
const SQLITE_DB_PATH = path.resolve(
  process.env.SCORE_DB_PATH
  || process.env.ACCESS_DB_PATH
  || path.join(__dirname, 'scores.db')
);

const ROUND_COUNT = 5;
const ABSOLUTE_MIN_HZ = 40;
const ABSOLUTE_MAX_HZ = 4000;
const MODES = new Set(['solo', 'challenge', 'daily']);
const DIFFICULTIES = new Set(['easy', 'hard']);
const DIFFICULTY_CONFIG = {
  easy: { min: 180, max: 1200, tolerance: 0.36 },
  hard: { min: 70, max: 2600, tolerance: 0.22 }
};

const PLAYER_NAME_REGEX = /^[A-Za-z0-9 _-]+$/;
const PLAYER_NAME_MIN_LENGTH = 2;
const PLAYER_NAME_MAX_LENGTH = 20;
const CHALLENGE_CODE_REGEX = /^[A-Za-z0-9_-]{3,120}$/;
const GAME_ID_REGEX = /^[A-Za-z0-9-]{16,128}$/;

const SESSION_TTL_MS = Math.max(60_000, Number(process.env.GAME_SESSION_TTL_MS) || 10 * 60_000);
const MAX_ACTIVE_SESSIONS = Math.max(100, Number(process.env.GAME_STORE_MAX_ACTIVE) || 5000);

const RAW_FRONTEND_ORIGINS = String(process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || '').trim();
const FRONTEND_ORIGINS = new Set(
  RAW_FRONTEND_ORIGINS
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
);

const db = new sqlite3.Database(SQLITE_DB_PATH);
const gameSessions = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve({ lastID: this.lastID, changes: this.changes });
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
      resolve(row || null);
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
      resolve(Array.isArray(rows) ? rows : []);
    });
  });
}

function createHttpError(statusCode, message, code = null, detail = '') {
  const error = new Error(message);
  error.statusCode = Number(statusCode) || 500;
  error.code = code || null;
  error.detail = detail || '';
  return error;
}

function sendJsonError(res, statusCode, error, detail = '', code = null) {
  res.status(Number(statusCode) || 500).json({
    ok: false,
    error: String(error || 'Unknown server error.'),
    detail: String(detail || ''),
    code: code || null
  });
}

function getUtcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeMode(mode, allowEmpty = false) {
  const value = String(mode || '').trim().toLowerCase();
  if (!value && allowEmpty) return '';
  if (MODES.has(value)) return value;
  throw createHttpError(
    400,
    allowEmpty ? 'Invalid mode filter.' : 'Invalid mode.',
    'INVALID_MODE',
    `mode must be one of: ${Array.from(MODES).join(', ')}`
  );
}

function normalizeDifficulty(difficulty, allowEmpty = false) {
  const value = String(difficulty || '').trim().toLowerCase();
  if (!value && allowEmpty) return '';
  if (DIFFICULTIES.has(value)) return value;
  throw createHttpError(
    400,
    allowEmpty ? 'Invalid difficulty filter.' : 'Invalid difficulty.',
    'INVALID_DIFFICULTY',
    `difficulty must be one of: ${Array.from(DIFFICULTIES).join(', ')}`
  );
}

function normalizeChallengeCode(code, allowEmpty = true) {
  const value = String(code || '').trim();
  if (!value) {
    if (allowEmpty) return '';
    throw createHttpError(400, 'Missing challengeCode.', 'MISSING_CHALLENGE_CODE');
  }
  if (!CHALLENGE_CODE_REGEX.test(value)) {
    throw createHttpError(
      400,
      'Invalid challengeCode format.',
      'INVALID_CHALLENGE_CODE',
      'challengeCode must be 3-120 chars with letters, digits, underscores, or hyphens.'
    );
  }
  return value;
}

function normalizePlayerName(name) {
  const value = String(name || '').trim();
  if (!value) return 'Player';
  if (value.length < PLAYER_NAME_MIN_LENGTH || value.length > PLAYER_NAME_MAX_LENGTH) {
    throw createHttpError(
      400,
      'Invalid player name length.',
      'INVALID_NAME_LENGTH',
      `name must be ${PLAYER_NAME_MIN_LENGTH}-${PLAYER_NAME_MAX_LENGTH} chars.`
    );
  }
  if (!PLAYER_NAME_REGEX.test(value)) {
    throw createHttpError(
      400,
      'Invalid player name characters.',
      'INVALID_NAME_CHARS',
      'name can only contain letters, numbers, spaces, underscore, and hyphen.'
    );
  }
  return value;
}

function normalizeGameId(gameId) {
  const value = String(gameId || '').trim();
  if (!GAME_ID_REGEX.test(value)) {
    throw createHttpError(400, 'Invalid gameId format.', 'INVALID_GAME_ID');
  }
  return value;
}

function normalizeRound(round) {
  const value = Number(round);
  if (!Number.isInteger(value) || value < 1 || value > ROUND_COUNT) {
    throw createHttpError(400, 'Invalid round index.', 'INVALID_ROUND', `round must be 1-${ROUND_COUNT}.`);
  }
  return value;
}

function normalizeFrequency(value, label = 'frequency') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw createHttpError(400, `Invalid ${label}.`, 'INVALID_FREQUENCY', `${label} must be numeric.`);
  }
  return clamp(roundTo(parsed, 2), ABSOLUTE_MIN_HZ, ABSOLUTE_MAX_HZ);
}

function getDifficultyConfig(difficulty) {
  const safeDifficulty = normalizeDifficulty(difficulty);
  return DIFFICULTY_CONFIG[safeDifficulty];
}

function getClientIp(req) {
  const rawForwarded = req.headers['x-forwarded-for'];
  const forwarded = typeof rawForwarded === 'string' ? rawForwarded.split(',')[0].trim() : '';
  const value = forwarded || req.socket?.remoteAddress || req.ip || 'unknown';
  return String(value || 'unknown').replace(/^::ffff:/, '');
}

function parseFrequencyArray(rawJson) {
  try {
    const parsed = JSON.parse(String(rawJson || '[]'));
    if (!Array.isArray(parsed) || parsed.length !== ROUND_COUNT) return null;
    const values = parsed.map((item) => Number(item));
    if (values.some((item) => !Number.isFinite(item))) return null;
    return values.map((item) => roundTo(item, 2));
  } catch {
    return null;
  }
}

function hashToUnit(seed) {
  const digest = createHash('sha256').update(String(seed)).digest();
  const int = digest.readUInt32BE(0);
  return int / 0xffffffff;
}

function generateSeededFrequencies(seed, difficulty) {
  const config = getDifficultyConfig(difficulty);
  const span = config.max - config.min;
  return Array.from({ length: ROUND_COUNT }, (_, index) => {
    const unit = hashToUnit(`${seed}|${index + 1}`);
    const value = config.min + unit * span;
    return clamp(roundTo(value, 2), config.min, config.max);
  });
}

function generateRandomFrequencies(difficulty) {
  const config = getDifficultyConfig(difficulty);
  return Array.from({ length: ROUND_COUNT }, () => roundTo(randomInt(config.min, config.max + 1), 2));
}

async function ensureFrequencyDailyChallenge(dateKey) {
  const existing = await get(
    `SELECT easy_freqs_json, hard_freqs_json FROM frequency_daily_challenges WHERE date_key = ?`,
    [dateKey]
  );

  const parsedEasy = parseFrequencyArray(existing?.easy_freqs_json);
  const parsedHard = parseFrequencyArray(existing?.hard_freqs_json);
  if (parsedEasy && parsedHard) {
    return { easy: parsedEasy, hard: parsedHard };
  }

  const easy = generateSeededFrequencies(`frequency|daily|${dateKey}|easy`, 'easy');
  const hard = generateSeededFrequencies(`frequency|daily|${dateKey}|hard`, 'hard');
  const now = new Date().toISOString();

  await run(
    `
      INSERT INTO frequency_daily_challenges (date_key, easy_freqs_json, hard_freqs_json, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(date_key) DO UPDATE SET
        easy_freqs_json = excluded.easy_freqs_json,
        hard_freqs_json = excluded.hard_freqs_json,
        created_at = excluded.created_at
    `,
    [dateKey, JSON.stringify(easy), JSON.stringify(hard), now]
  );

  return { easy, hard };
}

async function getFrequencyDailyStatus(clientIp, difficulty) {
  const safeDifficulty = normalizeDifficulty(difficulty);
  const dateKey = getUtcDayKey();

  await run(`DELETE FROM frequency_daily_challenges WHERE date_key <> ?`, [dateKey]);
  await run(`DELETE FROM frequency_daily_plays WHERE date_key <> ?`, [dateKey]);

  const challenge = await ensureFrequencyDailyChallenge(dateKey);
  const played = await get(
    `
      SELECT player_name, score, played_at
      FROM frequency_daily_plays
      WHERE date_key = ? AND ip = ? AND difficulty = ?
    `,
    [dateKey, clientIp, safeDifficulty]
  );

  return {
    dateKey,
    difficulty: safeDifficulty,
    canPlay: !played,
    playedEntry: played
      ? {
          name: String(played.player_name || 'Player'),
          score: roundTo(Number(played.score) || 0, 2),
          time: String(played.played_at || new Date().toISOString())
        }
      : null,
    frequencies: safeDifficulty === 'hard' ? challenge.hard : challenge.easy
  };
}

function computeRoundScore(target, guess, difficulty) {
  const config = getDifficultyConfig(difficulty);
  const errorHz = Math.abs(guess - target);
  const errorPercent = (errorHz / target) * 100;
  const normalizedError = (errorHz / target) / config.tolerance;
  const normalized = clamp(1 - normalizedError, 0, 1);
  const curved = Math.pow(normalized, 0.82);
  const score = roundTo(curved * 10, 2);

  return {
    target: roundTo(target, 2),
    guess: roundTo(guess, 2),
    errorHz: roundTo(errorHz, 2),
    errorPercent: roundTo(errorPercent, 2),
    score
  };
}

function pruneExpiredSessions(nowMs = Date.now()) {
  for (const [id, session] of gameSessions.entries()) {
    if (session.expiresAt <= nowMs) {
      gameSessions.delete(id);
    }
  }

  if (gameSessions.size <= MAX_ACTIVE_SESSIONS) return;

  const sorted = Array.from(gameSessions.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, gameSessions.size - MAX_ACTIVE_SESSIONS);

  sorted.forEach((session) => {
    gameSessions.delete(session.gameId);
  });
}

function createSession({ mode, difficulty, ip, challengeCode, frequencies }) {
  const gameId = randomUUID();
  const now = Date.now();
  const session = {
    gameId,
    mode,
    difficulty,
    ip,
    challengeCode: challengeCode || '',
    frequencies,
    results: [],
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    submittedAt: 0
  };
  gameSessions.set(gameId, session);
  return session;
}

function getSessionOrThrow(gameId, clientIp) {
  const safeGameId = normalizeGameId(gameId);
  const session = gameSessions.get(safeGameId);

  if (!session) {
    throw createHttpError(404, 'Game session not found.', 'GAME_NOT_FOUND');
  }
  if (Date.now() > session.expiresAt) {
    gameSessions.delete(safeGameId);
    throw createHttpError(410, 'Game session expired.', 'GAME_EXPIRED');
  }
  if (session.submittedAt) {
    throw createHttpError(409, 'Game session already submitted.', 'GAME_ALREADY_SUBMITTED');
  }
  if (session.ip !== clientIp) {
    throw createHttpError(403, 'Game session IP mismatch.', 'GAME_IP_MISMATCH');
  }

  return session;
}

function normalizeStartPayload(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const mode = normalizeMode(body.mode);
  const difficulty = normalizeDifficulty(body.difficulty);
  const challengeCode = normalizeChallengeCode(body.challengeCode, true);
  return { mode, difficulty, challengeCode };
}

function normalizeCheckpointPayload(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const gameId = normalizeGameId(body.gameId);
  const round = normalizeRound(body.round);
  const guessFrequency = normalizeFrequency(body?.guess?.frequency, 'guess.frequency');
  return { gameId, round, guessFrequency };
}

function normalizeSubmitPayload(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const gameId = normalizeGameId(body.gameId);
  const name = normalizePlayerName(body.name);
  return { gameId, name };
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

function normalizeLimit(rawLimit, defaultLimit = 100, maxLimit = 200) {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) return defaultLimit;
  return Math.floor(clamp(parsed, 1, maxLimit));
}

async function readFrequencyLeaderboard(limit, { mode = '', difficulty = '' } = {}) {
  const filter = buildLeaderboardFilter(mode, difficulty);
  const safeLimit = normalizeLimit(limit, 100, 200);

  const rows = await all(
    `
      SELECT name, mode, difficulty, score, time, COALESCE(challenge_code, '') AS challenge_code
      FROM frequency_scores
      ${filter.whereClause}
      ORDER BY score DESC, time ASC
      LIMIT ?
    `,
    [...filter.params, safeLimit]
  );

  return rows.map((row, index) => ({
    name: String(row.name || 'Player'),
    mode: normalizeMode(row.mode),
    difficulty: normalizeDifficulty(row.difficulty),
    score: roundTo(Number(row.score) || 0, 2),
    time: row.time ? new Date(row.time).toISOString() : new Date().toISOString(),
    challengeCode: String(row.challenge_code || ''),
    rank: index + 1
  }));
}

async function readFrequencyLeaderboardSummary({ mode = '', difficulty = '' } = {}) {
  const filter = buildLeaderboardFilter(mode, difficulty);

  const totals = await get(
    `
      SELECT
        COUNT(*) AS total_entries,
        COUNT(DISTINCT name) AS unique_players,
        COALESCE(AVG(score), 0) AS average_score,
        COALESCE(MAX(score), 0) AS top_score,
        MIN(time) AS first_score_at,
        MAX(time) AS last_score_at
      FROM frequency_scores
      ${filter.whereClause}
    `,
    filter.params
  );

  const byModeRows = await all(
    `
      SELECT mode, COUNT(*) AS entry_count
      FROM frequency_scores
      ${filter.whereClause}
      GROUP BY mode
      ORDER BY entry_count DESC
    `,
    filter.params
  );

  return {
    totalEntries: Number(totals?.total_entries) || 0,
    uniquePlayers: Number(totals?.unique_players) || 0,
    averageScore: roundTo(Number(totals?.average_score) || 0, 2),
    topScore: roundTo(Number(totals?.top_score) || 0, 2),
    firstScoreAt: totals?.first_score_at ? String(totals.first_score_at) : '',
    lastScoreAt: totals?.last_score_at ? String(totals.last_score_at) : '',
    byMode: byModeRows.map((row) => ({
      mode: normalizeMode(row.mode),
      count: Number(row.entry_count) || 0
    }))
  };
}

async function insertFrequencyScore({ name, score, mode, difficulty, clientIp, challengeCode = '' }) {
  const safeName = normalizePlayerName(name);
  const safeMode = normalizeMode(mode);
  const safeDifficulty = normalizeDifficulty(difficulty);
  const safeScore = roundTo(clamp(Number(score) || 0, 0, 50), 2);
  const safeChallengeCode = safeMode === 'challenge' ? normalizeChallengeCode(challengeCode, true) : '';
  const now = new Date().toISOString();

  if (safeMode === 'daily') {
    const daily = await getFrequencyDailyStatus(clientIp, safeDifficulty);
    if (!daily.canPlay) {
      throw createHttpError(
        409,
        'Daily already played for this IP today.',
        'DAILY_ALREADY_PLAYED',
        `date=${daily.dateKey} ip=${clientIp}`
      );
    }
  }

  await run(
    `
      INSERT INTO frequency_scores (name, mode, difficulty, score, time, challenge_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [safeName, safeMode, safeDifficulty, safeScore, now, safeChallengeCode, now]
  );

  if (safeMode === 'daily') {
    const dateKey = getUtcDayKey();
    await run(
      `
        INSERT INTO frequency_daily_plays (date_key, ip, difficulty, player_name, score, played_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [dateKey, clientIp, safeDifficulty, safeName, safeScore, now]
    );
  }

  let rankQuery = `
    SELECT COUNT(*) AS ahead
    FROM frequency_scores
    WHERE mode = ?
      AND difficulty = ?
      AND (score > ? OR (score = ? AND time < ?))
  `;
  let rankParams = [safeMode, safeDifficulty, safeScore, safeScore, now];

  if (safeMode === 'challenge' && safeChallengeCode) {
    rankQuery = `
      SELECT COUNT(*) AS ahead
      FROM frequency_scores
      WHERE mode = ?
        AND difficulty = ?
        AND challenge_code = ?
        AND (score > ? OR (score = ? AND time < ?))
    `;
    rankParams = [safeMode, safeDifficulty, safeChallengeCode, safeScore, safeScore, now];
  }

  const rankRow = await get(rankQuery, rankParams);

  return {
    name: safeName,
    score: safeScore,
    mode: safeMode,
    difficulty: safeDifficulty,
    rank: (Number(rankRow?.ahead) || 0) + 1,
    time: now,
    challengeCode: safeChallengeCode
  };
}

function isLocalhostName(name) {
  const value = String(name || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1';
}

function isAllowedOrigin(origin) {
  if (!origin) return true;

  if (FRONTEND_ORIGINS.size > 0) {
    if (FRONTEND_ORIGINS.has(origin)) return true;
    try {
      const parsed = new URL(origin);
      return isLocalhostName(parsed.hostname);
    } catch {
      return false;
    }
  }

  return true;
}

app.use((req, res, next) => {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';

  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, X-Cluster-Peers');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  if (req.method === 'OPTIONS') {
    if (origin && !isAllowedOrigin(origin)) {
      res.status(403).end();
      return;
    }
    res.status(204).end();
    return;
  }

  next();
});

app.use(express.json({ limit: '128kb' }));

app.get('/api/health', async (req, res) => {
  let tableCount = 0;
  try {
    const row = await get(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'`);
    tableCount = Number(row?.count) || 0;
  } catch {
    tableCount = 0;
  }

  res.json({
    ok: true,
    service: 'frequency-game-server',
    version: VERSION,
    host: HOST,
    dbPath: SQLITE_DB_PATH,
    tableCount,
    now: new Date().toISOString(),
    features: {
      leaderboardV2: true,
      dailyMode: true,
      challengeMode: true,
      frequency: true
    }
  });
});

app.get('/api/frequency/daily', async (req, res) => {
  const clientIp = getClientIp(req);

  try {
    const difficulty = normalizeDifficulty(req.query.difficulty || 'easy');
    const daily = await getFrequencyDailyStatus(clientIp, difficulty);
    res.json(daily);
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 500,
      error?.message || 'Failed to load frequency daily challenge.',
      error?.detail || '',
      error?.code || 'FREQUENCY_DAILY_ERROR'
    );
  }
});

app.get('/api/frequency/scores', async (req, res) => {
  const limit = normalizeLimit(req.query.limit, 100, 200);

  try {
    const mode = normalizeMode(req.query.mode, true);
    const difficulty = normalizeDifficulty(req.query.difficulty, true);
    const rows = await readFrequencyLeaderboard(limit, { mode, difficulty });
    res.json(rows);
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 500,
      error?.message || 'Failed to read frequency scores.',
      error?.detail || '',
      error?.code || 'FREQUENCY_SCORE_READ_ERROR'
    );
  }
});

app.get('/api/frequency/leaderboard', async (req, res) => {
  const limit = normalizeLimit(req.query.limit, 100, 200);

  try {
    const mode = normalizeMode(req.query.mode, true);
    const difficulty = normalizeDifficulty(req.query.difficulty, true);
    const [entries, summary] = await Promise.all([
      readFrequencyLeaderboard(limit, { mode, difficulty }),
      readFrequencyLeaderboardSummary({ mode, difficulty })
    ]);

    res.json({
      entries,
      summary,
      filters: {
        mode: mode || null,
        difficulty: difficulty || null
      }
    });
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 500,
      error?.message || 'Failed to read frequency leaderboard.',
      error?.detail || '',
      error?.code || 'FREQUENCY_LEADERBOARD_ERROR'
    );
  }
});

app.post('/api/frequency/game/start', async (req, res) => {
  pruneExpiredSessions();

  try {
    const safeInput = normalizeStartPayload(req.body);
    const clientIp = getClientIp(req);

    let frequencies = [];
    if (safeInput.mode === 'daily') {
      const daily = await getFrequencyDailyStatus(clientIp, safeInput.difficulty);
      if (!daily.canPlay) {
        throw createHttpError(
          409,
          'Daily already played for this IP today.',
          'DAILY_ALREADY_PLAYED',
          `date=${daily.dateKey} ip=${clientIp}`
        );
      }
      frequencies = Array.isArray(daily.frequencies) ? daily.frequencies.slice(0, ROUND_COUNT) : [];
    } else if (safeInput.mode === 'challenge' && safeInput.challengeCode) {
      frequencies = generateSeededFrequencies(
        `frequency|challenge|${safeInput.difficulty}|${safeInput.challengeCode}`,
        safeInput.difficulty
      );
    } else {
      frequencies = generateRandomFrequencies(safeInput.difficulty);
    }

    if (!Array.isArray(frequencies) || frequencies.length !== ROUND_COUNT) {
      throw createHttpError(500, 'Unable to generate target frequencies.', 'FREQUENCY_GENERATION_ERROR');
    }

    const session = createSession({
      mode: safeInput.mode,
      difficulty: safeInput.difficulty,
      ip: clientIp,
      challengeCode: safeInput.challengeCode,
      frequencies
    });

    res.json({
      ok: true,
      gameId: session.gameId,
      mode: session.mode,
      difficulty: session.difficulty,
      challengeCode: session.challengeCode,
      frequencies: session.frequencies
    });
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 500,
      error?.message || 'Failed to start frequency game.',
      error?.detail || '',
      error?.code || 'FREQUENCY_GAME_START_ERROR'
    );
  }
});

app.post('/api/frequency/game/checkpoint', async (req, res) => {
  pruneExpiredSessions();

  try {
    const safeInput = normalizeCheckpointPayload(req.body);
    const clientIp = getClientIp(req);
    const session = getSessionOrThrow(safeInput.gameId, clientIp);

    const expectedRound = session.results.length + 1;
    if (safeInput.round !== expectedRound) {
      throw createHttpError(
        409,
        'Checkpoint out of sequence.',
        'CHECKPOINT_OUT_OF_SEQUENCE',
        `expectedRound=${expectedRound}`
      );
    }

    const target = Number(session.frequencies[safeInput.round - 1]);
    if (!Number.isFinite(target)) {
      throw createHttpError(500, 'Missing target frequency for this round.', 'MISSING_TARGET');
    }

    const result = computeRoundScore(target, safeInput.guessFrequency, session.difficulty);
    session.results.push({ round: safeInput.round, ...result });

    const runningScore = roundTo(
      session.results.reduce((sum, item) => sum + Number(item.score || 0), 0),
      2
    );

    res.json({
      ok: true,
      round: safeInput.round,
      acceptedScore: result.score,
      runningScore,
      errorHz: result.errorHz,
      errorPercent: result.errorPercent
    });
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 500,
      error?.message || 'Failed to submit round checkpoint.',
      error?.detail || '',
      error?.code || 'FREQUENCY_CHECKPOINT_ERROR'
    );
  }
});

app.post('/api/frequency/game/submit', async (req, res) => {
  pruneExpiredSessions();

  try {
    const safeInput = normalizeSubmitPayload(req.body);
    const clientIp = getClientIp(req);
    const session = getSessionOrThrow(safeInput.gameId, clientIp);

    if (session.results.length !== ROUND_COUNT) {
      throw createHttpError(
        409,
        'Cannot submit game before all rounds are validated.',
        'INCOMPLETE_GAME',
        `expectedRounds=${ROUND_COUNT} actual=${session.results.length}`
      );
    }

    const totalScore = roundTo(
      session.results.reduce((sum, result) => sum + Number(result.score || 0), 0),
      2
    );

    const saved = await insertFrequencyScore({
      name: safeInput.name,
      score: totalScore,
      mode: session.mode,
      difficulty: session.difficulty,
      clientIp,
      challengeCode: session.challengeCode
    });

    session.submittedAt = Date.now();
    gameSessions.delete(session.gameId);

    res.json({
      ok: true,
      name: saved.name,
      score: saved.score,
      rank: saved.rank,
      mode: saved.mode,
      difficulty: saved.difficulty,
      time: saved.time,
      challengeCode: saved.challengeCode
    });
  } catch (error) {
    sendJsonError(
      res,
      Number(error?.statusCode) || 500,
      error?.message || 'Failed to submit final frequency score.',
      error?.detail || '',
      error?.code || 'FREQUENCY_SUBMIT_ERROR'
    );
  }
});

app.use(express.static(__dirname, { index: false }));

app.get('/', (req, res) => {
  res.redirect('/frequency-guess-challenge/');
});

app.get('/frequency-guess-challenge', (req, res) => {
  res.redirect('/frequency-guess-challenge/');
});

app.get('/frequency-guess-challenge/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frequency-guess-challenge', 'index.html'));
});

app.use((req, res) => {
  sendJsonError(res, 404, 'Route not found.', '', 'ROUTE_NOT_FOUND');
});

app.use((error, req, res, next) => {
  const statusCode = Number(error?.statusCode) || 500;
  sendJsonError(
    res,
    statusCode,
    error?.message || 'Unhandled server error.',
    error?.detail || '',
    error?.code || 'UNHANDLED_SERVER_ERROR'
  );
});

async function initializeDatabase() {
  await run(
    `
      CREATE TABLE IF NOT EXISTS frequency_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'solo',
        difficulty TEXT NOT NULL DEFAULT 'easy',
        score REAL NOT NULL,
        time TEXT NOT NULL,
        challenge_code TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ''
      )
    `
  );

  await run(
    `
      CREATE TABLE IF NOT EXISTS frequency_daily_challenges (
        date_key TEXT PRIMARY KEY,
        easy_freqs_json TEXT NOT NULL,
        hard_freqs_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `
  );

  await run(
    `
      CREATE TABLE IF NOT EXISTS frequency_daily_plays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_key TEXT NOT NULL,
        ip TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        player_name TEXT NOT NULL,
        score REAL NOT NULL,
        played_at TEXT NOT NULL,
        UNIQUE(date_key, ip, difficulty)
      )
    `
  );

  const dailyPlayColumns = await all(`PRAGMA table_info(frequency_daily_plays)`);
  const dailyPlayColumnNames = new Set(
    dailyPlayColumns.map((column) => String(column?.name || '').toLowerCase())
  );

  if (!dailyPlayColumnNames.has('difficulty')) {
    await run(`ALTER TABLE frequency_daily_plays ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'easy'`);
  }
  if (!dailyPlayColumnNames.has('player_name')) {
    await run(`ALTER TABLE frequency_daily_plays ADD COLUMN player_name TEXT NOT NULL DEFAULT 'Player'`);
  }
  if (!dailyPlayColumnNames.has('played_at')) {
    await run(`ALTER TABLE frequency_daily_plays ADD COLUMN played_at TEXT NOT NULL DEFAULT ''`);
  }

  await run(`CREATE INDEX IF NOT EXISTS idx_frequency_scores_rank ON frequency_scores(score DESC, time ASC)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_frequency_scores_mode ON frequency_scores(mode, difficulty, score DESC, time ASC)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_frequency_scores_challenge ON frequency_scores(mode, challenge_code, score DESC, time ASC)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_frequency_daily_plays ON frequency_daily_plays(date_key, ip, difficulty)`);

  await run(`UPDATE frequency_scores SET mode = 'solo' WHERE mode IS NULL OR trim(mode) = ''`);
  await run(`UPDATE frequency_scores SET difficulty = 'easy' WHERE difficulty IS NULL OR trim(difficulty) = ''`);
  await run(`UPDATE frequency_scores SET challenge_code = '' WHERE challenge_code IS NULL`);
  await run(`UPDATE frequency_scores SET time = COALESCE(NULLIF(time, ''), datetime('now'))`);
  await run(`UPDATE frequency_scores SET created_at = COALESCE(NULLIF(created_at, ''), time, datetime('now'))`);
  await run(`UPDATE frequency_daily_plays SET difficulty = 'easy' WHERE difficulty IS NULL OR trim(difficulty) = ''`);
  await run(`UPDATE frequency_daily_plays SET player_name = 'Player' WHERE player_name IS NULL OR trim(player_name) = ''`);
  await run(`UPDATE frequency_daily_plays SET played_at = COALESCE(NULLIF(played_at, ''), datetime('now'))`);
}

async function startServer() {
  await initializeDatabase();

  const listenOnPort = (port, attemptsLeft) => {
    const server = app.listen(port, HOST, () => {
      console.log(`[frequency-game] listening on http://${HOST}:${port}`);
      console.log(`[frequency-game] SQLite: ${SQLITE_DB_PATH}`);
    });

    server.on('error', (error) => {
      if (error && error.code === 'EADDRINUSE' && !EXPLICIT_PORT && attemptsLeft > 0) {
        const nextPort = port + 1;
        console.warn(`[frequency-game] port ${port} busy, trying ${nextPort}`);
        listenOnPort(nextPort, attemptsLeft - 1);
        return;
      }

      console.error('[frequency-game] failed to start server:', error);
      process.exitCode = 1;
    });
  };

  listenOnPort(INITIAL_PORT, PORT_SCAN_LIMIT - 1);
}

startServer().catch((error) => {
  console.error('[frequency-game] fatal startup error:', error);
  process.exitCode = 1;
});
