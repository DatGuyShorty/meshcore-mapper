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

// Tile-based cache: snap to a fixed 0.25° grid so nearby repeaters reuse the same tiles.
const TILE_SIZE = 0.25;  // degrees
const CACHE_V_OSM = 'bv4:';
const CACHE_V_DERIVED = 'bv5:'; // building heights prefer DSM-DEM derivation
const TILE_N    = 16;
const BUILDING_TILE_CONCURRENCY = 3;
const M_PER_LAT = 110574;
const M_PER_LON = 111320;
const DEFAULT_BUILDING_HEIGHT_M = 5;

const WALL_BARRIER_TYPES = new Set(['wall', 'retaining_wall', 'city_wall']);
const MAN_MADE_BLOCKERS = new Set([
  'silo',
  'storage_tank',
  'gasometer',
  'water_tower',
  'tower',
]);

const DEFAULT_HEIGHT_BY_BUILDING_TYPE = {
  apartments: 16,
  barracks: 12,
  bungalow: 5,
  cabin: 3,
  cathedral: 28,
  chapel: 10,
  church: 18,
  civic: 12,
  commercial: 10,
  construction: 5,
  detached: 6,
  dormitory: 14,
  farm: 7,
  farm_auxiliary: 5,
  garage: 3,
  garages: 3,
  greenhouse: 4,
  hangar: 12,
  hospital: 14,
  hotel: 15,
  house: 6,
  hut: 3,
  industrial: 10,
  kindergarten: 6,
  office: 12,
  public: 10,
  residential: 8,
  retail: 8,
  roof: 3,
  school: 9,
  semidetached_house: 6,
  service: 4,
  shed: 3,
  stable: 5,
  static_caravan: 3,
  terrace: 7,
  train_station: 12,
  university: 12,
  warehouse: 10,
  yes: DEFAULT_BUILDING_HEIGHT_M,
};

const DEFAULT_HEIGHT_BY_MAN_MADE = {
  gasometer: 18,
  silo: 18,
  storage_tank: 12,
  tower: 25,
  water_tower: 25,
};

const DEFAULT_HEIGHT_BY_BARRIER = {
  city_wall: 8,
  retaining_wall: 4,
  wall: 2.5,
};

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

function _isClosedRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return !!first && !!last && first[0] === last[0] && first[1] === last[1];
}

function _lineCorridorRings(ring, widthM) {
  if (!Array.isArray(ring) || ring.length < 2 || !Number.isFinite(widthM) || widthM <= 0) return [];
  const half = widthM / 2;
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [lat1, lon1] = ring[i];
    const [lat2, lon2] = ring[i + 1];
    const latMid = (lat1 + lat2) / 2;
    const lonScale = Math.max(1e-6, M_PER_LON * Math.cos(latMid * Math.PI / 180));
    const dx = (lon2 - lon1) * lonScale;
    const dy = (lat2 - lat1) * M_PER_LAT;
    const len = Math.hypot(dx, dy);
    if (len <= 0) continue;
    const nx = -dy / len;
    const ny = dx / len;
    const dLat = (ny * half) / M_PER_LAT;
    const dLon = (nx * half) / lonScale;
    out.push([
      [lat1 + dLat, lon1 + dLon],
      [lat2 + dLat, lon2 + dLon],
      [lat2 - dLat, lon2 - dLon],
      [lat1 - dLat, lon1 - dLon],
    ]);
  }
  return out;
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
 * Parse common OSM length values into metres.
 */
export function parseOsmLengthMeters(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const raw = String(value).trim().toLowerCase().replace(',', '.');
  if (!raw) return null;

  const feetInches = raw.match(/(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?/);
  if (feetInches) {
    const feet = parseFloat(feetInches[1]);
    const inches = parseFloat(feetInches[2] ?? '0');
    const meters = feet * 0.3048 + inches * 0.0254;
    return meters > 0 ? meters : null;
  }

  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = parseFloat(match[0]);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (/\b(ft|feet|foot)\b/.test(raw)) return numeric * 0.3048;
  return numeric;
}

function _osmType(value) {
  return String(value ?? '').trim().toLowerCase();
}

function _clampHeight(value, min = 1, max = 400) {
  return Math.max(min, Math.min(max, value));
}

function _roofHeight(tags) {
  const explicit = parseOsmLengthMeters(tags?.['roof:height']);
  if (explicit !== null) return explicit;
  const roofLevels = parseOsmLengthMeters(tags?.['roof:levels']);
  if (roofLevels !== null) return roofLevels * 2.6;
  const shape = _osmType(tags?.['roof:shape']);
  if (['flat', 'skillion'].includes(shape)) return 0.5;
  if (['gabled', 'hipped', 'pyramidal', 'mansard', 'gambrel', 'round'].includes(shape)) return 1.5;
  return 1.0;
}

function _floorHeightForTags(tags) {
  const building = _osmType(tags?.building || tags?.['building:part']);
  if (['industrial', 'warehouse', 'hangar', 'farm', 'farm_auxiliary', 'retail'].includes(building)) return 4.2;
  if (['church', 'cathedral', 'chapel', 'train_station'].includes(building)) return 5.0;
  if (['garage', 'garages', 'shed', 'hut', 'roof', 'greenhouse'].includes(building)) return 2.6;
  if (['hospital', 'school', 'university', 'office', 'commercial', 'hotel'].includes(building)) return 3.4;
  return 3.0;
}

function _defaultStructureHeight(tags) {
  const building = _osmType(tags?.building || tags?.['building:part']);
  const manMade = _osmType(tags?.man_made);
  const barrier = _osmType(tags?.barrier);
  if (building && DEFAULT_HEIGHT_BY_BUILDING_TYPE[building] !== undefined) return DEFAULT_HEIGHT_BY_BUILDING_TYPE[building];
  if (manMade && DEFAULT_HEIGHT_BY_MAN_MADE[manMade] !== undefined) return DEFAULT_HEIGHT_BY_MAN_MADE[manMade];
  if (barrier && DEFAULT_HEIGHT_BY_BARRIER[barrier] !== undefined) return DEFAULT_HEIGHT_BY_BARRIER[barrier];
  if (_osmType(tags?.military) === 'bunker') return 5;
  return DEFAULT_BUILDING_HEIGHT_M;
}

export function inferBuildingHeight(tags = {}) {
  const explicit = parseOsmLengthMeters(tags.height || tags.est_height);
  if (explicit !== null) return _clampHeight(explicit);

  const levels = parseOsmLengthMeters(tags['building:levels'] || tags.levels);
  const minHeight = parseOsmLengthMeters(tags.min_height) ?? 0;
  if (levels !== null) {
    const minLevel = parseOsmLengthMeters(tags['building:min_level']) ?? 0;
    const aboveGroundLevels = Math.max(0.25, levels - minLevel);
    return _clampHeight(minHeight + aboveGroundLevels * _floorHeightForTags(tags) + _roofHeight(tags));
  }

  return _clampHeight(minHeight + _defaultStructureHeight(tags));
}

export function classifyStructureTags(tags = {}) {
  const building = _osmType(tags.building || tags['building:part']);
  const manMade = _osmType(tags.man_made);
  const barrier = _osmType(tags.barrier);
  const military = _osmType(tags.military);

  if (building && building !== 'no') {
    return { kind: `building:${building}`, height: inferBuildingHeight(tags), linearWidthM: null };
  }
  if (MAN_MADE_BLOCKERS.has(manMade)) {
    return { kind: `man_made:${manMade}`, height: inferBuildingHeight(tags), linearWidthM: null };
  }
  if (WALL_BARRIER_TYPES.has(barrier)) {
    const width = barrier === 'city_wall' ? 2.5 : 0.9;
    return { kind: `barrier:${barrier}`, height: inferBuildingHeight(tags), linearWidthM: width };
  }
  if (military === 'bunker') {
    return { kind: 'military:bunker', height: inferBuildingHeight(tags), linearWidthM: null };
  }
  return null;
}

export function buildBuildingsOverpassQuery(bbox) {
  const filters = [
    `way["building"]${bbox};`,
    `relation["building"]${bbox};`,
    `way["building:part"]${bbox};`,
    `relation["building:part"]${bbox};`,
    `way["man_made"~"^(silo|storage_tank|gasometer|water_tower|tower)$"]${bbox};`,
    `relation["man_made"~"^(silo|storage_tank|gasometer|water_tower|tower)$"]${bbox};`,
    `way["barrier"~"^(wall|retaining_wall|city_wall)$"]${bbox};`,
    `relation["barrier"~"^(wall|retaining_wall|city_wall)$"]${bbox};`,
    `way["military"="bunker"]${bbox};`,
    `relation["military"="bunker"]${bbox};`,
  ].join('');
  return `[out:json][timeout:60];(${filters});out geom tags;`;
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
  const query = buildBuildingsOverpassQuery(bbox);

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
  const polygons = [], bboxes = [], heights = [], ids = [], kinds = [];
  const seenFeatureIds = new Set();

  const addRing = (ring, h, featureId, kind) => {
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
    kinds.push(kind || 'building');
    if (featureId) seenFeatureIds.add(featureId);
  };

  for (const el of data.elements) {
    const classification = classifyStructureTags(el.tags);
    if (!classification) continue;
    const h = classification.height;
    const baseFeatureId = `${el.type}:${el.id ?? 'na'}`;
    if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
      const ring = el.geometry.map(n => [n.lat, n.lon]);
      if (classification.linearWidthM && !_isClosedRing(ring) && String(el.tags?.area || '').toLowerCase() !== 'yes') {
        const corridors = _lineCorridorRings(ring, classification.linearWidthM);
        for (let ci = 0; ci < corridors.length; ci++) {
          addRing(corridors[ci], h, `${baseFeatureId}:line:${ci}`, classification.kind);
        }
      } else {
        addRing(ring, h, baseFeatureId, classification.kind);
      }
    } else if (el.type === 'relation' && el.members) {
      for (let mi = 0; mi < el.members.length; mi++) {
        const m = el.members[mi];
        if (m.type !== 'way' || m.role === 'inner' || !m.geometry || m.geometry.length < 3) continue;
        addRing(m.geometry.map(n => [n.lat, n.lon]), h, `${baseFeatureId}:outer:${m.ref ?? mi}`, classification.kind);
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
  const tileData = { polygons, bboxes, heights: derivedHeights, ids, kinds };
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
  const polygons = [], bboxes = [], heights = [], ids = [], kinds = [];
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
          polygons.push(poly);
          bboxes.push(bb);
          heights.push(td.heights[i]);
          ids.push(id);
          kinds.push(td.kinds?.[i] || 'building');
        }
      }

      completed++;
      onProgress?.({ source: 'buildings', completed, total: tiles.length });
    }
  };

  await Promise.all(Array.from({ length: workers }, () => runWorker()));

  console.info(`[buildings] merged ${polygons.length} building(s) from ${tiles.length} tile(s)`);
  const tileIndex = _buildTileIndex(polygons, bboxes, latMin, latMax, lonMin, lonMax);
  return { polygons, bboxes, heights, ids, kinds, tileIndex };
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
