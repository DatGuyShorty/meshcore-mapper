/**
 * buildings.js — Fetch building footprints from OpenStreetMap (via Overpass API)
 * and compute additional signal attenuation from traversal through buildings.
 * Exports: fetchBuildings, buildingLossDb
 */
import { earthBulgeM, segmentPolygonIntervals } from './propagation.js';
import { fetchDatasetElevations } from './elevation.js';
import { scheduledFetch } from './requestScheduler.js';

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const MIRROR_COOLDOWN_MS = {
  status406: 10 * 60 * 1000,
  status429: 2 * 60 * 1000,
  status5xx: 60 * 1000,
  network: 60 * 1000,
};
const _mirrorCooldownUntil = new Map();

// Tile-based cache: snap to a fixed 0.25° grid so nearby repeaters reuse the same tiles.
const TILE_SIZE = 0.25;  // degrees
const CACHE_V_OSM = 'bv2:';
const CACHE_V_DERIVED = 'bv3:'; // building heights prefer DSM-DEM derivation
const TILE_N    = 16;
const BUILDING_TILE_CONCURRENCY = 3;

function _mirrorInCooldown(base) {
  return (_mirrorCooldownUntil.get(base) ?? 0) > Date.now();
}

function _markMirrorCooldown(base, ms) {
  _mirrorCooldownUntil.set(base, Date.now() + Math.max(1000, ms));
}

function _pickMirror(attempt) {
  const available = OVERPASS_MIRRORS.filter(base => !_mirrorInCooldown(base));
  const pool = available.length ? available : OVERPASS_MIRRORS;
  return pool[attempt % pool.length];
}

function _abortError() {
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}

function _throwIfAborted(signal) {
  if (signal?.aborted) throw _abortError();
}

function _sleep(ms, signal) {
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

function _snapB(v) { return Math.floor(v / TILE_SIZE) * TILE_SIZE; }

function _tilesForBboxB(latMin, latMax, lonMin, lonMax, cacheVersion) {
  const tiles = [];
  for (let la = _snapB(latMin); la < latMax; la += TILE_SIZE) {
    for (let lo = _snapB(lonMin); lo < lonMax; lo += TILE_SIZE) {
      tiles.push({ la, lo, key: `${cacheVersion}${la.toFixed(4)}:${lo.toFixed(4)}` });
    }
  }
  return tiles;
}
const DEFAULT_WALL_LOSS_DB_PER_M = 0.5; // ~0.5 dB/m at 868 MHz (ITU-R P.2040 residential)

const _memCache     = new Map();
const MEM_CACHE_MAX = 8;

function _fallbackFeatureId(prefix, ring, bbox) {
  if (bbox) {
    return `${prefix}:bb:${bbox.latMin.toFixed(6)}:${bbox.latMax.toFixed(6)}:${bbox.lonMin.toFixed(6)}:${bbox.lonMax.toFixed(6)}:${ring?.length ?? 0}`;
  }
  if (!ring?.length) return `${prefix}:empty`;
  const first = ring[0];
  const mid = ring[Math.floor(ring.length / 2)] ?? first;
  const last = ring[ring.length - 1] ?? first;
  return `${prefix}:rg:${ring.length}:${first[0].toFixed(6)}:${first[1].toFixed(6)}:${mid[0].toFixed(6)}:${mid[1].toFixed(6)}:${last[0].toFixed(6)}:${last[1].toFixed(6)}`;
}

function _polygonCentroid(ring) {
  if (!ring?.length) return null;
  let lat = 0;
  let lon = 0;
  for (const [rla, rlo] of ring) {
    lat += rla;
    lon += rlo;
  }
  return { latitude: lat / ring.length, longitude: lon / ring.length };
}

async function _deriveBuildingHeightsFromDsmMinusDem(polygons, fallbackHeights, signal, datasetBatchConcurrency, sampleLimit = 0) {
  if (!polygons.length) return fallbackHeights;

  const sampleCount = Number.isFinite(sampleLimit) ? Math.max(0, Math.floor(sampleLimit)) : 0;
  const sampled = [];
  if (sampleCount > 0 && polygons.length > sampleCount) {
    const step = polygons.length / sampleCount;
    const seen = new Set();
    for (let i = 0; i < sampleCount; i++) {
      const idx = Math.min(polygons.length - 1, Math.floor(i * step));
      if (seen.has(idx)) continue;
      seen.add(idx);
      sampled.push({ idx, centroid: _polygonCentroid(polygons[idx]) ?? { latitude: 0, longitude: 0 } });
    }
  } else {
    for (let i = 0; i < polygons.length; i++) {
      sampled.push({ idx: i, centroid: _polygonCentroid(polygons[i]) ?? { latitude: 0, longitude: 0 } });
    }
  }
  const centroids = sampled.map(s => s.centroid);

  try {
    const fetchOpts = { signal, batchConcurrency: datasetBatchConcurrency };
    const [dem, dsm] = await Promise.all([
      fetchDatasetElevations(centroids, 'srtm30m', null, fetchOpts),
      fetchDatasetElevations(centroids, 'aster30m', null, fetchOpts),
    ]);

    const derived = fallbackHeights.slice();
    let applied = 0;
    for (let i = 0; i < sampled.length; i++) {
      const delta = dsm[i] - dem[i];
      if (!Number.isFinite(delta) || delta <= 0) continue;
      derived[sampled[i].idx] = Math.max(2, Math.min(180, delta));
      applied++;
    }
    console.info(`[buildings] DSM-DEM heights applied for ${applied}/${sampled.length} buildings (sampled from ${derived.length})`);
    return derived;
  } catch (err) {
    if (err?.cancelled || err?.name === 'AbortError') throw err;
    console.warn('[buildings] DSM-DEM height derivation failed, using OSM heights:', err.message);
    return fallbackHeights;
  }
}

function _buildTileIndex(polygons, bboxes, latMin, latMax, lonMin, lonMax) {
  if (polygons.length === 0) return null;
  const latSpan = (latMax - latMin) || 1;
  const lonSpan = (lonMax - lonMin) || 1;
  const tiles = Array.from({ length: TILE_N * TILE_N }, () => []);
  for (let pi = 0; pi < bboxes.length; pi++) {
    const bb   = bboxes[pi];
    const rMin = Math.max(0, Math.floor((bb.latMin - latMin) / latSpan * TILE_N));
    const rMax = Math.min(TILE_N - 1, Math.floor((bb.latMax - latMin) / latSpan * TILE_N));
    const cMin = Math.max(0, Math.floor((bb.lonMin - lonMin) / lonSpan * TILE_N));
    const cMax = Math.min(TILE_N - 1, Math.floor((bb.lonMax - lonMin) / lonSpan * TILE_N));
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) tiles[r * TILE_N + c].push(pi);
    }
  }
  return { tiles, latMin, latSpan, lonMin, lonSpan };
}

/**
 * Determine building height from OSM tags (m above ground).
 * Priority: `height` tag → `building:levels * 3` → default 5 m.
 */
function _buildingHeight(tags) {
  // Prefer explicit absolute height if available.
  if (tags?.height) {
    const h = parseFloat(tags.height);
    if (!isNaN(h) && h > 0) return h;
  }

  // Otherwise infer from levels with a type-aware floor height.
  if (tags?.['building:levels']) {
    const levels = parseFloat(tags['building:levels']);
    if (!isNaN(levels) && levels > 0) {
      const bType = String(tags?.building || '').toLowerCase();
      const floorH = (bType === 'industrial' || bType === 'warehouse' || bType === 'church' || bType === 'cathedral') ? 4.2 : 3.0;
      const roofH  = !isNaN(parseFloat(tags?.['roof:height'])) ? Math.max(0, parseFloat(tags['roof:height'])) : 1.0;
      return levels * floorH + roofH;
    }
  }

  // If min_height is set (raised structure), include it as baseline offset.
  const minH = !isNaN(parseFloat(tags?.min_height)) ? Math.max(0, parseFloat(tags.min_height)) : 0;
  const bType = String(tags?.building || '').toLowerCase();
  const base = (bType === 'industrial' || bType === 'warehouse') ? 8.0
             : (bType === 'church' || bType === 'cathedral') ? 12.0
             : (bType === 'garage' || bType === 'shed') ? 3.0
             : 5.0;
  return minH + base;
}

/**
 * Fetch one 0.25° tile of building footprints (mem-cache → SQLite → Overpass).
 * Tiles are shared across all repeaters — cached once, reused for every coverage run in the area.
 */
async function _fetchBuildingsTile(la, lo, key, {
  signal = null,
  datasetBatchConcurrency = 2,
  deriveObstacleHeights = false,
  derivationSampleLimit = 0,
} = {}) {
  _throwIfAborted(signal);
  if (_memCache.has(key)) {
    console.debug(`[buildings] mem-cache hit tile ${key}`);
    return _memCache.get(key);
  }
  const sqlCached = await window.electronAPI.cacheBuildingsLookup(key);
  if (sqlCached) {
    console.debug(`[buildings] SQLite hit tile ${key} — ${sqlCached.polygons.length} building(s)`);
    if (_memCache.size >= MEM_CACHE_MAX) _memCache.delete(_memCache.keys().next().value);
    _memCache.set(key, sqlCached);
    return sqlCached;
  }
  console.info(`[buildings] fetching tile ${key} from Overpass`);

  const tLatMax = (la + TILE_SIZE).toFixed(4);
  const tLonMax = (lo + TILE_SIZE).toFixed(4);
  const bbox  = `(${la},${lo},${tLatMax},${tLonMax})`;
  const query = `[out:json][timeout:60];(way["building"]${bbox};relation["building"]${bbox};);out geom tags;`;

  let res = null, lastErr = null;
  for (let attempt = 0; attempt < OVERPASS_MIRRORS.length * 3; attempt++) {
    _throwIfAborted(signal);
    const base = _pickMirror(attempt);
    if (attempt > 0) await _sleep(2000 * Math.ceil(attempt / OVERPASS_MIRRORS.length), signal);
    try {
      res = await scheduledFetch(base, {
        method: 'POST',
        headers: {
          'Accept': '*/*',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal,
        timeoutMs: 60000,
      });
    } catch (err) {
      if (signal?.aborted) throw _abortError();
      _markMirrorCooldown(base, MIRROR_COOLDOWN_MS.network);
      lastErr = err;
      continue;
    }
    if (res.status === 406) {
      _markMirrorCooldown(base, MIRROR_COOLDOWN_MS.status406);
      res = null;
      continue;
    }
    if (res.status === 429) {
      _markMirrorCooldown(base, MIRROR_COOLDOWN_MS.status429);
      res = null;
      continue;
    }
    if (res.status >= 500) {
      _markMirrorCooldown(base, MIRROR_COOLDOWN_MS.status5xx);
      res = null;
      continue;
    }
    break;
  }
  if (!res) throw new Error(`Overpass API unreachable: ${lastErr?.message ?? 'all mirrors rejected'}`);
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);

  const data = await res.json();
  const polygons = [], bboxes = [], heights = [], ids = [];
  const seenFeatureIds = new Set();

  const addRing = (ring, h, featureId) => {
    if (featureId && seenFeatureIds.has(featureId)) return;
    if (ring.length < 3) return;
    let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
    for (const [rla, rlo] of ring) {
      if (rla < la0) la0 = rla; if (rla > la1) la1 = rla;
      if (rlo < lo0) lo0 = rlo; if (rlo > lo1) lo1 = rlo;
    }
    polygons.push(ring);
    bboxes.push({ latMin: la0, latMax: la1, lonMin: lo0, lonMax: lo1 });
    heights.push(h);
    ids.push(featureId || _fallbackFeatureId('b', ring, bboxes[bboxes.length - 1]));
    if (featureId) seenFeatureIds.add(featureId);
  };

  for (const el of data.elements) {
    const h = _buildingHeight(el.tags);
    const baseFeatureId = `${el.type}:${el.id ?? 'na'}`;
    if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
      addRing(el.geometry.map(n => [n.lat, n.lon]), h, baseFeatureId);
    } else if (el.type === 'relation' && el.members) {
      for (let mi = 0; mi < el.members.length; mi++) {
        const m = el.members[mi];
        if (m.type !== 'way' || m.role === 'inner' || !m.geometry || m.geometry.length < 3) continue;
        addRing(m.geometry.map(n => [n.lat, n.lon]), h, `${baseFeatureId}:outer:${m.ref ?? mi}`);
      }
    }
  }

  const derivedHeights = deriveObstacleHeights
    ? await _deriveBuildingHeightsFromDsmMinusDem(
      polygons,
      heights,
      signal,
      datasetBatchConcurrency,
      derivationSampleLimit
    )
    : heights;
  console.info(`[buildings] tile ${key}: ${polygons.length} building(s)`);
  const tileData = { polygons, bboxes, heights: derivedHeights, ids };
  if (_memCache.size >= MEM_CACHE_MAX) _memCache.delete(_memCache.keys().next().value);
  _memCache.set(key, tileData);
  await window.electronAPI.cacheBuildingsStore(key, tileData);
  return tileData;
}

/**
 * Fetch building footprints within a bounding box.
 * Data is fetched and cached per 0.25° tile — nearby repeaters share the same tile data.
 * @returns {Promise<{ polygons, bboxes, heights, tileIndex }>}
 */
export async function fetchBuildings(latMin, latMax, lonMin, lonMax, options = {}) {
  const {
    signal = null,
    onProgress = null,
    tileConcurrency = BUILDING_TILE_CONCURRENCY,
    datasetBatchConcurrency = 2,
    deriveObstacleHeights = false,
    derivationSampleLimit = 100,
  } = options;
  _throwIfAborted(signal);
  const cacheVersion = deriveObstacleHeights ? CACHE_V_DERIVED : CACHE_V_OSM;
  const tiles = _tilesForBboxB(latMin, latMax, lonMin, lonMax, cacheVersion);
  const polygons = [], bboxes = [], heights = [], ids = [];
  const seenMerged = new Set();
  let completed = 0;
  let nextIdx = 0;
  const workersLimit = Math.max(1, Math.min(12, Math.floor(tileConcurrency)));

  onProgress?.({ source: 'buildings', completed, total: tiles.length });

  const workers = Math.min(workersLimit, tiles.length || 1);
  const runWorker = async () => {
    for (;;) {
      _throwIfAborted(signal);
      const idx = nextIdx++;
      if (idx >= tiles.length) return;
      const { la, lo, key } = tiles[idx];

      let td;
      try {
        td = await _fetchBuildingsTile(la, lo, key, {
          signal,
          datasetBatchConcurrency,
          deriveObstacleHeights,
          derivationSampleLimit,
        });
      }
      catch (e) {
        if (e?.cancelled || e?.name === 'AbortError') throw e;
        console.warn(`[buildings] tile ${key} failed, skipping:`, e);
        td = null;
      }

      if (td) {
        for (let i = 0; i < td.polygons.length; i++) {
          const poly = td.polygons[i];
          const bb = td.bboxes[i];
          const id = td.ids?.[i] || _fallbackFeatureId('b', poly, bb);
          if (seenMerged.has(id)) continue;
          seenMerged.add(id);
          polygons.push(td.polygons[i]);
          bboxes.push(td.bboxes[i]);
          heights.push(td.heights[i]);
          ids.push(id);
        }
      }

      completed++;
      onProgress?.({ source: 'buildings', completed, total: tiles.length });
    }
  };

  await Promise.all(Array.from({ length: workers }, () => runWorker()));

  console.info(`[buildings] merged ${polygons.length} building(s) from ${tiles.length} tile(s)`);
  const tileIndex = _buildTileIndex(polygons, bboxes, latMin, latMax, lonMin, lonMax);
  return { polygons, bboxes, heights, ids, tileIndex };
}

function _segmentCandidates(tileIndex, bboxes, lat1, lon1, lat2, lon2, polygonCount) {
  const latLo = Math.min(lat1, lat2), latHi = Math.max(lat1, lat2);
  const lonLo = Math.min(lon1, lon2), lonHi = Math.max(lon1, lon2);
  if (!tileIndex) {
    return Array.from({ length: polygonCount }, (_, i) => i)
      .filter(i => !(latHi < bboxes[i].latMin || latLo > bboxes[i].latMax || lonHi < bboxes[i].lonMin || lonLo > bboxes[i].lonMax));
  }

  const rMin = Math.max(0, Math.min(TILE_N - 1, Math.floor((latLo - tileIndex.latMin) / tileIndex.latSpan * TILE_N)));
  const rMax = Math.max(0, Math.min(TILE_N - 1, Math.floor((latHi - tileIndex.latMin) / tileIndex.latSpan * TILE_N)));
  const cMin = Math.max(0, Math.min(TILE_N - 1, Math.floor((lonLo - tileIndex.lonMin) / tileIndex.lonSpan * TILE_N)));
  const cMax = Math.max(0, Math.min(TILE_N - 1, Math.floor((lonHi - tileIndex.lonMin) / tileIndex.lonSpan * TILE_N)));
  const set = new Set();
  for (let r = Math.min(rMin, rMax); r <= Math.max(rMin, rMax); r++) {
    for (let c = Math.min(cMin, cMax); c <= Math.max(cMin, cMax); c++) {
      for (const i of tileIndex.tiles[r * TILE_N + c]) {
        const bb = bboxes[i];
        if (latHi < bb.latMin || latLo > bb.latMax || lonHi < bb.lonMin || lonLo > bb.lonMax) continue;
        set.add(i);
      }
    }
  }
  return set;
}

/**
 * Compute total building attenuation (dB) along a terrain profile path.
 * The ray is attenuated when it passes through a building footprint below the rooftop.
 *
 * @param {Float64Array} profileLats   - latitude of each profile sample
 * @param {Float64Array} profileLons   - longitude of each profile sample
 * @param {number[]|Float32Array}  profileElevs
 * @param {number}  txAntH
 * @param {number}  rxAntH
 * @param {Array}   polygons
 * @param {Array}   bboxes
 * @param {number[]} heights     - building height (m above terrain) per polygon
 * @param {object|null} tileIndex
 * @param {number}  totalDistM
 * @param {number}  lossPerMeterDb
 * @returns {number} total building loss in dB
 */
export function buildingLossDb(profileLats, profileLons, profileElevs, txAntH, rxAntH,
                               polygons, bboxes, heights, tileIndex, totalDistM, lossPerMeterDb = DEFAULT_WALL_LOSS_DB_PER_M) {
  if (!polygons || polygons.length === 0) return 0;
  const n = profileLats.length;
  const segLen = totalDistM / (n - 1);
  const txAbsElev = (profileElevs?.[0]     ?? 0) + txAntH;
  const rxAbsElev = (profileElevs?.[n - 1] ?? 0) + rxAntH;
  const wallCrossLossDb = 14; // Typical external wall penetration (sub-GHz urban average)
  let loss = 0;
  for (let si = 0; si < n - 1; si++) {
    const lat1 = profileLats[si], lon1 = profileLons[si];
    const lat2 = profileLats[si + 1], lon2 = profileLons[si + 1];
    const candidates = _segmentCandidates(tileIndex, bboxes, lat1, lon1, lat2, lon2, polygons.length);
    for (const i of candidates) {
      const intervals = segmentPolygonIntervals(lat1, lon1, lat2, lon2, polygons[i]);
      for (const [a, b] of intervals) {
        const f = (a + b) / 2;
        const t = (si + f) / (n - 1);
        const rayAbsElev  = txAbsElev + (rxAbsElev - txAbsElev) * t;
        const terrainElev = (profileElevs?.[si] ?? 0) + ((profileElevs?.[si + 1] ?? 0) - (profileElevs?.[si] ?? 0)) * f;
        const rooftopElev = terrainElev + earthBulgeM(t, totalDistM) + (heights?.[i] ?? 5);
        if (rayAbsElev <= rooftopElev) {
          loss += segLen * (b - a) * lossPerMeterDb;
          if (a > 1e-6) loss += wallCrossLossDb;
          if (b < 1 - 1e-6) loss += wallCrossLossDb;
        }
      }
    }
  }
  return loss;
}
