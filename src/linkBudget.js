import { fetchElevations } from './elevation.js';
import { fetchFoliage, foliageLossDb } from './foliage.js';
import { fetchBuildings, buildingLossDb } from './buildings.js';
import { antennaPatternOffsetDb, bearingDeg, checkLoS, fspl, haversine, profileSampleCount, shadowFadingDb } from './propagation.js';
import { drawTerrainProfile, sampleObstacleHeights } from './terrainProfileView.js';

function _quantile(values, q) {
  if (!values.length) return 0;
  const idx = (values.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return values[lo];
  const t = idx - lo;
  return values[lo] + (values[hi] - values[lo]) * t;
}

function _computeMonteCarlo({
  trials,
  sigma,
  baseSeed,
  txPower,
  effectiveTxGain,
  effectiveRxGain,
  pathLoss,
  totalExtras,
  requiredRx,
}) {
  const margins = new Array(trials);
  let outages = 0;
  for (let i = 0; i < trials; i++) {
    const s = shadowFadingDb(sigma, `${baseSeed}|trial:${i}`);
    const rx = txPower + effectiveTxGain + effectiveRxGain - pathLoss - totalExtras - s;
    const margin = rx - requiredRx;
    margins[i] = margin;
    if (margin < 0) outages++;
  }
  margins.sort((a, b) => a - b);
  return {
    enabled: true,
    trials,
    outageProbability: outages / trials,
    marginP05: _quantile(margins, 0.05),
    marginP50: _quantile(margins, 0.50),
    marginP95: _quantile(margins, 0.95),
  };
}

export async function calculateLinkBudget(pointA, pointB, settings, { signal = null } = {}) {
  const startTime = performance.now();
  const log = [];
  const step = (msg) => {
    const elapsed = (performance.now() - startTime).toFixed(1);
    const entry = `[${elapsed}ms] ${msg}`;
    console.log(`[p2p] ${entry}`);
    log.push(entry);
  };

  step('Settings: ' + JSON.stringify({
    txHeight: settings.txHeight,
    rxHeight: settings.rxHeight,
    txPower: settings.txPower,
    txGain: settings.txGain,
    rxGain: settings.rxGain,
    antennaPattern: settings.antennaPattern,
    txAzimuthDeg: settings.txAzimuthDeg,
    rxAzimuthDeg: settings.rxAzimuthDeg,
    freqMHz: settings.freqMHz,
    rxSens: settings.rxSens,
    fadeMargin: settings.fadeMargin,
    useFoliage: settings.useFoliage,
    useBuildings: settings.useBuildings,
    useLos: settings.useLos,
    useFresnel: settings.useFresnel,
  }));

  const distM = haversine(pointA.lat, pointA.lng, pointB.lat, pointB.lng);
  const sampleCount = profileSampleCount(distM, settings.profileTargetSpacingM, 32, settings.profileMaxSamples);
  step(`Distance: ${(distM / 1000).toFixed(2)} km, samples: ${sampleCount}`);
  const profilePoints = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / (sampleCount - 1);
    profilePoints.push({
      latitude: pointA.lat + (pointB.lat - pointA.lat) * t,
      longitude: pointA.lng + (pointB.lng - pointA.lng) * t,
    });
  }

  const PAD = 0.003;
  const latMin = Math.min(pointA.lat, pointB.lat) - PAD;
  const latMax = Math.max(pointA.lat, pointB.lat) + PAD;
  const lonMin = Math.min(pointA.lng, pointB.lng) - PAD;
  const lonMax = Math.max(pointA.lng, pointB.lng) + PAD;

  step('Fetching elevation data...');
  const elevs = await fetchElevations(profilePoints, null, { signal });
  step(`Elevation data fetched (${elevs.length} samples)`);

  step('Fetching foliage and buildings...');
  const [foliage, buildings] = await Promise.all([
    settings.useFoliage
      ? fetchFoliage(latMin, latMax, lonMin, lonMax, {
        signal,
        deriveObstacleHeights: settings.deriveObstacleHeights,
      }).catch(e => {
        if (e?.cancelled || e?.name === 'AbortError') throw e;
        console.warn('[p2p] foliage fetch failed:', e.message);
        return null;
      })
      : Promise.resolve(null),
    settings.useBuildings
      ? fetchBuildings(latMin, latMax, lonMin, lonMax, {
        signal,
        deriveObstacleHeights: settings.deriveObstacleHeights,
      }).catch(e => {
        if (e?.cancelled || e?.name === 'AbortError') throw e;
        console.warn('[p2p] buildings fetch failed:', e.message);
        return null;
      })
      : Promise.resolve(null),
  ]);
  step(`Foliage data: ${foliage ? 'loaded' : 'skipped'}, Buildings: ${buildings ? 'loaded' : 'skipped'}`);

  const txElev = elevs[0];
  const rxElev = elevs[sampleCount - 1];
  step(`TX elevation: ${txElev.toFixed(1)} m, RX elevation: ${rxElev.toFixed(1)} m`);
  const profileLats = new Float64Array(sampleCount);
  const profileLons = new Float64Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    profileLats[i] = profilePoints[i].latitude;
    profileLons[i] = profilePoints[i].longitude;
  }

  step('Sampling obstacle heights...');
  const { vegH, bldH } = sampleObstacleHeights(profilePoints, foliage, buildings);

  step('Computing line of sight...');
  const geoResult = checkLoS(txElev, rxElev, elevs, settings.txHeight, settings.rxHeight, distM, settings.freqMHz, false, 'deygout');
  step(`Geometric LoS: ${geoResult.geometricLos ? 'clear' : 'blocked'}, clearance: ${geoResult.minClearanceM.toFixed(1)} m, model: ${geoResult.diffractionModel || 'knife-edge'}`);
  const fresnelResult = checkLoS(txElev, rxElev, elevs, settings.txHeight, settings.rxHeight, distM, settings.freqMHz, true, 'deygout');
  step(`Fresnel LoS: ${fresnelResult.fresnelClear ? 'clear' : 'blocked'}, clearance ratio: ${fresnelResult.minFresnelClearanceRatio.toFixed(2)}`);
  step('Computing losses...');
  const foliageLoss = foliage
    ? foliageLossDb(profileLats, profileLons, elevs, settings.txHeight, settings.rxHeight,
        foliage.polygons, foliage.bboxes, foliage.canopyHeights, foliage.factors,
        foliage.tileIndex, distM, settings.foliageLossPerM, settings.freqMHz)
    : 0;
  step(`Foliage loss: ${foliageLoss.toFixed(1)} dB, Diffraction loss: ${geoResult.diffractionLossDb.toFixed(1)} dB`);
  const buildingLoss = buildings
    ? buildingLossDb(profileLats, profileLons, elevs, settings.txHeight, settings.rxHeight,
        buildings.polygons, buildings.bboxes, buildings.heights,
        buildings.tileIndex, distM, settings.buildingLossPerM)
    : 0;
  step(`Building loss: ${buildingLoss.toFixed(1)} dB`);

  step('Computing link budget...');
  const pathLoss = fspl(distM, settings.freqMHz);
  const totalExtras = geoResult.diffractionLossDb + foliageLoss + buildingLoss;
  const shadowSeed = [
    pointA.lat, pointA.lng,
    pointB.lat, pointB.lng,
    settings.freqMHz,
    settings.shadowFadingSigmaDb ?? 0,
  ].join('|');
  const shadowFading = shadowFadingDb(settings.shadowFadingSigmaDb ?? 0, shadowSeed);
  const txToRxBearing = bearingDeg(pointA.lat, pointA.lng, pointB.lat, pointB.lng);
  const rxToTxBearing = bearingDeg(pointB.lat, pointB.lng, pointA.lat, pointA.lng);
  const txPatternOffset = antennaPatternOffsetDb(settings.antennaPattern, settings.txAzimuthDeg, txToRxBearing);
  const rxPatternOffset = antennaPatternOffsetDb(settings.antennaPattern, settings.rxAzimuthDeg, rxToTxBearing);
  const effectiveTxGain = settings.txGain + txPatternOffset;
  const effectiveRxGain = settings.rxGain + rxPatternOffset;
  step(`Path loss: ${pathLoss.toFixed(1)} dB, Total extra loss: ${totalExtras.toFixed(1)} dB, Shadow fading: ${shadowFading.toFixed(1)} dB`);
  step(`Pattern gain offsets: TX ${txPatternOffset.toFixed(1)} dB, RX ${rxPatternOffset.toFixed(1)} dB`);
  const rxPower = settings.txPower + effectiveTxGain + effectiveRxGain - pathLoss - totalExtras - shadowFading;
  const requiredRx = settings.rxSens + (settings.fadeMargin ?? 0);
  const margin = rxPower - requiredRx;
  step(`RX power: ${rxPower.toFixed(1)} dBm, Required: ${requiredRx.toFixed(1)} dBm, Margin: ${margin.toFixed(1)} dB`);

  let monteCarlo = null;
  if (settings.shadowFadingStochastic && (settings.shadowFadingSigmaDb ?? 0) > 0) {
    const trials = Math.max(16, Math.min(5000, Number(settings.shadowFadingTrials) || 200));
    monteCarlo = _computeMonteCarlo({
      trials,
      sigma: settings.shadowFadingSigmaDb ?? 0,
      baseSeed: shadowSeed,
      txPower: settings.txPower,
      effectiveTxGain,
      effectiveRxGain,
      pathLoss,
      totalExtras,
      requiredRx,
    });
    step(`Monte Carlo: ${trials} trials, outage ${(monteCarlo.outageProbability * 100).toFixed(1)}%, margin P50 ${monteCarlo.marginP50.toFixed(1)} dB`);
  }

  step('Drawing terrain profile...');
  const profileSvg = drawTerrainProfile(elevs, txElev, rxElev, settings.txHeight, settings.rxHeight, distM, settings.freqMHz, vegH, bldH);

  const totalTime = (performance.now() - startTime).toFixed(1);
  step(`Complete (${totalTime}ms total)`);

  return {
    distM,
    sampleCount,
    pathLoss,
    diffractionLoss: geoResult.diffractionLossDb,
    foliageLoss,
    buildingLoss,
    shadowFadingLoss: shadowFading,
    totalPathLoss: pathLoss + totalExtras + shadowFading,
    rxPower,
    margin,
    requiredRx,
    fadeMargin: settings.fadeMargin ?? 0,
    txEirp: settings.txPower + effectiveTxGain,
    txPatternOffset,
    rxPatternOffset,
    effectiveTxGain,
    effectiveRxGain,
    geoResult,
    fresnelResult,
    monteCarlo,
    profileSvg,
    _calcLog: log,
  };
}
