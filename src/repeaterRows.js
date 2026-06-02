// @ts-check
/**
 * Pure helpers for parsing config files and normalising WebSocket live-feed
 * payloads. No DOM, no Leaflet, no Electron — safe to import from anywhere.
 * Type-checked under `npm run typecheck`.
 *
 * @typedef {Object} ConfigRepeater
 * @property {string} name
 * @property {number} lat
 * @property {number} lon
 * @property {number} height
 * @property {number} power
 * @property {number} freq
 * @property {number} gain
 */

/**
 * Parse a value into a finite number; returns `null` if it isn't finite.
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseFiniteNumber(value) {
  const n = Number.parseFloat(/** @type {string} */ (value));
  return Number.isFinite(n) ? n : null;
}

/**
 * Strict lat/lon validity: both must be finite numbers within range.
 * @param {unknown} lat
 * @param {unknown} lon
 * @returns {boolean}
 */
export function isValidLatLon(lat, lon) {
  return Number.isFinite(lat)
    && Number.isFinite(lon)
    && /** @type {number} */ (lat) >= -90
    && /** @type {number} */ (lat) <= 90
    && /** @type {number} */ (lon) >= -180
    && /** @type {number} */ (lon) <= 180;
}

/**
 * @param {unknown} row
 * @param {string} [fallbackName]
 * @returns {ConfigRepeater | null}
 */
export function parseConfigRepeater(row, fallbackName = 'Unnamed') {
  const r = /** @type {Record<string, unknown>} */ (row ?? {});
  const lat = parseFiniteNumber(r.lat);
  const lon = parseFiniteNumber(r.lon);
  const height = parseFiniteNumber(r.height);
  const power = parseFiniteNumber(r.power);
  const freq = parseFiniteNumber(r.freq);
  const gain = parseFiniteNumber(r.gain) ?? 2;

  if (!isValidLatLon(lat, lon)) return null;
  if (height === null || power === null || freq === null || freq <= 0) return null;

  return {
    name: String(r.name || fallbackName),
    lat: /** @type {number} */ (lat),
    lon: /** @type {number} */ (lon),
    height,
    power,
    freq,
    gain,
  };
}

/**
 * @param {unknown} rows
 * @returns {ConfigRepeater[]}
 */
export function parseConfigRepeaters(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(row => parseConfigRepeater(row))
    .filter(/** @returns {row is ConfigRepeater} */ row => row !== null);
}

/**
 * Validate and rewrite a user-entered live-feed URL to a `ws://` / `wss://`
 * URL suitable for `new WebSocket(...)`. Returns `null` for anything that
 * isn't an `http(s)`/`ws(s)` URL so the caller can surface a clear error
 * instead of letting `new WebSocket()` throw with an opaque scheme message.
 *
 * @param {unknown} rawUrl
 * @returns {string | null}
 */
export function normalizeWsUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  // Match scheme insensitively; only allow ws/wss/http/https.
  const m = /^(wss?|https?):\/\//i.exec(trimmed);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const rest = trimmed.slice(m[0].length);
  const wsScheme = scheme === 'https' || scheme === 'wss' ? 'wss' : 'ws';
  return `${wsScheme}://${rest}`;
}

/**
 * Derive a stable string key for a live-feed row. Prefers explicit
 * `wsKey` / `short` / `id` / `name`; falls back to rounded coordinates
 * if no identifier is present.
 * @param {unknown} row
 * @returns {string}
 */
export function wsKeyForRow(row) {
  const r = /** @type {Record<string, unknown>} */ (row ?? {});
  const rawKey = r.wsKey ?? r.short ?? r.id ?? r.name;
  if (rawKey !== undefined && rawKey !== null && String(rawKey).trim()) {
    return String(rawKey);
  }
  const lat = parseFiniteNumber(r.lat);
  const lon = parseFiniteNumber(r.lon);
  return `${lat !== null ? lat.toFixed(5) : 'nan'}:${lon !== null ? lon.toFixed(5) : 'nan'}`;
}

// Caps mirror src/main/ipcHandlers.js#_safeWsRow so the in-memory state and
// the persisted DB row never disagree on length.
const WS_NAME_MAX = 120;
const WS_SHORT_MAX = 80;
const WS_LAST_SEEN_MAX = 80;
const WS_KEY_MAX = 160;

/**
 * @template T
 * @param {T} value
 * @param {number} max
 * @returns {T | string}
 */
function _clamp(value, max) {
  if (value === undefined || value === null) return value;
  return String(value).slice(0, max);
}

/**
 * @typedef {Object} WsSnapshotResult
 * @property {boolean} ok
 * @property {boolean} explicitClear
 * @property {any[]} rows
 * @property {Set<string>} keys
 * @property {number} invalidCount
 * @property {number} duplicateCount
 */

/**
 * Normalise a payload received from the live-feed WebSocket.
 * Validates lat/lon, dedupes by `wsKey`, clamps string fields to the
 * same caps used by the DB-side `_safeWsRow` so a pathological feed
 * cannot freeze the renderer before the persistence layer's clamp fires.
 * @param {unknown} data
 * @returns {WsSnapshotResult}
 */
export function normalizeWsRepeaterSnapshot(data) {
  const d = /** @type {Record<string, unknown>} */ (data ?? {});
  const explicitClear = d.clear === true || d.clearWsRepeaters === true;
  const list = Array.isArray(data) ? data
    : Array.isArray(d.payload) ? d.payload
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
