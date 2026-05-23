/**
 * optimizerWorker.js — Pure greedy scoring loop for the optimizer.
 * Receives pre-fetched grids and elevations from the main thread.
 * No DOM, no IPC — pure computation only.
 */
import { checkLoS, bilinearElev } from './propagation.js';

const PROFILE_SAMPLES = 16;
const _profile = new Float32Array(PROFILE_SAMPLES);

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
    gridRes:    opts.evalRes,
    latMin:     opts.latMin,
    latMax:     opts.latMax,
    lonMin:     opts.lonMin,
    lonMax:     opts.lonMax,
  };

  const placed  = [];
  const covered = new Uint8Array(evalPoints.length);

  for (let round = 0; round < nRepeaters; round++) {
    let bestScore = -1, bestIdx = 0, bestSignals = null;

    for (let ci = 0; ci < candidates.length; ci++) {
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
  const mPerLat   = 110574;
  const mPerLon   = 111320 * Math.cos(tx.lat * Math.PI / 180);
  const fsplBase  = 20 * Math.log10(tx.freq * 1e6) - 147.55;

  let newCovered = 0, total = 0;
  const signals = new Float32Array(evalPoints.length);
  signals.fill(-200);

  for (let idx = 0; idx < evalPoints.length; idx++) {
    if (covered[idx]) continue;
    const pt   = evalPoints[idx];
    const dLat = (pt.latitude  - tx.lat) * mPerLat;
    const dLon = (pt.longitude - tx.lon) * mPerLon;
    const dist = Math.sqrt(dLat * dLat + dLon * dLon);
    if (dist > opts.radiusKm * 1000) continue;
    total++;
    const sig = _computeSignal(tx, txElev, pt, evalElevs[idx], dist, fsplBase, evalElevs, opts);
    signals[idx] = sig;
    if (sig >= threshold) newCovered++;
  }

  return { score: total === 0 ? 0 : newCovered / total, signals };
}

function _markCovered(signals, covered, opts) {
  const threshold = opts.rxSens + opts.fadeMargin;
  for (let idx = 0; idx < signals.length; idx++) {
    if (!covered[idx] && signals[idx] >= threshold) covered[idx] = 1;
  }
}

function _computeSignal(tx, txElev, pt, rxElev, dist, fsplBase, gridElevs, opts) {
  const { rxHeight, useLos, useFresnel, gridRes, latMin, latMax, lonMin, lonMax } = opts;
  let rxPower = tx.power + (tx.gain ?? 0) - (20 * Math.log10(Math.max(1, dist)) + fsplBase);

  if (useLos && dist > 50) {
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
