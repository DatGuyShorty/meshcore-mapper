import { antennaPatternOffsetDb, bearingDeg, bilinearElev, checkLoS, profileSampleCount } from './propagation.js';
import { foliageLossDb } from './foliage.js';
import { buildingLossDb } from './buildings.js';

export const DEFAULT_PROFILE_TARGET_SPACING_M = 50;
export const DEFAULT_PROFILE_MIN_SAMPLES = 16;
export const DEFAULT_PROFILE_MAX_SAMPLES = 512;

export function flatDistanceM(txLat, txLon, rxLat, rxLon) {
  if (!_hasFiniteLatLon(txLat, txLon) || !_hasFiniteLatLon(rxLat, rxLon)) return Infinity;
  const mPerLat = 110574;
  const mPerLon = 111320 * Math.cos(txLat * Math.PI / 180);
  const dLat = (rxLat - txLat) * mPerLat;
  const dLon = _shortestDeltaLonDeg(rxLon, txLon) * mPerLon;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

export function fsplBaseDb(freqMHz) {
  const freq = Number(freqMHz);
  if (!Number.isFinite(freq) || freq <= 0) return Infinity;
  return 20 * Math.log10(freq * 1e6) - 147.55;
}

export function ensureProfileBuffers(maxSamples = DEFAULT_PROFILE_MAX_SAMPLES) {
  return {
    elevs: new Float32Array(maxSamples),
    lats: new Float64Array(maxSamples),
    lons: new Float64Array(maxSamples),
  };
}

export function fillTerrainProfile(buffers, count, txLat, txLon, rxLat, rxLon, elevGrid, elevRes, bounds) {
  for (let s = 0; s < count; s++) {
    const t = s / (count - 1);
    const lat = txLat + (rxLat - txLat) * t;
    const lon = txLon + (rxLon - txLon) * t;
    buffers.lats[s] = lat;
    buffers.lons[s] = lon;
    buffers.elevs[s] = bilinearElev(lat, lon, elevGrid, elevRes, bounds.latMin, bounds.latMax, bounds.lonMin, bounds.lonMax);
  }
}

export function computeSignalToPoint({
  tx,
  txElev,
  rxLat,
  rxLon,
  rxElev = null,
  distM = null,
  fsplBase = null,
  elevGrid,
  elevRes,
  bounds,
  rxHeight,
  rxGain = 0,
  rxPattern = 'omni',
  rxAzimuthDeg = 0,
  effectiveSens = -127,
  useLos = true,
  useFresnel = false,
  diffractionModel = 'knife-edge',
  foliage = null,
  foliageLossPerM = 0.3,
  buildings = null,
  buildingLossPerM = 0.5,
  profileTargetSpacingM = DEFAULT_PROFILE_TARGET_SPACING_M,
  profileMinSamples = DEFAULT_PROFILE_MIN_SAMPLES,
  profileMaxSamples = DEFAULT_PROFILE_MAX_SAMPLES,
  profileBuffers = null,
}) {
  if (!tx || typeof tx !== 'object') return _noCoverageResult(Infinity);
  const dist = distM ?? flatDistanceM(tx.lat, tx.lon, rxLat, rxLon);
  const base = fsplBase ?? fsplBaseDb(tx.freq);
  if (!_hasFiniteLatLon(tx?.lat, tx?.lon)
    || !_hasFiniteLatLon(rxLat, rxLon)
    || !Number.isFinite(dist)
    || !Number.isFinite(base)
    || !Number.isFinite(Number(tx?.power))
    || !Number.isFinite(Number(tx?.height))
    || !Number.isFinite(Number(tx?.freq))
    || Number(tx.freq) <= 0) {
    return _noCoverageResult(dist);
  }
  const txToRxBearing = bearingDeg(tx.lat, tx.lon, rxLat, rxLon);
  const rxToTxBearing = bearingDeg(rxLat, rxLon, tx.lat, tx.lon);
  const txPatternOffset = antennaPatternOffsetDb(tx.pattern ?? 'omni', tx.azimuthDeg ?? 0, txToRxBearing);
  const rxPatternOffset = antennaPatternOffsetDb(rxPattern, rxAzimuthDeg, rxToTxBearing);
  const effectiveTxGain = (tx.gain ?? 0) + txPatternOffset;
  const effectiveRxGain = rxGain + rxPatternOffset;
  let rxPower = tx.power + effectiveTxGain + effectiveRxGain - (20 * Math.log10(Math.max(1, dist)) + base);
  let los = null;

  if ((useLos || foliage || buildings) && dist > 50) {
    const buffers = profileBuffers ?? ensureProfileBuffers(profileMaxSamples);
    const maxSamples = Math.min(profileMaxSamples, buffers.elevs.length);
    const sampleCount = profileSampleCount(dist, profileTargetSpacingM, profileMinSamples, maxSamples);
    fillTerrainProfile(buffers, sampleCount, tx.lat, tx.lon, rxLat, rxLon, elevGrid, elevRes, bounds);
    const profile = buffers.elevs.subarray(0, sampleCount);
    const profileLats = buffers.lats.subarray(0, sampleCount);
    const profileLons = buffers.lons.subarray(0, sampleCount);
    const rxGroundElev = rxElev ?? bilinearElev(rxLat, rxLon, elevGrid, elevRes, bounds.latMin, bounds.latMax, bounds.lonMin, bounds.lonMax);

    if (useLos) {
      los = checkLoS(txElev, rxGroundElev, profile, tx.height, rxHeight, dist, tx.freq, useFresnel, diffractionModel);
      rxPower -= los.diffractionLossDb;
      if (!los.geometricLos && los.diffractionLossDb > 60) rxPower = Math.min(rxPower, effectiveSens - 10);
    }

    if (foliage) {
      rxPower -= foliageLossDb(
        profileLats, profileLons, profile, tx.height, rxHeight,
        foliage.polygons, foliage.bboxes, foliage.canopyHeights, foliage.factors,
        foliage.tileIndex, dist, foliageLossPerM, tx.freq, foliage.holes
      );
    }

    if (buildings) {
      rxPower -= buildingLossDb(
        profileLats, profileLons, profile, tx.height, rxHeight,
        buildings.polygons, buildings.bboxes, buildings.heights,
        buildings.tileIndex, dist, buildingLossPerM, buildings.holes
      );
    }
  }

  return { rxPower, distM: dist, los, txPatternOffset, rxPatternOffset, effectiveTxGain, effectiveRxGain };
}

function _hasFiniteLatLon(lat, lon) {
  return Number.isFinite(Number(lat))
    && Number.isFinite(Number(lon))
    && Number(lat) >= -90
    && Number(lat) <= 90;
}

function _shortestDeltaLonDeg(a, b) {
  return ((Number(a) - Number(b) + 540) % 360) - 180;
}

function _noCoverageResult(dist) {
  return {
    rxPower: -200,
    distM: Number.isFinite(dist) ? dist : Infinity,
    los: null,
    txPatternOffset: 0,
    rxPatternOffset: 0,
    effectiveTxGain: 0,
    effectiveRxGain: 0,
  };
}
