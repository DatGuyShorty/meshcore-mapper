import { clampedGridFractions } from './osmGeometry.js';

export type Bbox = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

export type LatLonPoint = {
  latitude: number;
  longitude: number;
};

export type LocalPoint = {
  x: number;
  z: number;
};

export type TerrainMetrics = {
  latMid: number;
  lonMid: number;
  widthM: number;
  depthM: number;
};

export type TerrainMeshArrays = TerrainMetrics & {
  positions: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  minElevation: number;
  maxElevation: number;
};

export type SceneStatusKind = 'success' | 'warning';

export type SceneStatus = {
  text: string;
  kind: SceneStatusKind;
};

const M_PER_LAT = 110574;
const M_PER_LON = 111320;

export function boundsFromLeaflet(leafletBounds: {
  getSouth(): number;
  getNorth(): number;
  getWest(): number;
  getEast(): number;
}): Bbox {
  return {
    latMin: leafletBounds.getSouth(),
    latMax: leafletBounds.getNorth(),
    lonMin: leafletBounds.getWest(),
    lonMax: leafletBounds.getEast(),
  };
}

export function buildTerrainGridPoints(bounds: Bbox, res: number): LatLonPoint[] {
  const gridRes = Math.max(2, Math.floor(res));
  const points: LatLonPoint[] = [];
  for (let r = 0; r < gridRes; r++) {
    const rf = gridRes > 1 ? r / (gridRes - 1) : 0;
    const latitude = bounds.latMax - rf * (bounds.latMax - bounds.latMin);
    for (let c = 0; c < gridRes; c++) {
      const cf = gridRes > 1 ? c / (gridRes - 1) : 0;
      points.push({
        latitude,
        longitude: bounds.lonMin + cf * (bounds.lonMax - bounds.lonMin),
      });
    }
  }
  return points;
}

export function terrainMetrics(bounds: Bbox): TerrainMetrics {
  const latMid = (bounds.latMin + bounds.latMax) / 2;
  const lonMid = (bounds.lonMin + bounds.lonMax) / 2;
  const widthM = Math.max(1, Math.abs(bounds.lonMax - bounds.lonMin) * M_PER_LON * Math.cos(latMid * Math.PI / 180));
  const depthM = Math.max(1, Math.abs(bounds.latMax - bounds.latMin) * M_PER_LAT);
  return { latMid, lonMid, widthM, depthM };
}

export function projectLatLonToMeters(lat: number, lon: number, bounds: Bbox): LocalPoint {
  const { latMid, lonMid } = terrainMetrics(bounds);
  return {
    x: (lon - lonMid) * M_PER_LON * Math.cos(latMid * Math.PI / 180),
    z: (latMid - lat) * M_PER_LAT,
  };
}

export function latLonFromMeters(x: number, z: number, bounds: Bbox): { lat: number; lon: number } {
  const { latMid, lonMid } = terrainMetrics(bounds);
  const lonScale = M_PER_LON * Math.cos(latMid * Math.PI / 180);
  return {
    lat: latMid - z / M_PER_LAT,
    lon: lonMid + x / Math.max(1e-6, lonScale),
  };
}

export function boundsCenteredOn(center: { lat?: unknown; lon?: unknown } | null | undefined, referenceBounds: Bbox): Bbox {
  const latSpan = referenceBounds.latMax - referenceBounds.latMin;
  const lonSpan = referenceBounds.lonMax - referenceBounds.lonMin;
  const lat = Number(center?.lat);
  const lon = Number(center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ...referenceBounds };
  return {
    latMin: lat - latSpan / 2,
    latMax: lat + latSpan / 2,
    lonMin: lon - lonSpan / 2,
    lonMax: lon + lonSpan / 2,
  };
}

export function boundsWithTileBuffer(bounds: Bbox, radius = 1): Bbox {
  const tileRadius = Math.max(0, Math.floor(radius));
  const latSpan = bounds.latMax - bounds.latMin;
  const lonSpan = bounds.lonMax - bounds.lonMin;
  return {
    latMin: bounds.latMin - latSpan * tileRadius,
    latMax: bounds.latMax + latSpan * tileRadius,
    lonMin: bounds.lonMin - lonSpan * tileRadius,
    lonMax: bounds.lonMax + lonSpan * tileRadius,
  };
}

export function boundsForTileGrid(bounds: Bbox, columns = 1, rows = columns): Bbox {
  const colCount = Math.max(1, Math.floor(columns));
  const rowCount = Math.max(1, Math.floor(rows));
  const latSpan = bounds.latMax - bounds.latMin;
  const lonSpan = bounds.lonMax - bounds.lonMin;
  const latMid = (bounds.latMin + bounds.latMax) / 2;
  const lonMid = (bounds.lonMin + bounds.lonMax) / 2;
  return {
    latMin: latMid - (latSpan * rowCount) / 2,
    latMax: latMid + (latSpan * rowCount) / 2,
    lonMin: lonMid - (lonSpan * colCount) / 2,
    lonMax: lonMid + (lonSpan * colCount) / 2,
  };
}

export function boundsForFocusPoints(
  points: Array<{ lat?: unknown; lon?: unknown; lng?: unknown }>,
  referenceBounds: Bbox,
): Bbox {
  const valid: Array<{ lat: number; lon: number }> = [];
  for (const point of points ?? []) {
    const lat = Number(point?.lat);
    const lon = Number(point?.lon ?? point?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lon)) valid.push({ lat, lon });
  }
  if (!valid.length) return { ...referenceBounds };
  if (valid.length === 1) return boundsCenteredOn(valid[0], referenceBounds);

  let latMin = Infinity;
  let latMax = -Infinity;
  let lonMin = Infinity;
  let lonMax = -Infinity;
  for (const point of valid) {
    latMin = Math.min(latMin, point.lat);
    latMax = Math.max(latMax, point.lat);
    lonMin = Math.min(lonMin, point.lon);
    lonMax = Math.max(lonMax, point.lon);
  }

  const refLatSpan = Math.max(0.0001, Math.abs(referenceBounds.latMax - referenceBounds.latMin));
  const refLonSpan = Math.max(0.0001, Math.abs(referenceBounds.lonMax - referenceBounds.lonMin));
  const latSpan = Math.max((latMax - latMin) * 1.55, refLatSpan * 0.45, 0.002);
  const lonSpan = Math.max((lonMax - lonMin) * 1.55, refLonSpan * 0.45, 0.002);
  const latMid = (latMin + latMax) / 2;
  const lonMid = (lonMin + lonMax) / 2;
  return {
    latMin: latMid - latSpan / 2,
    latMax: latMid + latSpan / 2,
    lonMin: lonMid - lonSpan / 2,
    lonMax: lonMid + lonSpan / 2,
  };
}

export function isLatLonInsideBounds(lat: number, lon: number, bounds: Bbox, padFraction = 0): boolean {
  const latPad = Math.abs(bounds.latMax - bounds.latMin) * Math.max(0, padFraction);
  const lonPad = Math.abs(bounds.lonMax - bounds.lonMin) * Math.max(0, padFraction);
  return lat >= bounds.latMin - latPad
    && lat <= bounds.latMax + latPad
    && lon >= bounds.lonMin - lonPad
    && lon <= bounds.lonMax + lonPad;
}

export function nodeMarkerMetrics(widthM: number, depthM: number, antennaHeightM: number, verticalScale = 1): {
  radius: number;
  mastHeight: number;
  mastRadius: number;
  ringRadius: number;
  ringTube: number;
} {
  const terrainSize = Math.max(1, Number(widthM) || 1, Number(depthM) || 1);
  const radius = Math.max(28, Math.min(160, terrainSize * 0.012));
  const mastHeight = Math.max(radius * 1.8, Math.max(3, Number(antennaHeightM) || 10) * Math.max(1, verticalScale));
  return {
    radius,
    mastHeight,
    mastRadius: Math.max(3, radius * 0.12),
    ringRadius: radius * 1.55,
    ringTube: Math.max(2, radius * 0.075),
  };
}

export function elevationStats(elevations: ArrayLike<number> | null | undefined): { min: number; max: number; span: number } {
  let min = Infinity;
  let max = -Infinity;
  const arr = elevations ?? [];
  for (let i = 0; i < arr.length; i++) {
    const value = arr[i];
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0, span: 1 };
  return { min, max, span: Math.max(1, max - min) };
}

export function buildTerrainMeshArrays({
  bounds,
  elevations,
  res,
  verticalScale = 1,
}: {
  bounds: Bbox;
  elevations: ArrayLike<number>;
  res: number;
  verticalScale?: number;
}): TerrainMeshArrays {
  const gridRes = Math.max(2, Math.floor(res));
  const expected = gridRes * gridRes;
  if (!elevations || elevations.length !== expected) {
    throw new Error(`Expected ${expected} elevation samples, got ${elevations?.length ?? 0}`);
  }

  const { min, max, span } = elevationStats(elevations);
  const positions = new Float32Array(expected * 3);
  const colors = new Float32Array(expected * 3);
  const uvs = new Float32Array(expected * 2);
  let p = 0;
  let k = 0;
  let u = 0;
  for (let r = 0; r < gridRes; r++) {
    const rf = gridRes > 1 ? r / (gridRes - 1) : 0;
    const lat = bounds.latMax - rf * (bounds.latMax - bounds.latMin);
    for (let c = 0; c < gridRes; c++) {
      const cf = gridRes > 1 ? c / (gridRes - 1) : 0;
      const lon = bounds.lonMin + cf * (bounds.lonMax - bounds.lonMin);
      const elev = elevations[r * gridRes + c];
      const { x, z } = projectLatLonToMeters(lat, lon, bounds);
      positions[p++] = x;
      positions[p++] = (elev - min) * verticalScale;
      positions[p++] = z;

      const t = Math.max(0, Math.min(1, (elev - min) / span));
      const [cr, cg, cb] = terrainColor(t);
      colors[k++] = cr;
      colors[k++] = cg;
      colors[k++] = cb;

      uvs[u++] = cf;
      uvs[u++] = 1 - rf;
    }
  }

  const indices = new Uint32Array((gridRes - 1) * (gridRes - 1) * 6);
  let i = 0;
  for (let r = 0; r < gridRes - 1; r++) {
    for (let c = 0; c < gridRes - 1; c++) {
      const a = r * gridRes + c;
      const b = a + 1;
      const d = (r + 1) * gridRes + c;
      const e = d + 1;
      indices[i++] = a; indices[i++] = d; indices[i++] = b;
      indices[i++] = b; indices[i++] = d; indices[i++] = e;
    }
  }

  return {
    positions,
    colors,
    uvs,
    indices,
    minElevation: min,
    maxElevation: max,
    ...terrainMetrics(bounds),
  };
}

export function sampleTerrainElevation(
  lat: number,
  lon: number,
  { bounds, elevations, res }: { bounds: Bbox; elevations: ArrayLike<number>; res: number },
): number {
  if (!elevations?.length || res <= 1) return 0;
  const latSpan = bounds.latMax - bounds.latMin;
  const lonSpan = bounds.lonMax - bounds.lonMin;
  if (latSpan === 0 || lonSpan === 0) return elevations[0] ?? 0;
  const fractions = clampedGridFractions(lat, lon, bounds);
  const rowF = fractions.row * (res - 1);
  const colF = fractions.col * (res - 1);
  const r0 = Math.max(0, Math.min(res - 2, Math.floor(rowF)));
  const c0 = Math.max(0, Math.min(res - 2, Math.floor(colF)));
  const tr = rowF - r0;
  const tc = colF - c0;
  const a = elevations[r0 * res + c0];
  const b = elevations[r0 * res + c0 + 1];
  const d = elevations[(r0 + 1) * res + c0];
  const e = elevations[(r0 + 1) * res + c0 + 1];
  return a * (1 - tc) * (1 - tr)
    + b * tc * (1 - tr)
    + d * (1 - tc) * tr
    + e * tc * tr;
}

export function format3dSceneStatus({
  res,
  tileCount,
  stats,
  terrainSource = 'dem',
}: {
  res: number;
  tileCount: number;
  stats: { buildings?: number; foliage?: number; nodes?: number; coverage?: number; links?: number };
  terrainSource?: 'dem' | 'preview';
}): SceneStatus {
  const prefix = terrainSource === 'preview'
    ? 'Preview terrain (synthetic; DEM unavailable)'
    : '3D terrain';
  return {
    kind: terrainSource === 'preview' ? 'warning' : 'success',
    text: `${prefix} ${res}x${res} over ${tileCount} tiles; `
      + `${stats.buildings ?? 0} buildings, `
      + `${stats.foliage ?? 0} vegetation areas, `
      + `${stats.nodes ?? 0} nodes, `
      + `${stats.coverage ?? 0} coverage overlays, `
      + `${stats.links ?? 0} links.`,
  };
}

function terrainColor(t: number): [number, number, number] {
  if (t < 0.35) return _mix([0.10, 0.32, 0.18], [0.30, 0.54, 0.24], t / 0.35);
  if (t < 0.72) return _mix([0.30, 0.54, 0.24], [0.60, 0.52, 0.33], (t - 0.35) / 0.37);
  return _mix([0.60, 0.52, 0.33], [0.78, 0.80, 0.76], (t - 0.72) / 0.28);
}

function _mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}
