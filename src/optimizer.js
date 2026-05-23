/**
 * optimizer.js
 * Finds the best repeater placement location(s) within a bounding box.
 * No DOM, no map, no network I/O — all inputs are plain data.
 *
 * Algorithm: exhaustive grid search over candidate TX locations, scoring each
 * with scoreCoverage(). For multiple repeaters, a greedy incremental pass is
 * used (place each repeater to maximise marginal new coverage).
 */
import { fetchElevations } from './elevation.js';
import { checkLoS, bilinearElev } from './propagation.js';

// P1: module-level profile buffer — pre-allocated once, reused across all computeSignal calls
const PROFILE_SAMPLES = 16;
const _profile = new Float32Array(PROFILE_SAMPLES);

/**
 * Find the best N repeater locations within a bounding box.
 *
 * @param {object} bounds       - { latMin, latMax, lonMin, lonMax }
 * @param {number} nRepeaters   - how many locations to find
 * @param {object} txParams     - { height, power, freq } — same for all candidates
 * @param {object} opts         - { rxHeight, rxSens, radiusKm, useLos, useFresnel, candidateRes, evalRes }
 *   candidateRes: grid size for candidate TX locations (e.g. 16)
 *   evalRes:      grid size for coverage evaluation (e.g. 64)
 * @param {function} onProgress - callback(pct: 0-100, msg: string)
 * @returns {Promise<Array<{ lat, lon, score, elevM }>>} best locations, best first
 */
export async function findBestLocations(bounds, nRepeaters, txParams, opts, onProgress) {
  const { latMin, latMax, lonMin, lonMax } = bounds;
  const { height, power, freq, gain } = txParams;
  const { rxHeight, rxSens, radiusKm, useLos, useFresnel } = opts;
  const candidateRes = opts.candidateRes ?? 16;
  const evalRes      = opts.evalRes      ?? 48;

  const progress = onProgress ?? (() => {});

  // ── Build evaluation grid (where we measure how many devices get covered) ──
  progress(2, 'Building evaluation grid…');
  const evalPoints = buildGrid(latMin, latMax, lonMin, lonMax, evalRes);

  // ── Build candidate TX locations ──
  const candidates = buildGrid(latMin, latMax, lonMin, lonMax, candidateRes);

  // ── Fetch elevations for eval grid + all candidates in one round-trip ──
  progress(5, `Fetching elevation for ${evalPoints.length + candidates.length} points…`);
  const allPoints = [...evalPoints, ...candidates];
  const allElevs  = useLos ? await fetchElevations(allPoints) : allPoints.map(() => 0);

  const evalElevs      = allElevs.slice(0, evalPoints.length);
  const candidateElevs = allElevs.slice(evalPoints.length);

  progress(20, 'Scoring candidate locations…');

  // shared opts for scoreCoverage
  const scoreOpts = {
    rxHeight, rxSens, radiusKm, useLos, useFresnel,
    gridRes: evalRes,
    latMin, latMax, lonMin, lonMax,
  };

  // ── Greedy incremental search ──
  const placed = [];
  const covered = new Uint8Array(evalPoints.length);

  for (let round = 0; round < nRepeaters; round++) {
    let bestScore   = -1;
    let bestIdx     = 0;
    let bestSignals = null; // P7: cache the winning candidate's signal array

    for (let ci = 0; ci < candidates.length; ci++) {
      const cand = candidates[ci];
      const tx   = { lat: cand.latitude, lon: cand.longitude, height, power, freq, gain };

      const { score, signals } = scoreCoverageIncremental(
        tx, candidateElevs[ci], evalPoints, evalElevs, covered, scoreOpts
      );

      if (score > bestScore) { bestScore = score; bestIdx = ci; bestSignals = signals; }

      if (ci % 16 === 0) {
        const pct = 20 + 75 * ((round + ci / candidates.length) / nRepeaters);
        progress(pct, `Round ${round + 1}/${nRepeaters}: scoring candidate ${ci + 1}/${candidates.length}…`);
      }
    }

    // P7: use cached signals from the winning pass — no second computeSignal sweep
    markCovered(bestSignals, evalPoints, covered, scoreOpts);

    const best = candidates[bestIdx];
    placed.push({
      lat:   best.latitude,
      lon:   best.longitude,
      score: bestScore,
      elevM: candidateElevs[bestIdx],
    });
  }

  progress(100, 'Done.');
  return placed;
}

// ─── Helpers ────────────────────────────────────────────────────

function buildGrid(latMin, latMax, lonMin, lonMax, res) {
  const pts = [];
  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      pts.push({
        latitude:  latMax - r * (latMax - latMin) / (res - 1),
        longitude: lonMin + c * (lonMax - lonMin) / (res - 1),
      });
    }
  }
  return pts;
}

/**
 * Score marginal new coverage; also returns the per-point signal array for the winner (P7).
 */
function scoreCoverageIncremental(tx, txElev, evalPoints, evalElevs, covered, opts) {
  const { rxSens, radiusKm } = opts;
  const threshold = rxSens + (opts.fadeMargin ?? 0);

  // P3: flat-Earth scale factors — computed once per candidate, not per eval point
  const mPerLat = 110574;
  const mPerLon = 111320 * Math.cos(tx.lat * Math.PI / 180);

  // P4: hoist frequency-constant part of FSPL
  const fsplBase = 20 * Math.log10(tx.freq * 1e6) - 147.55;

  let newCovered = 0, total = 0;
  const signals = new Float32Array(evalPoints.length);
  signals.fill(-200);

  for (let idx = 0; idx < evalPoints.length; idx++) {
    if (covered[idx]) continue;
    const pt   = evalPoints[idx];
    // P3: flat-Earth distance
    const dLat = (pt.latitude  - tx.lat) * mPerLat;
    const dLon = (pt.longitude - tx.lon) * mPerLon;
    const dist = Math.sqrt(dLat * dLat + dLon * dLon);
    if (dist > radiusKm * 1000) continue;
    total++;

    const sig = computeSignal(tx, txElev, pt, evalElevs[idx], dist, fsplBase, evalElevs, opts);
    signals[idx] = sig;
    if (sig >= threshold) newCovered++;
  }

  return { score: total === 0 ? 0 : newCovered / total, signals };
}

/**
 * P7: mark covered cells using pre-computed signal array from the winning scoring pass.
 */
function markCovered(signals, evalPoints, covered, opts) {
  const threshold = opts.rxSens + (opts.fadeMargin ?? 0);
  for (let idx = 0; idx < evalPoints.length; idx++) {
    if (!covered[idx] && signals[idx] >= threshold) covered[idx] = 1;
  }
}

function computeSignal(tx, txElev, pt, rxElev, dist, fsplBase, gridElevs, opts) {
  const { rxHeight, useLos, useFresnel, gridRes, latMin, latMax, lonMin, lonMax } = opts;

  // P4: fsplBase already hoisted by caller
  let rxPower = tx.power + (tx.gain ?? 0) - (20 * Math.log10(Math.max(1, dist)) + fsplBase);

  if (useLos && dist > 50) {
    // P1: fill module-level pre-allocated profile buffer
    for (let s = 0; s < PROFILE_SAMPLES; s++) {
      const t = s / (PROFILE_SAMPLES - 1);
      _profile[s] = bilinearElev(
        tx.lat + (pt.latitude  - tx.lat) * t,
        tx.lon + (pt.longitude - tx.lon) * t,
        gridElevs, gridRes, latMin, latMax, lonMin, lonMax
      );
    }
    const los = checkLoS(txElev, rxElev, _profile, tx.height, rxHeight, dist, tx.freq, useFresnel);
    rxPower -= los.diffractionLossDb;
    if (!los.los && los.diffractionLossDb > 60) rxPower = Math.min(rxPower, opts.rxSens - 10);
  }

  return rxPower;
}
