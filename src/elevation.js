/**
 * elevation.js
 * Fetches terrain elevation data using high-accuracy APIs, with SQLite caching.
 * Cache is keyed on lat/lon rounded to 4 decimal places (~11m precision).
 *
 * API priority (best-to-worst resolution):
 *   1. opentopodata.org/srtm30m  — SRTM 1 arc-second, 30m global coverage
 *   2. opentopodata.org/aster30m — ASTER GDEM v3, 30m (different source fills SRTM voids)
 *   3. open-elevation.com        — SRTM ~90m, last resort
 *
 * Null elevations (SRTM voids) are filled by forward/backward propagation from
 * neighbouring profile points instead of defaulting to 0m.
 */

// Per-API config: url, max locations per POST request, inter-batch delay (ms)
const ELEVATION_APIS = [
  { url: 'https://api.opentopodata.org/v1/srtm30m',  maxBatch: 100, delayMs: 1100, name: 'opentopodata/srtm30m'  },
  { url: 'https://api.opentopodata.org/v1/aster30m', maxBatch: 100, delayMs: 1100, name: 'opentopodata/aster30m' },
  { url: 'https://api.open-elevation.com/api/v1/lookup', maxBatch: 256, delayMs: 500, name: 'open-elevation.com' },
];

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const round4 = v  => Math.round(v * 1e4) / 1e4;

// Session-scoped in-memory cache — keyed on "lat,lon" (rounded 4 dp).
// P13: capped at ELEV_MEM_MAX entries; when exceeded the oldest 25% are evicted.
const _elevMem = new Map();
const ELEV_MEM_MAX = 500_000;
function _elevMemSet(k, v) {
  if (_elevMem.size >= ELEV_MEM_MAX) {
    const evict = Math.ceil(ELEV_MEM_MAX * 0.25);
    let count = 0;
    for (const key of _elevMem.keys()) {
      _elevMem.delete(key);
      if (++count >= evict) break;
    }
    console.info(`[elevation] mem-cache evicted ${count} oldest entries (cap=${ELEV_MEM_MAX})`);
  }
  _elevMem.set(k, v);
}

/**
 * Fetch elevations for an array of { latitude, longitude } points.
 * Returns a matching array of elevation values in metres.
 * Lookup order: in-memory → SQLite bbox query (IPC) → external API.
 *
 * @param {Array<{latitude: number, longitude: number}>} points
 * @returns {Promise<number[]>}
 */
export async function fetchElevations(points) {
  const rounded = points.map(p => ({ lat: round4(p.latitude), lon: round4(p.longitude) }));

  // 1. Check in-memory cache first — zero IPC cost
  const results       = new Array(points.length);
  const missingMemIdx = [];
  for (let i = 0; i < rounded.length; i++) {
    const k = `${rounded[i].lat},${rounded[i].lon}`;
    if (_elevMem.has(k)) {
      results[i] = _elevMem.get(k);
    } else {
      missingMemIdx.push(i);
    }
  }

  if (missingMemIdx.length === 0) {
    console.debug(`[elevation] mem-cache hit — all ${points.length} points`);
    return results;
  }

  // 2. SQLite bbox query for points not yet in memory (P11)
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const i of missingMemIdx) {
    const p = rounded[i];
    if (p.lat < latMin) latMin = p.lat;
    if (p.lat > latMax) latMax = p.lat;
    if (p.lon < lonMin) lonMin = p.lon;
    if (p.lon > lonMax) lonMax = p.lon;
  }
  const cachedRows = await window.electronAPI.cacheElevationsLookupBbox({ latMin, latMax, lonMin, lonMax });

  const dbMap = new Map();
  for (const row of cachedRows) {
    const k = `${row.lat},${row.lon}`;
    dbMap.set(k, row.elev);
    _elevMemSet(k, row.elev);
  }

  const missingApiIdx = [];
  for (const i of missingMemIdx) {
    const k = `${rounded[i].lat},${rounded[i].lon}`;
    if (dbMap.has(k)) {
      results[i] = dbMap.get(k);
    } else {
      missingApiIdx.push(i);
    }
  }

  if (missingApiIdx.length === 0) {
    console.debug(`[elevation] mem: ${points.length - missingMemIdx.length} / SQLite: ${missingMemIdx.length} — no API call needed`);
    return results;
  }
  console.info(`[elevation] mem: ${points.length - missingMemIdx.length}, SQLite: ${missingMemIdx.length - missingApiIdx.length}, API: ${missingApiIdx.length}`);

  // 3. Fetch remaining from external API
  const missingPoints = missingApiIdx.map(i => ({ latitude: rounded[i].lat, longitude: rounded[i].lon }));
  const fetched = await _fetchFromAPI(missingPoints);

  const toStore = [];
  for (let j = 0; j < missingApiIdx.length; j++) {
    const idx = missingApiIdx[j];
    const k   = `${rounded[idx].lat},${rounded[idx].lon}`;
    results[idx] = fetched[j];
    _elevMemSet(k, fetched[j]);
    toStore.push({ lat: rounded[idx].lat, lon: rounded[idx].lon, elev: fetched[j] });
  }

  await window.electronAPI.cacheElevationsStore(toStore);
  console.debug(`[elevation] stored ${toStore.length} new points to SQLite`);
  return results;
}

/**
 * Try each API in priority order until one succeeds for all points.
 * Each API has its own maxBatch limit and inter-batch pacing.
 */
async function _fetchFromAPI(points) {
  let lastErr = null;
  for (const api of ELEVATION_APIS) {
    try {
      const result = await _fetchFromSingleAPI(api, points);
      return result;
    } catch (err) {
      console.warn(`[elevation] ${api.name} failed: ${err.message} — trying next source`);
      lastErr = err;
    }
  }
  throw new Error(`All elevation sources exhausted: ${lastErr?.message ?? 'unknown'}`);
}

async function _fetchFromSingleAPI(api, points) {
  const results = new Array(points.length).fill(null);

  for (let i = 0; i < points.length; i += api.maxBatch) {
    if (i > 0) await sleep(api.delayMs);

    const batch = points.slice(i, i + api.maxBatch);
    let resp = null, lastErr = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(2000 * attempt);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        resp = await fetch(api.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ locations: batch }),
          signal: controller.signal,
        });
        clearTimeout(timer);
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        continue; // likely network timeout — retry
      }

      if (resp.status === 429) {
        // Rate-limited — wait a bit longer and retry
        resp = null;
        await sleep(5000);
        continue;
      }
      if (resp.status >= 400) {
        // HTTP 4xx/5xx — this API can't serve this batch; try the next API
        resp = null;
        break;
      }
      break; // success
    }

    if (!resp) throw new Error(`${api.name}: ${lastErr?.message ?? 'HTTP error after retries'}`);
    if (!resp.ok) throw new Error(`${api.name}: HTTP ${resp.status}`);

    const data = await resp.json();
    if (!data.results?.length) throw new Error(`${api.name}: empty response body`);
    if (data.results.length < batch.length) {
      console.warn(`[elevation] ${api.name}: expected ${batch.length} results, got ${data.results.length}`);
    }

    data.results.forEach((r, j) => {
      results[i + j] = (r.elevation !== null && r.elevation !== undefined) ? r.elevation : null;
    });
    console.debug(`[elevation] ${api.name}: fetched ${Math.min(i + api.maxBatch, points.length) - i} points`);
  }

  // Fill SRTM voids: propagate from neighbours instead of defaulting to 0 m.
  // A 0 m value on a 2000 m ridge causes catastrophic diffraction errors.
  _fillNulls(results, points);
  return results;
}

/**
 * Fill null elevations (data voids) using forward/backward propagation along
 * the profile array. This preserves correct terrain heights at either end of a void.
 * Absolute fallback of 0 m should never fire for real terrain if the API works.
 */
function _fillNulls(results, points) {
  // Forward fill
  let last = null;
  for (let i = 0; i < results.length; i++) {
    if (results[i] !== null) { last = results[i]; }
    else if (last !== null)  { results[i] = last; }
  }
  // Backward fill (handles leading nulls)
  last = null;
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i] !== null) { last = results[i]; }
    else if (last !== null)  { results[i] = last; }
    else {
      results[i] = 0;
      console.warn(`[elevation] no elevation data at ${points[i]?.latitude},${points[i]?.longitude} — defaulting to 0 m`);
    }
  }
}

