import { computeSignalToPoint, ensureProfileBuffers, flatDistanceM, fsplBaseDb } from './signalModel.js';
import { LORA_REQUIRED_SNR_DB } from './radioMetrics.js';

// Fallback used when a coverage result was computed before noise/SNR metadata
// existed on the payload. SF11 (-17.5 dB required SNR) is the default LoRa
// modem we assume in the rest of the UI when no preset is selected.
const FALLBACK_REQUIRED_SNR_DB = LORA_REQUIRED_SNR_DB[11];

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
    const radiusKm = Number(result?.radiusKm);
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) continue;
    if (!_insideBounds(lat, lon, result.bounds)) continue;

    const distM = flatDistanceM(result.rep.lat, result.rep.lon, lat, lon);
    if (distM > radiusKm * 1000) continue;

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
      : result.effectiveSens - FALLBACK_REQUIRED_SNR_DB;
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
