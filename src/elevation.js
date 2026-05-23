/**
 * elevation.js
 * Fetches terrain elevation data using high-accuracy APIs, with SQLite caching.
 * Cache is keyed on lat/lon rounded to 4 decimal places (~11m precision).
 */

const ELEVATION_APIS = [
  {
    url: 'https://api.opentopodata.org/v1/srtm30m,aster30m',
    maxBatch: 100,
    delayMs: 1100,
    name: 'opentopodata/srtm30m+aster30m',
    body: 'pipe',
  },
  {
    url: 'https://api.open-elevation.com/api/v1/lookup',
    maxBatch: 256,
    delayMs: 500,
    name: 'open-elevation.com',
    body: 'array',
  },
];

function _abortError() {
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}

function _throwIfAborted(signal) {
  if (signal?.aborted) throw _abortError();
}

function _isAbort(err) {
  return err?.cancelled || err?.name === 'AbortError';
}

function sleep(ms, signal) {
  _throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(cleanup, ms);
    function cleanup() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(_abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
const round4 = v => Math.round(v * 1e4) / 1e4;

const _elevMem = new Map();
const ELEV_MEM_MAX = 500_000;

function _metric(stats, key, amount = 1) {
  if (!stats) return;
  stats[key] = (stats[key] ?? 0) + amount;
}

function _key(lat, lon) {
  return `${lat},${lon}`;
}

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

function _dedupeRounded(points) {
  const unique = [];
  const byKey = new Map();
  const pointToUnique = new Int32Array(points.length);

  for (let i = 0; i < points.length; i++) {
    const lat = round4(points[i].latitude);
    const lon = round4(points[i].longitude);
    const key = _key(lat, lon);
    let idx = byKey.get(key);
    if (idx === undefined) {
      idx = unique.length;
      byKey.set(key, idx);
      unique.push({ lat, lon, key, elev: undefined });
    }
    pointToUnique[i] = idx;
  }

  return { unique, pointToUnique };
}

async function _lookupCache(points) {
  if (window.electronAPI?.cacheElevationsLookupMany) {
    return window.electronAPI.cacheElevationsLookupMany(points);
  }

  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const p of points) {
    if (p.lat < latMin) latMin = p.lat;
    if (p.lat > latMax) latMax = p.lat;
    if (p.lon < lonMin) lonMin = p.lon;
    if (p.lon > lonMax) lonMax = p.lon;
  }
  return window.electronAPI.cacheElevationsLookupBbox({ latMin, latMax, lonMin, lonMax });
}

/**
 * Fetch elevations for an array of { latitude, longitude } points.
 * Returns a matching array of elevation values in metres.
 *
 * @param {Array<{latitude: number, longitude: number}>} points
 * @param {object|null} stats optional mutable metrics object
 * @returns {Promise<number[]>}
 */
export async function fetchElevations(points, stats = null, options = {}) {
  if (!points.length) return [];
  const signal = options.signal;
  _throwIfAborted(signal);

  _metric(stats, 'calls');
  _metric(stats, 'requestedPoints', points.length);

  const { unique, pointToUnique } = _dedupeRounded(points);
  _metric(stats, 'uniquePoints', unique.length);
  _metric(stats, 'duplicatePoints', points.length - unique.length);

  const missingMem = [];
  for (const item of unique) {
    if (_elevMem.has(item.key)) {
      item.elev = _elevMem.get(item.key);
      _metric(stats, 'memHits');
    } else {
      missingMem.push(item);
    }
  }

  if (missingMem.length) {
    _throwIfAborted(signal);
    const cachedRows = await _lookupCache(missingMem.map(({ lat, lon }) => ({ lat, lon })));
    _throwIfAborted(signal);
    const dbMap = new Map();
    for (const row of cachedRows) {
      const key = _key(row.lat, row.lon);
      dbMap.set(key, row.elev);
      _elevMemSet(key, row.elev);
    }

    const missingApi = [];
    for (const item of missingMem) {
      if (dbMap.has(item.key)) {
        item.elev = dbMap.get(item.key);
        _metric(stats, 'dbHits');
      } else {
        missingApi.push(item);
      }
    }

    if (missingApi.length) {
      _metric(stats, 'cacheMisses', missingApi.length);
      _metric(stats, 'apiPoints', missingApi.length);
      const missingPoints = missingApi.map(({ lat, lon }) => ({ latitude: lat, longitude: lon }));
      const fetched = await _fetchFromAPI(missingPoints, stats, signal);
      const toStore = [];

      for (let i = 0; i < missingApi.length; i++) {
        const item = missingApi[i];
        item.elev = fetched[i];
        _elevMemSet(item.key, fetched[i]);
        toStore.push({ lat: item.lat, lon: item.lon, elev: fetched[i] });
      }

      _throwIfAborted(signal);
      await window.electronAPI.cacheElevationsStore(toStore);
      _metric(stats, 'storedPoints', toStore.length);
      console.debug(`[elevation] stored ${toStore.length} new points to SQLite`);
    }
  }

  const results = new Array(points.length);
  for (let i = 0; i < pointToUnique.length; i++) {
    results[i] = unique[pointToUnique[i]].elev;
  }

  console.info(
    `[elevation] requested=${points.length}, unique=${unique.length}, ` +
    `mem=${stats?.memHits ?? 0}, db=${stats?.dbHits ?? 0}, api=${stats?.apiPoints ?? 0}`
  );
  return results;
}

async function _fetchFromAPI(points, stats, signal) {
  let lastErr = null;
  for (const api of ELEVATION_APIS) {
    try {
      return await _fetchFromSingleAPI(api, points, stats, signal);
    } catch (err) {
      if (_isAbort(err)) throw err;
      console.warn(`[elevation] ${api.name} failed: ${err.message} - trying next source`);
      lastErr = err;
    }
  }
  throw new Error(`All elevation sources exhausted: ${lastErr?.message ?? 'unknown'}`);
}

function _requestBody(api, batch) {
  if (api.body === 'pipe') {
    return JSON.stringify({
      locations: batch.map(p => `${p.latitude},${p.longitude}`).join('|'),
      interpolation: 'bilinear',
    });
  }
  return JSON.stringify({ locations: batch });
}

async function _fetchFromSingleAPI(api, points, stats, signal) {
  const results = new Array(points.length).fill(null);

  for (let i = 0; i < points.length; i += api.maxBatch) {
    _throwIfAborted(signal);
    if (i > 0) await sleep(api.delayMs, signal);

    const batch = points.slice(i, i + api.maxBatch);
    let resp = null, lastErr = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      _throwIfAborted(signal);
      if (attempt > 0) await sleep(2000 * attempt, signal);
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        _metric(stats, 'apiRequests');
        resp = await fetch(api.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: _requestBody(api, batch),
          signal: controller.signal,
        });
        clearTimeout(timer);
      } catch (err) {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) throw _abortError();
        lastErr = err;
        continue;
      }
      signal?.removeEventListener('abort', onAbort);

      if (resp.status === 429) {
        resp = null;
        await sleep(5000, signal);
        continue;
      }
      if (resp.status >= 400) {
        resp = null;
        break;
      }
      break;
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

  _fillNulls(results, points);
  return results;
}

function _fillNulls(results, points) {
  let last = null;
  for (let i = 0; i < results.length; i++) {
    if (results[i] !== null) last = results[i];
    else if (last !== null) results[i] = last;
  }

  last = null;
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i] !== null) last = results[i];
    else if (last !== null) results[i] = last;
    else {
      results[i] = 0;
      console.warn(`[elevation] no elevation data at ${points[i]?.latitude},${points[i]?.longitude} - defaulting to 0 m`);
    }
  }
}
