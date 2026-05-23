/**
 * optimizerWorker.js — Pure greedy scoring loop for the optimizer.
 * Receives pre-fetched grids and elevations from the main thread.
 * No DOM, no IPC — pure computation only.
 */
import { computeSignalToPoint, ensureProfileBuffers, flatDistanceM, fsplBaseDb } from './signalModel.js';

onmessage = function ({ data }) {
  const { evalPoints, evalElevs, candidates, candidateElevs, nRepeaters, txParams, opts } = data;
  const { height, power, freq, gain } = txParams;

  const scoreOpts = {
    rxHeight:   opts.rxHeight,
    rxSens:     opts.rxSens,
    fadeMargin: opts.fadeMargin ?? 0,
    radiusKm:   opts.radiusKm,
    useLos:     opts.useLos,
    useFresnel: opts.useFresnel,
    foliage:    opts.useFoliage ? opts.foliage : null,
    foliageLossPerM: opts.foliageLossPerM ?? 0.3,
    buildings:  opts.useBuildings ? opts.buildings : null,
    buildingLossPerM: opts.buildingLossPerM ?? 0.5,
    gridRes:    opts.evalRes,
    latMin:     opts.latMin,
    latMax:     opts.latMax,
    lonMin:     opts.lonMin,
    lonMax:     opts.lonMax,
    profileTargetSpacingM: opts.profileTargetSpacingM,
    profileMaxSamples: opts.profileMaxSamples,
  };

  const placed  = [];
  const covered = new Uint8Array(evalPoints.length);
  const selectedCandidates = new Uint8Array(candidates.length);

  for (let round = 0; round < nRepeaters; round++) {
    let bestScore = -1, bestIdx = -1, bestSignals = null;

    for (let ci = 0; ci < candidates.length; ci++) {
      if (selectedCandidates[ci]) continue;
      const cand = candidates[ci];
      const tx   = { lat: cand.latitude, lon: cand.longitude, height, power, freq, gain };

      const { score, signals } = _scoreCoverageIncremental(
        tx, candidateElevs[ci], evalPoints, evalElevs, covered, scoreOpts
      );

      if (score > bestScore) { bestScore = score; bestIdx = ci; bestSignals = signals; }

      if (ci % 16 === 0) {
        const pct = 20 + 75 * ((round + ci / candidates.length) / nRepeaters);
        postMessage({ type: 'progress', pct,
          msg: `Round ${round + 1}/${nRepeaters}: scoring candidate ${ci + 1}/${candidates.length}…` });
      }
    }

    if (bestIdx === -1 || bestScore <= 0 || !bestSignals) break;
    selectedCandidates[bestIdx] = 1;
    _markCovered(bestSignals, covered, scoreOpts);

    const best = candidates[bestIdx];
    placed.push({
      lat:   best.latitude,
      lon:   best.longitude,
      score: bestScore,
      elevM: candidateElevs[bestIdx],
    });
  }

  postMessage({ type: 'done', results: placed });
};

function _scoreCoverageIncremental(tx, txElev, evalPoints, evalElevs, covered, opts) {
  const threshold = opts.rxSens + opts.fadeMargin;
  const fsplBase  = fsplBaseDb(tx.freq);
  const profileBuffers = ensureProfileBuffers(opts.profileMaxSamples ?? 256);

  let newCovered = 0;
  const signals = new Float32Array(evalPoints.length);
  signals.fill(-200);

  for (let idx = 0; idx < evalPoints.length; idx++) {
    if (covered[idx]) continue;
    const pt   = evalPoints[idx];
    const dist = flatDistanceM(tx.lat, tx.lon, pt.latitude, pt.longitude);
    if (dist > opts.radiusKm * 1000) continue;
    const sig = _computeSignal(tx, txElev, pt, evalElevs[idx], dist, fsplBase, evalElevs, opts, profileBuffers);
    signals[idx] = sig;
    if (sig >= threshold) newCovered++;
  }

  return { score: evalPoints.length === 0 ? 0 : newCovered / evalPoints.length, signals };
}

function _markCovered(signals, covered, opts) {
  const threshold = opts.rxSens + opts.fadeMargin;
  for (let idx = 0; idx < signals.length; idx++) {
    if (!covered[idx] && signals[idx] >= threshold) covered[idx] = 1;
  }
}

function _computeSignal(tx, txElev, pt, rxElev, dist, fsplBase, gridElevs, opts, profileBuffers) {
  return computeSignalToPoint({
    tx, txElev, rxLat: pt.latitude, rxLon: pt.longitude, rxElev,
    distM: dist, fsplBase, elevGrid: gridElevs, elevRes: opts.gridRes,
    bounds: { latMin: opts.latMin, latMax: opts.latMax, lonMin: opts.lonMin, lonMax: opts.lonMax },
    rxHeight: opts.rxHeight,
    effectiveSens: opts.rxSens + opts.fadeMargin,
    useLos: opts.useLos,
    useFresnel: opts.useFresnel,
    foliage: opts.foliage,
    foliageLossPerM: opts.foliageLossPerM,
    buildings: opts.buildings,
    buildingLossPerM: opts.buildingLossPerM,
    profileTargetSpacingM: opts.profileTargetSpacingM,
    profileMaxSamples: opts.profileMaxSamples,
    profileBuffers,
  }).rxPower;
}
