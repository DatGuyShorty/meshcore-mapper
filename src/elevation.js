/**
 * elevation.js
 * Fetches SRTM elevation data from open-elevation.com (falling back to opentopodata.org),
 * with SQLite caching. Cache is keyed on lat/lon rounded to 4 decimal places (~11m precision).
 * No DOM dependencies — safe to call from any context.
 */

// Primary and fallback elevation API endpoints (same request/response format)
const ELEVATION_APIS = [
  'https://api.open-elevation.com/api/v1/lookup',
  'https://api.opentopodata.org/v1/srtm30m',
];
const BATCH_SIZE = 256;
const BATCH_DELAY_MS = 400;

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const round4 = v  => Math.round(v * 1e4) / 1e4;

/**
 * Fetch elevations for an array of { latitude, longitude } points.
 * Returns a matching array of elevation values in metres.
 * Uses a single bbox SQL query to check the cache (P11), then fetches only missing points.
 *
 * @param {Array<{latitude: number, longitude: number}>} points
 * @returns {Promise<number[]>}
 */
export async function fetchElevations(points) {
  const rounded = points.map(p => ({ lat: round4(p.latitude), lon: round4(p.longitude) }));

  // P11: single bbox query instead of N individual lookups
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const p of rounded) {
    if (p.lat < latMin) latMin = p.lat;
    if (p.lat > latMax) latMax = p.lat;
    if (p.lon < lonMin) lonMin = p.lon;
    if (p.lon > lonMax) lonMax = p.lon;
  }
  const cachedRows = await window.electronAPI.cacheElevationsLookupBbox({ latMin, latMax, lonMin, lonMax });

  const cacheMap = new Map();
  for (const row of cachedRows) cacheMap.set(`${row.lat},${row.lon}`, row.elev);

  const results    = new Array(points.length);
  const missingIdx = [];
  for (let i = 0; i < rounded.length; i++) {
    const v = cacheMap.get(`${rounded[i].lat},${rounded[i].lon}`);
    if (v !== undefined) {
      results[i] = v;
    } else {
      missingIdx.push(i);
    }
  }

  if (missingIdx.length === 0) {
    console.debug(`[elevation] cache hit — all ${points.length} points served from cache`);
    return results;
  }
  console.info(`[elevation] cache: ${points.length - missingIdx.length} hits, ${missingIdx.length} misses — fetching from API`);

  // Fetch only the uncached points from the API
  const missingPoints = missingIdx.map(i => ({ latitude: rounded[i].lat, longitude: rounded[i].lon }));
  const fetched = await _fetchFromAPI(missingPoints);

  const toStore = [];
  for (let j = 0; j < missingIdx.length; j++) {
    const idx = missingIdx[j];
    results[idx] = fetched[j];
    toStore.push({ lat: rounded[idx].lat, lon: rounded[idx].lon, elev: fetched[j] });
  }

  await window.electronAPI.cacheElevationsStore(toStore);
  console.debug(`[elevation] stored ${toStore.length} new elevation points to cache`);
  return results;
}

async function _fetchFromAPI(points) {
  const results = new Array(points.length).fill(0);

  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(BATCH_DELAY_MS);

    const batch = points.slice(i, i + BATCH_SIZE);
    let resp = null;
    let lastErr = null;

    // A3/F3: try each API in order; fall back to next on 5xx or timeout
    outer:
    for (let api = 0; api < ELEVATION_APIS.length; api++) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await sleep(2000 * attempt);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          resp = await fetch(ELEVATION_APIS[api], {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ locations: batch }),
            signal: controller.signal,
          });
          clearTimeout(timer);
        } catch (err) {
          clearTimeout(timer);
          lastErr = err;
          continue;
        }
        if (resp.status === 429) { resp = null; continue; }
        if (resp.status >= 500)  { resp = null; break; } // try next API
        break outer;
      }
    }
    if (!resp) throw new Error(`Elevation API unreachable: ${lastErr?.message ?? '429/5xx after all attempts'}`);
    if (!resp.ok) throw new Error(`Elevation API error: ${resp.status}`);
    console.debug(`[elevation] API response OK for batch ${i}–${Math.min(i + BATCH_SIZE, points.length)} (${resp.url?.split('/')[2] ?? 'unknown'})`);
    const data = await resp.json();
    if (data.results.length !== batch.length) {
      console.warn(`[elevation] Expected ${batch.length} results, got ${data.results.length} — truncated response`);
    }
    data.results.forEach((r, j) => {
      if (r.elevation === null || r.elevation === undefined) {
        console.warn(`[elevation] null elevation at ${batch[j].latitude},${batch[j].longitude} — defaulting to 0 m`);
      }
      results[i + j] = r.elevation ?? 0;
    });
  }

  return results;
}

