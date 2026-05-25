import { computeSignalToPoint, ensureProfileBuffers, flatDistanceM, fsplBaseDb } from './signalModel.js';

function _lon(latlng) {
  return Number.isFinite(latlng?.lng) ? latlng.lng : latlng?.lon;
}

function _insideBounds(lat, lon, bounds) {
  return lat >= bounds.latMin && lat <= bounds.latMax
    && lon >= bounds.lonMin && lon <= bounds.lonMax;
}

export function inspectCoverageAtPoint(latlng, coverageResults, { limit = 4 } = {}) {
  const lat = latlng?.lat;
  const lon = _lon(latlng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  const rows = [];
  for (const result of coverageResults ?? []) {
    if (!_insideBounds(lat, lon, result.bounds)) continue;

    const distM = flatDistanceM(result.rep.lat, result.rep.lon, lat, lon);
    if (distM > result.radiusKm * 1000) continue;

    const profileMaxSamples = result.profileMaxSamples ?? 512;
    const signal = computeSignalToPoint({
      tx: result.rep,
      txElev: result.txElev,
      rxLat: lat,
      rxLon: lon,
      distM,
      fsplBase: fsplBaseDb(result.rep.freq),
      elevGrid: result.elevGrid,
      elevRes: result.elevRes,
      bounds: result.bounds,
      rxHeight: result.rxHeight,
      effectiveSens: result.effectiveSens,
      useLos: result.useLos,
      useFresnel: result.useFresnel,
      diffractionModel: result.diffractionModel,
      foliage: result.foliage,
      foliageLossPerM: result.foliageLossPerM,
      buildings: result.buildings,
      buildingLossPerM: result.buildingLossPerM,
      profileTargetSpacingM: result.profileTargetSpacingM,
      profileMaxSamples,
      profileBuffers: ensureProfileBuffers(profileMaxSamples),
    });

    const noiseFloorDbm = Number.isFinite(result.noiseFloorDbm)
      ? result.noiseFloorDbm
      : result.effectiveSens + 17.5;
    const requiredSnrDb = Number.isFinite(result.requiredSnrWithMarginDb)
      ? result.requiredSnrWithMarginDb
      : result.effectiveSens - noiseFloorDbm;

    rows.push({
      repId: result.rep.id,
      repName: result.rep.name,
      rxPower: signal.rxPower,
      snrDb: signal.rxPower - noiseFloorDbm,
      requiredSnrDb,
      margin: signal.rxPower - result.effectiveSens,
      distM,
      los: signal.los,
      threshold: result.effectiveSens,
    });
  }

  return rows
    .sort((a, b) => b.margin - a.margin)
    .slice(0, Math.max(1, limit));
}
