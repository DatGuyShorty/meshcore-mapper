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
    const key = wsKeyForRow(row);
    if (keys.has(key)) {
      duplicateCount++;
      continue;
    }
    keys.add(key);
    rows.push({ ...row, lat, lon, wsKey: key });
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
