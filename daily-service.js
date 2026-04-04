function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeColor(color) {
  if (!color || typeof color !== 'object') return null;
  const h = Math.round(Number(color.h));
  const s = Math.round(Number(color.s));
  const v = Math.round(Number(color.v));
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(v)) return null;
  return {
    h: clamp(h, 0, 360),
    s: clamp(s, 0, 100),
    v: clamp(v, 0, 100)
  };
}

function createRandomDailyColors() {
  return Array.from({ length: 5 }, () => ({
    h: Math.floor(Math.random() * 361),
    s: 20 + Math.floor(Math.random() * 81),
    v: 20 + Math.floor(Math.random() * 76)
  }));
}

function parseDailyColors(rawValue) {
  try {
    const parsed = JSON.parse(String(rawValue || '[]'));
    if (!Array.isArray(parsed)) return null;
    const normalized = parsed.map(normalizeColor).filter(Boolean);
    if (normalized.length !== 5) return null;
    return normalized;
  } catch {
    return null;
  }
}

function serializeDailyColors(colors) {
  const normalized = Array.isArray(colors) ? colors.map(normalizeColor).filter(Boolean) : [];
  return JSON.stringify(normalized.slice(0, 5));
}

function getUtcDayKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

module.exports = {
  createRandomDailyColors,
  getUtcDayKey,
  parseDailyColors,
  serializeDailyColors
};
