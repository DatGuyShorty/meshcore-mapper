/**
 * elevation.js
 * Fetches terrain elevation data using high-accuracy APIs, with SQLite caching.
 * Cache is keyed on lat/lon rounded to 4 decimal places (~11m precision).
 */
import { scheduledFetch } from './requestScheduler.js';

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

const OPENTOPO_BASE = 'https://api.opentopodata.org/v1';

const DEM_TILE_SOURCE = 'terrarium';
const DEM_TILE_MIN_ZOOM = 10;
const DEM_TILE_MAX_ZOOM = 15;
const DEM_TILE_SIZE = 256;
const DEM_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const DEM_TILE_FETCH_CONCURRENCY = 6;
const DATASET_BATCH_CONCURRENCY = 2;

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
const round6 = v => Math.round(v * 1e6) / 1e6;

const _elevMem = new Map();
const ELEV_MEM_MAX = 500_000;
const _demTileMem = new Map();
const DEM_TILE_MEM_MAX = 1024;

function _metric(stats, key, amount = 1) {
  if (!stats) return;
  stats[key] = (stats[key] ?? 0) + amount;
}

function _key(lat, lon) {
  return `${lat},${lon}`;
}

function _demKey(source, z, x, y) {
  return `${source}:${z}:${x}:${y}`;
}

function _toUint8Array(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function _demTileMemSet(k, v) {
  if (_demTileMem.size >= DEM_TILE_MEM_MAX) {
    const evict = Math.ceil(DEM_TILE_MEM_MAX * 0.25);
    let count = 0;
    for (const key of _demTileMem.keys()) {
      _demTileMem.delete(key);
      if (++count >= evict) break;
    }
  }
  _demTileMem.set(k, v);
}

function _latLonToTilePoint(lat, lon, z) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const n = 2 ** z;
  const x = n * ((lon + 180) / 360);
  const latRad = clampedLat * Math.PI / 180;
  const y = n * (1 - (Math.log(Math.tan(latRad) + (1 / Math.cos(latRad))) / Math.PI)) / 2;

  const tx = Math.max(0, Math.min(n - 1, Math.floor(x)));
  const ty = Math.max(0, Math.min(n - 1, Math.floor(y)));
  const px = Math.max(0, Math.min(DEM_TILE_SIZE - 1, (x - tx) * DEM_TILE_SIZE));
  const py = Math.max(0, Math.min(DEM_TILE_SIZE - 1, (y - ty) * DEM_TILE_SIZE));
  return { tx, ty, px, py };
}

function _webMercatorPixelMeters(lat, z) {
  return 156543.034 * Math.cos(lat * Math.PI / 180) / (2 ** z);
}

function _estimatePointSpacingM(points) {
  if (!points || points.length < 2) return 0;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of points) {
    const lat = p.latitude ?? p.lat;
    const lon = p.longitude ?? p.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  if (!Number.isFinite(minLat) || minLat === maxLat && minLon === maxLon) return 0;

  const latMid = (minLat + maxLat) / 2;
  const widthM = Math.abs(maxLon - minLon) * 111320 * Math.cos(latMid * Math.PI / 180);
  const heightM = Math.abs(maxLat - minLat) * 110574;
  const side = Math.max(1, Math.round(Math.sqrt(points.length)));
  return Math.max(widthM, heightM) / Math.max(1, side - 1);
}

function _chooseDemTileZoom(points, options = {}) {
  const explicit = Number(options.demTileZoom);
  if (Number.isFinite(explicit)) {
    return Math.max(DEM_TILE_MIN_ZOOM, Math.min(DEM_TILE_MAX_ZOOM, Math.round(explicit)));
  }

  const targetResolutionM = Number.isFinite(options.targetResolutionM)
    ? options.targetResolutionM
    : _estimatePointSpacingM(points);

  if (!Number.isFinite(targetResolutionM) || targetResolutionM <= 0) return DEM_TILE_MAX_ZOOM;

  const first = points.find(p => Number.isFinite(p.latitude ?? p.lat));
  const lat = first ? (first.latitude ?? first.lat) : 0;
  const desiredPixelM = Math.max(2, targetResolutionM / 3);

  for (let z = DEM_TILE_MIN_ZOOM; z <= DEM_TILE_MAX_ZOOM; z++) {
    if (_webMercatorPixelMeters(lat, z) <= desiredPixelM) return z;
  }
  return DEM_TILE_MAX_ZOOM;
}

async function _decodeTilePng(bytes) {
  const blob = new Blob([bytes], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);

  let canvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width: imageData.width,
    height: imageData.height,
    data: imageData.data,
  };
}

function _sampleTerrariumPixel(tile, x, y) {
  const idx = (y * tile.width + x) * 4;
  const r = tile.data[idx];
  const g = tile.data[idx + 1];
  const b = tile.data[idx + 2];
  return (r * 256 + g + b / 256) - 32768;
}

function _sampleTerrariumElevation(tile, px, py) {
  const x = Math.max(0, Math.min(tile.width - 1, px));
  const y = Math.max(0, Math.min(tile.height - 1, py));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(tile.width - 1, x0 + 1);
  const y1 = Math.min(tile.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const e00 = _sampleTerrariumPixel(tile, x0, y0);
  const e10 = _sampleTerrariumPixel(tile, x1, y0);
  const e01 = _sampleTerrariumPixel(tile, x0, y1);
  const e11 = _sampleTerrariumPixel(tile, x1, y1);
  return e00 * (1 - fx) * (1 - fy) +
         e10 * fx * (1 - fy) +
         e01 * (1 - fx) * fy +
         e11 * fx * fy;
}

async function _mapWithConcurrency(items, limit, mapper) {
  if (!items.length) return [];
  const concurrency = Math.max(1, Math.min(limit, items.length));
  const out = new Array(items.length);
  let next = 0;

  const runWorker = async () => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      out[idx] = await mapper(items[idx], idx);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return out;
}

async function _getDemTile(source, z, x, y, stats, signal) {
  const key = _demKey(source, z, x, y);
  if (_demTileMem.has(key)) {
    _metric(stats, 'demTileMemHits');
    return _demTileMem.get(key);
  }

  _throwIfAborted(signal);
  const cachedBytes = await window.electronAPI.cacheDemTileGet({ source, z, x, y });
  const bytes = _toUint8Array(cachedBytes);
  if (bytes?.byteLength) {
    _metric(stats, 'demTileDbHits');
    const tile = await _decodeTilePng(bytes);
    _demTileMemSet(key, tile);
    return tile;
  }

  _metric(stats, 'demTileNetFetches');
  const url = DEM_TILE_URL
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const resp = await scheduledFetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`DEM tile HTTP ${resp.status} for ${z}/${x}/${y}`);

    const arr = new Uint8Array(await resp.arrayBuffer());
    await window.electronAPI.cacheDemTileStore({ source, z, x, y, data: arr });
    const tile = await _decodeTilePng(arr);
    _demTileMemSet(key, tile);
    return tile;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

async function _processDemTileGroups(tileGroups, stats, signal, options = {}) {
  const onProgress = options.onProgress;
  const configuredConcurrency = Number.isFinite(options.concurrency)
    ? Math.max(1, Math.min(16, Math.floor(options.concurrency)))
    : DEM_TILE_FETCH_CONCURRENCY;
  const groups = Array.isArray(tileGroups) ? tileGroups : Array.from(tileGroups);
  const apiFallback = [];
  let completedTiles = 0;
  let nextIndex = 0;

  onProgress?.({ completed: completedTiles, total: groups.length });
  if (!groups.length) return apiFallback;

  const workers = Math.min(configuredConcurrency, groups.length);
  const runWorker = async () => {
    for (;;) {
      _throwIfAborted(signal);
      const idx = nextIndex++;
      if (idx >= groups.length) return;
      const group = groups[idx];

      _metric(stats, 'demTileRequests');
      try {
        const tile = await _getDemTile(DEM_TILE_SOURCE, group.z, group.x, group.y, stats, signal);
        for (const s of group.samples) {
          const elev = _sampleTerrariumElevation(tile, s.px, s.py);
          if (Number.isFinite(elev)) {
            s.item.elev = elev;
            _elevMemSet(s.item.key, elev);
            _metric(stats, 'demTilePoints');
          } else {
            apiFallback.push(s.item);
          }
        }
      } catch (err) {
        if (_isAbort(err)) throw err;
        _metric(stats, 'demTileMisses');
        console.warn(`[elevation] DEM tile ${group.z}/${group.x}/${group.y} failed: ${err.message}`);
        for (const s of group.samples) apiFallback.push(s.item);
      }

      completedTiles++;
      onProgress?.({ completed: completedTiles, total: groups.length });
    }
  };

  await Promise.all(Array.from({ length: workers }, () => runWorker()));
  return apiFallback;
}

async function _fillFromDemTiles(items, stats, signal, options = {}) {
  if (!items.length || !window.electronAPI?.cacheDemTileGet || !window.electronAPI?.cacheDemTileStore) {
    return items;
  }

  const demTileZoom = _chooseDemTileZoom(items, options);
  if (stats) stats.demTileZoom = Math.max(stats.demTileZoom ?? 0, demTileZoom);
  const tileGroups = new Map();
  for (const item of items) {
    const p = _latLonToTilePoint(item.lat, item.lon, demTileZoom);
    const key = `${demTileZoom}/${p.tx}/${p.ty}`;
    let group = tileGroups.get(key);
    if (!group) {
      group = { z: demTileZoom, x: p.tx, y: p.ty, samples: [] };
      tileGroups.set(key, group);
    }
    group.samples.push({ item, px: p.px, py: p.py });
  }

  await _processDemTileGroups(tileGroups.values(), stats, signal);

  return items.filter(item => item.elev === undefined);
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
      const toStore = [];

      const unresolved = await _fillFromDemTiles(missingApi, stats, signal);

      for (const item of missingApi) {
        if (item.elev !== undefined) {
          toStore.push({ lat: item.lat, lon: item.lon, elev: item.elev });
        }
      }

      if (unresolved.length) {
        _metric(stats, 'apiPoints', unresolved.length);
        const missingPoints = unresolved.map(({ lat, lon }) => ({ latitude: lat, longitude: lon }));
        const fetched = await _fetchFromAPI(missingPoints, stats, signal);

        for (let i = 0; i < unresolved.length; i++) {
          const item = unresolved[i];
          item.elev = fetched[i];
          _elevMemSet(item.key, fetched[i]);
          toStore.push({ lat: item.lat, lon: item.lon, elev: fetched[i] });
        }
      }

      _throwIfAborted(signal);
      if (toStore.length) {
        await window.electronAPI.cacheElevationsStore(toStore);
        _metric(stats, 'storedPoints', toStore.length);
        console.debug(`[elevation] stored ${toStore.length} new points to SQLite`);
      }
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

/**
 * Fetch elevations for a large regular grid directly from DEM raster tiles.
 * Bypasses the point DB entirely — tiles are the cache.
 * Falls back to the API only for points whose tile couldn't be fetched.
 *
 * @param {Array<{latitude: number, longitude: number}>} points
 * @param {object|null} stats
 * @param {{signal?: AbortSignal}} options
 * @returns {Promise<number[]>}
 */
export async function fetchElevationsFromTiles(points, stats = null, options = {}) {
  if (!points.length) return [];
  const signal = options.signal;
  const onProgress = options.onProgress;
  const demTileConcurrency = options.demTileConcurrency;
  const demTileZoom = _chooseDemTileZoom(points, options);
  if (stats) stats.demTileZoom = Math.max(stats.demTileZoom ?? 0, demTileZoom);
  _throwIfAborted(signal);

  _metric(stats, 'calls');
  _metric(stats, 'requestedPoints', points.length);
  const startTileRequests = stats?.demTileRequests ?? 0;
  const startTilePoints = stats?.demTilePoints ?? 0;
  const startApiPoints = stats?.apiPoints ?? 0;

  // Build work items, checking in-memory cache first.
  const items = points.map((p, i) => {
    const lat = round6(p.latitude);
    const lon = round6(p.longitude);
    const key = _key(lat, lon);
    const cached = _elevMem.get(key);
    if (cached !== undefined) {
      _metric(stats, 'memHits');
      return { i, lat, lon, key, elev: cached };
    }
    return { i, lat, lon, key, elev: undefined };
  });

  const missing = items.filter(it => it.elev === undefined);

  if (missing.length) {
    // Group by DEM tile, fetch each tile once, sample all points in it.
    const tileGroups = new Map();
    for (const item of missing) {
      const p = _latLonToTilePoint(item.lat, item.lon, demTileZoom);
      const tileKey = `${demTileZoom}/${p.tx}/${p.ty}`;
      let group = tileGroups.get(tileKey);
      if (!group) {
        group = { z: demTileZoom, x: p.tx, y: p.ty, samples: [] };
        tileGroups.set(tileKey, group);
      }
      group.samples.push({ item, px: p.px, py: p.py });
    }

    const apiFallback = await _processDemTileGroups(tileGroups.values(), stats, signal, {
      onProgress,
      concurrency: demTileConcurrency,
    });

    if (apiFallback.length) {
      _metric(stats, 'apiPoints', apiFallback.length);
      const apiPoints = apiFallback.map(({ lat, lon }) => ({ latitude: lat, longitude: lon }));
      const fetched = await _fetchFromAPI(apiPoints, stats, signal);
      for (let i = 0; i < apiFallback.length; i++) {
        apiFallback[i].elev = fetched[i];
        _elevMemSet(apiFallback[i].key, fetched[i]);
      }
    }
  }

  const results = new Array(points.length);
  for (const it of items) results[it.i] = it.elev ?? 0;

  console.info(
    `[elevation/tiles] requested=${points.length}, ` +
    `z=${demTileZoom}, ` +
    `mem=${stats?.memHits ?? 0}, tileRequests=${(stats?.demTileRequests ?? 0) - startTileRequests}, ` +
    `tileSamples=${(stats?.demTilePoints ?? 0) - startTilePoints}, api=${(stats?.apiPoints ?? 0) - startApiPoints}`
  );
  return results;
}

/**
 * Fetch elevations from a specific OpenTopoData dataset without point-DB caching.
 * Useful when deriving above-ground heights from DSM-DEM.
 *
 * @param {Array<{latitude: number, longitude: number}>} points
 * @param {string} dataset e.g. "srtm30m" or "aster30m"
 * @param {object|null} stats
 * @param {{signal?: AbortSignal}} options
 * @returns {Promise<number[]>}
 */
export async function fetchDatasetElevations(points, dataset, stats = null, options = {}) {
  if (!points.length) return [];
  if (!dataset || typeof dataset !== 'string') {
    throw new Error('fetchDatasetElevations requires a dataset name');
  }
  const signal = options.signal;
  const batchConcurrency = Number.isFinite(options.batchConcurrency)
    ? Math.max(1, Math.min(4, Math.floor(options.batchConcurrency)))
    : DATASET_BATCH_CONCURRENCY;
  _throwIfAborted(signal);

  _metric(stats, 'datasetCalls');
  _metric(stats, 'datasetRequestedPoints', points.length);

  const api = {
    url: `${OPENTOPO_BASE}/${encodeURIComponent(dataset)}`,
    maxBatch: 100,
    delayMs: 0,
    name: `opentopodata/${dataset}`,
    body: 'pipe',
  };

  if (points.length <= api.maxBatch || batchConcurrency === 1) {
    return _fetchFromSingleAPI(api, points, stats, signal);
  }

  const chunks = [];
  for (let i = 0; i < points.length; i += api.maxBatch) {
    chunks.push({ start: i, pts: points.slice(i, i + api.maxBatch) });
  }

  const results = new Array(points.length);
  await _mapWithConcurrency(chunks, batchConcurrency, async (chunk) => {
    _throwIfAborted(signal);
    const vals = await _fetchFromSingleAPI(api, chunk.pts, stats, signal);
    for (let i = 0; i < vals.length; i++) {
      results[chunk.start + i] = vals[i];
    }
  });

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
      try {
        _metric(stats, 'apiRequests');
        resp = await scheduledFetch(api.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: _requestBody(api, batch),
          signal,
          timeoutMs: 25000,
        });
      } catch (err) {
        if (signal?.aborted) throw _abortError();
        lastErr = err;
        continue;
      }

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
