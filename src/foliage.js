/**
 * foliage.js — Fetch vegetation polygons from OpenStreetMap (via Overpass API)
 * and compute additional signal attenuation from forest traversal.
 * Exports: fetchFoliage, foliageLossDb
 */
import { earthBulgeM, segmentPolygonIntervalsWithHoles } from './propagation.js';
import { fetchDatasetElevations } from './elevation.js';
import { scheduledFetch } from './requestScheduler.js';
import { fetchOsmTileBatch } from './osmTilePipeline.js';
import {
  assembleMultipolygon,
  fallbackFeatureId as _fallbackFeatureId,
  featureDedupeKey,
  holeCandidatesForOuter,
  isClosedRing as _isClosedRing,
  lineCorridorRings as _lineCorridorRings,
  overpassBboxString,
  pointCircleRing as _pointCircleRing,
  ringBBox,
  tileDescriptorsForBbox,
} from './osmGeometry.js';

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Tile-based cache: snap to a fixed 0.25° grid so nearby repeaters reuse the same data.
// Old 'v3:' per-repeater exact-bbox keys become unreachable (stale but harmless).
const CACHE_V_OSM = 'fv13:';  // incremented: super-relation recursion + multipolygon assembly fallback
const CACHE_V_DERIVED = 'fv14:'; // incremented: super-relation recursion + multipolygon assembly fallback + canopy heights prefer DSM-DEM derivation
const FOLIAGE_TILE_CONCURRENCY = 3;

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

/** Return 0.25° tile descriptors covering the given bbox. */
function _tilesForBbox(latMin, latMax, lonMin, lonMax, cacheVersion) {
  return tileDescriptorsForBbox(latMin, latMax, lonMin, lonMax, cacheVersion);
}

// P2: tile grid resolution for spatial index
const TILE_N = 16;

// Average canopy heights (m above terrain) per vegetation type
const CANOPY_HEIGHTS = {
  forest:   20,   // landuse=forest — mature closed forest
  wood:     20,   // natural=wood
  mangrove: 12,
  meadow:    0.5, // natural=meadow / landuse=meadow — open grassland
  farmland:  0.5, // natural=farmland / landuse=farmland — agricultural fields
  park:      2,   // leisure=park — city park or recreation area
  scrub:     2,   // natural=scrub — low shrubs
  orchard:   4,   // landuse=orchard
  heath:     0.5, // natural=heath — open heathland
  tree_row: 12,
  vineyard:  2,   // landuse=vineyard — trellised vines
  wetland:   5,   // natural=wetland — reeds / mangrove
  reedbed:   3,
  swamp:     8,
  shrubbery: 2,   // landuse=shrubbery
  hedge:     2,   // barrier=hedge
  greenhouse_horticulture: 4, // landuse=greenhouse_horticulture
  plant_nursery: 3,
};

const FOLIAGE_FACTORS = {
  forest: 1,
  wood: 1,
  mangrove: 0.85,
  scrub: 0.4,
  shrubbery: 0.4,
  heath: 0.25,
  hedge: 0.45,
  orchard: 0.55,
  plant_nursery: 0.45,
  tree_row: 0.55,
  vineyard: 0.45,
  wetland: 0.6,
  reedbed: 0.45,
  swamp: 0.75,
  greenhouse_horticulture: 0.55,
  meadow: 0.25,
  farmland: 0.25,
  park: 0.35,
};

// B3: multi-entry in-memory cache (LRU-capped at 8 entries)
const _memCache    = new Map();
const MEM_CACHE_MAX = 8;

function _parseOsmLengthMeters(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const raw = String(value).trim().toLowerCase().replace(',', '.');
  if (!raw) return null;
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = parseFloat(match[0]);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (/\b(ft|feet|foot)\b/.test(raw)) return numeric * 0.3048;
  return numeric;
}

function _tagValue(tags, name) {
  return String(tags?.[name] ?? '').trim().toLowerCase();
}

export function classifyFoliageTags(tags = {}) {
  const landuse = _tagValue(tags, 'landuse');
  const landcover = _tagValue(tags, 'landcover');
  const natural = _tagValue(tags, 'natural');
  const leisure = _tagValue(tags, 'leisure');
  const barrier = _tagValue(tags, 'barrier');
  const wetland = _tagValue(tags, 'wetland');
  let kind = null;
  let linearWidthM = null;

  if (landuse === 'forest' || landcover === 'forest' || landcover === 'trees' || landcover === 'wood' || landcover === 'tree_cover') kind = 'forest';
  else if (landuse === 'orchard') kind = 'orchard';
  else if (landuse === 'vineyard') kind = 'vineyard';
  else if (landuse === 'shrubbery') kind = 'shrubbery';
  else if (landuse === 'greenhouse_horticulture') kind = 'greenhouse_horticulture';
  else if (landuse === 'plant_nursery') kind = 'plant_nursery';
  else if (natural === 'wood') kind = 'wood';
  else if (natural === 'forest') kind = 'forest';
  else if (natural === 'tree') kind = 'forest';
  else if (natural === 'park' || landuse === 'park' || leisure === 'park') kind = 'park';
  else if (natural === 'farmland' || landuse === 'farmland') kind = 'farmland';
  else if (natural === 'meadow' || landuse === 'meadow' || landcover === 'grass' || landuse === 'grass') kind = 'meadow';
  else if (natural === 'grassland') kind = 'meadow';
  else if (natural === 'plantation' || landuse === 'plantation') kind = 'forest';
  else if (natural === 'scrub' || natural === 'shrubbery') kind = 'scrub';
  else if (natural === 'heath') kind = 'heath';
  else if (natural === 'tree_row') {
    kind = 'tree_row';
    linearWidthM = 8;
  } else if (natural === 'wetland') {
    if (wetland === 'mangrove') kind = 'mangrove';
    else if (wetland === 'reedbed') kind = 'reedbed';
    else if (['swamp', 'marsh'].includes(wetland)) kind = 'swamp';
    else kind = 'wetland';
  } else if (natural === 'mangrove') kind = 'mangrove';
  else if (barrier === 'hedge') {
    kind = 'hedge';
    linearWidthM = 2;
  }

  if (!kind) return null;
  const explicitHeight = _parseOsmLengthMeters(tags.height || tags.est_height || tags['trees:height']);
  const canopyHeight = explicitHeight !== null
    ? Math.max(0.3, Math.min(80, explicitHeight))
    : (CANOPY_HEIGHTS[kind] ?? 10);
  return {
    kind,
    factor: FOLIAGE_FACTORS[kind] ?? 1,
    canopyHeight,
    linearWidthM,
  };
}

export function buildFoliageOverpassQuery(bbox) {
  const areaFilters = [
    ['landuse', 'forest'],
    ['landuse', 'orchard'],
    ['landuse', 'vineyard'],
    ['landuse', 'shrubbery'],
    ['landuse', 'greenhouse_horticulture'],
    ['landuse', 'plant_nursery'],
    ['landuse', 'plantation'],
    ['landuse', 'park'],
    ['landuse', 'meadow'],
    ['landuse', 'grass'],
    ['landuse', 'farmland'],
    ['landcover', 'forest'],
    ['landcover', 'trees'],
    ['landcover', 'wood'],
    ['landcover', 'tree_cover'],
    ['landcover', 'grass'],
    ['leisure', 'park'],
    ['natural', 'wood'],
    ['natural', 'forest'],
    ['natural', 'tree'],
    ['natural', 'park'],
    ['natural', 'farmland'],
    ['natural', 'plantation'],
    ['natural', 'meadow'],
    ['natural', 'grassland'],
    ['natural', 'scrub'],
    ['natural', 'shrubbery'],
    ['natural', 'heath'],
    ['natural', 'wetland'],
    ['natural', 'mangrove'],
  ].flatMap(([k, v]) => [`way["${k}"="${v}"]${bbox};`, `relation["${k}"="${v}"]${bbox};`]).join('');
  const nodeFilters = [
    `node["natural"="tree"]${bbox};`,
    `node["barrier"="hedge"]${bbox};`,
  ].join('');
  const linearFilters = [
    `way["barrier"="hedge"]${bbox};`,
    `way["natural"="tree_row"]${bbox};`,
  ].join('');
  // Request relation bodies (members) first, then fetch geometries so
  // relation elements include a non-null `members` array while still
  // returning geometry for ways.
  return `[out:json][timeout:60];(${areaFilters}${nodeFilters}${linearFilters});(._;>>;);out body; (._;>;);out geom tags;`;
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

async function _deriveCanopyFromDsmMinusDem(polygons, fallbackHeights, signal, datasetBatchConcurrency, sampleLimit = 0) {
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
      derived[sampled[i].idx] = Math.max(0.5, Math.min(60, delta));
      applied++;
    }
    console.info(`[foliage] DSM-DEM canopy applied for ${applied}/${sampled.length} polygons (sampled from ${derived.length})`);
    return derived;
  } catch (err) {
    if (err?.cancelled || err?.name === 'AbortError') throw err;
    console.warn('[foliage] DSM-DEM canopy derivation failed, using defaults:', err.message);
    return fallbackHeights;
  }
}

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
async function _fetchFoliageTile(tile, {
  signal = null,
  datasetBatchConcurrency = 2,
  deriveObstacleHeights = false,
  derivationSampleLimit = 0,
} = {}) {
  const { key } = tile;
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

  const bbox = overpassBboxString(tile);
  const query = buildFoliageOverpassQuery(bbox);

  let res = null, lastErr = null;
  for (let attempt = 0; attempt < OVERPASS_MIRRORS.length * 2; attempt++) {
    _throwIfAborted(signal);
    const base = OVERPASS_MIRRORS[attempt % OVERPASS_MIRRORS.length];
    if (attempt > 0) await _sleep(2000 * Math.ceil(attempt / OVERPASS_MIRRORS.length), signal);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      res = await scheduledFetch(base, {
        method: 'POST',
        headers: {
          'Accept': '*/*',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: `data=${encodeURIComponent(query)}`,
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
    if (res.status === 429 || res.status === 406 || res.status >= 500) { res = null; continue; }
    break;
  }
  if (!res) throw new Error(`Overpass API unreachable: ${lastErr?.message ?? 'all mirrors rejected'}`);
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);

  const data = await res.json();
  const polygons = [], bboxes = [], factors = [], canopyHeights = [], ids = [], kinds = [], holes = [];
  const seenFeatureIds = new Set();
  const elementGeom = new Map();
  for (const el of data.elements) {
    if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2) {
      elementGeom.set(`way:${el.id}`, el.geometry);
    }
  }
  const memberGeometry = (member) => {
    if (!member || typeof member.type !== 'string') return null;
    if (Array.isArray(member.geometry) && member.geometry.length >= 2) return member.geometry;
    return elementGeom.get(`${member.type}:${member.ref}`) ?? null;
  };

  const addRing = (ring, classification, featureId, ringHoles = []) => {
    if (ring.length < 3) return;
    const bbox = ringBBox(ring);
    const id = featureId || _fallbackFeatureId('f', ring, bbox);
    const dedupeKey = featureDedupeKey(id, ring, bbox);
    if (seenFeatureIds.has(dedupeKey)) return;
    polygons.push(ring);
    bboxes.push(bbox);
    factors.push(classification.factor);
    canopyHeights.push(classification.canopyHeight);
    ids.push(id);
    kinds.push(classification.kind);
    holes.push(ringHoles);
    seenFeatureIds.add(dedupeKey);
  };

  for (const el of data.elements) {
    const classification = classifyFoliageTags(el.tags);
    if (!classification) continue;
    const baseFeatureId = `${el.type}:${el.id ?? 'na'}`;
    if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
      const ring = el.geometry.map(n => [n.lat, n.lon]);
      if (classification.linearWidthM && !_isClosedRing(ring) && String(el.tags?.area || '').toLowerCase() !== 'yes') {
        const corridors = _lineCorridorRings(ring, classification.linearWidthM);
        for (let ci = 0; ci < corridors.length; ci++) {
          addRing(corridors[ci], classification, `${baseFeatureId}:line:${ci}`);
        }
      } else {
        addRing(ring, classification, baseFeatureId);
      }
    } else if (el.type === 'relation' && el.members) {
      const multi = assembleMultipolygon(el.members, memberGeometry);
      if (multi.outers.length) {
        for (let ri = 0; ri < multi.outers.length; ri++) {
          const ring = multi.outers[ri];
          if (ring.length < 3) continue;
          addRing(ring, classification, `${baseFeatureId}:outer:${ri}`, holeCandidatesForOuter(ring, multi.holes));
        }
      } else if (Array.isArray(el.geometry) && el.geometry.length >= 3) {
        addRing(el.geometry.map(n => [n.lat, n.lon]), classification, baseFeatureId);
      } else {
        // Fallback: render each outer-role member way individually when ring
        // assembly fails (e.g., fragmented members, sub-relation members the
        // assembler can't traverse). Inner-role members are skipped so holes
        // don't get rendered as forest. Geometry comes from inline `member.geometry`
        // or from any way captured into `elementGeom` via the deep recursion.
        let mi = 0;
        let rendered = 0;
        for (const member of el.members) {
          const role = String(member?.role || 'outer').trim().toLowerCase();
          if (role === 'inner') continue;
          const geometry = memberGeometry(member);
          if (!geometry || geometry.length < 3) continue;
          const ring = geometry.map(n => [n.lat, n.lon]);
          addRing(ring, classification, `${baseFeatureId}:member:${mi++}`);
          rendered++;
        }
        if (rendered === 0) {
          console.warn(`[foliage] relation ${el.id} (${classification.kind}) produced no renderable rings (${el.members.length} member(s))`);
        }
      }
    } else if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
      const diameterM = classification.linearWidthM || 6;
      addRing(_pointCircleRing(el.lat, el.lon, diameterM), classification, `${baseFeatureId}:node`);
    }
  }

  const derivedCanopyHeights = deriveObstacleHeights
    ? await _deriveCanopyFromDsmMinusDem(
      polygons,
      canopyHeights,
      signal,
      datasetBatchConcurrency,
      derivationSampleLimit
    )
    : canopyHeights;
  console.info(`[foliage] tile ${key}: ${polygons.length} polygon(s)`);
  const tileData = { polygons, bboxes, factors, canopyHeights: derivedCanopyHeights, ids, kinds, holes };
  if (_memCache.size >= MEM_CACHE_MAX) _memCache.delete(_memCache.keys().next().value);
  _memCache.set(key, tileData);
  await window.electronAPI.cacheFoliageStore(key, tileData);
  return tileData;
}

export async function fetchFoliage(latMin, latMax, lonMin, lonMax, options = {}) {
  const {
    signal = null,
    onProgress = null,
    tileConcurrency = FOLIAGE_TILE_CONCURRENCY,
    datasetBatchConcurrency = 2,
    deriveObstacleHeights = false,
    derivationSampleLimit = 100,
  } = options;
  _throwIfAborted(signal);
  const cacheVersion = deriveObstacleHeights ? CACHE_V_DERIVED : CACHE_V_OSM;
  const tiles = _tilesForBbox(latMin, latMax, lonMin, lonMax, cacheVersion);
  const polygons = [], bboxes = [], factors = [], canopyHeights = [], ids = [], kinds = [], holes = [];
  const seenMerged = new Set();
  const tileResults = await fetchOsmTileBatch(tiles, {
    signal,
    tileConcurrency,
    loadTile: tile => _fetchFoliageTile(tile, {
      signal,
      datasetBatchConcurrency,
      deriveObstacleHeights,
      derivationSampleLimit,
    }),
    onProgress: ({ completed, total }) => onProgress?.({ source: 'foliage', completed, total }),
    onTileError: (e, tile) => console.warn(`[foliage] tile ${tile.key} failed, skipping:`, e),
  });

  for (const { data: td } of tileResults) {
    for (let i = 0; i < td.polygons.length; i++) {
      const poly = td.polygons[i];
      const bb = td.bboxes[i];
      const id = td.ids?.[i] || _fallbackFeatureId('f', poly, bb);
      const dedupeKey = featureDedupeKey(id, poly, bb);
      if (seenMerged.has(dedupeKey)) continue;
      seenMerged.add(dedupeKey);
      polygons.push(poly);
      bboxes.push(bb);
      factors.push(td.factors[i]);
      canopyHeights.push(td.canopyHeights[i]);
      ids.push(id);
      kinds.push(td.kinds?.[i] || 'vegetation');
      holes.push(td.holes?.[i] ?? []);
    }
  }

  console.info(`[foliage] merged ${polygons.length} polygon(s) from ${tiles.length} tile(s)`);
  const tileIndex = _buildTileIndex(polygons, bboxes, latMin, latMax, lonMin, lonMax);
  return { polygons, bboxes, factors, canopyHeights, ids, kinds, holes, tileIndex };
}

export function weissbergerFoliageLossDb(freqMHz, depthM) {
  if (!Number.isFinite(depthM) || depthM <= 0) return 0;
  const fGHz = Math.max(0.1, (Number(freqMHz) || 868) / 1000);
  const d = Math.min(400, Math.max(0, depthM));
  if (d <= 14) return 0.45 * (fGHz ** 0.284) * d;
  return 1.33 * (fGHz ** 0.284) * (d ** 0.588);
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
export function foliageLossDb(profileLats, profileLons, profileElevs, txAntH, rxAntH, polygons, bboxes, canopyHeights, factors, tileIndex, totalDistM, lossPerMeterDb = 0.3, freqMHz = 868, holes = []) {
  if (!polygons || polygons.length === 0) return 0;
  const n = profileLats.length;
  const segLen = totalDistM / (n - 1);
  const lossPerM = Math.max(0, Number(lossPerMeterDb) || 0);
  // Compute absolute elevation (AMSL) of TX and RX antenna tips
  const txAbsElev = (profileElevs?.[0]     ?? 0) + txAntH;
  const rxAbsElev = (profileElevs?.[n - 1] ?? 0) + rxAntH;
  let linearLoss = 0;
  for (let si = 0; si < n - 1; si++) {
    const lat1 = profileLats[si], lon1 = profileLons[si];
    const lat2 = profileLats[si + 1], lon2 = profileLons[si + 1];
    const candidates = _segmentCandidates(tileIndex, bboxes, lat1, lon1, lat2, lon2, polygons.length);
    for (const i of candidates) {
      const intervals = segmentPolygonIntervalsWithHoles(lat1, lon1, lat2, lon2, polygons[i], holes?.[i]);
      for (const [a, b] of intervals) {
        const f = (a + b) / 2;
        const t = (si + f) / (n - 1);
        const rayAbsElev  = txAbsElev + (rxAbsElev - txAbsElev) * t;
        const terrainElev = (profileElevs?.[si] ?? 0) + ((profileElevs?.[si + 1] ?? 0) - (profileElevs?.[si] ?? 0)) * f;
        const canopyTop = terrainElev + earthBulgeM(t, totalDistM) + (canopyHeights?.[i] ?? 10);
        if (rayAbsElev <= canopyTop) {
          linearLoss += segLen * (b - a) * lossPerM * (factors?.[i] ?? 1.0);
        }
      }
    }
  }
  if (linearLoss <= 0 || lossPerM <= 0) return linearLoss;
  const equivalentDepthM = linearLoss / lossPerM;
  return Math.min(linearLoss, weissbergerFoliageLossDb(freqMHz, equivalentDepthM));
}