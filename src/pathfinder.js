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
import { haversine, fspl, checkLoS } from './propagation.js';

const PROFILE_SAMPLES = 24; // samples per edge terrain profile
const MAX_EDGE_KM = 200;    // skip edges longer than this — no LoRa link will span 200 km

/**
 * Build profile sample-point array from node A to node B.
 */
function _profilePoints(a, b) {
  const pts = [];
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const t = i / (PROFILE_SAMPLES - 1);
    pts.push({
      latitude:  a.lat + (b.lat - a.lat) * t,
      longitude: a.lon + (b.lon - a.lon) * t,
    });
  }
  return pts;
}

/**
 * Link margin (dB) when node txNode transmits to rxNode.
 * rxGain  — RX antenna gain, dBi (assumed same for all RX nodes)
 * rxSens  — RX sensitivity, dBm
 * profile — pre-fetched elevation array (length = PROFILE_SAMPLES)
 * txElev  — ground elevation at txNode (m AMSL)
 * rxElev  — ground elevation at rxNode (m AMSL)
 */
function _linkMargin(txNode, txElev, rxNode, rxElev, profile, rxGain, rxSens, useFresnel) {
  const distM = haversine(txNode.lat, txNode.lon, rxNode.lat, rxNode.lon);
  if (distM < 1) return 60; // same location
  const pathLoss = fspl(distM, txNode.freq);
  const los = checkLoS(txElev, rxElev, profile, txNode.height, rxNode.height, distM, txNode.freq, useFresnel);
  return txNode.power + txNode.gain + rxGain - pathLoss - los.diffractionLossDb - rxSens;
}

/**
 * Find the best relay path between two nodes in the given node array.
 *
 * @param {Array<{id, name, lat, lon, height, power, freq, gain}>} nodes  — all candidate nodes
 * @param {number}  fromId     — source node id
 * @param {number}  toId       — destination node id
 * @param {number}  rxSens     — receiver sensitivity dBm (applied to all hops)
 * @param {number}  rxGain     — RX antenna gain dBi (applied to all hops)
 * @param {boolean} useFresnel — include Fresnel-zone clearance in loss model
 * @returns {Promise<{
 *   path: Array<{node, incomingMargin: number|null}>,
 *   bottleneck: number,
 *   numHops: number,
 *   edgeDistances: number[],
 * } | null>}  null = no path found
 */
export async function findBestPath(nodes, fromId, toId, rxSens, rxGain, useFresnel) {
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
      edges.push({ i, j, distM, offset: allProfilePts.length });
      _profilePoints(nodes[i], nodes[j]).forEach(p => allProfilePts.push(p));
    }
  }

  let profileElevs = [];
  if (allProfilePts.length > 0) {
    profileElevs = await fetchElevations(allProfilePts);
  }

  // ── 3. Build directed margin matrix ──
  // margin[i*n+j] = margin when node[i] TXs to node[j], -Inf if no usable edge
  const margin  = new Float32Array(n * n).fill(-Infinity);
  const distMat = new Float32Array(n * n).fill(0);

  for (const { i, j, distM, offset } of edges) {
    const profile = profileElevs.slice(offset, offset + PROFILE_SAMPLES);
    margin[i * n + j] = _linkMargin(nodes[i], nodeElevs[i], nodes[j], nodeElevs[j], profile, rxGain, rxSens, useFresnel);
    margin[j * n + i] = _linkMargin(nodes[j], nodeElevs[j], nodes[i], nodeElevs[i], profile, rxGain, rxSens, useFresnel);
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
