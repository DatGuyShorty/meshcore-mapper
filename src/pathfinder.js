// @ts-check
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
 *
 * @typedef {Object} RelayNode
 * @property {string | number} id
 * @property {string} [name]
 * @property {number} lat
 * @property {number} lon
 * @property {number} height
 * @property {number} power
 * @property {number} freq
 * @property {number} gain
 * @property {string} [pattern]
 * @property {number} [azimuthDeg]
 *
 * @typedef {import('./signalModel.js').ObstacleSet} ObstacleSet
 *
 * @typedef {Object} LinkScenario
 * @property {ObstacleSet | null} foliage
 * @property {ObstacleSet | null} buildings
 * @property {number} foliageLossPerM
 * @property {number} buildingLossPerM
 *
 * @typedef {Object} PathfinderScenario
 * @property {AbortSignal | null} [signal]
 * @property {((line: string) => void) | null} [onLog]
 * @property {((pct: number, msg: string) => void) | null} [onProgress]
 * @property {number} [pathHopRadiusKm]
 * @property {boolean} [useFoliage]
 * @property {boolean} [useBuildings]
 * @property {boolean} [deriveObstacleHeights]
 * @property {number} [foliageLossPerM]
 * @property {number} [buildingLossPerM]
 *
 * @typedef {Object} PathStep
 * @property {RelayNode} node
 * @property {number | null} incomingMargin
 *
 * @typedef {Object} PathResult
 * @property {PathStep[]} path
 * @property {number} bottleneck
 * @property {number} numHops
 * @property {number[]} edgeDistances
 * @property {number[]} edgeRxPowers
 */
import { fetchElevations } from './elevation.js';
import { fetchFoliage, foliageLossDb } from './foliage.js';
import { fetchBuildings, buildingLossDb } from './buildings.js';
import { antennaPatternOffsetDb, bearingDeg, haversine, fspl, checkLoS, profileSampleCount } from './propagation.js';

const PROFILE_TARGET_SPACING_M = 75;
const PROFILE_MAX_SAMPLES = 512;
const MAX_EDGE_KM = 200;    // skip edges longer than this — no LoRa link will span 200 km
const DEFAULT_HOP_RADIUS_KM = 25;

/**
 * Build profile sample-point array from node A to node B.
 * @param {RelayNode} a
 * @param {RelayNode} b
 * @param {number} samples
 * @returns {Array<{ latitude: number, longitude: number }>}
 */
function _profilePoints(a, b, samples) {
  /** @type {Array<{ latitude: number, longitude: number }>} */
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    pts.push({
      latitude:  a.lat + (b.lat - a.lat) * t,
      longitude: a.lon + (b.lon - a.lon) * t,
    });
  }
  return pts;
}

/** @param {RelayNode[]} nodes */
function _nodesBbox(nodes) {
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
 *  @param {RelayNode[]} nodes
 *  @param {Array<{ i: number, j: number }>} edges
 *  @returns {RelayNode[]}
 */
function _nodesInEdges(nodes, edges) {
  /** @type {Set<number>} */
  const idxSet = new Set();
  for (const { i, j } of edges) { idxSet.add(i); idxSet.add(j); }
  /** @type {RelayNode[]} */
  const out = [];
  for (const idx of idxSet) out.push(nodes[idx]);
  return out;
}

/** @param {Array<{ latitude: number, longitude: number }>} points */
function _profileCoordArrays(points) {
  const lats = new Float64Array(points.length);
  const lons = new Float64Array(points.length);
  for (let i = 0; i < points.length; i++) {
    lats[i] = points[i].latitude;
    lons[i] = points[i].longitude;
  }
  return { lats, lons };
}

/** @param {Float64Array} src */
function _reverseFloat64(src) {
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[src.length - 1 - i];
  return out;
}

/**
 * @param {number} candidateMargin
 * @param {number} candidateHops
 * @param {number} currentMargin
 * @param {number} currentHops
 */
function _isBetterScore(candidateMargin, candidateHops, currentMargin, currentHops) {
  if (candidateMargin > currentMargin) return true;
  if (candidateMargin < currentMargin) return false;
  return candidateHops < currentHops;
}

/**
 * @param {number[]} frontier
 * @param {Float32Array} bestMargin
 * @param {Int32Array} bestHops
 * @returns {number}
 */
function _bestFrontierIndex(frontier, bestMargin, bestHops) {
  let bestPos = 0;
  for (let i = 1; i < frontier.length; i++) {
    const a = frontier[i];
    const b = frontier[bestPos];
    if (_isBetterScore(bestMargin[a], bestHops[a], bestMargin[b], bestHops[b])) {
      bestPos = i;
    }
  }
  return bestPos;
}

/**
 * Link margin (dB) when node txNode transmits to rxNode.
 * @param {RelayNode} txNode
 * @param {number} txElev   ground elevation at txNode (m AMSL)
 * @param {RelayNode} rxNode
 * @param {number} rxElev   ground elevation at rxNode (m AMSL)
 * @param {number[]} profile  pre-fetched elevation array
 * @param {Float64Array} profileLats
 * @param {Float64Array} profileLons
 * @param {number} rxGain   RX antenna gain dBi, fallback when rxNode.gain isn't finite
 * @param {number} rxSens   required RX level dBm, including fade margin
 * @param {boolean} useFresnel
 * @param {LinkScenario} scenario
 * @returns {number}
 */
function _linkMargin(txNode, txElev, rxNode, rxElev, profile, profileLats, profileLons, rxGain, rxSens, useFresnel, scenario) {
  const distM = haversine(txNode.lat, txNode.lon, rxNode.lat, rxNode.lon);
  if (distM < 1) return 60; // same location
  const pathLoss = fspl(distM, txNode.freq);
  const los = checkLoS(txElev, rxElev, profile, txNode.height, rxNode.height, distM, txNode.freq, useFresnel, 'deygout');
  const foliageLoss = scenario.foliage
    ? foliageLossDb(
        profileLats, profileLons, profile, txNode.height, rxNode.height,
        scenario.foliage.polygons, scenario.foliage.bboxes,
        scenario.foliage.canopyHeights ?? [], scenario.foliage.factors ?? [],
        scenario.foliage.tileIndex, distM, scenario.foliageLossPerM, txNode.freq, scenario.foliage.holes
      )
    : 0;
  const buildingLoss = scenario.buildings
    ? buildingLossDb(
        profileLats, profileLons, profile, txNode.height, rxNode.height,
        scenario.buildings.polygons, scenario.buildings.bboxes,
        scenario.buildings.heights ?? [], scenario.buildings.tileIndex,
        distM, scenario.buildingLossPerM, scenario.buildings.holes
      )
    : 0;
  const txToRxBearing = bearingDeg(txNode.lat, txNode.lon, rxNode.lat, rxNode.lon);
  const rxToTxBearing = bearingDeg(rxNode.lat, rxNode.lon, txNode.lat, txNode.lon);
  const txPatternOffset = antennaPatternOffsetDb(txNode.pattern ?? 'omni', txNode.azimuthDeg ?? 0, txToRxBearing);
  const rxPatternOffset = antennaPatternOffsetDb(rxNode.pattern ?? 'omni', rxNode.azimuthDeg ?? 0, rxToTxBearing);
  const effectiveRxGain = Number.isFinite(rxNode.gain) ? rxNode.gain : rxGain;
  return txNode.power + txNode.gain + txPatternOffset + effectiveRxGain + rxPatternOffset
    - pathLoss - los.diffractionLossDb - foliageLoss - buildingLoss - rxSens;
}

/**
 * Find the best relay path between two nodes in the given node array.
 * @param {RelayNode[]} nodes
 * @param {string | number} fromId
 * @param {string | number} toId
 * @param {number} rxSens     required receiver level dBm, including fade margin
 * @param {number} rxGain     RX antenna gain dBi (fallback when node.gain isn't finite)
 * @param {boolean} useFresnel
 * @param {PathfinderScenario} [scenario]
 * @returns {Promise<PathResult | null>}  null = no path found
 */
export async function findBestPath(nodes, fromId, toId, rxSens, rxGain, useFresnel, scenario = {}) {
  const t0 = performance.now();
  /** @param {string} msg */
  const step = (msg) => {
    const elapsed = (performance.now() - t0).toFixed(1);
    if (typeof scenario.onLog === 'function') {
      scenario.onLog(`[${elapsed}ms] ${msg}`);
      return;
    }
    console.info(`[pathfinder] [${elapsed}ms] ${msg}`);
  };
  /**
   * @param {number} pct
   * @param {string} msg
   */
  const progress = (pct, msg) => {
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
  step(`Hop radius: ${hopRadiusKm.toFixed(1)} km (effective cap ${Math.min(hopRadiusKm, MAX_EDGE_KM).toFixed(1)} km)`);
  const sourceRadiusCount = nodes.reduce((count, nd, idx) => {
    if (idx === fromIdx) return count;
    const distM = haversine(nodes[fromIdx].lat, nodes[fromIdx].lon, nd.lat, nd.lon);
    return count + (distM <= hopRadiusM ? 1 : 0);
  }, 0);
  step(`Source-radius filter: ${sourceRadiusCount} node(s) within first-hop window`);

  // ── 1. Fetch ground elevations for all nodes (one point each) ──
  progress(12, 'Fetching node elevations...');
  const nodeElevs = await fetchElevations(
    nodes.map(nd => ({ latitude: nd.lat, longitude: nd.lon })),
    null,
    { signal }
  );
  progress(22, 'Node elevations ready.');
  step(`Node elevations fetched (${nodeElevs.length})`);

  // ── 2. Build radius-limited candidate edges + batch all profile points ──
  /** @type {Array<{ i: number, j: number, distM: number, samples: number, offset: number }>} */
  const edges = [];
  /** @type {Array<{ latitude: number, longitude: number }>} */
  const allProfilePts = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const distM = haversine(nodes[i].lat, nodes[i].lon, nodes[j].lat, nodes[j].lon);
      if (distM > hopRadiusM) continue;
      const samples = profileSampleCount(distM, PROFILE_TARGET_SPACING_M, 16, PROFILE_MAX_SAMPLES);
      edges.push({ i, j, distM, samples, offset: allProfilePts.length });
      _profilePoints(nodes[i], nodes[j], samples).forEach(p => allProfilePts.push(p));
    }
  }
  progress(36, `Built ${edges.length} candidate hop${edges.length !== 1 ? 's' : ''}.`);
  step(`Candidate hops within radius: ${edges.length}, profile points: ${allProfilePts.length}`);

  /** @type {number[]} */
  let profileElevs = [];
  if (allProfilePts.length > 0) {
    progress(44, `Fetching terrain profiles for ${edges.length} hop${edges.length !== 1 ? 's' : ''}...`);
    profileElevs = await fetchElevations(allProfilePts, null, { signal });
    progress(58, 'Terrain profiles ready.');
    step(`Profile elevations fetched (${profileElevs.length})`);
  }

  // ── 3. Build directed margin matrix ──
  // margin[i*n+j] = margin when node[i] TXs to node[j], -Inf if no usable edge
  /** @type {ObstacleSet | null} */
  let foliage = null;
  /** @type {ObstacleSet | null} */
  let buildings = null;
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
              if (e?.cancelled || e?.name === 'AbortError') throw e;
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
              if (e?.cancelled || e?.name === 'AbortError') throw e;
              console.warn('[pathfinder] buildings fetch failed, skipping:', e);
              return null;
            })
        : Promise.resolve(null),
    ]).then(([f, b]) => /** @type {[ObstacleSet | null, ObstacleSet | null]} */ ([f, b]));
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

  /** @type {Array<Array<{ idx: number, distM: number, margin: number }>>} */
  const adjacency = Array.from({ length: n }, () => []);

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

  // ── 4. Radius-based frontier search ──
  // Prefer stronger bottleneck margin first, then fewer hops.
  const bestMargin = new Float32Array(n).fill(-Infinity);
  const bestHops = new Int32Array(n).fill(0x7fffffff);
  const prev = new Int32Array(n).fill(-1);
  const incomingMargin = new Float32Array(n).fill(-Infinity);
  const settled = new Uint8Array(n);
  /** @type {number[]} */
  const frontier = [fromIdx];
  bestMargin[fromIdx] = Infinity;
  bestHops[fromIdx] = 0;

  while (frontier.length > 0) {
    const uPos = _bestFrontierIndex(frontier, bestMargin, bestHops);
    const u = frontier.splice(uPos, 1)[0];
    if (settled[u]) continue;
    settled[u] = 1;
    if (u === toIdx) break;

    for (const edge of adjacency[u]) {
      const v = edge.idx;
      if (settled[v]) continue;
      const reachableMargin = Math.min(bestMargin[u], edge.margin);
      const reachableHops = bestHops[u] + 1;
      if (_isBetterScore(reachableMargin, reachableHops, bestMargin[v], bestHops[v])) {
        bestMargin[v] = reachableMargin;
        bestHops[v] = reachableHops;
        prev[v] = u;
        incomingMargin[v] = edge.margin;
        frontier.push(v);
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
  /** @type {PathStep[]} */
  const path = [];
  let cur = toIdx;
  while (cur !== fromIdx) {
    const p = prev[cur];
    path.unshift({ node: nodes[cur], incomingMargin: incomingMargin[cur] });
    cur = p;
  }
  path.unshift({ node: nodes[fromIdx], incomingMargin: null });

  /** @type {number[]} */
  const edgeDistances = [];
  /** @type {number[]} */
  const edgeRxPowers = [];
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
