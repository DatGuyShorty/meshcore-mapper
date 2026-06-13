import { clampedGridFractions } from './osmGeometry.js';

type NumericArray = ArrayLike<number>;
type Point2d = { x: number; y: number };
type SegmentIntersection = { t: number; u: number };
type LocalBasis = {
  lat0: number;
  lon0: number;
  mPerDegLat: number;
  mPerDegLon: number;
};
type RayPath = { pathM: number; coeff: number };
type GradientStop = readonly [number, number, number, number, number];
type Bbox = { latMin: number; latMax: number; lonMin: number; lonMax: number };
type TileIndex = {
  tiles: number[][];
  latMin: number;
  latSpan: number;
  lonMin: number;
  lonSpan: number;
};

export type Polygon = Array<[number, number]>;

type BuildingFacadeSource = {
  polygons?: Polygon[];
  bboxes?: Bbox[];
  heights?: NumericArray;
  tileIndex?: TileIndex | null;
} | null;

export type FacadeRay = {
  lat: number;
  lon: number;
  pathM: number;
  leg1M: number;
  leg2M: number;
  reflectionAbsElevM: number;
  reflectionGroundElevM: number;
  buildingIndex: number;
  edgeIndex: number;
};

type TraceBuildingFacadeRaysArgs = {
  txLat: number;
  txLon: number;
  txAbsElevM: number;
  rxLat: number;
  rxLon: number;
  rxAbsElevM: number;
  buildings: BuildingFacadeSource;
  elevGrid: NumericArray | null | undefined;
  elevRes: number;
  bounds: Bbox;
  maxRays?: number;
  maxSearchRadiusM?: number;
  maxExtraPathM?: number;
  minFacadeLengthM?: number;
};

type AntennaPattern = string | { hpbwDeg?: number; maxAttenDb?: number } | null | undefined;

export type CheckLoSResult = {
  los: boolean;
  geometricLos: boolean;
  fresnelClear: boolean;
  diffractionLossDb: number;
  diffractionModel: string;
  minClearanceM: number;
  minFresnelClearanceRatio: number;
};

/**
 * propagation.js
 * Pure LoRa radio propagation calculations.
 * No DOM, no map, no network — safe to call from any context including a future optimizer.
 */

// ─── Haversine distance (metres) ────────────────────────────────
/**
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} distance in metres
 */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── Free-Space Path Loss (dB) ───────────────────────────────────
// FSPL = 20·log10(d_m) + 20·log10(f_hz) − 147.55
/**
 * @param {number} distanceM - distance in metres (clamped to ≥1)
 * @param {number} freqMHz   - frequency in MHz
 * @returns {number} path loss in dB
 */
export function fspl(distanceM: number, freqMHz: number): number {
  if (distanceM < 1) distanceM = 1;
  return 20 * Math.log10(distanceM) + 20 * Math.log10(freqMHz * 1e6) - 147.55;
}

// ─── Line-of-Sight with knife-edge diffraction ───────────────────
/**
 * Check LoS along a pre-sampled terrain profile and compute diffraction loss.
 * Uses the Fresnel-Kirchhoff diffraction parameter (ITU-R P.526).
 * Fresnel clearance is reported separately; it is not added to terrain height
 * for diffraction loss.
 *
 * @param {number}   txElevM      - TX ground elevation (m AMSL)
 * @param {number}   rxElevM      - RX ground elevation (m AMSL)
 * @param {number[]} profileElevs - terrain elevations along path (incl. TX and RX ends)
 * @param {number}   txHeightM    - TX antenna height above ground (m)
 * @param {number}   rxHeightM    - RX antenna height above ground (m)
 * @param {number}   totalDistM   - total path length (m)
 * @param {number}   freqMHz      - frequency (MHz)
 * @param {boolean}  useFresnel   - use first Fresnel zone clearance for the returned `los` flag
 * @returns {{ los: boolean, diffractionLossDb: number }}
 */
// B6: single source of truth for the effective Earth radius used everywhere in the propagation model
export const RE_EFF = 6371000 * (4 / 3); // k = 4/3, standard atmosphere

// P5: cached wavelength and sample-fraction arrays — computed once per unique input, reused thereafter
const _lambdaCache = new Map<number, number>();
const _fracsCache  = new Map<number, Float64Array>();

/** @param {number} freqMHz */
function _getLambda(freqMHz: number): number {
  let v = _lambdaCache.get(freqMHz);
  if (v === undefined) {
    v = 299792458 / (freqMHz * 1e6);
    _lambdaCache.set(freqMHz, v);
  }
  return v;
}

/** @param {number} n */
function _getFracs(n: number): Float64Array {
  let f = _fracsCache.get(n);
  if (!f) {
    f = new Float64Array(n);
    for (let i = 0; i < n; i++) f[i] = i / (n - 1);
    _fracsCache.set(n, f);
  }
  return f;
}

/**
 * Two-ray (direct + ground-reflected) interference gain relative to free space,
 * in dB to ADD to the free-space rxPower. Flat-earth geometry: direct path
 * √(d²+(ht−hr)²), ground-reflected image path √(d²+(ht+hr)²). The combined field
 * factor is `F = |1 + Γ·e^{−jΔφ}|` with `Γ = −R` (phase reversal on reflection),
 * `Δφ = 2π·(r_refl − r_direct)/λ`. Near the TX this produces constructive/
 * destructive interference lobes; the deep null is floored so it never returns −∞.
 * @param {number} distM      horizontal TX–RX distance (m)
 * @param {number} txHeightM  TX antenna height above ground (m)
 * @param {number} rxHeightM  RX antenna height above ground (m)
 * @param {number} freqMHz
 * @param {number} [reflectionCoeff]  |Γ| in [0,1] (default 0.7)
 * @returns {number} reflection gain in dB (≈ −20 … +6)
 */
export function twoRayReflectionGainDb(
  distM: number,
  txHeightM: number,
  rxHeightM: number,
  freqMHz: number,
  reflectionCoeff = 0.7
): number {
  const d = Number(distM);
  const ht = Math.max(0, Number(txHeightM));
  const hr = Math.max(0, Number(rxHeightM));
  const R = _clampUnit(reflectionCoeff, 0);
  if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(freqMHz) || freqMHz <= 0 || R <= 0) return 0;
  const lambda = _getLambda(freqMHz);
  const rDirect = Math.hypot(d, ht - hr);
  const rReflected = Math.hypot(d, ht + hr);
  const dPhi = 2 * Math.PI * (rReflected - rDirect) / lambda;
  // F² = 1 + R² − 2R·cos(Δφ); floor (≈ −20 dB) so deep nulls stay finite.
  const f2 = Math.max(0.01, 1 + R * R - 2 * R * Math.cos(dPhi));
  return 10 * Math.log10(f2);
}

/**
 * Six-ray urban-corridor reflection gain relative to free-space rxPower.
 * The geometry is an image-source approximation with TX/RX on the centerline
 * between two parallel side reflectors:
 *   direct, ground, left wall, right wall, left wall+ground, right wall+ground.
 *
 * This is intentionally a corridor model, not a full building ray tracer. It
 * is useful when the link lies along a street or valley-like reflective channel
 * and the user can provide an effective wall-to-wall width.
 * @param {number} distM      horizontal TX-RX distance (m)
 * @param {number} txHeightM  TX antenna height above ground (m)
 * @param {number} rxHeightM  RX antenna height above ground (m)
 * @param {number} freqMHz
 * @param {number} [groundReflectionCoeff] |Gamma_g| in [0,1]
 * @param {number} [wallReflectionCoeff]   |Gamma_w| in [0,1]
 * @param {number} [corridorWidthM]         side-reflector spacing in metres
 * @returns {number} reflection gain in dB
 */
export function sixRayReflectionGainDb(
  distM: number,
  txHeightM: number,
  rxHeightM: number,
  freqMHz: number,
  groundReflectionCoeff = 0.7,
  wallReflectionCoeff = 0.35,
  corridorWidthM = 24
): number {
  const d = Number(distM);
  const ht = Math.max(0, Number(txHeightM));
  const hr = Math.max(0, Number(rxHeightM));
  const groundR = _clampUnit(groundReflectionCoeff, 0);
  const wallR = _clampUnit(wallReflectionCoeff, 0);
  const widthRaw = Number(corridorWidthM);
  const width = Number.isFinite(widthRaw) ? Math.max(1, widthRaw) : 24;
  if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(freqMHz) || freqMHz <= 0) return 0;
  if (groundR <= 0 && wallR <= 0) return 0;

  const rDirect = Math.hypot(d, ht - hr);
  const rGround = Math.hypot(d, ht + hr);
  const rWall = Math.hypot(d, width, ht - hr);
  const rWallGround = Math.hypot(d, width, ht + hr);
  const paths: RayPath[] = [
    { pathM: rDirect, coeff: 1 },
    { pathM: rGround, coeff: -groundR },
    { pathM: rWall, coeff: -wallR },
    { pathM: rWall, coeff: -wallR },
    { pathM: rWallGround, coeff: groundR * wallR },
    { pathM: rWallGround, coeff: groundR * wallR },
  ];
  return _coherentFieldGainDb(paths, rDirect, freqMHz, 0.001);
}

/**
 * Combine coherent ray fields into a gain/loss relative to the direct
 * free-space path. Each coefficient is a field-amplitude multiplier.
 * @param {Array<{ pathM: number, coeff: number }>} paths
 * @param {number} referencePathM
 * @param {number} freqMHz
 * @param {number} [minPowerRatio]
 * @returns {number}
 */
export function coherentFieldGainDb(
  paths: RayPath[],
  referencePathM: number,
  freqMHz: number,
  minPowerRatio = 0.001
): number {
  return _coherentFieldGainDb(paths, referencePathM, freqMHz, minPowerRatio);
}

/**
 * @typedef {Object} FacadeRay
 * @property {number} lat
 * @property {number} lon
 * @property {number} pathM
 * @property {number} leg1M
 * @property {number} leg2M
 * @property {number} reflectionAbsElevM
 * @property {number} reflectionGroundElevM
 * @property {number} buildingIndex
 * @property {number} edgeIndex
 */

/**
 * Find specular first-order reflections from real building footprint edges.
 * Buildings are treated as finite vertical mirror planes whose height comes
 * from the existing OSM/DSM building-height payload. This is ray optics, not
 * a full-wave EM solver: it traces direct visibility to wall facets and
 * leaves foliage/building attenuation to the caller.
 *
 * @param {Object} args
 * @param {number} args.txLat
 * @param {number} args.txLon
 * @param {number} args.txAbsElevM
 * @param {number} args.rxLat
 * @param {number} args.rxLon
 * @param {number} args.rxAbsElevM
 * @param {{ polygons?: Array<Array<[number, number]>>, bboxes?: Array<{ latMin: number, latMax: number, lonMin: number, lonMax: number }>, heights?: ArrayLike<number>, tileIndex?: { tiles: number[][], latMin: number, latSpan: number, lonMin: number, lonSpan: number } | null } | null} args.buildings
 * @param {ArrayLike<number> | null | undefined} args.elevGrid
 * @param {number} args.elevRes
 * @param {{ latMin: number, latMax: number, lonMin: number, lonMax: number }} args.bounds
 * @param {number} [args.maxRays]
 * @param {number} [args.maxSearchRadiusM]
 * @param {number} [args.maxExtraPathM]
 * @param {number} [args.minFacadeLengthM]
 * @returns {FacadeRay[]}
 */
export function traceBuildingFacadeRays({
  txLat,
  txLon,
  txAbsElevM,
  rxLat,
  rxLon,
  rxAbsElevM,
  buildings,
  elevGrid,
  elevRes,
  bounds,
  maxRays = 16,
  maxSearchRadiusM,
  maxExtraPathM,
  minFacadeLengthM = 3,
}: TraceBuildingFacadeRaysArgs): FacadeRay[] {
  const polygons = buildings?.polygons;
  if (!polygons || polygons.length === 0) return [];
  const directHorizM = haversine(txLat, txLon, rxLat, rxLon);
  if (!Number.isFinite(directHorizM) || directHorizM <= 0) return [];

  const searchRadiusM = Number.isFinite(maxSearchRadiusM)
    ? Math.max(10, Number(maxSearchRadiusM))
    : Math.min(250, Math.max(50, directHorizM * 0.2));
  const extraPathLimitM = Number.isFinite(maxExtraPathM)
    ? Math.max(0, Number(maxExtraPathM))
    : Math.min(600, Math.max(80, directHorizM * 0.35));
  const lat0 = (txLat + rxLat) / 2;
  const lon0 = (txLon + rxLon) / 2;
  const basis = _localBasis(lat0, lon0);
  const tx = _toLocal(txLat, txLon, basis);
  const rx = _toLocal(rxLat, rxLon, basis);
  const inflateLat = searchRadiusM / 111320;
  const cosLat = Math.max(0.05, Math.abs(Math.cos(lat0 * Math.PI / 180)));
  const inflateLon = searchRadiusM / (111320 * cosLat);
  const qLatMin = Math.min(txLat, rxLat) - inflateLat;
  const qLatMax = Math.max(txLat, rxLat) + inflateLat;
  const qLonMin = Math.min(txLon, rxLon) - inflateLon;
  const qLonMax = Math.max(txLon, rxLon) + inflateLon;
  const candidateIndices = _polygonCandidatesForBbox(
    buildings.tileIndex ?? null,
    buildings.bboxes ?? [],
    qLatMin,
    qLatMax,
    qLonMin,
    qLonMax,
    polygons.length
  );
  const rays: FacadeRay[] = [];

  for (const buildingIndex of candidateIndices) {
    const poly = polygons[buildingIndex];
    if (!poly || poly.length < 3) continue;
    const heightM = buildings.heights?.[buildingIndex] ?? 5;
    if (!Number.isFinite(heightM) || heightM <= 0) continue;

    for (let edgeIndex = 0; edgeIndex < poly.length; edgeIndex++) {
      const aLL = poly[edgeIndex];
      const bLL = poly[(edgeIndex + 1) % poly.length];
      if (!aLL || !bLL) continue;
      const a = _toLocal(aLL[0], aLL[1], basis);
      const b = _toLocal(bLL[0], bLL[1], basis);
      const wallVec = { x: b.x - a.x, y: b.y - a.y };
      const wallLenM = Math.hypot(wallVec.x, wallVec.y);
      if (wallLenM < minFacadeLengthM) continue;

      const sideTx = _cross(wallVec, { x: tx.x - a.x, y: tx.y - a.y });
      const sideRx = _cross(wallVec, { x: rx.x - a.x, y: rx.y - a.y });
      if (sideTx * sideRx < 0) continue;

      const imageRx = _reflectPointAcrossLine(rx, a, b);
      const hit = _segmentLineIntersection(tx, imageRx, a, b);
      if (!hit) continue;
      const ref = {
        x: tx.x + (imageRx.x - tx.x) * hit.t,
        y: tx.y + (imageRx.y - tx.y) * hit.t,
      };
      const leg1M = Math.hypot(ref.x - tx.x, ref.y - tx.y);
      const leg2M = Math.hypot(rx.x - ref.x, rx.y - ref.y);
      const horizPathM = leg1M + leg2M;
      if (horizPathM - directHorizM > extraPathLimitM) continue;

      const tPath = horizPathM > 0 ? leg1M / horizPathM : 0;
      const reflectionAbsElevM = txAbsElevM + (rxAbsElevM - txAbsElevM) * tPath;
      const ll = _fromLocal(ref.x, ref.y, basis);
      const reflectionGroundElevM = bilinearElev(
        ll.lat,
        ll.lon,
        elevGrid,
        elevRes,
        bounds.latMin,
        bounds.latMax,
        bounds.lonMin,
        bounds.lonMax
      );
      if (reflectionAbsElevM < reflectionGroundElevM) continue;
      if (reflectionAbsElevM > reflectionGroundElevM + heightM) continue;

      const leg1PathM = Math.hypot(leg1M, reflectionAbsElevM - txAbsElevM);
      const leg2PathM = Math.hypot(leg2M, rxAbsElevM - reflectionAbsElevM);
      rays.push({
        lat: ll.lat,
        lon: ll.lon,
        pathM: leg1PathM + leg2PathM,
        leg1M,
        leg2M,
        reflectionAbsElevM,
        reflectionGroundElevM,
        buildingIndex,
        edgeIndex,
      });
    }
  }

  rays.sort((a, b) => a.pathM - b.pathM);
  return rays.slice(0, Math.max(0, Math.floor(maxRays)));
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function _clampUnit(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

/** @param {number} lat0 @param {number} lon0 */
function _localBasis(lat0: number, lon0: number): LocalBasis {
  return {
    lat0,
    lon0,
    mPerDegLat: 111320,
    mPerDegLon: 111320 * Math.max(0.05, Math.abs(Math.cos(lat0 * Math.PI / 180))),
  };
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {{ lat0: number, lon0: number, mPerDegLat: number, mPerDegLon: number }} basis
 */
function _toLocal(lat: number, lon: number, basis: LocalBasis): Point2d {
  return {
    x: (lon - basis.lon0) * basis.mPerDegLon,
    y: (lat - basis.lat0) * basis.mPerDegLat,
  };
}

/**
 * @param {number} x
 * @param {number} y
 * @param {{ lat0: number, lon0: number, mPerDegLat: number, mPerDegLon: number }} basis
 */
function _fromLocal(x: number, y: number, basis: LocalBasis): { lat: number; lon: number } {
  return {
    lat: basis.lat0 + y / basis.mPerDegLat,
    lon: basis.lon0 + x / basis.mPerDegLon,
  };
}

/** @param {{ x: number, y: number }} a @param {{ x: number, y: number }} b */
function _cross(a: Point2d, b: Point2d): number {
  return a.x * b.y - a.y * b.x;
}

/**
 * @param {{ x: number, y: number }} p
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 */
function _reflectPointAcrossLine(p: Point2d, a: Point2d, b: Point2d): Point2d {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0) return p;
  const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  const proj = { x: a.x + vx * t, y: a.y + vy * t };
  return { x: 2 * proj.x - p.x, y: 2 * proj.y - p.y };
}

/**
 * Intersection of p->q and a->b. Returns parameters along both finite segments.
 * @param {{ x: number, y: number }} p
 * @param {{ x: number, y: number }} q
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {{ t: number, u: number } | null}
 */
function _segmentLineIntersection(p: Point2d, q: Point2d, a: Point2d, b: Point2d): SegmentIntersection | null {
  const r = { x: q.x - p.x, y: q.y - p.y };
  const s = { x: b.x - a.x, y: b.y - a.y };
  const denom = _cross(r, s);
  if (Math.abs(denom) < 1e-9) return null;
  const ap = { x: a.x - p.x, y: a.y - p.y };
  const t = _cross(ap, s) / denom;
  const u = _cross(ap, r) / denom;
  if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null;
  return { t, u };
}

/**
 * @param {{ tiles: number[][], latMin: number, latSpan: number, lonMin: number, lonSpan: number } | null} tileIndex
 * @param {Array<{ latMin: number, latMax: number, lonMin: number, lonMax: number }>} bboxes
 * @param {number} latMin
 * @param {number} latMax
 * @param {number} lonMin
 * @param {number} lonMax
 * @param {number} polygonCount
 * @returns {Iterable<number>}
 */
function _polygonCandidatesForBbox(
  tileIndex: TileIndex | null,
  bboxes: Bbox[],
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number,
  polygonCount: number
): Iterable<number> {
  const bboxOverlaps = (i: number): boolean => {
    const bb = bboxes[i];
    if (!bb) return true;
    return !(latMax < bb.latMin || latMin > bb.latMax || lonMax < bb.lonMin || lonMin > bb.lonMax);
  };
  if (!tileIndex || !Array.isArray(tileIndex.tiles) || tileIndex.latSpan === 0 || tileIndex.lonSpan === 0) {
    return Array.from({ length: polygonCount }, (_, i) => i).filter(bboxOverlaps);
  }

  const tileN = Math.max(1, Math.round(Math.sqrt(tileIndex.tiles.length)));
  const rMin = Math.max(0, Math.min(tileN - 1, Math.floor((latMin - tileIndex.latMin) / tileIndex.latSpan * tileN)));
  const rMax = Math.max(0, Math.min(tileN - 1, Math.floor((latMax - tileIndex.latMin) / tileIndex.latSpan * tileN)));
  const cMin = Math.max(0, Math.min(tileN - 1, Math.floor((lonMin - tileIndex.lonMin) / tileIndex.lonSpan * tileN)));
  const cMax = Math.max(0, Math.min(tileN - 1, Math.floor((lonMax - tileIndex.lonMin) / tileIndex.lonSpan * tileN)));
  const set = new Set<number>();
  for (let r = Math.min(rMin, rMax); r <= Math.max(rMin, rMax); r++) {
    for (let c = Math.min(cMin, cMax); c <= Math.max(cMin, cMax); c++) {
      for (const i of tileIndex.tiles[r * tileN + c] ?? []) {
        if (i >= 0 && i < polygonCount && bboxOverlaps(i)) set.add(i);
      }
    }
  }
  return set;
}

/**
 * @param {Array<{ pathM: number, coeff: number }>} paths
 * @param {number} referencePathM
 * @param {number} freqMHz
 * @param {number} minPowerRatio
 */
function _coherentFieldGainDb(paths: RayPath[], referencePathM: number, freqMHz: number, minPowerRatio: number): number {
  const lambda = _getLambda(freqMHz);
  let real = 0;
  let imag = 0;
  for (const ray of paths) {
    if (!Number.isFinite(ray.pathM) || ray.pathM <= 0 || ray.coeff === 0) continue;
    const amp = ray.coeff * (referencePathM / ray.pathM);
    const phase = -2 * Math.PI * (ray.pathM - referencePathM) / lambda;
    real += amp * Math.cos(phase);
    imag += amp * Math.sin(phase);
  }
  const powerRatio = Math.max(minPowerRatio, real * real + imag * imag);
  return 10 * Math.log10(powerRatio);
}

/**
 * Knife-edge diffraction loss as a function of the Fresnel-Kirchhoff
 * parameter v. ITU-R P.526-style approximation.
 * @param {number} v
 */
function _knifeEdgeLossDb(v: number): number {
  if (v <= -0.78) return 0;
  return Math.max(0, 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1));
}

/**
 * Recursive Deygout multi-edge diffraction over the obstacle-height profile
 * between sample indices i0..i1.
 * @param {ArrayLike<number>} obstacleHeights
 * @param {ArrayLike<number>} distsM
 * @param {number} lambdaM
 * @param {number} i0
 * @param {number} i1
 * @param {number} h0
 * @param {number} h1
 * @returns {number}
 */
function _deygoutSectionLoss(
  obstacleHeights: NumericArray,
  distsM: NumericArray,
  lambdaM: number,
  i0: number,
  i1: number,
  h0: number,
  h1: number
): number {
  if (i1 - i0 < 2) return 0;

  const sectionDist = distsM[i1] - distsM[i0];
  if (sectionDist <= 0) return 0;

  let maxV = -Infinity;
  let maxIdx = -1;

  for (let i = i0 + 1; i < i1; i++) {
    const d1 = distsM[i] - distsM[i0];
    const d2 = distsM[i1] - distsM[i];
    if (d1 <= 0 || d2 <= 0) continue;
    const lineH = h0 + (h1 - h0) * (d1 / sectionDist);
    const h = obstacleHeights[i] - lineH;
    const v = h * Math.sqrt(2 * sectionDist / (lambdaM * d1 * d2));
    if (v > maxV) {
      maxV = v;
      maxIdx = i;
    }
  }

  if (maxIdx < 0 || maxV <= -0.78) return 0;

  const mainLoss = _knifeEdgeLossDb(maxV);
  const peakH = obstacleHeights[maxIdx];
  const leftLoss = _deygoutSectionLoss(obstacleHeights, distsM, lambdaM, i0, maxIdx, h0, peakH);
  const rightLoss = _deygoutSectionLoss(obstacleHeights, distsM, lambdaM, maxIdx, i1, peakH, h1);
  return mainLoss + leftLoss + rightLoss;
}

/** @param {number} deg */
function _normalizeAzimuthDeg(deg: number): number {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

/**
 * @param {number} a
 * @param {number} b
 */
function _shortestAngleDiffDeg(a: number, b: number): number {
  const d = Math.abs(_normalizeAzimuthDeg(a) - _normalizeAzimuthDeg(b));
  return d > 180 ? 360 - d : d;
}

/**
 * Initial bearing (azimuth, degrees clockwise from north) from point 1 to
 * point 2 along a great circle.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return _normalizeAzimuthDeg(Math.atan2(y, x) * 180 / Math.PI);
}

/**
 * Off-axis antenna pattern attenuation. Accepts either a built-in pattern
 * key ('omni', 'sector90', 'sector120') or a custom `{hpbwDeg, maxAttenDb}`
 * shape.
 * @param {string | { hpbwDeg?: number, maxAttenDb?: number } | null | undefined} pattern
 * @param {number} boresightDeg
 * @param {number} targetBearingDeg
 * @returns {number}
 */
export function antennaPatternOffsetDb(pattern: AntennaPattern, boresightDeg: number, targetBearingDeg: number): number {
  if (!pattern || pattern === 'omni') return 0;

  const offAxis = _shortestAngleDiffDeg(boresightDeg ?? 0, targetBearingDeg ?? 0);
  if (typeof pattern === 'string') {
    if (pattern === 'sector120') {
      if (offAxis <= 60) return 0;
      if (offAxis <= 90) return -3;
      if (offAxis <= 120) return -10;
      return -20;
    }
    if (pattern === 'sector90') {
      if (offAxis <= 45) return 0;
      if (offAxis <= 70) return -3;
      if (offAxis <= 100) return -10;
      return -20;
    }
    return 0;
  }

  const hpbwDeg = Math.max(1, Number(pattern.hpbwDeg) || 360);
  const maxAttenDb = Math.max(0, Number(pattern.maxAttenDb) || 20);
  const attenDb = Math.min(maxAttenDb, 12 * (offAxis / hpbwDeg) ** 2);
  return -attenDb;
}

/**
 * @typedef {Object} CheckLoSResult
 * @property {boolean} los
 * @property {boolean} geometricLos
 * @property {boolean} fresnelClear
 * @property {number} diffractionLossDb
 * @property {string} diffractionModel
 * @property {number} minClearanceM
 * @property {number} minFresnelClearanceRatio
 */

/**
 * Check LoS along a pre-sampled terrain profile and compute diffraction loss.
 * @param {number} txElevM
 * @param {number} rxElevM
 * @param {ArrayLike<number>} profileElevs
 * @param {number} txHeightM
 * @param {number} rxHeightM
 * @param {number} totalDistM
 * @param {number} freqMHz
 * @param {boolean} useFresnel
 * @param {string} [diffractionModel]
 * @returns {CheckLoSResult}
 */
export function checkLoS(
  txElevM: number,
  rxElevM: number,
  profileElevs: NumericArray,
  txHeightM: number,
  rxHeightM: number,
  totalDistM: number,
  freqMHz: number,
  useFresnel: boolean,
  diffractionModel = 'knife-edge'
): CheckLoSResult {
  const n = profileElevs.length;
  if (n < 2) {
    return {
      los: true,
      geometricLos: true,
      fresnelClear: true,
      diffractionLossDb: 0,
      diffractionModel,
      minClearanceM: Infinity,
      minFresnelClearanceRatio: Infinity,
    };
  }

  const txH  = txElevM + txHeightM;
  const rxH  = rxElevM + rxHeightM;
  const λ    = _getLambda(freqMHz);
  const fracs = _getFracs(n);
  const distsM = new Float64Array(n);
  const obstacleHeights = new Float64Array(n);
  obstacleHeights[0] = txH;
  obstacleHeights[n - 1] = rxH;

  // Earth-curvature correction using effective Earth radius (k = 4/3, standard atmosphere).
  // Adds d1*d2/(2*Re_eff) to each terrain sample, accounting for the planet's curvature
  // over long paths.  At 15 km the peak bulge is ~14 m — significant for marginal links.

  let maxV = -Infinity;
  let minClearanceM = Infinity;
  let minFresnelClearanceRatio = Infinity;

  for (let i = 1; i < n - 1; i++) {
    const d1    = fracs[i] * totalDistM;
    const d2    = totalDistM - d1;
    const lineH = txH + (rxH - txH) * fracs[i];
    const r1    = Math.sqrt(λ * d1 * d2 / totalDistM);
    const bulge = d1 * d2 / (2 * RE_EFF);              // effective terrain rise due to Earth curvature
    const terrainH = profileElevs[i] + bulge;
    distsM[i] = d1;
    obstacleHeights[i] = terrainH;
    const clearanceM = lineH - terrainH;
    const h     = terrainH - lineH;
    const v     = h * Math.sqrt(2 * totalDistM / (λ * d1 * d2));
    if (v > maxV) maxV = v;
    if (clearanceM < minClearanceM) minClearanceM = clearanceM;
    if (r1 > 0) {
      const ratio = clearanceM / r1;
      if (ratio < minFresnelClearanceRatio) minFresnelClearanceRatio = ratio;
    }
  }
  distsM[0] = 0;
  distsM[n - 1] = totalDistM;

  const geometricLos = maxV < 0;
  const fresnelClear = minFresnelClearanceRatio >= 1;
  const los = useFresnel ? fresnelClear : geometricLos;

  if (maxV < -0.7) {
    return {
      los,
      geometricLos,
      fresnelClear,
      diffractionLossDb: 0,
      diffractionModel,
      minClearanceM,
      minFresnelClearanceRatio,
    };
  }

  const singleEdgeLoss = _knifeEdgeLossDb(maxV);
  const deygoutLoss = diffractionModel === 'deygout'
    ? _deygoutSectionLoss(obstacleHeights, distsM, λ, 0, n - 1, txH, rxH)
    : singleEdgeLoss;
  const loss = diffractionModel === 'deygout'
    ? Math.max(singleEdgeLoss, deygoutLoss)
    : singleEdgeLoss;

  return {
    los,
    geometricLos,
    fresnelClear,
    diffractionLossDb: Math.max(0, loss),
    diffractionModel: diffractionModel === 'deygout' && deygoutLoss >= singleEdgeLoss ? 'deygout' : 'knife-edge',
    minClearanceM,
    minFresnelClearanceRatio,
  };
}

/**
 * Pick a sensible sample count for a terrain profile at a given distance.
 * @param {number} distanceM
 * @param {number} [targetSpacingM]
 * @param {number} [minSamples]
 * @param {number} [maxSamples]
 * @returns {number}
 */
export function profileSampleCount(distanceM: number, targetSpacingM = 50, minSamples = 16, maxSamples = 512): number {
  if (!Number.isFinite(distanceM) || distanceM <= 0) return minSamples;
  return Math.max(minSamples, Math.min(maxSamples, Math.ceil(distanceM / targetSpacingM) + 1));
}

/**
 * Earth-curvature bulge in metres at a fractional position along a path of
 * `totalDistM` metres, using the standard k=4/3 effective Earth radius.
 * @param {number} fraction
 * @param {number} totalDistM
 * @returns {number}
 */
export function earthBulgeM(fraction: number, totalDistM: number): number {
  const d1 = fraction * totalDistM;
  const d2 = totalDistM - d1;
  return (d1 > 0 && d2 > 0) ? d1 * d2 / (2 * RE_EFF) : 0;
}

// ─── Shadow fading (log-normal fading) ──────────────────────────────
// Log-normal fading model: L = L_0 + 10n·log10(d) + X_σ
// where X_σ ~ N(0, σ) is Gaussian random variable (in dB)
// Typical σ = 4–8 dB for LoRa links in suburban/urban areas
/**
 * Apply log-normal shadow fading to path loss.
 * @param {number} sigmaDbd - standard deviation of fading (dB); 0 = disabled
 * @param {string | null} [seedKey] - if provided, switches to deterministic mode for stable reruns
 * @returns {number} shadow fading value (dB), normally distributed with mean 0 and std dev σ
 */
export function shadowFadingDb(sigmaDbd: number, seedKey: string | null = null): number {
  if (!Number.isFinite(sigmaDbd) || sigmaDbd <= 0) return 0;

  let u1;
  let u2;
  if (seedKey == null) {
    // Backward-compatible random mode.
    u1 = Math.max(Number.EPSILON, Math.random());
    u2 = Math.random();
  } else {
    // Deterministic mode for stable repeated calculations with unchanged inputs.
    const seedA = _fnv1a32(`${seedKey}|a`);
    const seedB = _fnv1a32(`${seedKey}|b`);
    u1 = Math.max(Number.EPSILON, _unitFromSeed(seedA));
    u2 = _unitFromSeed(seedB);
  }

  // Box-Muller transform: convert two uniform RVs to Gaussian
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return sigmaDbd * z;
}

/** @param {string} text */
function _fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** @param {number} seed */
function _unitFromSeed(seed: number): number {
  // LCG step; returns [0, 1).
  const next = (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
  return next / 4294967296;
}
// ─── FUTURE: Multi-edge diffraction models ──────────────────────────────────────────────────────────────────────────────────────────────
// Current: Deygout multi-edge (primary) + single knife-edge fallback lower bound
// TODO: Rounded obstacle diffraction — smooth transitions for non-sharp peaks
// TODO: Antenna patterns — directional gain (azimuth/elevation masks) per antenna
/** @typedef {Array<[number, number]>} Polygon */

/**
 * Return the [t0, t1] sub-intervals of the line segment (lat1,lon1)→(lat2,lon2)
 * that lie inside the polygon. Each returned interval is in normalised
 * line-parameter space (0 = start point, 1 = end point).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @param {Polygon} poly
 * @returns {Array<[number, number]>}
 */
export function segmentPolygonIntervals(lat1: number, lon1: number, lat2: number, lon2: number, poly: Polygon): Array<[number, number]> {
  if (!poly || poly.length < 3) return [];

  const ts = [0, 1];
  const dx = lon2 - lon1;
  const dy = lat2 - lat1;
  const EPS = 1e-9;

  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [y3, x3] = poly[j];
    const [y4, x4] = poly[i];
    const sx = x4 - x3;
    const sy = y4 - y3;
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < EPS) continue;

    const qpx = x3 - lon1;
    const qpy = y3 - lat1;
    const t = (qpx * sy - qpy * sx) / denom;
    const u = (qpx * dy - qpy * dx) / denom;
    if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) ts.push(t);
  }

  ts.sort((a, b) => a - b);
  const uniq: number[] = [];
  for (const t of ts) {
    if (uniq.length === 0 || Math.abs(t - uniq[uniq.length - 1]) > 1e-6) uniq.push(t);
  }

  const intervals: Array<[number, number]> = [];
  for (let i = 0; i < uniq.length - 1; i++) {
    const a = uniq[i];
    const b = uniq[i + 1];
    if (b - a < EPS) continue;
    const mid = (a + b) / 2;
    const lat = lat1 + (lat2 - lat1) * mid;
    const lon = lon1 + (lon2 - lon1) * mid;
    if (pointInPolygon(lat, lon, poly)) intervals.push([a, b]);
  }
  return intervals;
}

/**
 * Same as `segmentPolygonIntervals` but subtracts any sub-intervals that fall
 * inside one or more holes (interior rings of a multipolygon).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @param {Polygon} poly
 * @param {Polygon[]} [holes]
 * @returns {Array<[number, number]>}
 */
export function segmentPolygonIntervalsWithHoles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  poly: Polygon,
  holes: Polygon[] = []
): Array<[number, number]> {
  let intervals = segmentPolygonIntervals(lat1, lon1, lat2, lon2, poly);
  if (!intervals.length || !Array.isArray(holes) || holes.length === 0) return intervals;

  for (const hole of holes) {
    const holeIntervals = segmentPolygonIntervals(lat1, lon1, lat2, lon2, hole);
    if (!holeIntervals.length) continue;
    intervals = _subtractIntervals(intervals, holeIntervals);
    if (!intervals.length) break;
  }
  return intervals;
}

/**
 * @param {Array<[number, number]>} intervals
 * @param {Array<[number, number]>} cuts
 * @returns {Array<[number, number]>}
 */
function _subtractIntervals(intervals: Array<[number, number]>, cuts: Array<[number, number]>): Array<[number, number]> {
  let out = intervals;
  for (const [cutA, cutB] of cuts) {
    const next: Array<[number, number]> = [];
    for (const [a, b] of out) {
      if (cutB <= a || cutA >= b) {
        next.push([a, b]);
        continue;
      }
      if (cutA > a) next.push([a, Math.min(cutA, b)]);
      if (cutB < b) next.push([Math.max(cutB, a), b]);
    }
    out = next;
  }
  return out;
}


// P6: write directly into a Uint8ClampedArray — avoids one [r,g,b,a] allocation per pixel
// Gradient stops: [normalised 0-1, r, g, b, alpha]
// 0 = at rxSens (threshold), 1 = strong signal (cap at -70 dBm)
const GRAD: ReadonlyArray<GradientStop> = [
  [0.00, 220,  40,   0, 120],  // red-orange  — just above threshold
  [0.25, 255, 160,   0, 145],  // amber
  [0.50, 230, 220,   0, 155],  // yellow
  [0.75,  80, 210,  30, 165],  // yellow-green
  [1.00,   0, 200,  90, 180],  // green       — strong signal
];

/**
 * Write a single RGBA pixel into a coverage heatmap buffer.
 * @param {Uint8ClampedArray} buf  - ImageData buffer
 * @param {number}            base - byte offset (idx * 4)
 * @param {number}            sigDbm
 * @param {number}            rxSens
 */
export function writePixel(buf: Uint8ClampedArray, base: number, sigDbm: number, rxSens: number): void {
  if (sigDbm < rxSens) {
    // Below threshold — dark red, semi-transparent
    buf[base]=70; buf[base+1]=0; buf[base+2]=0; buf[base+3]=70;
    return;
  }
  const CAP = rxSens + 50;                    // map [rxSens … rxSens+50 dB] → [0 … 1]
  const t = Math.min(1, (sigDbm - rxSens) / (CAP - rxSens));

  // Find which segment t falls in
  let i = 1;
  while (i < GRAD.length - 1 && t > GRAD[i][0]) i++;
  const lo = GRAD[i - 1], hi = GRAD[i];
  const f = (t - lo[0]) / (hi[0] - lo[0]);

  buf[base]   = Math.round(lo[1] + f * (hi[1] - lo[1]));
  buf[base+1] = Math.round(lo[2] + f * (hi[2] - lo[2]));
  buf[base+2] = Math.round(lo[3] + f * (hi[3] - lo[3]));
  buf[base+3] = Math.round(lo[4] + f * (hi[4] - lo[4]));
}

// ─── Bilinear elevation interpolation ───────────────────────────
/**
 * Sample a flat row-major elevation grid at an arbitrary lat/lon using bilinear interpolation.
 * @param {number} lat
 * @param {number} lon
 * @param {ArrayLike<number> | null | undefined} grid  - flat [row * res + col] elevation array
 * @param {number} res     - grid resolution (same for rows and cols)
 * @param {number} latMin
 * @param {number} latMax
 * @param {number} lonMin
 * @param {number} lonMax
 * @returns {number} interpolated elevation (m)
 */
export function bilinearElev(
  lat: number,
  lon: number,
  grid: NumericArray | null | undefined,
  res: number,
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number
): number {
  if (!grid || res <= 1) return grid?.[0] ?? 0;
  const latSpan = latMax - latMin;
  const lonSpan = lonMax - lonMin;
  if (latSpan === 0 || lonSpan === 0) return grid[0] ?? 0;
  const fractions = clampedGridFractions(lat, lon, { latMin, latMax, lonMin, lonMax });
  const cFrac = fractions.col * (res - 1);
  const rFrac = fractions.row * (res - 1);
  const c0 = Math.max(0, Math.min(res - 2, Math.floor(cFrac)));
  const r0 = Math.max(0, Math.min(res - 2, Math.floor(rFrac)));
  const tc = cFrac - c0, tr = rFrac - r0;
  return grid[r0*res+c0]*(1-tc)*(1-tr)
       + grid[r0*res+c0+1]*tc*(1-tr)
       + grid[(r0+1)*res+c0]*(1-tc)*tr
       + grid[(r0+1)*res+c0+1]*tc*tr;
}

// ─── Point-in-polygon (lat/lon) ──────────────────────────────────
/**
 * Ray-casting point-in-polygon test for a [lat, lon] polygon.
 * @param {number} lat
 * @param {number} lon
 * @param {Array<[number,number]>} poly - array of [lat, lon] vertex pairs
 * @returns {boolean}
 */
export function pointInPolygon(lat: number, lon: number, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
