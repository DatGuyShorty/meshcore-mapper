/**
 * pathfinder.js — Best relay path search through the repeater network.
 *
 * Algorithm: max-bottleneck Dijkstra.
 *   Maximises the minimum per-hop link margin along the path (i.e. find the path
 *   where the worst single hop has the highest margin).  This matches how a LoRa
 *   mesh routes: a chain is only as reliable as its weakest link.
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
import { haversine, fspl, checkLoS, profileSampleCount } from './propagation.js';

const PROFILE_TARGET_SPACING_M = 75;
const PROFILE_MAX_SAMPLES = 512;
const MAX_EDGE_KM = 200;    // skip edges longer than this — no LoRa link will span 200 km

/**
 * Build profile sample-point array from node A to node B.
 */
function _profilePoints(a, b, samples) {
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

function _nodesBbox(nodes) {
  const PAD = 0.003;
  return {
    latMin: Math.min(...nodes.map(n => n.lat)) - PAD,
    latMax: Math.max(...nodes.map(n => n.lat)) + PAD,
    lonMin: Math.min(...nodes.map(n => n.lon)) - PAD,
    lonMax: Math.max(...nodes.map(n => n.lon)) + PAD,
  };
}

function _profileCoordArrays(points) {
  const lats = new Float64Array(points.length);
  const lons = new Float64Array(points.length);
  for (let i = 0; i < points.length; i++) {
    lats[i] = points[i].latitude;
    lons[i] = points[i].longitude;
  }
  return { lats, lons };
}

function _reverseFloat64(src) {
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[src.length - 1 - i];
  return out;
}

/**
 * Link margin (dB) when node txNode transmits to rxNode.
 * rxGain  — RX antenna gain, dBi (assumed same for all RX nodes)
 * rxSens  — required RX level, dBm, including any requested fade margin
 * profile — pre-fetched elevation array
 * txElev  — ground elevation at txNode (m AMSL)
 * rxElev  — ground elevation at rxNode (m AMSL)
 */
function _linkMargin(txNode, txElev, rxNode, rxElev, profile, profileLats, profileLons, rxGain, rxSens, useFresnel, scenario) {
  const distM = haversine(txNode.lat, txNode.lon, rxNode.lat, rxNode.lon);
  if (distM < 1) return 60; // same location
  const pathLoss = fspl(distM, txNode.freq);
  const los = checkLoS(txElev, rxElev, profile, txNode.height, rxNode.height, distM, txNode.freq, useFresnel);
  const foliageLoss = scenario.foliage
    ? foliageLossDb(
        profileLats, profileLons, profile, txNode.height, rxNode.height,
        scenario.foliage.polygons, scenario.foliage.bboxes,
        scenario.foliage.canopyHeights, scenario.foliage.factors,
        scenario.foliage.tileIndex, distM, scenario.foliageLossPerM
      )
    : 0;
  const buildingLoss = scenario.buildings
    ? buildingLossDb(
        profileLats, profileLons, profile, txNode.height, rxNode.height,
        scenario.buildings.polygons, scenario.buildings.bboxes,
        scenario.buildings.heights, scenario.buildings.tileIndex,
        distM, scenario.buildingLossPerM
      )
    : 0;
  const effectiveRxGain = Number.isFinite(rxNode.gain) ? rxNode.gain : rxGain;
  return txNode.power + txNode.gain + effectiveRxGain - pathLoss - los.diffractionLossDb - foliageLoss - buildingLoss - rxSens;
}

/**
 * Find the best relay path between two nodes in the given node array.
 *
 * @param {Array<{id, name, lat, lon, height, power, freq, gain}>} nodes  — all candidate nodes
 * @param {number}  fromId     — source node id
 * @param {number}  toId       — destination node id
 * @param {number}  rxSens     — required receiver level dBm, including fade margin
 * @param {number}  rxGain     — RX antenna gain dBi (applied to all hops)
 * @param {boolean} useFresnel - use Fresnel clearance for the returned LoS flag
 * @returns {Promise<{
 *   path: Array<{node, incomingMargin: number|null}>,
 *   bottleneck: number,
 *   numHops: number,
 *   edgeDistances: number[],
 * } | null>}  null = no path found
 */
export async function findBestPath(nodes, fromId, toId, rxSens, rxGain, useFresnel, scenario = {}) {
  const n = nodes.length;
  if (n < 2) return null;

  const idxById = new Map(nodes.map((nd, i) => [nd.id, i]));
  const fromIdx = idxById.get(fromId);
  const toIdx   = idxById.get(toId);
  if (fromIdx === undefined || toIdx === undefined) return null;
  if (fromIdx === toIdx) return null;

  // ── 1. Fetch ground elevations for all nodes (one point each) ──
  const nodeElevs = await fetchElevations(
    nodes.map(nd => ({ latitude: nd.lat, longitude: nd.lon }))
  );

  // ── 2. Build edge list + batch all profile points ──
  // Keep only edges within MAX_EDGE_KM to limit fetch size.
  const edges = []; // { i, j, distM, offset }
  const allProfilePts = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const distM = haversine(nodes[i].lat, nodes[i].lon, nodes[j].lat, nodes[j].lon);
      if (distM > MAX_EDGE_KM * 1000) continue;
      const samples = profileSampleCount(distM, PROFILE_TARGET_SPACING_M, 16, PROFILE_MAX_SAMPLES);
      edges.push({ i, j, distM, samples, offset: allProfilePts.length });
      _profilePoints(nodes[i], nodes[j], samples).forEach(p => allProfilePts.push(p));
    }
  }

  let profileElevs = [];
  if (allProfilePts.length > 0) {
    profileElevs = await fetchElevations(allProfilePts);
  }

  // ── 3. Build directed margin matrix ──
  // margin[i*n+j] = margin when node[i] TXs to node[j], -Inf if no usable edge
  let foliage = null;
  let buildings = null;
  if (scenario.useFoliage || scenario.useBuildings) {
    const bbox = _nodesBbox(nodes);
    [foliage, buildings] = await Promise.all([
      scenario.useFoliage
        ? fetchFoliage(bbox.latMin, bbox.latMax, bbox.lonMin, bbox.lonMax)
            .catch(e => { console.warn('[pathfinder] foliage fetch failed, skipping:', e); return null; })
        : Promise.resolve(null),
      scenario.useBuildings
        ? fetchBuildings(bbox.latMin, bbox.latMax, bbox.lonMin, bbox.lonMax)
            .catch(e => { console.warn('[pathfinder] buildings fetch failed, skipping:', e); return null; })
        : Promise.resolve(null),
    ]);
  }
  const linkScenario = {
    foliage,
    buildings,
    foliageLossPerM: scenario.foliageLossPerM ?? 0.3,
    buildingLossPerM: scenario.buildingLossPerM ?? 0.5,
  };

  const margin  = new Float32Array(n * n).fill(-Infinity);
  const distMat = new Float32Array(n * n).fill(0);

  for (const { i, j, distM, samples, offset } of edges) {
    const profile = profileElevs.slice(offset, offset + samples);
    const profilePoints = allProfilePts.slice(offset, offset + samples);
    const { lats, lons } = _profileCoordArrays(profilePoints);
    const reverseProfile = profile.slice().reverse();
    const reverseLats = _reverseFloat64(lats);
    const reverseLons = _reverseFloat64(lons);
    margin[i * n + j] = _linkMargin(nodes[i], nodeElevs[i], nodes[j], nodeElevs[j], profile, lats, lons, rxGain, rxSens, useFresnel, linkScenario);
    margin[j * n + i] = _linkMargin(nodes[j], nodeElevs[j], nodes[i], nodeElevs[i], reverseProfile, reverseLats, reverseLons, rxGain, rxSens, useFresnel, linkScenario);
    distMat[i * n + j] = distMat[j * n + i] = distM;
  }

  // ── 4. Max-bottleneck Dijkstra ──
  // best[i] = highest bottleneck margin reachable from fromIdx to i
  const best    = new Float32Array(n).fill(-Infinity);
  const prev    = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  best[fromIdx] = Infinity; // source is free

  for (let iter = 0; iter < n; iter++) {
    // Pick the unvisited node with the best reachable bottleneck
    let u = -1;
    for (let k = 0; k < n; k++) {
      if (!visited[k] && (u === -1 || best[k] > best[u])) u = k;
    }
    if (u === -1 || best[u] === -Infinity) break;
    visited[u] = 1;
    if (u === toIdx) break;

    for (let v = 0; v < n; v++) {
      if (visited[v]) continue;
      const m = margin[u * n + v];
      if (m === -Infinity) continue;
      const reachable = Math.min(best[u], m);
      if (reachable > best[v]) {
        best[v] = reachable;
        prev[v] = u;
      }
    }
  }

  if (best[toIdx] === -Infinity) return null; // no connected path

  // ── 5. Reconstruct path ──
  const path = [];
  let cur = toIdx;
  while (cur !== fromIdx) {
    const p = prev[cur];
    path.unshift({ node: nodes[cur], incomingMargin: margin[p * n + cur] });
    cur = p;
  }
  path.unshift({ node: nodes[fromIdx], incomingMargin: null });

  const edgeDistances = [];
  for (let s = 1; s < path.length; s++) {
    const a = path[s - 1].node, b = path[s].node;
    edgeDistances.push(haversine(a.lat, a.lon, b.lat, b.lon));
  }

  return {
    path,
    bottleneck: best[toIdx],
    numHops: path.length - 1,
    edgeDistances,
  };
}
