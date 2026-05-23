/**
 * buildings.js — Fetch building footprints from OpenStreetMap (via Overpass API)
 * and compute additional signal attenuation from traversal through buildings.
 * Exports: fetchBuildings, buildingLossDb
 */
import { pointInPolygon } from './propagation.js';

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Tile-based cache: snap to a fixed 0.25° grid so nearby repeaters reuse the same tiles.
const TILE_SIZE = 0.25;  // degrees
const CACHE_V   = 'bv2:'; // bumped; key format is now tile-based
const TILE_N    = 16;

function _snapB(v) { return Math.floor(v / TILE_SIZE) * TILE_SIZE; }

function _tilesForBboxB(latMin, latMax, lonMin, lonMax) {
  const tiles = [];
  for (let la = _snapB(latMin); la < latMax; la += TILE_SIZE) {
    for (let lo = _snapB(lonMin); lo < lonMax; lo += TILE_SIZE) {
      tiles.push({ la, lo, key: `${CACHE_V}${la.toFixed(4)}:${lo.toFixed(4)}` });
    }
  }
  return tiles;
}
const DEFAULT_WALL_LOSS_DB_PER_M = 0.5; // ~0.5 dB/m at 868 MHz (ITU-R P.2040 residential)

const _memCache     = new Map();
const MEM_CACHE_MAX = 8;

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
async function _fetchBuildingsTile(la, lo, key) {
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
  for (let attempt = 0; attempt < OVERPASS_MIRRORS.length * 2; attempt++) {
    const base = OVERPASS_MIRRORS[attempt % OVERPASS_MIRRORS.length];
    const url  = `${base}?data=${encodeURIComponent(query)}`;
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * Math.ceil(attempt / OVERPASS_MIRRORS.length)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      res = await fetch(url, { headers: { 'Accept': '*/*' }, signal: controller.signal });
      clearTimeout(timer);
    } catch (err) { clearTimeout(timer); lastErr = err; continue; }
    if (res.status === 429 || res.status === 406 || res.status >= 500) { res = null; continue; }
    break;
  }
  if (!res) throw new Error(`Overpass API unreachable: ${lastErr?.message ?? 'all mirrors rejected'}`);
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);

  const data = await res.json();
  const polygons = [], bboxes = [], heights = [];

  const addRing = (ring, h) => {
    if (ring.length < 3) return;
    let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
    for (const [rla, rlo] of ring) {
      if (rla < la0) la0 = rla; if (rla > la1) la1 = rla;
      if (rlo < lo0) lo0 = rlo; if (rlo > lo1) lo1 = rlo;
    }
    polygons.push(ring);
    bboxes.push({ latMin: la0, latMax: la1, lonMin: lo0, lonMax: lo1 });
    heights.push(h);
  };

  for (const el of data.elements) {
    const h = _buildingHeight(el.tags);
    if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
      addRing(el.geometry.map(n => [n.lat, n.lon]), h);
    } else if (el.type === 'relation' && el.members) {
      for (const m of el.members) {
        if (m.type !== 'way' || m.role === 'inner' || !m.geometry || m.geometry.length < 3) continue;
        addRing(m.geometry.map(n => [n.lat, n.lon]), h);
      }
    }
  }

  console.info(`[buildings] tile ${key}: ${polygons.length} building(s)`);
  const tileData = { polygons, bboxes, heights };
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
export async function fetchBuildings(latMin, latMax, lonMin, lonMax) {
  const tiles = _tilesForBboxB(latMin, latMax, lonMin, lonMax);
  const polygons = [], bboxes = [], heights = [];

  for (const { la, lo, key } of tiles) {
    let td;
    try { td = await _fetchBuildingsTile(la, lo, key); }
    catch (e) { console.warn(`[buildings] tile ${key} failed, skipping:`, e); continue; }
    for (let i = 0; i < td.polygons.length; i++) {
      polygons.push(td.polygons[i]);
      bboxes.push(td.bboxes[i]);
      heights.push(td.heights[i]);
    }
  }

  console.info(`[buildings] merged ${polygons.length} building(s) from ${tiles.length} tile(s)`);
  const tileIndex = _buildTileIndex(polygons, bboxes, latMin, latMax, lonMin, lonMax);
  return { polygons, bboxes, heights, tileIndex };
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
  let prevBuilding = -1;
  for (let si = 0; si < n; si++) {
    const lat = profileLats[si];
    const lon = profileLons[si];
    const t = si / (n - 1);
    const rayAbsElev  = txAbsElev + (rxAbsElev - txAbsElev) * t;
    const terrainElev = profileElevs?.[si] ?? 0;

    let candidates;
    if (tileIndex) {
      const r = Math.max(0, Math.min(TILE_N - 1, Math.floor((lat - tileIndex.latMin) / tileIndex.latSpan * TILE_N)));
      const c = Math.max(0, Math.min(TILE_N - 1, Math.floor((lon - tileIndex.lonMin) / tileIndex.lonSpan * TILE_N)));
      candidates = tileIndex.tiles[r * TILE_N + c];
    } else {
      candidates = Array.from({ length: polygons.length }, (_, i) => i);
    }
    let curBuilding = -1;
    for (const i of candidates) {
      const bb = bboxes[i];
      if (lat < bb.latMin || lat > bb.latMax || lon < bb.lonMin || lon > bb.lonMax) continue;
      if (pointInPolygon(lat, lon, polygons[i])) {
        const rooftopElev = terrainElev + (heights?.[i] ?? 5);
        if (rayAbsElev <= rooftopElev) {
          curBuilding = i;
          // Optional interior attenuation for long through-building paths
          loss += segLen * lossPerMeterDb;
        }
        break;
      }
    }

    // Charge wall penetration only when crossing a building boundary.
    if (curBuilding !== prevBuilding) {
      if (prevBuilding !== -1) loss += wallCrossLossDb; // exiting previous building
      if (curBuilding !== -1)  loss += wallCrossLossDb; // entering new building
    }
    prevBuilding = curBuilding;
  }

  // If path ends while still inside a building, account for exit wall.
  if (prevBuilding !== -1) loss += wallCrossLossDb;
  return loss;
}
