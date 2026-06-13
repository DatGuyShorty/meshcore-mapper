/**
 * Pure helpers for parsing config files and normalising WebSocket live-feed
 * payloads. No DOM, no Leaflet, no Electron - safe to import from anywhere.
 */

export type ConfigRepeater = {
  name: string;
  lat: number;
  lon: number;
  height: number;
  power: number;
  freq: number;
  gain: number;
};

export type WsRepeaterRow = Record<string, unknown> & {
  lat: number;
  lon: number;
  wsKey: string;
};

export type WsSnapshotResult = {
  ok: boolean;
  explicitClear: boolean;
  rows: WsRepeaterRow[];
  keys: Set<string>;
  invalidCount: number;
  duplicateCount: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/**
 * Parse a value into a finite number; returns `null` if it isn't finite.
 */
export function parseFiniteNumber(value: unknown): number | null {
  const n = Number.parseFloat(value as string);
  return Number.isFinite(n) ? n : null;
}

/**
 * Strict lat/lon validity: both must be finite numbers within range.
 */
export function isValidLatLon(lat: unknown, lon: unknown): boolean {
  return typeof lat === 'number'
    && typeof lon === 'number'
    && Number.isFinite(lat)
    && Number.isFinite(lon)
    && lat >= -90
    && lat <= 90
    && lon >= -180
    && lon <= 180;
}

export function parseConfigRepeater(row: unknown, fallbackName = 'Unnamed'): ConfigRepeater | null {
  const r = asRecord(row);
  const lat = parseFiniteNumber(r.lat);
  const lon = parseFiniteNumber(r.lon);
  const height = parseFiniteNumber(r.height);
  const power = parseFiniteNumber(r.power);
  const freq = parseFiniteNumber(r.freq);
  const gain = parseFiniteNumber(r.gain) ?? 2;

  if (lat === null || lon === null || !isValidLatLon(lat, lon)) return null;
  if (height === null || power === null || freq === null || freq <= 0) return null;

  return {
    name: String(r.name || fallbackName),
    lat,
    lon,
    height,
    power,
    freq,
    gain,
  };
}

export function parseConfigRepeaters(rows: unknown): ConfigRepeater[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(row => parseConfigRepeater(row))
    .filter((row): row is ConfigRepeater => row !== null);
}

/**
 * Validate and rewrite a user-entered live-feed URL to a `ws://` / `wss://`
 * URL suitable for `new WebSocket(...)`. Returns `null` for anything that
 * isn't an `http(s)`/`ws(s)` URL so the caller can surface a clear error
 * instead of letting `new WebSocket()` throw with an opaque scheme message.
 */
export function normalizeWsUrl(rawUrl: unknown): string | null {
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
 */
export function wsKeyForRow(row: unknown): string {
  const r = asRecord(row);
  const rawKey = r.wsKey ?? r.short ?? r.id ?? r.name;
  if (rawKey !== undefined && rawKey !== null && String(rawKey).trim()) {
    return String(rawKey);
  }
  const lat = parseFiniteNumber(r.lat);
  const lon = parseFiniteNumber(r.lon);
  return `${lat !== null ? lat.toFixed(5) : 'nan'}:${lon !== null ? lon.toFixed(5) : 'nan'}`;
}

// Caps mirror src/main/ipcHandlers.ts#_safeWsRow so the in-memory state and
// the persisted DB row never disagree on length.
const WS_NAME_MAX = 120;
const WS_SHORT_MAX = 80;
const WS_LAST_SEEN_MAX = 80;
const WS_KEY_MAX = 160;

function clampString(value: unknown, max: number): string {
  return String(value).slice(0, max);
}

function clampOptionalString(value: unknown, max: number): unknown {
  if (value === undefined || value === null) return value;
  return clampString(value, max);
}

/**
 * Normalise a payload received from the live-feed WebSocket.
 * Validates lat/lon, dedupes by `wsKey`, clamps string fields to the
 * same caps used by the DB-side `_safeWsRow` so a pathological feed
 * cannot freeze the renderer before the persistence layer's clamp fires.
 */
export function normalizeWsRepeaterSnapshot(data: unknown): WsSnapshotResult {
  const d = asRecord(data);
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

  const rows: WsRepeaterRow[] = [];
  const keys = new Set<string>();
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const row of list) {
    const r = asRecord(row);
    const lat = parseFiniteNumber(r.lat);
    const lon = parseFiniteNumber(r.lon);
    if (lat === null || lon === null || !isValidLatLon(lat, lon)) {
      invalidCount++;
      continue;
    }
    const rawKey = wsKeyForRow(r);
    const key = clampString(rawKey, WS_KEY_MAX);
    if (keys.has(key)) {
      duplicateCount++;
      continue;
    }
    keys.add(key);
    rows.push({
      ...r,
      name: clampOptionalString(r.name, WS_NAME_MAX),
      short: clampOptionalString(r.short, WS_SHORT_MAX),
      last_seen: clampOptionalString(r.last_seen, WS_LAST_SEEN_MAX),
      lastSeen: clampOptionalString(r.lastSeen, WS_LAST_SEEN_MAX),
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
