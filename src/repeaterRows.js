export function parseFiniteNumber(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export function isValidLatLon(lat, lon) {
  return Number.isFinite(lat)
    && Number.isFinite(lon)
    && lat >= -90
    && lat <= 90
    && lon >= -180
    && lon <= 180;
}

export function parseConfigRepeater(row, fallbackName = 'Unnamed') {
  const lat = parseFiniteNumber(row?.lat);
  const lon = parseFiniteNumber(row?.lon);
  const height = parseFiniteNumber(row?.height);
  const power = parseFiniteNumber(row?.power);
  const freq = parseFiniteNumber(row?.freq);
  const gain = parseFiniteNumber(row?.gain) ?? 2;

  if (!isValidLatLon(lat, lon)) return null;
  if (!Number.isFinite(height) || !Number.isFinite(power) || !Number.isFinite(freq) || freq <= 0) return null;

  return {
    name: String(row?.name || fallbackName),
    lat,
    lon,
    height,
    power,
    freq,
    gain,
  };
}

export function parseConfigRepeaters(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => parseConfigRepeater(row)).filter(Boolean);
}

export function wsKeyForRow(row) {
  const rawKey = row?.wsKey ?? row?.short ?? row?.id ?? row?.name;
  if (rawKey !== undefined && rawKey !== null && String(rawKey).trim()) {
    return String(rawKey);
  }
  const lat = parseFiniteNumber(row?.lat);
  const lon = parseFiniteNumber(row?.lon);
  return `${Number.isFinite(lat) ? lat.toFixed(5) : 'nan'}:${Number.isFinite(lon) ? lon.toFixed(5) : 'nan'}`;
}

// Caps mirror src/main/ipcHandlers.js#_safeWsRow so the in-memory state and
// the persisted DB row never disagree on length.
const WS_NAME_MAX = 120;
const WS_SHORT_MAX = 80;
const WS_LAST_SEEN_MAX = 80;
const WS_KEY_MAX = 160;

function _clamp(value, max) {
  if (value === undefined || value === null) return value;
  return String(value).slice(0, max);
}

export function normalizeWsRepeaterSnapshot(data) {
  const explicitClear = data?.clear === true || data?.clearWsRepeaters === true;
  const list = Array.isArray(data) ? data
    : Array.isArray(data?.payload) ? data.payload
    : explicitClear ? []
    : null;

  if (!list) {
    return {
      ok: false,
      explicitClear: false,
      rows: [],
      keys: new Set(),
      invalidCount: 0,
      duplicateCount: 0,
    };
  }

  const rows = [];
  const keys = new Set();
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const row of list) {
    const lat = parseFiniteNumber(row?.lat);
    const lon = parseFiniteNumber(row?.lon);
    if (!isValidLatLon(lat, lon)) {
      invalidCount++;
      continue;
    }
    const rawKey = wsKeyForRow(row);
    const key = _clamp(rawKey, WS_KEY_MAX);
    if (keys.has(key)) {
      duplicateCount++;
      continue;
    }
    keys.add(key);
    rows.push({
      ...row,
      name: row?.name === undefined || row?.name === null ? row?.name : _clamp(row.name, WS_NAME_MAX),
      short: row?.short === undefined || row?.short === null ? row?.short : _clamp(row.short, WS_SHORT_MAX),
      last_seen: row?.last_seen === undefined || row?.last_seen === null ? row?.last_seen : _clamp(row.last_seen, WS_LAST_SEEN_MAX),
      lastSeen: row?.lastSeen === undefined || row?.lastSeen === null ? row?.lastSeen : _clamp(row.lastSeen, WS_LAST_SEEN_MAX),
      lat,
      lon,
      wsKey: key,
    });
  }

  return {
    ok: true,
    explicitClear,
    rows,
    keys,
    invalidCount,
    duplicateCount,
  };
}
