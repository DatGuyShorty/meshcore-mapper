/**
 * foliage.js — Fetch vegetation polygons from OpenStreetMap (via Overpass API)
 * and compute additional signal attenuation from forest traversal.
 * Exports: fetchFoliage, foliageLossDb
 */

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Cache version — bump when data shape changes to invalidate stored entries
const CACHE_V = 'v2:';

// P2: tile grid resolution for spatial index
const TILE_N = 16;

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
 * Fetch forest/wood polygons within a bounding box from OpenStreetMap.
 * Returns an object with pre-computed bounding boxes and tile index for fast filtering.
 *
 * @param {number} latMin @param {number} latMax @param {number} lonMin @param {number} lonMax
 * @returns {Promise<{ polygons, bboxes, factors, tileIndex }>}
 */
export async function fetchFoliage(latMin, latMax, lonMin, lonMax) {
  const key = CACHE_V + `${latMin.toFixed(4)},${latMax.toFixed(4)},${lonMin.toFixed(4)},${lonMax.toFixed(4)}`;

  // L1: in-memory (B3: now a Map, supports multiple bboxes simultaneously)
  if (_memCache.has(key)) return _memCache.get(key);

  // L2: SQLite (30-day TTL enforced in main process)
  const sqlCached = await window.electronAPI.cacheFoliageLookup(key);
  if (sqlCached) {
    const tileIndex = _buildTileIndex(sqlCached.polygons, sqlCached.bboxes, latMin, latMax, lonMin, lonMax);
    const result = { key, ...sqlCached, tileIndex };
    _memCache.set(key, result);
    return result;
  }

  // Query both way and relation elements for each vegetation tag.
  const bbox = `(${latMin},${lonMin},${latMax},${lonMax})`;
  const filters = [
    ['landuse', 'forest'], ['natural', 'wood'],
    ['natural', 'scrub'],  ['landuse', 'orchard'],
  ].flatMap(([k, v]) => [`way["${k}"="${v}"]${bbox};`, `relation["${k}"="${v}"]${bbox};`]).join('');
  const query = `[out:json][timeout:60];(${filters});out geom;`;

  let res = null;
  let lastErr = null;
  for (let attempt = 0; attempt < OVERPASS_MIRRORS.length * 2; attempt++) {
    const base = OVERPASS_MIRRORS[attempt % OVERPASS_MIRRORS.length];
    const url  = `${base}?data=${encodeURIComponent(query)}`;
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * Math.ceil(attempt / OVERPASS_MIRRORS.length)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      res = await fetch(url, { headers: { 'Accept': '*/*' }, signal: controller.signal });
      clearTimeout(timer);
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      continue;
    }
    if (res.status === 429 || res.status === 406 || res.status >= 500) { res = null; continue; }
    break;
  }
  if (!res) throw new Error(`Overpass API unreachable: ${lastErr?.message ?? 'all mirrors rejected'}`);
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);

  const data = await res.json();

  const polygons = [];
  const bboxes   = [];
  const factors  = [];

  const addRing = (ring, factor) => {
    if (ring.length < 3) return;
    let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
    for (const [la, lo] of ring) {
      if (la < la0) la0 = la; if (la > la1) la1 = la;
      if (lo < lo0) lo0 = lo; if (lo > lo1) lo1 = lo;
    }
    polygons.push(ring);
    bboxes.push({ latMin: la0, latMax: la1, lonMin: lo0, lonMax: lo1 });
    factors.push(factor);
  };

  for (const el of data.elements) {
    const factor = (el.tags?.natural === 'scrub' || el.tags?.landuse === 'orchard') ? 0.5 : 1.0;
    if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
      addRing(el.geometry.map(n => [n.lat, n.lon]), factor);
    } else if (el.type === 'relation' && el.members) {
      for (const m of el.members) {
        if (m.type !== 'way' || m.role === 'inner' || !m.geometry || m.geometry.length < 3) continue;
        addRing(m.geometry.map(n => [n.lat, n.lon]), factor);
      }
    }
  }

  const tileIndex = _buildTileIndex(polygons, bboxes, latMin, latMax, lonMin, lonMax);
  const result = { key, polygons, bboxes, factors, tileIndex };

  // B3: cap mem cache size (simple FIFO eviction)
  if (_memCache.size >= MEM_CACHE_MAX) _memCache.delete(_memCache.keys().next().value);
  _memCache.set(key, result);

  await window.electronAPI.cacheFoliageStore(key, { polygons, bboxes, factors });
  return result;
}

/**
 * Compute total foliage attenuation (dB) along a terrain profile path.
 * Uses the tile index (P2) to skip irrelevant polygons.
 *
 * @param {Array<[number,number]>} profileLatLons
 * @param {Array<Array<[number,number]>>} polygons
 * @param {Array} bboxes
 * @param {number[]} factors
 * @param {object|null} tileIndex - pre-built spatial index from fetchFoliage
 * @param {number} totalDistM
 * @param {number} lossPerMeterDb
 * @returns {number} total foliage loss in dB
 */
export function foliageLossDb(profileLatLons, polygons, bboxes, factors, tileIndex, totalDistM, lossPerMeterDb) {
  if (!polygons || polygons.length === 0) return 0;
  const segLen = totalDistM / (profileLatLons.length - 1);
  let loss = 0;
  for (const [lat, lon] of profileLatLons) {
    // P2: use tile index to only check polygons whose tile contains this point
    let candidates;
    if (tileIndex) {
      const r = Math.max(0, Math.min(TILE_N - 1, Math.floor((lat - tileIndex.latMin) / tileIndex.latSpan * TILE_N)));
      const c = Math.max(0, Math.min(TILE_N - 1, Math.floor((lon - tileIndex.lonMin) / tileIndex.lonSpan * TILE_N)));
      candidates = tileIndex.tiles[r * TILE_N + c];
    } else {
      candidates = Array.from({ length: polygons.length }, (_, i) => i);
    }
    for (const i of candidates) {
      const bb = bboxes[i];
      if (lat < bb.latMin || lat > bb.latMax || lon < bb.lonMin || lon > bb.lonMax) continue;
      if (_pointInPolygon(lat, lon, polygons[i])) {
        loss += segLen * lossPerMeterDb * (factors?.[i] ?? 1.0);
        break;
      }
    }
  }
  return loss;
}

function _pointInPolygon(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

