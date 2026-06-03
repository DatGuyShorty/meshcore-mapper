// @ts-check
import { antennaPatternOffsetDb, bearingDeg, bilinearElev, checkLoS, profileSampleCount, twoRayReflectionGainDb } from './propagation.js';
import { foliageLossDb } from './foliage.js';
import { buildingLossDb } from './buildings.js';

export const DEFAULT_PROFILE_TARGET_SPACING_M = 50;
export const DEFAULT_PROFILE_MIN_SAMPLES = 16;
export const DEFAULT_PROFILE_MAX_SAMPLES = 512;

/**
 * @typedef {Object} Bbox
 * @property {number} latMin
 * @property {number} latMax
 * @property {number} lonMin
 * @property {number} lonMax
 *
 * @typedef {Object} TxSpec
 * @property {number} lat
 * @property {number} lon
 * @property {number} height       Antenna height above ground (m)
 * @property {number} power        TX power (dBm)
 * @property {number} freq         Frequency (MHz)
 * @property {number} [gain]       Antenna gain (dBi)
 * @property {string} [pattern]    Antenna pattern key ('omni', 'sector90', …)
 * @property {number} [azimuthDeg]
 * @property {string} [name]
 * @property {string | number} [id]
 *
 * @typedef {Object} ProfileBuffers
 * @property {Float32Array} elevs
 * @property {Float64Array} lats
 * @property {Float64Array} lons
 *
 * @typedef {Object} ObstacleSet
 * @property {Array<Array<[number, number]>>} polygons
 * @property {Array<Bbox>} bboxes
 * @property {Float32Array | number[]} [canopyHeights]
 * @property {Float32Array | number[]} [factors]
 * @property {Float32Array | number[]} [heights]
 * @property {any} [tileIndex]
 * @property {any} [holes]
 */

/**
 * Approximate ground distance in metres using a local flat-Earth projection.
 * Good to ~0.03% for ranges typical of LoRa links; cheap enough to call
 * hundreds of thousands of times during a grid scan.
 * @param {unknown} txLat
 * @param {unknown} txLon
 * @param {unknown} rxLat
 * @param {unknown} rxLon
 * @returns {number}
 */
export function flatDistanceM(txLat, txLon, rxLat, rxLon) {
  if (!_hasFiniteLatLon(txLat, txLon) || !_hasFiniteLatLon(rxLat, rxLon)) return Infinity;
  const txLatN = /** @type {number} */ (txLat);
  const txLonN = /** @type {number} */ (txLon);
  const rxLatN = /** @type {number} */ (rxLat);
  const rxLonN = /** @type {number} */ (rxLon);
  const mPerLat = 110574;
  const mPerLon = 111320 * Math.cos(txLatN * Math.PI / 180);
  const dLat = (rxLatN - txLatN) * mPerLat;
  const dLon = _shortestDeltaLonDeg(rxLonN, txLonN) * mPerLon;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Constant part of FSPL: `20·log10(f_Hz) − 147.55`.
 * Returned as a base value the caller adds `20·log10(d_m)` to.
 * @param {unknown} freqMHz
 * @returns {number}
 */
export function fsplBaseDb(freqMHz) {
  const freq = Number(freqMHz);
  if (!Number.isFinite(freq) || freq <= 0) return Infinity;
  return 20 * Math.log10(freq * 1e6) - 147.55;
}

/**
 * Allocate (and pool) reusable typed-array buffers for terrain profile
 * sampling, so the inner coverage loop doesn't allocate per pixel.
 * @param {number} [maxSamples]
 * @returns {ProfileBuffers}
 */
export function ensureProfileBuffers(maxSamples = DEFAULT_PROFILE_MAX_SAMPLES) {
  return {
    elevs: new Float32Array(maxSamples),
    lats: new Float64Array(maxSamples),
    lons: new Float64Array(maxSamples),
  };
}

/**
 * Sample the terrain elevation grid along the great-circle line between
 * (txLat, txLon) and (rxLat, rxLon) into the provided typed-array buffers.
 * @param {ProfileBuffers} buffers
 * @param {number} count
 * @param {number} txLat
 * @param {number} txLon
 * @param {number} rxLat
 * @param {number} rxLon
 * @param {ArrayLike<number>} elevGrid
 * @param {number} elevRes
 * @param {Bbox} bounds
 */
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

/**
 * @typedef {Object} ComputeSignalArgs
 * @property {TxSpec} tx
 * @property {number} txElev
 * @property {number} rxLat
 * @property {number} rxLon
 * @property {number | null} [rxElev]
 * @property {number | null} [distM]
 * @property {number | null} [fsplBase]
 * @property {ArrayLike<number>} elevGrid
 * @property {number} elevRes
 * @property {Bbox} bounds
 * @property {number} rxHeight
 * @property {number} [rxGain]
 * @property {string} [rxPattern]
 * @property {number} [rxAzimuthDeg]
 * @property {number} [effectiveSens]
 * @property {boolean} [useLos]
 * @property {boolean} [useFresnel]
 * @property {boolean} [useGroundReflection]
 * @property {number} [reflectionCoeff]
 * @property {string} [diffractionModel]
 * @property {ObstacleSet | null} [foliage]
 * @property {number} [foliageLossPerM]
 * @property {ObstacleSet | null} [buildings]
 * @property {number} [buildingLossPerM]
 * @property {number} [profileTargetSpacingM]
 * @property {number} [profileMinSamples]
 * @property {number} [profileMaxSamples]
 * @property {ProfileBuffers | null} [profileBuffers]
 *
 * @typedef {Object} SignalToPointResult
 * @property {number} rxPower
 * @property {number} distM
 * @property {any} los
 * @property {number} txPatternOffset
 * @property {number} rxPatternOffset
 * @property {number} effectiveTxGain
 * @property {number} effectiveRxGain
 */

/**
 * @param {ComputeSignalArgs} args
 * @returns {SignalToPointResult}
 */
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
  useGroundReflection = false,
  reflectionCoeff = 0.7,
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
      // Ground reflection (2-ray) only on clear (geometric-LoS) paths.
      if (useGroundReflection && los.geometricLos) {
        rxPower += twoRayReflectionGainDb(dist, tx.height, rxHeight, tx.freq, reflectionCoeff);
      }
    }

    if (foliage) {
      rxPower -= foliageLossDb(
        profileLats, profileLons, profile, tx.height, rxHeight,
        foliage.polygons, foliage.bboxes,
        foliage.canopyHeights ?? [], foliage.factors ?? [],
        foliage.tileIndex, dist, foliageLossPerM, tx.freq, foliage.holes
      );
    }

    if (buildings) {
      rxPower -= buildingLossDb(
        profileLats, profileLons, profile, tx.height, rxHeight,
        buildings.polygons, buildings.bboxes,
        buildings.heights ?? [],
        buildings.tileIndex, dist, buildingLossPerM, buildings.holes
      );
    }
  }

  return { rxPower, distM: dist, los, txPatternOffset, rxPatternOffset, effectiveTxGain, effectiveRxGain };
}

/**
 * @param {unknown} lat
 * @param {unknown} lon
 * @returns {boolean}
 */
function _hasFiniteLatLon(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  return Number.isFinite(la)
    && Number.isFinite(lo)
    && la >= -90
    && la <= 90
    && lo >= -180
    && lo <= 180;
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number}
 */
function _shortestDeltaLonDeg(a, b) {
  return ((Number(a) - Number(b) + 540) % 360) - 180;
}

/**
 * @param {number} dist
 * @returns {SignalToPointResult}
 */
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
