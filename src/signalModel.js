import { bilinearElev, checkLoS, profileSampleCount } from './propagation.js';
import { foliageLossDb } from './foliage.js';
import { buildingLossDb } from './buildings.js';

export const DEFAULT_PROFILE_TARGET_SPACING_M = 50;
export const DEFAULT_PROFILE_MIN_SAMPLES = 16;
export const DEFAULT_PROFILE_MAX_SAMPLES = 512;

export function flatDistanceM(txLat, txLon, rxLat, rxLon) {
  const mPerLat = 110574;
  const mPerLon = 111320 * Math.cos(txLat * Math.PI / 180);
  const dLat = (rxLat - txLat) * mPerLat;
  const dLon = (rxLon - txLon) * mPerLon;
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

export function fsplBaseDb(freqMHz) {
  return 20 * Math.log10(freqMHz * 1e6) - 147.55;
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
  effectiveSens = -127,
  useLos = true,
  useFresnel = false,
  foliage = null,
  foliageLossPerM = 0.3,
  buildings = null,
  buildingLossPerM = 0.5,
  profileTargetSpacingM = DEFAULT_PROFILE_TARGET_SPACING_M,
  profileMinSamples = DEFAULT_PROFILE_MIN_SAMPLES,
  profileMaxSamples = DEFAULT_PROFILE_MAX_SAMPLES,
  profileBuffers = null,
}) {
  const dist = distM ?? flatDistanceM(tx.lat, tx.lon, rxLat, rxLon);
  const base = fsplBase ?? fsplBaseDb(tx.freq);
  let rxPower = tx.power + (tx.gain ?? 0) + rxGain - (20 * Math.log10(Math.max(1, dist)) + base);
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
      los = checkLoS(txElev, rxGroundElev, profile, tx.height, rxHeight, dist, tx.freq, useFresnel);
      rxPower -= los.diffractionLossDb;
      if (!los.geometricLos && los.diffractionLossDb > 60) rxPower = Math.min(rxPower, effectiveSens - 10);
    }

    if (foliage) {
      rxPower -= foliageLossDb(
        profileLats, profileLons, profile, tx.height, rxHeight,
        foliage.polygons, foliage.bboxes, foliage.canopyHeights, foliage.factors,
        foliage.tileIndex, dist, foliageLossPerM, tx.freq
      );
    }

    if (buildings) {
      rxPower -= buildingLossDb(
        profileLats, profileLons, profile, tx.height, rxHeight,
        buildings.polygons, buildings.bboxes, buildings.heights,
        buildings.tileIndex, dist, buildingLossPerM
      );
    }
  }

  return { rxPower, distM: dist, los };
}
