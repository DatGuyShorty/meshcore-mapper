// @ts-check
/**
 * buildings.js — Fetch building footprints from OpenStreetMap (via Overpass API)
 * and compute additional signal attenuation from traversal through buildings.
 * Exports: fetchBuildings, buildingLossDb
 *
 * @typedef {import('./osmGeometry.js').Ring} Ring
 * @typedef {import('./osmGeometry.js').Bbox} Bbox
 *
 * @typedef {Object} BuildingsPayload
 * @property {Ring[]} polygons
 * @property {Bbox[]} bboxes
 * @property {number[]} heights
 * @property {Array<Ring[]>} holes
 * @property {{ tiles: number[][], latMin: number, latSpan: number, lonMin: number, lonSpan: number } | null} tileIndex
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

// Tile-based cache: snap to a fixed 0.25° grid so nearby repeaters reuse the same tiles.
const CACHE_V_OSM = 'bv6:';
const CACHE_V_DERIVED = 'bv7:'; // building heights prefer DSM-DEM derivation
const TILE_N    = 16;
const BUILDING_TILE_CONCURRENCY = 3;
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
  const err = /** @type {Error & { cancelled?: boolean }} */ (new Error('Cancelled'));
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}

/** @param {AbortSignal | null | undefined} signal */
function _throwIfAborted(signal) {
  if (signal?.aborted) throw _abortError();
}

/**
 * @param {number} ms
 * @param {AbortSignal | null | undefined} signal
 * @returns {Promise<void>}
 */
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

/**
 * @param {unknown} latMin
 * @param {unknown} latMax
 * @param {unknown} lonMin
 * @param {unknown} lonMax
 * @param {string} cacheVersion
 */
function _tilesForBboxB(latMin, latMax, lonMin, lonMax, cacheVersion) {
  return tileDescriptorsForBbox(latMin, latMax, lonMin, lonMax, cacheVersion);
}
const DEFAULT_WALL_LOSS_DB_PER_M = 0.5; // ~0.5 dB/m at 868 MHz (ITU-R P.2040 residential)

/** @type {Map<string, any>} */
const _memCache     = new Map();
const MEM_CACHE_MAX = 8;

/** @param {Ring | null | undefined} ring */
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

/**
 * @param {Ring[]} polygons
 * @param {number[]} fallbackHeights
 * @param {AbortSignal | null | undefined} signal
 * @param {number | undefined} datasetBatchConcurrency
 * @param {number} [sampleLimit]
 * @returns {Promise<number[]>}
 */
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
    const fetchOpts = { signal: signal ?? undefined, batchConcurrency: datasetBatchConcurrency };
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
  } catch (rawErr) {
    const err = /** @type {Error & { cancelled?: boolean }} */ (rawErr);
    if (err?.cancelled || err?.name === 'AbortError') throw err;
    console.warn('[buildings] DSM-DEM height derivation failed, using OSM heights:', err.message);
    return fallbackHeights;
  }
}

/**
 * @param {Ring[]} polygons
 * @param {Bbox[]} bboxes
 * @param {number} latMin
 * @param {number} latMax
 * @param {number} lonMin
 * @param {number} lonMax
 */
function _buildTileIndex(polygons, bboxes, latMin, latMax, lonMin, lonMax) {
  if (polygons.length === 0) return null;
  const latSpan = (latMax - latMin) || 1;
  const lonSpan = (lonMax - lonMin) || 1;
  /** @type {number[][]} */
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
 * Parse common OSM length values into metres. Accepts numbers, decimal
 * strings, `5 ft`, `5'10"`, etc. Returns `null` if the input doesn't
 * parse cleanly or resolves to a non-positive number.
 * @param {unknown} value
 * @returns {number | null}
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

/** @param {unknown} value */
function _osmType(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * @param {number} value
 * @param {number} [min]
 * @param {number} [max]
 */
function _clampHeight(value, min = 1, max = 400) {
  return Math.max(min, Math.min(max, value));
}

/** @typedef {Record<string, unknown>} OsmTags */

/** @param {OsmTags} tags */
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

/** @param {OsmTags} tags */
function _floorHeightForTags(tags) {
  const building = _osmType(tags?.building || tags?.['building:part']);
  if (['industrial', 'warehouse', 'hangar', 'farm', 'farm_auxiliary', 'retail'].includes(building)) return 4.2;
  if (['church', 'cathedral', 'chapel', 'train_station'].includes(building)) return 5.0;
  if (['garage', 'garages', 'shed', 'hut', 'roof', 'greenhouse'].includes(building)) return 2.6;
  if (['hospital', 'school', 'university', 'office', 'commercial', 'hotel'].includes(building)) return 3.4;
  return 3.0;
}

/** @param {OsmTags} tags */
function _defaultStructureHeight(tags) {
  const building = _osmType(tags?.building || tags?.['building:part']);
  const manMade = _osmType(tags?.man_made);
  const barrier = _osmType(tags?.barrier);
  const byBuilding = /** @type {Record<string, number>} */ (DEFAULT_HEIGHT_BY_BUILDING_TYPE);
  const byManMade = /** @type {Record<string, number>} */ (DEFAULT_HEIGHT_BY_MAN_MADE);
  const byBarrier = /** @type {Record<string, number>} */ (DEFAULT_HEIGHT_BY_BARRIER);
  if (building && byBuilding[building] !== undefined) return byBuilding[building];
  if (manMade && byManMade[manMade] !== undefined) return byManMade[manMade];
  if (barrier && byBarrier[barrier] !== undefined) return byBarrier[barrier];
  if (_osmType(tags?.military) === 'bunker') return 5;
  return DEFAULT_BUILDING_HEIGHT_M;
}

/**
 * Pick a building height in metres from a tag bag, in priority order:
 * explicit `height` / `building:height` → derived from `building:levels`
 * → fall-back default by `building` / `man_made` / `barrier` kind.
 * @param {OsmTags} [tags]
 * @returns {number}
 */
export function inferBuildingHeight(tags = {}) {
  const explicit = parseOsmLengthMeters(tags.height || tags['building:height'] || tags.est_height);
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

/**
 * Decide whether an OSM feature should be treated as an obstacle, and if so
 * which obstacle kind + inferred height + (for linear features) corridor
 * width.
 * @param {OsmTags} [tags]
 * @returns {{ kind: string, height: number, linearWidthM: number | null } | null}
 */
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

/**
 * Build the Overpass QL query string for a single tile bbox.
 * @param {string} bbox  pre-formatted `(south,west,north,east)` literal
 * @returns {string}
 */
export function buildBuildingsOverpassQuery(bbox) {
  const filters = [
    `way["building"]${bbox};`,
    `relation["building"]${bbox};`,
    `node["building"]${bbox};`,
    `way["building:part"]${bbox};`,
    `relation["building:part"]${bbox};`,
    `way["man_made"~"^(silo|storage_tank|gasometer|water_tower|tower)$"]${bbox};`,
    `relation["man_made"~"^(silo|storage_tank|gasometer|water_tower|tower)$"]${bbox};`,
    `node["man_made"~"^(silo|storage_tank|gasometer|water_tower|tower)$"]${bbox};`,
    `way["barrier"~"^(wall|retaining_wall|city_wall)$"]${bbox};`,
    `relation["barrier"~"^(wall|retaining_wall|city_wall)$"]${bbox};`,
    `way["military"="bunker"]${bbox};`,
    `relation["military"="bunker"]${bbox};`,
    `node["military"="bunker"]${bbox};`,
  ].join('');
  return `[out:json][timeout:60];(${filters});out geom tags;`;
}

/**
 * Fetch one 0.25° tile of building footprints (mem-cache → SQLite → Overpass).
 * Tiles are shared across all repeaters — cached once, reused for every coverage run in the area.
 * @param {import('./osmGeometry.js').TileDescriptor} tile
 * @param {Object} [options]
 * @param {AbortSignal | null} [options.signal]
 * @param {number} [options.datasetBatchConcurrency]
 * @param {boolean} [options.deriveObstacleHeights]
 * @param {number} [options.derivationSampleLimit]
 * @returns {Promise<any>}
 */
async function _fetchBuildingsTile(tile, {
  signal = null,
  datasetBatchConcurrency = 2,
  deriveObstacleHeights = false,
  derivationSampleLimit = 0,
} = {}) {
  const { key } = tile;
  _throwIfAborted(signal);
  if (_memCache.has(key)) {
    console.debug(`[buildings] mem-cache hit tile ${key}`);
    return _memCache.get(key);
  }
  const sqlCached = await window.electronAPI.cacheBuildingsLookup(key);
  if (sqlCached) {
    console.debug(`[buildings] SQLite hit tile ${key} — ${sqlCached.polygons.length} building(s)`);
    if (_memCache.size >= MEM_CACHE_MAX) _memCache.delete(/** @type {string} */ (_memCache.keys().next().value));
    _memCache.set(key, sqlCached);
    return sqlCached;
  }
  console.info(`[buildings] fetching tile ${key} from Overpass`);

  const bbox  = overpassBboxString(tile);
  const query = buildBuildingsOverpassQuery(bbox);

  /** @type {Response | null} */
  let res = null;
  /** @type {Error | null} */
  let lastErr = null;
  for (let attempt = 0; attempt < OVERPASS_MIRRORS.length * 2; attempt++) {
    _throwIfAborted(signal);
    const base = OVERPASS_MIRRORS[attempt % OVERPASS_MIRRORS.length];
    if (attempt > 0) await _sleep(2000 * Math.ceil(attempt / OVERPASS_MIRRORS.length), signal);
    try {
      // 60s timeout via the scheduler: its clock starts when the request is
      // actually dequeued, not while it waits behind the per-host Overpass
      // concurrency cap (1). A hand-rolled timer here would count queue-wait
      // time and spuriously abort queued tiles.
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
      lastErr = /** @type {Error} */ (err);
      continue;
    }
    if (!res) continue;
    if (res.status === 429 || res.status === 406 || res.status >= 500) { res = null; continue; }
    break;
  }
  if (!res) throw new Error(`Overpass API unreachable: ${lastErr?.message ?? 'all mirrors rejected'}`);
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);

  const data = await res.json();
  /** @type {Ring[]} */ const polygons = [];
  /** @type {Bbox[]} */ const bboxes = [];
  /** @type {number[]} */ const heights = [];
  /** @type {string[]} */ const ids = [];
  /** @type {string[]} */ const kinds = [];
  /** @type {Ring[][]} */ const holes = [];
  /** @type {Set<string>} */
  const seenFeatureIds = new Set();
  /** @type {Map<string, Array<{ lat: number, lon: number }>>} */
  const elementGeom = new Map();
  for (const el of data.elements) {
    if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2) {
      elementGeom.set(`way:${el.id}`, el.geometry);
    }
  }
  /** @param {any} member */
  const memberGeometry = (member) => {
    if (!member || typeof member.type !== 'string') return null;
    if (Array.isArray(member.geometry) && member.geometry.length >= 2) return member.geometry;
    return elementGeom.get(`${member.type}:${member.ref}`) ?? null;
  };

  /**
   * @param {Ring} ring
   * @param {number} h
   * @param {string} featureId
   * @param {string} kind
   * @param {Ring[]} [ringHoles]
   */
  const addRing = (ring, h, featureId, kind, ringHoles = []) => {
    if (ring.length < 3) return;
    const bbox = ringBBox(ring);
    const id = featureId || _fallbackFeatureId('b', ring, bbox);
    const dedupeKey = featureDedupeKey(id, ring, bbox);
    if (seenFeatureIds.has(dedupeKey)) return;
    polygons.push(ring);
    bboxes.push(bbox);
    heights.push(h);
    ids.push(id);
    kinds.push(kind || 'building');
    holes.push(ringHoles);
    seenFeatureIds.add(dedupeKey);
  };

  for (const el of data.elements) {
    const classification = classifyStructureTags(el.tags);
    if (!classification) continue;
    const h = classification.height;
    const baseFeatureId = `${el.type}:${el.id ?? 'na'}`;
    if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
      /** @type {Ring} */
      const ring = el.geometry.map((/** @type {{lat:number,lon:number}} */ n) => /** @type {[number,number]} */ ([n.lat, n.lon]));
      if (classification.linearWidthM && !_isClosedRing(ring) && String(el.tags?.area || '').toLowerCase() !== 'yes') {
        const corridors = _lineCorridorRings(ring, classification.linearWidthM);
        for (let ci = 0; ci < corridors.length; ci++) {
          addRing(corridors[ci], h, `${baseFeatureId}:line:${ci}`, classification.kind);
        }
      } else {
        addRing(ring, h, baseFeatureId, classification.kind);
      }
    } else if (el.type === 'relation' && el.members) {
      const multi = assembleMultipolygon(el.members, memberGeometry);
      if (multi.outers.length) {
        for (let ri = 0; ri < multi.outers.length; ri++) {
          const ring = multi.outers[ri];
          if (ring.length < 3) continue;
          addRing(ring, h, `${baseFeatureId}:outer:${ri}`, classification.kind, holeCandidatesForOuter(ring, multi.holes));
        }
      } else if (Array.isArray(el.geometry) && el.geometry.length >= 3) {
        addRing(el.geometry.map((/** @type {{lat:number,lon:number}} */ n) => /** @type {[number,number]} */ ([n.lat, n.lon])), h, baseFeatureId, classification.kind);
      }
    } else if (el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
      const diameterM = parseOsmLengthMeters(el.tags?.diameter || el.tags?.width)
        || classification.linearWidthM
        || 8;
      addRing(_pointCircleRing(el.lat, el.lon, diameterM), h, `${baseFeatureId}:node`, classification.kind);
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
  const tileData = { polygons, bboxes, heights: derivedHeights, ids, kinds, holes };
  if (_memCache.size >= MEM_CACHE_MAX) _memCache.delete(/** @type {string} */ (_memCache.keys().next().value));
  _memCache.set(key, tileData);
  await window.electronAPI.cacheBuildingsStore(key, tileData);
  return tileData;
}

/**
 * Fetch building footprints within a bounding box.
 * Data is fetched and cached per 0.25° tile — nearby repeaters share the same tile data.
 * @param {number} latMin
 * @param {number} latMax
 * @param {number} lonMin
 * @param {number} lonMax
 * @param {Object} [options]
 * @param {AbortSignal | null} [options.signal]
 * @param {((p: { source: string, completed: number, total: number }) => void) | null} [options.onProgress]
 * @param {number} [options.tileConcurrency]
 * @param {number} [options.datasetBatchConcurrency]
 * @param {boolean} [options.deriveObstacleHeights]
 * @param {number} [options.derivationSampleLimit]
 * @returns {Promise<BuildingsPayload & { ids: string[], kinds: string[] }>}
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
  /** @type {Ring[]} */ const polygons = [];
  /** @type {Bbox[]} */ const bboxes = [];
  /** @type {number[]} */ const heights = [];
  /** @type {string[]} */ const ids = [];
  /** @type {string[]} */ const kinds = [];
  /** @type {Ring[][]} */ const holes = [];
  /** @type {Set<string>} */
  const seenMerged = new Set();
  const tileResults = await fetchOsmTileBatch(tiles, {
    signal,
    tileConcurrency,
    loadTile: tile => _fetchBuildingsTile(tile, {
      signal,
      datasetBatchConcurrency,
      deriveObstacleHeights,
      derivationSampleLimit,
    }),
    onProgress: ({ completed, total }) => onProgress?.({ source: 'buildings', completed, total }),
    onTileError: (e, tile) => console.warn(`[buildings] tile ${tile.key} failed, skipping:`, e),
  });

  for (const { data: td } of tileResults) {
    for (let i = 0; i < td.polygons.length; i++) {
      const poly = td.polygons[i];
      const bb = td.bboxes[i];
      const id = td.ids?.[i] || _fallbackFeatureId('b', poly, bb);
      const dedupeKey = featureDedupeKey(id, poly, bb);
      if (seenMerged.has(dedupeKey)) continue;
      seenMerged.add(dedupeKey);
      polygons.push(poly);
      bboxes.push(bb);
      heights.push(td.heights[i]);
      ids.push(id);
      kinds.push(td.kinds?.[i] || 'building');
      holes.push(td.holes?.[i] ?? []);
    }
  }

  console.info(`[buildings] merged ${polygons.length} building(s) from ${tiles.length} tile(s)`);
  const tileIndex = _buildTileIndex(polygons, bboxes, latMin, latMax, lonMin, lonMax);
  return { polygons, bboxes, heights, ids, kinds, holes, tileIndex };
}

/**
 * @param {{ tiles: number[][], latMin: number, latSpan: number, lonMin: number, lonSpan: number } | null} tileIndex
 * @param {Bbox[]} bboxes
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @param {number} polygonCount
 * @returns {Iterable<number>}
 */
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
  /** @type {Set<number>} */
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
 * @param {ArrayLike<number>} profileLats
 * @param {ArrayLike<number>} profileLons
 * @param {ArrayLike<number>} profileElevs
 * @param {number}  txAntH
 * @param {number}  rxAntH
 * @param {Ring[]}   polygons
 * @param {Bbox[]}   bboxes
 * @param {ArrayLike<number>} heights     building height (m above terrain) per polygon
 * @param {{ tiles: number[][], latMin: number, latSpan: number, lonMin: number, lonSpan: number } | null} tileIndex
 * @param {number}  totalDistM
 * @param {number}  [lossPerMeterDb]
 * @param {Ring[][]} [holes]
 * @returns {number} total building loss in dB
 */
export function buildingLossDb(profileLats, profileLons, profileElevs, txAntH, rxAntH,
                               polygons, bboxes, heights, tileIndex, totalDistM, lossPerMeterDb = DEFAULT_WALL_LOSS_DB_PER_M, holes = []) {
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
      const intervals = segmentPolygonIntervalsWithHoles(lat1, lon1, lat2, lon2, polygons[i], holes?.[i]);
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
