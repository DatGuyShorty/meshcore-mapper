/**
 * pathfinder.js — Best relay path search through the repeater network.
 *
 * Algorithm: radius-limited frontier search.
 *   Starts from the selected source node, expands only to repeaters within the
 *   hop radius, and ranks paths lexicographically by bottleneck margin then hop
 *   count. This matches the requested "best signal, fewest hops" behavior.
 *
 * Elevation fetches are batched in two calls:
 *   1. One point per node (TX/RX ground elevation).
 *   2. All terrain profile samples for every candidate edge, in a single batch.
 *
 * Exports: findBestPath
 */
import { fetchElevations } from './elevation.js';
import { fetchFoliage, foliageLossDb } from './foliage.js';
import { fetchBuildings, buildingLossDb } from './buildings.js';
import { antennaPatternOffsetDb, bearingDeg, haversine, fspl, checkLoS, profileSampleCount } from './propagation.js';

export type RelayNode = {
  id: string | number;
  name?: string;
  lat: number;
  lon: number;
  height: number;
  power: number;
  freq: number;
  gain: number;
  pattern?: string;
  azimuthDeg?: number;
};

type Bbox = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

type ProfilePoint = {
  latitude: number;
  longitude: number;
};

type ObstacleRing = [number, number][];

type ObstacleTileIndex = {
  tiles: number[][];
  latMin: number;
  latSpan: number;
  lonMin: number;
  lonSpan: number;
};

type ObstacleSet = {
  polygons: ObstacleRing[];
  bboxes: Bbox[];
  canopyHeights?: ArrayLike<number>;
  factors?: ArrayLike<number>;
  heights?: ArrayLike<number>;
  tileIndex?: ObstacleTileIndex | null;
  holes?: ObstacleRing[][];
};

type LinkScenario = {
  foliage: ObstacleSet | null;
  buildings: ObstacleSet | null;
  foliageLossPerM: number;
  buildingLossPerM: number;
};

export type PathfinderScenario = {
  signal?: AbortSignal | null;
  onLog?: ((line: string) => void) | null;
  onProgress?: ((pct: number, msg: string) => void) | null;
  pathHopRadiusKm?: number;
  maxHops?: number;
  hopPenaltyDb?: number;
  useFoliage?: boolean;
  useBuildings?: boolean;
  deriveObstacleHeights?: boolean;
  foliageLossPerM?: number;
  buildingLossPerM?: number;
};

export type PathStep = {
  node: RelayNode;
  incomingMargin: number | null;
};

export type PathResult = {
  path: PathStep[];
  bottleneck: number;
  numHops: number;
  edgeDistances: number[];
  edgeRxPowers: number[];
};

type EdgeDescriptor = {
  i: number;
  j: number;
  distM: number;
  samples: number;
  offset: number;
};

type AdjacencyEdge = {
  idx: number;
  distM: number;
  margin: number;
};

type HeapEntry = {
  idx: number;
  margin: number;
  hops: number;
};

type FetchError = {
  cancelled?: boolean;
  name?: string;
};

const PROFILE_TARGET_SPACING_M = 150;  // coarser than coverage — we're screening many hops, not doing precise link budgets
const PROFILE_MAX_SAMPLES = 512;
const MAX_EDGE_KM = 200;    // skip edges longer than this — no LoRa link will span 200 km
const DEFAULT_HOP_RADIUS_KM = 25;
const DEFAULT_HOP_PENALTY_DB = 1; // dB deducted per hop from the effective score — keeps hops as a secondary tiebreaker without overriding better-margin paths
const DIFFRACTION_LOSS_CAP_DB = 200; // cap per-hop diffraction; Deygout can otherwise accumulate arbitrarily on obstructed terrain

function _profilePoints(a: RelayNode, b: RelayNode, samples: number): ProfilePoint[] {
  const pts: ProfilePoint[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    pts.push({
      latitude:  a.lat + (b.lat - a.lat) * t,
      longitude: a.lon + (b.lon - a.lon) * t,
    });
  }
  return pts;
}

function _nodesBbox(nodes: RelayNode[]): Bbox {
  const PAD = 0.003;
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const n of nodes) {
    if (n.lat < latMin) latMin = n.lat;
    if (n.lat > latMax) latMax = n.lat;
    if (n.lon < lonMin) lonMin = n.lon;
    if (n.lon > lonMax) lonMax = n.lon;
  }
  return {
    latMin: latMin - PAD,
    latMax: latMax + PAD,
    lonMin: lonMin - PAD,
    lonMax: lonMax + PAD,
  };
}

/** Nodes that appear as either endpoint of any candidate edge — i.e. nodes that
 *  could possibly lie on a relay path. Isolated nodes outside hop radius of
 *  everyone are skipped so we don't fetch obstacles for them.
 */
function _nodesInEdges(nodes: RelayNode[], edges: Array<{ i: number; j: number }>): RelayNode[] {
  const idxSet = new Set<number>();
  for (const { i, j } of edges) { idxSet.add(i); idxSet.add(j); }
  const out: RelayNode[] = [];
  for (const idx of idxSet) out.push(nodes[idx]);
  return out;
}

function _profileCoordArrays(points: ProfilePoint[]): { lats: Float64Array; lons: Float64Array } {
  const lats = new Float64Array(points.length);
  const lons = new Float64Array(points.length);
  for (let i = 0; i < points.length; i++) {
    lats[i] = points[i].latitude;
    lons[i] = points[i].longitude;
  }
  return { lats, lons };
}

function _reverseFloat64(src: Float64Array): Float64Array {
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[src.length - 1 - i];
  return out;
}

function _isBetterScore(
  candidateMargin: number,
  candidateHops: number,
  currentMargin: number,
  currentHops: number,
  hopPenaltyDb: number,
): boolean {
  const candidateScore = candidateMargin - hopPenaltyDb * candidateHops;
  const currentScore   = currentMargin   - hopPenaltyDb * currentHops;
  return candidateScore > currentScore;
}

/**
 * Binary max-heap keyed by (margin DESC, hops ASC) for O(log n) dequeue.
 * Stale entries are harmless — the settled[] flag skips them on pop.
 */
class _MaxHeap {
  _data: HeapEntry[];
  _pen: number;

  constructor(hopPenaltyDb: number) {
    this._data = [];
    this._pen  = hopPenaltyDb;
  }
  get size() { return this._data.length; }
  push(idx: number, margin: number, hops: number): void {
    this._data.push({ idx, margin, hops });
    this._siftUp(this._data.length - 1);
  }
  pop(): number {
    const top = this._data[0];
    const last = this._data.pop() as HeapEntry;
    if (this._data.length > 0) {
      this._data[0] = last;
      this._siftDown(0);
    }
    return top.idx;
  }
  _siftUp(i: number): void {
    const d = this._data;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (_isBetterScore(d[i].margin, d[i].hops, d[p].margin, d[p].hops, this._pen)) {
        const tmp = d[i]; d[i] = d[p]; d[p] = tmp;
        i = p;
      } else break;
    }
  }
  _siftDown(i: number): void {
    const d = this._data;
    const n = d.length;
    for (;;) {
      let best = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && _isBetterScore(d[l].margin, d[l].hops, d[best].margin, d[best].hops, this._pen)) best = l;
      if (r < n && _isBetterScore(d[r].margin, d[r].hops, d[best].margin, d[best].hops, this._pen)) best = r;
      if (best === i) break;
      const tmp = d[i]; d[i] = d[best]; d[best] = tmp;
      i = best;
    }
  }
}

function _linkMargin(
  txNode: RelayNode,
  txElev: number,
  rxNode: RelayNode,
  rxElev: number,
  profile: number[],
  profileLats: Float64Array,
  profileLons: Float64Array,
  rxGain: number,
  rxSens: number,
  useFresnel: boolean,
  scenario: LinkScenario,
): number {
  const distM = haversine(txNode.lat, txNode.lon, rxNode.lat, rxNode.lon);
  if (distM < 1) return 60; // same location
  const pathLoss = fspl(distM, txNode.freq);
  const los = checkLoS(txElev, rxElev, profile, txNode.height, rxNode.height, distM, txNode.freq, useFresnel, 'deygout');
  const diffractionLoss = Math.min(los.diffractionLossDb, DIFFRACTION_LOSS_CAP_DB);
  const foliageLoss = scenario.foliage
    ? foliageLossDb(
        profileLats, profileLons, profile, txNode.height, rxNode.height,
        scenario.foliage.polygons ?? [], scenario.foliage.bboxes,
        scenario.foliage.canopyHeights ?? [], scenario.foliage.factors ?? [],
        scenario.foliage.tileIndex ?? null, distM, scenario.foliageLossPerM, txNode.freq, scenario.foliage.holes
      )
    : 0;
  const buildingLoss = scenario.buildings
    ? buildingLossDb(
        profileLats, profileLons, profile, txNode.height, rxNode.height,
        scenario.buildings.polygons ?? [], scenario.buildings.bboxes,
        scenario.buildings.heights ?? [], scenario.buildings.tileIndex ?? null,
        distM, scenario.buildingLossPerM, scenario.buildings.holes
      )
    : 0;
  const txToRxBearing = bearingDeg(txNode.lat, txNode.lon, rxNode.lat, rxNode.lon);
  const rxToTxBearing = bearingDeg(rxNode.lat, rxNode.lon, txNode.lat, txNode.lon);
  const txPatternOffset = antennaPatternOffsetDb(txNode.pattern ?? 'omni', txNode.azimuthDeg ?? 0, txToRxBearing);
  const rxPatternOffset = antennaPatternOffsetDb(rxNode.pattern ?? 'omni', rxNode.azimuthDeg ?? 0, rxToTxBearing);
  const effectiveRxGain = Number.isFinite(rxNode.gain) ? rxNode.gain : rxGain;
  return txNode.power + txNode.gain + txPatternOffset + effectiveRxGain + rxPatternOffset
    - pathLoss - diffractionLoss - foliageLoss - buildingLoss - rxSens;
}

export async function findBestPath(
  nodes: RelayNode[],
  fromId: string | number,
  toId: string | number,
  rxSens: number,
  rxGain: number,
  useFresnel: boolean,
  scenario: PathfinderScenario = {},
): Promise<PathResult | null> {
  const t0 = performance.now();
  const step = (msg: string): void => {
    const elapsed = (performance.now() - t0).toFixed(1);
    if (typeof scenario.onLog === 'function') {
      scenario.onLog(`[${elapsed}ms] ${msg}`);
      return;
    }
    console.info(`[pathfinder] [${elapsed}ms] ${msg}`);
  };
  const progress = (pct: number, msg: string): void => {
    if (typeof scenario.onProgress === 'function') scenario.onProgress(pct, msg);
  };
  const signal = scenario.signal ?? null;
  const n = nodes.length;
  if (n < 2) return null;

  progress(2, 'Preparing relay path search...');
  step('Settings: ' + JSON.stringify({
    nodes: n,
    fromId,
    toId,
    rxSens,
    rxGain,
    useFresnel,
    pathHopRadiusKm: Number.isFinite(scenario.pathHopRadiusKm) ? scenario.pathHopRadiusKm : DEFAULT_HOP_RADIUS_KM,
    maxHops: Math.max(0, Math.round(Number(scenario.maxHops) || 0)),
    hopPenaltyDb: Number.isFinite(scenario.hopPenaltyDb) ? scenario.hopPenaltyDb : DEFAULT_HOP_PENALTY_DB,
    useFoliage: Boolean(scenario.useFoliage),
    useBuildings: Boolean(scenario.useBuildings),
    deriveObstacleHeights: Boolean(scenario.deriveObstacleHeights),
  }));

  const idxById = new Map(nodes.map((nd, i) => [nd.id, i]));
  const fromIdx = idxById.get(fromId);
  const toIdx   = idxById.get(toId);
  if (fromIdx === undefined || toIdx === undefined) return null;
  if (fromIdx === toIdx) return null;
  const hopRadiusKm = Math.max(1, Number(scenario.pathHopRadiusKm) || DEFAULT_HOP_RADIUS_KM);
  const hopRadiusM = Math.min(hopRadiusKm, MAX_EDGE_KM) * 1000;
  const maxHops = Math.max(0, Math.round(Number(scenario.maxHops) || 0));
  const hopPenaltyDb = Number.isFinite(scenario.hopPenaltyDb) ? Number(scenario.hopPenaltyDb) : DEFAULT_HOP_PENALTY_DB;
  step(`Hop radius: ${hopRadiusKm.toFixed(1)} km (effective cap ${Math.min(hopRadiusKm, MAX_EDGE_KM).toFixed(1)} km)${maxHops > 0 ? `, max hops: ${maxHops}` : ''}, hop penalty: ${hopPenaltyDb} dB`);

  // ── 1. Fetch ground elevations for all nodes (one point each) ──
  progress(12, 'Fetching node elevations...');
  const nodeElevs = await fetchElevations(
    nodes.map(nd => ({ latitude: nd.lat, longitude: nd.lon })),
    null,
    { signal }
  ) as number[];
  progress(22, 'Node elevations ready.');
  step(`Node elevations fetched (${nodeElevs.length})`);

  // ── 2. Build radius-limited candidate edges + batch all profile points ──
  // Ellipse pre-filter: skip nodes where dist(node,from) + dist(node,to) > directDist + 2×hopRadius.
  // Those nodes can never improve on the optimal path (they require too large a detour).
  const directDistM = haversine(nodes[fromIdx].lat, nodes[fromIdx].lon, nodes[toIdx].lat, nodes[toIdx].lon);
  const ellipseMaxDistM = directDistM + 2 * hopRadiusM;
  const nodeDistTo = new Float64Array(n);
  const nodeInEllipse = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const dFrom = haversine(nodes[i].lat, nodes[i].lon, nodes[fromIdx].lat, nodes[fromIdx].lon);
    const dTo   = haversine(nodes[i].lat, nodes[i].lon, nodes[toIdx].lat, nodes[toIdx].lon);
    nodeDistTo[i] = dTo;
    nodeInEllipse[i] = (dFrom + dTo <= ellipseMaxDistM) ? 1 : 0;
  }
  // Source and destination are always included regardless of rounding.
  nodeInEllipse[fromIdx] = 1;
  nodeInEllipse[toIdx]   = 1;
  const ellipseCount = nodeInEllipse.reduce((s, v) => s + v, 0);
  step(`Ellipse filter: ${ellipseCount}/${n} nodes within path ellipse (slack=${((ellipseMaxDistM - directDistM) / 1000).toFixed(1)} km)`);

  const edges: EdgeDescriptor[] = [];
  const allProfilePts: ProfilePoint[] = [];

  for (let i = 0; i < n; i++) {
    if (!nodeInEllipse[i]) continue;
    for (let j = i + 1; j < n; j++) {
      if (!nodeInEllipse[j]) continue;
      const distM = haversine(nodes[i].lat, nodes[i].lon, nodes[j].lat, nodes[j].lon);
      if (distM > hopRadiusM) continue;
      const samples = profileSampleCount(distM, PROFILE_TARGET_SPACING_M, 16, PROFILE_MAX_SAMPLES);
      edges.push({ i, j, distM, samples, offset: allProfilePts.length });
      _profilePoints(nodes[i], nodes[j], samples).forEach(p => allProfilePts.push(p));
    }
  }
  progress(36, `Built ${edges.length} candidate hop${edges.length !== 1 ? 's' : ''}.`);
  step(`Candidate hops within radius: ${edges.length}, profile points: ${allProfilePts.length}`);

  let profileElevs: number[] = [];
  if (allProfilePts.length > 0) {
    progress(44, `Fetching terrain profiles for ${edges.length} hop${edges.length !== 1 ? 's' : ''}...`);
    profileElevs = await fetchElevations(allProfilePts, null, { signal }) as number[];
    progress(58, 'Terrain profiles ready.');
    step(`Profile elevations fetched (${profileElevs.length})`);
  }

  // ── 3. Build directed margin matrix ──
  // margin[i*n+j] = margin when node[i] TXs to node[j], -Inf if no usable edge
  let foliage: ObstacleSet | null = null;
  let buildings: ObstacleSet | null = null;
  if (scenario.useFoliage || scenario.useBuildings) {
    progress(64, 'Fetching relay obstacle layers...');
    const connectedNodes = _nodesInEdges(nodes, edges);
    const bbox = connectedNodes.length
      ? _nodesBbox(connectedNodes)
      : _nodesBbox([nodes[fromIdx], nodes[toIdx]]);
    [foliage, buildings] = await Promise.all([
      scenario.useFoliage
        ? fetchFoliage(bbox.latMin, bbox.latMax, bbox.lonMin, bbox.lonMax, {
            signal,
            deriveObstacleHeights: scenario.deriveObstacleHeights,
          })
            .catch(e => {
              const err = e as FetchError;
              if (err.cancelled || err.name === 'AbortError') throw e;
              console.warn('[pathfinder] foliage fetch failed, skipping:', e);
              return null;
            })
        : Promise.resolve(null),
      scenario.useBuildings
        ? fetchBuildings(bbox.latMin, bbox.latMax, bbox.lonMin, bbox.lonMax, {
            signal,
            deriveObstacleHeights: scenario.deriveObstacleHeights,
          })
            .catch(e => {
              const err = e as FetchError;
              if (err.cancelled || err.name === 'AbortError') throw e;
              console.warn('[pathfinder] buildings fetch failed, skipping:', e);
              return null;
            })
        : Promise.resolve(null),
    ]) as [ObstacleSet | null, ObstacleSet | null];
    if (scenario.useFoliage && !foliage) progress(72, 'Warning: foliage loss requested but vegetation data was unavailable.');
    if (scenario.useBuildings && !buildings) progress(72, 'Warning: building loss requested but structure data was unavailable.');
    progress(72, 'Relay obstacle layers ready.');
    step(`Obstacle layers ready: foliage=${foliage ? 'yes' : 'no'}, buildings=${buildings ? 'yes' : 'no'}`);
  }
  const linkScenario = {
    foliage,
    buildings,
    foliageLossPerM: scenario.foliageLossPerM ?? 0.3,
    buildingLossPerM: scenario.buildingLossPerM ?? 0.5,
  };

  const adjacency: AdjacencyEdge[][] = Array.from({ length: n }, () => []);

  for (const { i, j, distM, samples, offset } of edges) {
    const profile = profileElevs.slice(offset, offset + samples);
    const profilePoints = allProfilePts.slice(offset, offset + samples);
    const { lats, lons } = _profileCoordArrays(profilePoints);
    const reverseProfile = profile.slice().reverse();
    const reverseLats = _reverseFloat64(lats);
    const reverseLons = _reverseFloat64(lons);
    const forwardMargin = _linkMargin(nodes[i], nodeElevs[i], nodes[j], nodeElevs[j], profile, lats, lons, rxGain, rxSens, useFresnel, linkScenario);
    const reverseMargin = _linkMargin(nodes[j], nodeElevs[j], nodes[i], nodeElevs[i], reverseProfile, reverseLats, reverseLons, rxGain, rxSens, useFresnel, linkScenario);
    adjacency[i].push({ idx: j, distM, margin: forwardMargin });
    adjacency[j].push({ idx: i, distM, margin: reverseMargin });
  }
  progress(82, 'Relay hop margins calculated.');
  step('Radius-limited hop margins built');

  // ── 4. Max-heap frontier search ──
  // Score = bottleneck_margin - hopPenaltyDb * hops.
  // Each extra hop must justify itself with hopPenaltyDb dB of margin improvement.
  // This naturally prefers fewer, longer LoS hops over many short obstructed ones.
  const bestMargin = new Float32Array(n).fill(-Infinity);
  const bestHops = new Int32Array(n).fill(0x7fffffff);
  const prev = new Int32Array(n).fill(-1);
  const incomingMargin = new Float32Array(n).fill(-Infinity);
  const settled = new Uint8Array(n);
  const heap = new _MaxHeap(hopPenaltyDb);
  heap.push(fromIdx, Infinity, 0);
  bestMargin[fromIdx] = Infinity;
  bestHops[fromIdx] = 0;

  while (heap.size > 0) {
    const u = heap.pop();
    if (settled[u]) continue;
    settled[u] = 1;
    if (u === toIdx) break;
    if (maxHops > 0 && bestHops[u] >= maxHops) continue;

    for (const edge of adjacency[u]) {
      const v = edge.idx;
      if (settled[v]) continue;
      const reachableMargin = Math.min(bestMargin[u], edge.margin);
      const reachableHops = bestHops[u] + 1;
      if (_isBetterScore(reachableMargin, reachableHops, bestMargin[v], bestHops[v], hopPenaltyDb)) {
        bestMargin[v] = reachableMargin;
        bestHops[v] = reachableHops;
        prev[v] = u;
        incomingMargin[v] = edge.margin;
        heap.push(v, reachableMargin, reachableHops);
      }
    }
  }
  progress(92, 'Relay graph search complete.');
  step('Radius-based frontier search complete');

  if (bestMargin[toIdx] === -Infinity) {
    progress(100, 'No relay path found.');
    step(`No path found (${(performance.now() - t0).toFixed(1)}ms total)`);
    return null; // no connected path
  }

  // ── 5. Reconstruct path ──
  const path: PathStep[] = [];
  let cur = toIdx;
  while (cur !== fromIdx) {
    const p = prev[cur];
    path.unshift({ node: nodes[cur], incomingMargin: incomingMargin[cur] });
    cur = p;
  }
  path.unshift({ node: nodes[fromIdx], incomingMargin: null });

  const edgeDistances: number[] = [];
  const edgeRxPowers: number[] = [];
  for (let s = 1; s < path.length; s++) {
    const a = path[s - 1].node, b = path[s].node;
    edgeDistances.push(haversine(a.lat, a.lon, b.lat, b.lon));
    edgeRxPowers.push((path[s].incomingMargin ?? 0) + rxSens);
  }

  progress(100, 'Relay path ready.');
  return {
    path,
    bottleneck: bestMargin[toIdx],
    numHops: path.length - 1,
    edgeDistances,
    edgeRxPowers,
  };
}
