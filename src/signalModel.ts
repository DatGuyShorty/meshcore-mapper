import { antennaPatternOffsetDb, bearingDeg, bilinearElev, checkLoS, coherentFieldGainDb, profileSampleCount, sixRayReflectionGainDb, traceBuildingFacadeRays, twoRayReflectionGainDb } from './propagation.js';
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

export type Bbox = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

export type TxSpec = {
  lat: number;
  lon: number;
  height: number;
  power: number;
  freq: number;
  gain?: number;
  pattern?: string;
  azimuthDeg?: number;
  name?: string;
  id?: string | number;
};

export type ProfileBuffers = {
  elevs: Float32Array;
  lats: Float64Array;
  lons: Float64Array;
};

type ObstacleRing = [number, number][];

type ObstacleTileIndex = {
  tiles: number[][];
  latMin: number;
  latSpan: number;
  lonMin: number;
  lonSpan: number;
};

export type ObstacleSet = {
  polygons: ObstacleRing[];
  bboxes: Bbox[];
  canopyHeights?: ArrayLike<number>;
  factors?: ArrayLike<number>;
  heights?: ArrayLike<number>;
  tileIndex?: ObstacleTileIndex | null;
  holes?: ObstacleRing[][];
};

type CheckLoSResult = {
  geometricLos: boolean;
  minClearanceM?: number;
  minFresnelClearanceRatio?: number;
  diffractionLossDb: number;
  [key: string]: unknown;
};

type FacadeRay = {
  lat: number;
  lon: number;
  pathM: number;
  reflectionAbsElevM: number;
  buildingIndex: number;
};

export type SignalBreakdown = {
  pathLossDb: number;
  diffractionLossDb: number;
  foliageLossDb: number;
  buildingLossDb: number;
  reflectionGainDb: number;
  obstacleLossAppliedDb: number;
};

export type SignalToPointResult = {
  rxPower: number;
  distM: number;
  los: CheckLoSResult | null;
  txPatternOffset: number;
  rxPatternOffset: number;
  effectiveTxGain: number;
  effectiveRxGain: number;
  breakdown?: SignalBreakdown;
};

export type ComputeSignalArgs = {
  tx: TxSpec;
  txElev: number;
  rxLat: number;
  rxLon: number;
  rxElev?: number | null;
  distM?: number | null;
  fsplBase?: number | null;
  elevGrid?: ArrayLike<number>;
  elevRes?: number;
  bounds?: Bbox;
  rxHeight: number;
  rxGain?: number;
  rxPattern?: string;
  rxAzimuthDeg?: number;
  effectiveSens?: number;
  useLos?: boolean;
  useFresnel?: boolean;
  useGroundReflection?: boolean;
  reflectionModel?: string;
  reflectionCoeff?: number;
  sideReflectionCoeff?: number;
  reflectionCorridorWidthM?: number;
  diffractionModel?: string;
  foliage?: ObstacleSet | null;
  foliageLossPerM?: number;
  applyFoliageLoss?: boolean;
  buildings?: ObstacleSet | null;
  buildingLossPerM?: number;
  applyBuildingLoss?: boolean;
  profileTargetSpacingM?: number;
  profileMinSamples?: number;
  profileMaxSamples?: number;
  profileBuffers?: ProfileBuffers | null;
  includeBreakdown?: boolean;
};

type BuildingFacadeMultipathArgs = {
  tx: TxSpec;
  txAbsElev: number;
  rxLat: number;
  rxLon: number;
  rxAbsElev: number;
  rxHeight: number;
  distM: number;
  directObstacleLossDb: number;
  reflectionCoeff: number;
  sideReflectionCoeff: number;
  buildings: ObstacleSet | null;
  foliage: ObstacleSet | null;
  applyFoliageLoss: boolean;
  applyBuildingLoss: boolean;
  foliageLossPerM: number;
  buildingLossPerM: number;
  elevGrid: ArrayLike<number>;
  elevRes: number;
  bounds: Bbox;
  profileTargetSpacingM: number;
  profileMinSamples: number;
  profileMaxSamples: number;
};

type FacadeRayObstacleArgs = {
  tx: TxSpec;
  txAbsElev: number;
  rxLat: number;
  rxLon: number;
  rxAbsElev: number;
  buildings: ObstacleSet | null;
  foliage: ObstacleSet | null;
  applyFoliageLoss: boolean;
  applyBuildingLoss: boolean;
  foliageLossPerM: number;
  buildingLossPerM: number;
  elevGrid: ArrayLike<number>;
  elevRes: number;
  bounds: Bbox;
  profileTargetSpacingM: number;
  profileMinSamples: number;
  profileMaxSamples: number;
  legBuffers: ProfileBuffers;
};

type LegObstacleLossArgs = {
  startLat: number;
  startLon: number;
  startAbsElevM: number;
  endLat: number;
  endLon: number;
  endAbsElevM: number;
  buildings: ObstacleSet | null;
  foliage: ObstacleSet | null;
  applyFoliageLoss: boolean;
  applyBuildingLoss: boolean;
  foliageLossPerM: number;
  buildingLossPerM: number;
  freqMHz: number;
  skipBuildingIndex: number;
  elevGrid: ArrayLike<number>;
  elevRes: number;
  bounds: Bbox;
  profileTargetSpacingM: number;
  profileMinSamples: number;
  profileMaxSamples: number;
  buffers: ProfileBuffers;
};

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
export function flatDistanceM(txLat: unknown, txLon: unknown, rxLat: unknown, rxLon: unknown): number {
  if (!_hasFiniteLatLon(txLat, txLon) || !_hasFiniteLatLon(rxLat, rxLon)) return Infinity;
  const txLatN = Number(txLat);
  const txLonN = Number(txLon);
  const rxLatN = Number(rxLat);
  const rxLonN = Number(rxLon);
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
export function fsplBaseDb(freqMHz: unknown): number {
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
export function ensureProfileBuffers(maxSamples = DEFAULT_PROFILE_MAX_SAMPLES): ProfileBuffers {
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
export function fillTerrainProfile(
  buffers: ProfileBuffers,
  count: number,
  txLat: number,
  txLon: number,
  rxLat: number,
  rxLon: number,
  elevGrid: ArrayLike<number>,
  elevRes: number,
  bounds: Bbox,
): void {
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
 * @property {string} [reflectionModel]
 * @property {number} [reflectionCoeff]
 * @property {number} [sideReflectionCoeff]
 * @property {number} [reflectionCorridorWidthM]
 * @property {string} [diffractionModel]
 * @property {ObstacleSet | null} [foliage]
 * @property {number} [foliageLossPerM]
 * @property {boolean} [applyFoliageLoss]
 * @property {ObstacleSet | null} [buildings]
 * @property {number} [buildingLossPerM]
 * @property {boolean} [applyBuildingLoss]
 * @property {number} [profileTargetSpacingM]
 * @property {number} [profileMinSamples]
 * @property {number} [profileMaxSamples]
 * @property {ProfileBuffers | null} [profileBuffers]
 * @property {boolean} [includeBreakdown]
 *
 * @typedef {Object} SignalBreakdown
 * @property {number} pathLossDb
 * @property {number} diffractionLossDb
 * @property {number} foliageLossDb
 * @property {number} buildingLossDb
 * @property {number} reflectionGainDb
 * @property {number} obstacleLossAppliedDb
 *
 * @typedef {Object} SignalToPointResult
 * @property {number} rxPower
 * @property {number} distM
 * @property {any} los
 * @property {number} txPatternOffset
 * @property {number} rxPatternOffset
 * @property {number} effectiveTxGain
 * @property {number} effectiveRxGain
 * @property {SignalBreakdown} [breakdown]
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
  reflectionModel = 'two-ray',
  reflectionCoeff = 0.7,
  sideReflectionCoeff = 0.35,
  reflectionCorridorWidthM = 24,
  diffractionModel = 'knife-edge',
  foliage = null,
  foliageLossPerM = 0.3,
  applyFoliageLoss = true,
  buildings = null,
  buildingLossPerM = 0.5,
  applyBuildingLoss = true,
  profileTargetSpacingM = DEFAULT_PROFILE_TARGET_SPACING_M,
  profileMinSamples = DEFAULT_PROFILE_MIN_SAMPLES,
  profileMaxSamples = DEFAULT_PROFILE_MAX_SAMPLES,
  profileBuffers = null,
  includeBreakdown = false,
}: ComputeSignalArgs): SignalToPointResult {
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
  const pathLossDb = 20 * Math.log10(Math.max(1, dist)) + base;
  let rxPower = tx.power + effectiveTxGain + effectiveRxGain - pathLossDb;
  let los = null;
  let diffractionLossDb = 0;
  let foliageLoss = 0;
  let buildingLoss = 0;
  let reflectionGainDb = 0;
  let obstacleLossAppliedDb = 0;

  if ((useLos || foliage || buildings) && dist > 50) {
    const buffers = profileBuffers ?? ensureProfileBuffers(profileMaxSamples);
    const maxSamples = Math.min(profileMaxSamples, buffers.elevs.length);
    const sampleCount = profileSampleCount(dist, profileTargetSpacingM, profileMinSamples, maxSamples);
    fillTerrainProfile(buffers, sampleCount, tx.lat, tx.lon, rxLat, rxLon, elevGrid as ArrayLike<number>, elevRes as number, bounds as Bbox);
    const profile = buffers.elevs.subarray(0, sampleCount);
    const profileLats = buffers.lats.subarray(0, sampleCount);
    const profileLons = buffers.lons.subarray(0, sampleCount);
    const activeBounds = bounds as Bbox;
    const rxGroundElev = rxElev ?? bilinearElev(rxLat, rxLon, elevGrid as ArrayLike<number>, elevRes as number, activeBounds.latMin, activeBounds.latMax, activeBounds.lonMin, activeBounds.lonMax);
    const txAbsElev = txElev + tx.height;
    const rxAbsElev = rxGroundElev + rxHeight;
    const directFoliageLoss = applyFoliageLoss && foliage
      ? foliageLossDb(
          profileLats, profileLons, profile, tx.height, rxHeight,
          foliage.polygons ?? [], foliage.bboxes,
          foliage.canopyHeights ?? [], foliage.factors ?? [],
          foliage.tileIndex ?? null, dist, foliageLossPerM, tx.freq, foliage.holes
        )
      : 0;
    const directBuildingLoss = applyBuildingLoss && buildings
      ? buildingLossDb(
          profileLats, profileLons, profile, tx.height, rxHeight,
          buildings.polygons ?? [], buildings.bboxes,
          buildings.heights ?? [],
          buildings.tileIndex ?? null, dist, buildingLossPerM, buildings.holes
        )
      : 0;
    foliageLoss = directFoliageLoss;
    buildingLoss = directBuildingLoss;
    let directObstacleLossHandledByReflection = false;

    if (useLos) {
      los = checkLoS(txElev, rxGroundElev, profile, tx.height, rxHeight, dist, tx.freq, useFresnel, diffractionModel);
      diffractionLossDb = los.diffractionLossDb;
      rxPower -= diffractionLossDb;
      if (!los.geometricLos && los.diffractionLossDb > 60) rxPower = Math.min(rxPower, effectiveSens - 10);
      // Reflection multipath only on clear geometric-LoS paths.
      if (useGroundReflection && los.geometricLos) {
        if (reflectionModel === 'facade') {
          reflectionGainDb = _buildingFacadeMultipathGainDb({
            tx,
            txAbsElev,
            rxLat,
            rxLon,
            rxAbsElev,
            rxHeight,
            distM: dist,
            directObstacleLossDb: directFoliageLoss + directBuildingLoss,
            reflectionCoeff,
            sideReflectionCoeff,
            buildings,
            foliage,
            applyFoliageLoss,
            applyBuildingLoss,
            foliageLossPerM,
            buildingLossPerM,
            elevGrid: elevGrid as ArrayLike<number>,
            elevRes: elevRes as number,
            bounds: activeBounds,
            profileTargetSpacingM,
            profileMinSamples,
            profileMaxSamples,
          });
          rxPower += reflectionGainDb;
          directObstacleLossHandledByReflection = true;
        } else {
          reflectionGainDb = reflectionModel === 'six-ray'
            ? sixRayReflectionGainDb(
                dist,
                tx.height,
                rxHeight,
                tx.freq,
                reflectionCoeff,
                sideReflectionCoeff,
                reflectionCorridorWidthM
              )
            : twoRayReflectionGainDb(dist, tx.height, rxHeight, tx.freq, reflectionCoeff);
          rxPower += reflectionGainDb;
        }
      }
    }

    if (!directObstacleLossHandledByReflection) {
      obstacleLossAppliedDb = directFoliageLoss + directBuildingLoss;
      rxPower -= obstacleLossAppliedDb;
    } else {
      obstacleLossAppliedDb = directFoliageLoss + directBuildingLoss;
    }
  }

  const result: SignalToPointResult = {
    rxPower,
    distM: dist,
    los,
    txPatternOffset,
    rxPatternOffset,
    effectiveTxGain,
    effectiveRxGain,
  };
  if (includeBreakdown) {
    result.breakdown = {
      pathLossDb,
      diffractionLossDb,
      foliageLossDb: foliageLoss,
      buildingLossDb: buildingLoss,
      reflectionGainDb,
      obstacleLossAppliedDb,
    };
  }
  return result;
}

/**
 * @param {Object} args
 * @param {TxSpec} args.tx
 * @param {number} args.txAbsElev
 * @param {number} args.rxLat
 * @param {number} args.rxLon
 * @param {number} args.rxAbsElev
 * @param {number} args.rxHeight
 * @param {number} args.distM
 * @param {number} args.directObstacleLossDb
 * @param {number} args.reflectionCoeff
 * @param {number} args.sideReflectionCoeff
 * @param {ObstacleSet | null} args.buildings
 * @param {ObstacleSet | null} args.foliage
 * @param {boolean} args.applyFoliageLoss
 * @param {boolean} args.applyBuildingLoss
 * @param {number} args.foliageLossPerM
 * @param {number} args.buildingLossPerM
 * @param {ArrayLike<number>} args.elevGrid
 * @param {number} args.elevRes
 * @param {Bbox} args.bounds
 * @param {number} args.profileTargetSpacingM
 * @param {number} args.profileMinSamples
 * @param {number} args.profileMaxSamples
 * @returns {number}
 */
function _buildingFacadeMultipathGainDb({
  tx,
  txAbsElev,
  rxLat,
  rxLon,
  rxAbsElev,
  rxHeight,
  distM,
  directObstacleLossDb,
  reflectionCoeff,
  sideReflectionCoeff,
  buildings,
  foliage,
  applyFoliageLoss,
  applyBuildingLoss,
  foliageLossPerM,
  buildingLossPerM,
  elevGrid,
  elevRes,
  bounds,
  profileTargetSpacingM,
  profileMinSamples,
  profileMaxSamples,
}: BuildingFacadeMultipathArgs): number {
  const directPathM = Math.hypot(distM, txAbsElev - rxAbsElev);
  const directCoeff = _fieldCoeffFromLossDb(directObstacleLossDb);
  /** @type {Array<{ pathM: number, coeff: number }>} */
  const paths = [{ pathM: directPathM, coeff: directCoeff }];
  const groundR = _clampUnit(reflectionCoeff);
  const wallR = _clampUnit(sideReflectionCoeff);
  if (groundR > 0) {
    paths.push({
      pathM: Math.hypot(distM, tx.height + rxHeight),
      coeff: -groundR * directCoeff,
    });
  }

  if (wallR > 0 && buildings?.polygons?.length) {
    const facadeRays = traceBuildingFacadeRays({
      txLat: tx.lat,
      txLon: tx.lon,
      txAbsElevM: txAbsElev,
      rxLat,
      rxLon,
      rxAbsElevM: rxAbsElev,
      buildings,
      elevGrid,
      elevRes,
      bounds,
    }) as FacadeRay[];
    if (facadeRays.length) {
      const legBuffers = ensureProfileBuffers(profileMaxSamples);
      for (const ray of facadeRays) {
        const rayObstacleLoss = _facadeRayObstacleLossDb(ray, {
          tx,
          txAbsElev,
          rxLat,
          rxLon,
          rxAbsElev,
          buildings,
          foliage,
          applyFoliageLoss,
          applyBuildingLoss,
          foliageLossPerM,
          buildingLossPerM,
          elevGrid,
          elevRes,
          bounds,
          profileTargetSpacingM,
          profileMinSamples,
          profileMaxSamples,
          legBuffers,
        });
        paths.push({
          pathM: ray.pathM,
          coeff: -wallR * _fieldCoeffFromLossDb(rayObstacleLoss),
        });
      }
    }
  }

  return coherentFieldGainDb(paths, directPathM, tx.freq, 0.0001);
}

/**
 * @param {import('./propagation.js').FacadeRay} ray
 * @param {Object} args
 * @param {TxSpec} args.tx
 * @param {number} args.txAbsElev
 * @param {number} args.rxLat
 * @param {number} args.rxLon
 * @param {number} args.rxAbsElev
 * @param {ObstacleSet | null} args.buildings
 * @param {ObstacleSet | null} args.foliage
 * @param {boolean} args.applyFoliageLoss
 * @param {boolean} args.applyBuildingLoss
 * @param {number} args.foliageLossPerM
 * @param {number} args.buildingLossPerM
 * @param {ArrayLike<number>} args.elevGrid
 * @param {number} args.elevRes
 * @param {Bbox} args.bounds
 * @param {number} args.profileTargetSpacingM
 * @param {number} args.profileMinSamples
 * @param {number} args.profileMaxSamples
 * @param {ProfileBuffers} args.legBuffers
 */
function _facadeRayObstacleLossDb(ray: FacadeRay, args: FacadeRayObstacleArgs): number {
  return _legObstacleLossDb({
    startLat: args.tx.lat,
    startLon: args.tx.lon,
    startAbsElevM: args.txAbsElev,
    endLat: ray.lat,
    endLon: ray.lon,
    endAbsElevM: ray.reflectionAbsElevM,
    buildings: args.buildings,
    foliage: args.foliage,
    applyFoliageLoss: args.applyFoliageLoss,
    applyBuildingLoss: args.applyBuildingLoss,
    foliageLossPerM: args.foliageLossPerM,
    buildingLossPerM: args.buildingLossPerM,
    freqMHz: args.tx.freq,
    skipBuildingIndex: ray.buildingIndex,
    elevGrid: args.elevGrid,
    elevRes: args.elevRes,
    bounds: args.bounds,
    profileTargetSpacingM: args.profileTargetSpacingM,
    profileMinSamples: args.profileMinSamples,
    profileMaxSamples: args.profileMaxSamples,
    buffers: args.legBuffers,
  }) + _legObstacleLossDb({
    startLat: ray.lat,
    startLon: ray.lon,
    startAbsElevM: ray.reflectionAbsElevM,
    endLat: args.rxLat,
    endLon: args.rxLon,
    endAbsElevM: args.rxAbsElev,
    buildings: args.buildings,
    foliage: args.foliage,
    applyFoliageLoss: args.applyFoliageLoss,
    applyBuildingLoss: args.applyBuildingLoss,
    foliageLossPerM: args.foliageLossPerM,
    buildingLossPerM: args.buildingLossPerM,
    freqMHz: args.tx.freq,
    skipBuildingIndex: ray.buildingIndex,
    elevGrid: args.elevGrid,
    elevRes: args.elevRes,
    bounds: args.bounds,
    profileTargetSpacingM: args.profileTargetSpacingM,
    profileMinSamples: args.profileMinSamples,
    profileMaxSamples: args.profileMaxSamples,
    buffers: args.legBuffers,
  });
}

/**
 * @param {Object} args
 * @param {number} args.startLat
 * @param {number} args.startLon
 * @param {number} args.startAbsElevM
 * @param {number} args.endLat
 * @param {number} args.endLon
 * @param {number} args.endAbsElevM
 * @param {ObstacleSet | null} args.buildings
 * @param {ObstacleSet | null} args.foliage
 * @param {boolean} args.applyFoliageLoss
 * @param {boolean} args.applyBuildingLoss
 * @param {number} args.foliageLossPerM
 * @param {number} args.buildingLossPerM
 * @param {number} args.freqMHz
 * @param {number} args.skipBuildingIndex
 * @param {ArrayLike<number>} args.elevGrid
 * @param {number} args.elevRes
 * @param {Bbox} args.bounds
 * @param {number} args.profileTargetSpacingM
 * @param {number} args.profileMinSamples
 * @param {number} args.profileMaxSamples
 * @param {ProfileBuffers} args.buffers
 * @returns {number}
 */
function _legObstacleLossDb({
  startLat,
  startLon,
  startAbsElevM,
  endLat,
  endLon,
  endAbsElevM,
  buildings,
  foliage,
  applyFoliageLoss,
  applyBuildingLoss,
  foliageLossPerM,
  buildingLossPerM,
  freqMHz,
  skipBuildingIndex,
  elevGrid,
  elevRes,
  bounds,
  profileTargetSpacingM,
  profileMinSamples,
  profileMaxSamples,
  buffers,
}: LegObstacleLossArgs): number {
  const dist = flatDistanceM(startLat, startLon, endLat, endLon);
  if (!Number.isFinite(dist) || dist <= 1) return 0;
  const maxSamples = Math.min(profileMaxSamples, buffers.elevs.length);
  const sampleCount = profileSampleCount(dist, profileTargetSpacingM, profileMinSamples, maxSamples);
  fillTerrainProfile(buffers, sampleCount, startLat, startLon, endLat, endLon, elevGrid, elevRes, bounds);
  const profile = buffers.elevs.subarray(0, sampleCount);
  const profileLats = buffers.lats.subarray(0, sampleCount);
  const profileLons = buffers.lons.subarray(0, sampleCount);
  const startHeight = Math.max(0, startAbsElevM - profile[0]);
  const endHeight = Math.max(0, endAbsElevM - profile[sampleCount - 1]);
  let loss = 0;
  if (applyFoliageLoss && foliage) {
    loss += foliageLossDb(
      profileLats, profileLons, profile, startHeight, endHeight,
      foliage.polygons ?? [], foliage.bboxes,
      foliage.canopyHeights ?? [], foliage.factors ?? [],
      foliage.tileIndex ?? null, dist, foliageLossPerM, freqMHz, foliage.holes
    );
  }
  if (applyBuildingLoss && buildings) {
    loss += buildingLossDb(
      profileLats, profileLons, profile, startHeight, endHeight,
      buildings.polygons ?? [], buildings.bboxes,
      buildings.heights ?? [],
      buildings.tileIndex ?? null, dist, buildingLossPerM, buildings.holes, skipBuildingIndex
    );
  }
  return loss;
}

/** @param {number} lossDb */
function _fieldCoeffFromLossDb(lossDb: number): number {
  const loss = Number(lossDb);
  if (!Number.isFinite(loss) || loss <= 0) return 1;
  return 10 ** (-loss / 20);
}

/** @param {number} value */
function _clampUnit(value: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/**
 * @param {unknown} lat
 * @param {unknown} lon
 * @returns {boolean}
 */
function _hasFiniteLatLon(lat: unknown, lon: unknown): boolean {
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
function _shortestDeltaLonDeg(a: unknown, b: unknown): number {
  return ((Number(a) - Number(b) + 540) % 360) - 180;
}

/**
 * @param {number} dist
 * @returns {SignalToPointResult}
 */
function _noCoverageResult(dist: number): SignalToPointResult {
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
