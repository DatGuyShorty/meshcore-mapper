/**
 * foliage.js — Fetch vegetation polygons from OpenStreetMap (via Overpass API)
 * and compute additional signal attenuation from forest traversal.
 * Exports: fetchFoliage, foliageLossDb
 */
import { earthBulgeM, segmentPolygonIntervals } from './propagation.js';

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Tile-based cache: snap to a fixed 0.25° grid so nearby repeaters reuse the same data.
// Old 'v3:' per-repeater exact-bbox keys become unreachable (stale but harmless).
const TILE_SIZE = 0.25;  // degrees — 0.25° ≈ 27 km lat; a 15 km radius spans ≤ 4 tiles
const CACHE_V   = 'fv4:'; // bumped; key format is now tile-based

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

function _snap(v) { return Math.floor(v / TILE_SIZE) * TILE_SIZE; }

/** Return 0.25° tile descriptors covering the given bbox. */
function _tilesForBbox(latMin, latMax, lonMin, lonMax) {
  const tiles = [];
  for (let la = _snap(latMin); la < latMax; la += TILE_SIZE) {
    for (let lo = _snap(lonMin); lo < lonMax; lo += TILE_SIZE) {
      tiles.push({ la, lo, key: `${CACHE_V}${la.toFixed(4)}:${lo.toFixed(4)}` });
    }
  }
  return tiles;
}

// P2: tile grid resolution for spatial index
const TILE_N = 16;

// Average canopy heights (m above terrain) per vegetation type
const CANOPY_HEIGHTS = {
  forest:   20,   // landuse=forest — mature closed forest
  wood:     20,   // natural=wood
  scrub:     2,   // natural=scrub — low shrubs
  orchard:   4,   // landuse=orchard
  heath:     0.5, // natural=heath — open heathland
  vineyard:  2,   // landuse=vineyard — trellised vines
  wetland:   5,   // natural=wetland — reeds / mangrove
  shrubbery: 2,   // landuse=shrubbery
  hedge:     2,   // barrier=hedge
  greenhouse_horticulture: 4, // landuse=greenhouse_horticulture
};

// B3: multi-entry in-memory cache (LRU-capped at 8 entries)
const _memCache    = new Map();
const MEM_CACHE_MAX = 8;

/**
 * P2: Build a simple tile-grid spatial index for fast polygon lookup.
 * Returns null if there are no polygons.
 */
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
 * Fetch one 0.25° tile of foliage polygons (mem-cache → SQLite → Overpass).
 * Tiles are shared across all repeaters — cached once, reused for every coverage run in the area.
 */
async function _fetchFoliageTile(la, lo, key, { signal = null } = {}) {
  _throwIfAborted(signal);
  if (_memCache.has(key)) {
    console.debug(`[foliage] mem-cache hit tile ${key}`);
    return _memCache.get(key);
  }
  const sqlCached = await window.electronAPI.cacheFoliageLookup(key);
  if (sqlCached) {
    console.debug(`[foliage] SQLite hit tile ${key} — ${sqlCached.polygons.length} polygon(s)`);
    if (_memCache.size >= MEM_CACHE_MAX) _memCache.delete(_memCache.keys().next().value);
    _memCache.set(key, sqlCached);
    return sqlCached;
  }
  console.info(`[foliage] fetching tile ${key} from Overpass`);

  const tLatMax = (la + TILE_SIZE).toFixed(4);
  const tLonMax = (lo + TILE_SIZE).toFixed(4);
  const bbox = `(${la},${lo},${tLatMax},${tLonMax})`;
  const filters = [
    ['landuse', 'forest'], ['natural', 'wood'],
    ['natural', 'scrub'],  ['landuse', 'orchard'],
    ['natural', 'heath'],  ['landuse', 'vineyard'],
    ['natural', 'wetland'], ['landuse', 'shrubbery'],
    ['landuse', 'greenhouse_horticulture'],
  ].flatMap(([k, v]) => [`way["${k}"="${v}"]${bbox};`, `relation["${k}"="${v}"]${bbox};`]).join('')
  + `way["barrier"="hedge"]${bbox};`; // hedges as ways, not areas
  const query = `[out:json][timeout:60];(${filters});out geom;`;

  let res = null, lastErr = null;
  for (let attempt = 0; attempt < OVERPASS_MIRRORS.length * 2; attempt++) {
    _throwIfAborted(signal);
    const base = OVERPASS_MIRRORS[attempt % OVERPASS_MIRRORS.length];
    const url  = `${base}?data=${encodeURIComponent(query)}`;
    if (attempt > 0) await _sleep(2000 * Math.ceil(attempt / OVERPASS_MIRRORS.length), signal);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      res = await fetch(url, { headers: { 'Accept': '*/*' }, signal: controller.signal });
      clearTimeout(timer);
    } catch (err) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) throw _abortError();
      lastErr = err;
      continue;
    }
    signal?.removeEventListener('abort', onAbort);
    if (res.status === 429 || res.status === 406 || res.status >= 500) { res = null; continue; }
    break;
  }
  if (!res) throw new Error(`Overpass API unreachable: ${lastErr?.message ?? 'all mirrors rejected'}`);
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);

  const data = await res.json();
  const polygons = [], bboxes = [], factors = [], canopyHeights = [];

  const addRing = (ring, factor, canopyH) => {
    if (ring.length < 3) return;
    let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
    for (const [rla, rlo] of ring) {
      if (rla < la0) la0 = rla; if (rla > la1) la1 = rla;
      if (rlo < lo0) lo0 = rlo; if (rlo > lo1) lo1 = rlo;
    }
    polygons.push(ring);
    bboxes.push({ latMin: la0, latMax: la1, lonMin: lo0, lonMax: lo1 });
    factors.push(factor);
    canopyHeights.push(canopyH);
  };

  for (const el of data.elements) {
    const tag = el.tags?.landuse || el.tags?.natural || el.tags?.barrier;
    // Loss factor relative to dense forest (1.0). Low/sparse vegetation gets partial weight.
    const factor = (['scrub', 'heath', 'shrubbery', 'hedge'].includes(tag)) ? 0.4
                 : (['orchard', 'vineyard', 'greenhouse_horticulture'].includes(tag)) ? 0.55
                 : (['wetland'].includes(tag)) ? 0.6
                 : 1.0;
    const canopyH  = CANOPY_HEIGHTS[tag] ?? 10;
    if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
      addRing(el.geometry.map(n => [n.lat, n.lon]), factor, canopyH);
    } else if (el.type === 'relation' && el.members) {
      for (const m of el.members) {
        if (m.type !== 'way' || m.role === 'inner' || !m.geometry || m.geometry.length < 3) continue;
        addRing(m.geometry.map(n => [n.lat, n.lon]), factor, canopyH);
      }
    }
  }

  console.info(`[foliage] tile ${key}: ${polygons.length} polygon(s)`);
  const tileData = { polygons, bboxes, factors, canopyHeights };
  if (_memCache.size >= MEM_CACHE_MAX) _memCache.delete(_memCache.keys().next().value);
  _memCache.set(key, tileData);
  await window.electronAPI.cacheFoliageStore(key, tileData);
  return tileData;
}

/**
 * Fetch forest/wood polygons within a bounding box.
 * Data is fetched and cached per 0.25° tile — nearby repeaters share the same tile data.
 * @returns {Promise<{ polygons, bboxes, factors, canopyHeights, tileIndex }>}
 */
export async function fetchFoliage(latMin, latMax, lonMin, lonMax, options = {}) {
  const { signal = null } = options;
  _throwIfAborted(signal);
  const tiles = _tilesForBbox(latMin, latMax, lonMin, lonMax);
  const polygons = [], bboxes = [], factors = [], canopyHeights = [];

  for (const { la, lo, key } of tiles) {
    _throwIfAborted(signal);
    let td;
    try { td = await _fetchFoliageTile(la, lo, key, { signal }); }
    catch (e) {
      if (e?.cancelled || e?.name === 'AbortError') throw e;
      console.warn(`[foliage] tile ${key} failed, skipping:`, e);
      continue;
    }
    for (let i = 0; i < td.polygons.length; i++) {
      polygons.push(td.polygons[i]);
      bboxes.push(td.bboxes[i]);
      factors.push(td.factors[i]);
      canopyHeights.push(td.canopyHeights[i]);
    }
  }

  console.info(`[foliage] merged ${polygons.length} polygon(s) from ${tiles.length} tile(s)`);
  const tileIndex = _buildTileIndex(polygons, bboxes, latMin, latMax, lonMin, lonMax);
  return { polygons, bboxes, factors, canopyHeights, tileIndex };
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
 * Compute total foliage attenuation (dB) along a terrain profile path.
 * Height-aware: only attenuates the signal when the ray passes below the canopy top.
 * Uses the tile index (P2) to skip irrelevant polygons.
 *
 * @param {Float64Array} profileLats   - latitude of each profile sample
 * @param {Float64Array} profileLons   - longitude of each profile sample
 * @param {number[]|Float32Array}  profileElevs    - terrain elevation (m AMSL) at each sample
 * @param {number}  txAntH      - TX antenna height above ground (m)
 * @param {number}  rxAntH      - RX antenna height above ground (m)
 * @param {Array<Array<[number,number]>>} polygons
 * @param {Array}   bboxes
 * @param {number[]} canopyHeights  - canopy height (m above terrain) per polygon
 * @param {number[]} factors        - loss multiplier per polygon
 * @param {object|null} tileIndex
 * @param {number}  totalDistM
 * @param {number}  lossPerMeterDb
 * @returns {number} total foliage loss in dB
 */
export function foliageLossDb(profileLats, profileLons, profileElevs, txAntH, rxAntH, polygons, bboxes, canopyHeights, factors, tileIndex, totalDistM, lossPerMeterDb = 0.3) {
  if (!polygons || polygons.length === 0) return 0;
  const n = profileLats.length;
  const segLen = totalDistM / (n - 1);
  // Compute absolute elevation (AMSL) of TX and RX antenna tips
  const txAbsElev = (profileElevs?.[0]     ?? 0) + txAntH;
  const rxAbsElev = (profileElevs?.[n - 1] ?? 0) + rxAntH;
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
        const canopyTop = terrainElev + earthBulgeM(t, totalDistM) + (canopyHeights?.[i] ?? 10);
        if (rayAbsElev <= canopyTop) {
          loss += segLen * (b - a) * lossPerMeterDb * (factors?.[i] ?? 1.0);
        }
      }
    }
  }
  return loss;
}

