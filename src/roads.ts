import { scheduledFetch } from './requestScheduler.js';
import { fetchOsmTileBatch } from './osmTilePipeline.js';
import { overpassBboxString, tileDescriptorsForBbox } from './osmGeometry.js';

export type RoadPoint = {
  latitude: number;
  longitude: number;
};

export type RoadLine = {
  id: string;
  type: string;
  points: RoadPoint[];
};

export type RoadFetchResult = {
  lines: RoadLine[];
  tiles: number;
};

type RoadTilePayload = {
  lines: RoadLine[];
};

type RoadFetchOptions = {
  signal?: AbortSignal | null;
  tileConcurrency?: number;
};

type OsmTileDescriptor = {
  key: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  [key: string]: unknown;
};

type OsmWayElement = {
  type?: unknown;
  id?: unknown;
  tags?: Record<string, unknown>;
  geometry?: Array<{ lat?: unknown; lon?: unknown }>;
};

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const CACHE_V_ROADS = 'rv1:';
const ROAD_TILE_CONCURRENCY = 3;
const MEM_CACHE_MAX = 12;

const ACCESSIBLE_HIGHWAYS = new Set([
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'track',
  'road',
]);

const _memCache = new Map<string, RoadTilePayload>();

export function buildRoadOverpassQuery(bbox: string): string {
  return `[out:json][timeout:45];(way["highway"]${bbox};);out geom tags;`;
}

export function extractRoadLines(data: unknown): RoadLine[] {
  const elements = Array.isArray((data as { elements?: unknown })?.elements)
    ? (data as { elements: OsmWayElement[] }).elements
    : [];
  const lines: RoadLine[] = [];
  for (const el of elements) {
    if (el?.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    if (!isAccessibleRoad(el.tags ?? {})) continue;
    const points = el.geometry
      .map(pt => ({
        latitude: Number(pt.lat),
        longitude: Number(pt.lon),
      }))
      .filter((pt): pt is RoadPoint => Number.isFinite(pt.latitude) && Number.isFinite(pt.longitude));
    if (points.length < 2) continue;
    lines.push({
      id: `way:${el.id ?? fallbackRoadId(points)}`,
      type: String(el.tags?.highway ?? 'road'),
      points,
    });
  }
  return lines;
}

export async function fetchRoads(
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number,
  options: RoadFetchOptions = {},
): Promise<RoadFetchResult> {
  const {
    signal = null,
    tileConcurrency = ROAD_TILE_CONCURRENCY,
  } = options;
  const tiles = tileDescriptorsForBbox(latMin, latMax, lonMin, lonMax, CACHE_V_ROADS);
  const tileResults = await fetchOsmTileBatch(tiles, {
    signal,
    tileConcurrency,
    loadTile: (tile: OsmTileDescriptor) => fetchRoadTile(tile, { signal }),
    onTileError: (e: unknown, tile: OsmTileDescriptor) => console.warn(`[roads] tile ${tile.key} failed, skipping:`, e),
  });
  const lines: RoadLine[] = [];
  const seen = new Set<string>();
  for (const { data } of tileResults) {
    for (const line of data.lines ?? []) {
      if (seen.has(line.id)) continue;
      seen.add(line.id);
      lines.push(line);
    }
  }
  console.info(`[roads] merged ${lines.length} road line(s) from ${tiles.length} tile(s)`);
  return { lines, tiles: tiles.length };
}

function isAccessibleRoad(tags: Record<string, unknown>): boolean {
  const highway = String(tags.highway ?? '');
  if (!ACCESSIBLE_HIGHWAYS.has(highway)) return false;
  const access = String(tags.access ?? '').toLowerCase();
  if (access === 'no' || access === 'private') return false;
  return true;
}

async function fetchRoadTile(tile: OsmTileDescriptor, { signal = null }: { signal?: AbortSignal | null } = {}): Promise<RoadTilePayload> {
  const { key } = tile;
  if (signal?.aborted) throw abortError();
  if (_memCache.has(key)) {
    return _memCache.get(key) as RoadTilePayload;
  }

  const bbox = overpassBboxString(tile);
  const query = buildRoadOverpassQuery(bbox);
  let response: Response | null = null;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < OVERPASS_MIRRORS.length * 2; attempt++) {
    if (signal?.aborted) throw abortError();
    const base = OVERPASS_MIRRORS[attempt % OVERPASS_MIRRORS.length];
    try {
      response = await scheduledFetch(base, {
        method: 'POST',
        headers: {
          'Accept': '*/*',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal,
        timeoutMs: 45000,
      });
    } catch (rawErr) {
      lastErr = rawErr as Error;
      continue;
    }
    if (!response) continue;
    if (response.status === 429 || response.status === 406 || response.status >= 500) {
      response = null;
      continue;
    }
    break;
  }
  if (!response) throw new Error(`Overpass API unreachable: ${lastErr?.message ?? 'all mirrors rejected'}`);
  if (!response.ok) throw new Error(`Overpass API error: ${response.status}`);

  const payload = { lines: extractRoadLines(await response.json()) };
  if (_memCache.size >= MEM_CACHE_MAX) {
    const firstKey = _memCache.keys().next().value;
    if (firstKey) _memCache.delete(firstKey);
  }
  _memCache.set(key, payload);
  return payload;
}

function fallbackRoadId(points: RoadPoint[]): string {
  const first = points[0];
  const last = points[points.length - 1];
  return `${first.latitude.toFixed(6)},${first.longitude.toFixed(6)}:${last.latitude.toFixed(6)},${last.longitude.toFixed(6)}`;
}

function abortError(): Error & { cancelled?: boolean } {
  const err = new Error('Cancelled') as Error & { cancelled?: boolean };
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}
