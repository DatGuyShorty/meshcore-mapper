// @ts-check
/**
 * optimizer.js
 * Finds the best repeater placement location(s) within a bounding box.
 * Main-thread fallback for optimizer scoring. The UI normally uses
 * optimizerWorker.js after pre-fetching terrain and obstacle layers.
 *
 * Algorithm: exhaustive grid search over candidate TX locations, scoring each
 * with scoreCoverage(). For multiple repeaters, a greedy incremental pass is
 * used (place each repeater to maximise marginal new coverage).
 *
 * @typedef {import('./signalModel.js').TxSpec}        TxSpec
 * @typedef {import('./signalModel.js').ObstacleSet}   ObstacleSet
 * @typedef {import('./signalModel.js').ProfileBuffers} ProfileBuffers
 *
 * @typedef {Object} Bounds
 * @property {number} latMin
 * @property {number} latMax
 * @property {number} lonMin
 * @property {number} lonMax
 *
 * @typedef {Object} TxParams
 * @property {number} height
 * @property {number} power
 * @property {number} freq
 * @property {number} [gain]
 *
 * @typedef {Object} OptimizerOpts
 * @property {number} rxHeight
 * @property {number} rxSens
 * @property {number} [fadeMargin]
 * @property {number} radiusKm
 * @property {boolean} [useLos]
 * @property {boolean} [useFresnel]
 * @property {boolean} [useFoliage]
 * @property {boolean} [useBuildings]
 * @property {string}  [diffractionModel]
 * @property {number}  [candidateRes]
 * @property {number}  [evalRes]
 * @property {number}  [foliageLossPerM]
 * @property {number}  [buildingLossPerM]
 * @property {number}  [profileTargetSpacingM]
 * @property {number}  [profileMaxSamples]
 *
 * @typedef {Object} BestLocation
 * @property {number} lat
 * @property {number} lon
 * @property {number} score
 * @property {number} elevM
 *
 * @typedef {Object} ScoreOpts
 * @property {number} rxHeight
 * @property {number} rxSens
 * @property {number} fadeMargin
 * @property {number} radiusKm
 * @property {boolean | undefined} useLos
 * @property {boolean | undefined} useFresnel
 * @property {boolean | undefined} [useGroundReflection]
 * @property {number | undefined} [reflectionCoeff]
 * @property {string | undefined}  diffractionModel
 * @property {number}  gridRes
 * @property {number}  latMin
 * @property {number}  latMax
 * @property {number}  lonMin
 * @property {number}  lonMax
 * @property {number | undefined} profileTargetSpacingM
 * @property {number | undefined} profileMaxSamples
 * @property {ObstacleSet | null} foliage
 * @property {number | undefined} foliageLossPerM
 * @property {ObstacleSet | null} buildings
 * @property {number | undefined} buildingLossPerM
 */
import { fetchElevations } from './elevation.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';
import { computeSignalToPoint, ensureProfileBuffers, flatDistanceM, fsplBaseDb } from './signalModel.js';

/**
 * @param {{ useLos?: boolean, useFoliage?: boolean, useBuildings?: boolean }} [opts]
 * @returns {boolean}
 */
export function optimizerNeedsTerrain(opts = {}) {
  return Boolean(opts.useLos || opts.useFoliage || opts.useBuildings);
}

/**
 * Find the best N repeater locations within a bounding box.
 *
 * @param {Bounds} bounds
 * @param {number} nRepeaters
 * @param {TxParams} txParams
 * @param {OptimizerOpts} opts
 * @param {((pct: number, msg: string) => void) | null} [onProgress]
 * @returns {Promise<BestLocation[]>}
 */
export async function findBestLocations(bounds, nRepeaters, txParams, opts, onProgress) {
  const { latMin, latMax, lonMin, lonMax } = bounds;
  const { height, power, freq, gain } = txParams;
  const { rxHeight, rxSens, fadeMargin = 0, radiusKm, useLos, useFresnel } = opts;
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
  const allElevs  = optimizerNeedsTerrain(opts) ? await fetchElevations(allPoints) : allPoints.map(() => 0);
  console.info(`[optimizer] elevation fetched — ${evalPoints.length} eval pts, ${candidates.length} candidates`);

  const evalElevs      = allElevs.slice(0, evalPoints.length);
  const candidateElevs = allElevs.slice(evalPoints.length);

  let foliage = null;
  let buildings = null;
  if (opts.useFoliage || opts.useBuildings) {
    progress(12, 'Fetching obstacle layers...');
    [foliage, buildings] = await Promise.all([
      opts.useFoliage
        ? fetchFoliage(latMin, latMax, lonMin, lonMax)
            .catch(e => { console.warn('[optimizer] foliage fetch failed, skipping:', e); return null; })
        : Promise.resolve(null),
      opts.useBuildings
        ? fetchBuildings(latMin, latMax, lonMin, lonMax)
            .catch(e => { console.warn('[optimizer] buildings fetch failed, skipping:', e); return null; })
        : Promise.resolve(null),
    ]);
    if (opts.useFoliage && !foliage) progress(18, 'Warning: foliage loss requested but vegetation data was unavailable.');
    if (opts.useBuildings && !buildings) progress(18, 'Warning: building loss requested but structure data was unavailable.');
  }

  progress(20, 'Scoring candidate locations…');

  // shared opts for scoreCoverage
  /** @type {ScoreOpts} */
  const scoreOpts = {
    rxHeight, rxSens, fadeMargin, radiusKm, useLos, useFresnel,
    diffractionModel: opts.diffractionModel,
    gridRes: evalRes,
    latMin, latMax, lonMin, lonMax,
    profileTargetSpacingM: opts.profileTargetSpacingM,
    profileMaxSamples: opts.profileMaxSamples,
    foliage: /** @type {ObstacleSet | null} */ (foliage),
    foliageLossPerM: opts.foliageLossPerM,
    buildings: /** @type {ObstacleSet | null} */ (buildings),
    buildingLossPerM: opts.buildingLossPerM,
  };

  // ── Greedy incremental search ──
  /** @type {BestLocation[]} */
  const placed = [];
  const covered = new Uint8Array(evalPoints.length);
  const selectedCandidates = new Uint8Array(candidates.length);

  for (let round = 0; round < nRepeaters; round++) {
    let bestScore   = -1;
    let bestIdx     = -1;
    const scratchSignals = new Float32Array(evalPoints.length);
    const bestSignals = new Float32Array(evalPoints.length);
    let hasBestSignals = false;

    for (let ci = 0; ci < candidates.length; ci++) {
      if (selectedCandidates[ci]) continue;
      const cand = candidates[ci];
      const tx   = { lat: cand.latitude, lon: cand.longitude, height, power, freq, gain };

      const score = scoreCoverageIncremental(
        tx, candidateElevs[ci], evalPoints, evalElevs, covered, scoreOpts, scratchSignals
      );

      if (score > bestScore) {
        bestScore = score;
        bestIdx = ci;
        bestSignals.set(scratchSignals);
        hasBestSignals = true;
      }

      if (ci % 16 === 0) {
        const pct = 20 + 75 * ((round + ci / candidates.length) / nRepeaters);
        progress(pct, `Round ${round + 1}/${nRepeaters}: scoring candidate ${ci + 1}/${candidates.length}…`);
      }
    }

    // Use cached signals from the winning pass; avoid a second signal sweep.
    if (bestIdx === -1 || bestScore <= 0 || !hasBestSignals) break;
    selectedCandidates[bestIdx] = 1;
    markCovered(bestSignals, covered, scoreOpts);

    const best = candidates[bestIdx];
    placed.push({
      lat:   best.latitude,
      lon:   best.longitude,
      score: bestScore,
      elevM: candidateElevs[bestIdx],
    });
    console.info(`[optimizer] round ${round + 1}/${nRepeaters}: best candidate at (${best.latitude.toFixed(5)}, ${best.longitude.toFixed(5)}), score=${bestScore}, elev=${candidateElevs[bestIdx].toFixed(1)} m`);
  }

  progress(100, 'Done.');
  return placed;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Generate a regular lat/lon grid of `res × res` sample points inside a bbox.
 * Latitude decreases with row index so `[0]` is the north-west corner.
 * @param {number} latMin
 * @param {number} latMax
 * @param {number} lonMin
 * @param {number} lonMax
 * @param {number} res
 * @returns {Array<{ latitude: number, longitude: number }>}
 */
export function buildGrid(latMin, latMax, lonMin, lonMax, res) {
  const gridRes = Math.max(1, Math.floor(Number(res) || 1));
  /** @type {Array<{ latitude: number, longitude: number }>} */
  const pts = [];
  const rowDen = Math.max(1, gridRes - 1);
  const colDen = Math.max(1, gridRes - 1);
  for (let r = 0; r < gridRes; r++) {
    for (let c = 0; c < gridRes; c++) {
      pts.push({
        latitude:  latMax - r * (latMax - latMin) / rowDen,
        longitude: lonMin + c * (lonMax - lonMin) / colDen,
      });
    }
  }
  return pts;
}

/**
 * Score marginal new coverage and return the per-point signal array for the winner.
 * @param {TxSpec} tx
 * @param {number} txElev
 * @param {Array<{ latitude: number, longitude: number }>} evalPoints
 * @param {number[]} evalElevs
 * @param {Uint8Array} covered
 * @param {ScoreOpts} opts
 * @param {Float32Array} signals
 * @returns {number}
 */
function scoreCoverageIncremental(tx, txElev, evalPoints, evalElevs, covered, opts, signals) {
  const { rxSens, radiusKm } = opts;
  const threshold = rxSens + (opts.fadeMargin ?? 0);

  const fsplBase = fsplBaseDb(tx.freq);
  const profileBuffers = ensureProfileBuffers(opts.profileMaxSamples ?? 256);

  let newCovered = 0;
  signals.fill(-200);

  for (let idx = 0; idx < evalPoints.length; idx++) {
    if (covered[idx]) continue;
    const pt   = evalPoints[idx];
    const dist = flatDistanceM(tx.lat, tx.lon, pt.latitude, pt.longitude);
    if (dist > radiusKm * 1000) continue;
    const sig = computeSignal(tx, txElev, pt, evalElevs[idx], dist, fsplBase, evalElevs, opts, profileBuffers);
    signals[idx] = sig;
    if (sig >= threshold) newCovered++;
  }

  return evalPoints.length === 0 ? 0 : newCovered / evalPoints.length;
}

/**
 * Mark covered cells using the pre-computed signal array from the winning pass.
 * @param {Float32Array} signals
 * @param {Uint8Array} covered
 * @param {ScoreOpts} opts
 */
function markCovered(signals, covered, opts) {
  const threshold = opts.rxSens + (opts.fadeMargin ?? 0);
  for (let idx = 0; idx < signals.length; idx++) {
    if (!covered[idx] && signals[idx] >= threshold) covered[idx] = 1;
  }
}

/**
 * @param {TxSpec} tx
 * @param {number} txElev
 * @param {{ latitude: number, longitude: number }} pt
 * @param {number} rxElev
 * @param {number} dist
 * @param {number} fsplBase
 * @param {number[]} gridElevs
 * @param {ScoreOpts} opts
 * @param {ProfileBuffers} profileBuffers
 * @returns {number}
 */
function computeSignal(tx, txElev, pt, rxElev, dist, fsplBase, gridElevs, opts, profileBuffers) {
  return computeSignalToPoint({
    tx, txElev, rxLat: pt.latitude, rxLon: pt.longitude, rxElev,
    distM: dist, fsplBase, elevGrid: gridElevs, elevRes: opts.gridRes,
    bounds: { latMin: opts.latMin, latMax: opts.latMax, lonMin: opts.lonMin, lonMax: opts.lonMax },
    rxHeight: opts.rxHeight,
    effectiveSens: opts.rxSens + (opts.fadeMargin ?? 0),
    useLos: opts.useLos,
    useFresnel: opts.useFresnel,
    useGroundReflection: opts.useGroundReflection,
    reflectionCoeff: opts.reflectionCoeff,
    diffractionModel: opts.diffractionModel,
    foliage: opts.foliage,
    foliageLossPerM: opts.foliageLossPerM,
    buildings: opts.buildings,
    buildingLossPerM: opts.buildingLossPerM,
    profileTargetSpacingM: opts.profileTargetSpacingM,
    profileMaxSamples: opts.profileMaxSamples,
    profileBuffers,
  }).rxPower;
}
