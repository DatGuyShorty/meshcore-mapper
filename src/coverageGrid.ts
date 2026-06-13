import { clampLat } from './osmGeometry.js';

export type Bbox = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

export type ElevationGridPoint = {
  latitude: number;
  longitude: number;
};

/**
 * Compute a degree-space bounding box around a repeater for a given
 * analysis radius. Handles the polar singularity where `cos(lat)` is
 * near zero by widening to a full longitude band.
 */
export function coverageBbox(rep: { lat: number; lon: number }, radiusKm: number): Bbox {
  const degPerKmLat = 1 / 110.574;
  const lat = clampLat(rep.lat) ?? 0;
  const lon = Number(rep.lon);
  const radius = Number.isFinite(Number(radiusKm)) && Number(radiusKm) > 0 ? Number(radiusKm) : 0;
  const latMin = clampLat(lat - radius * degPerKmLat) as number;
  const latMax = clampLat(lat + radius * degPerKmLat) as number;
  const cosLat = Math.cos(lat * Math.PI / 180);
  if (!Number.isFinite(lon) || Math.abs(cosLat) < 1e-6) {
    return { latMin, latMax, lonMin: -180, lonMax: 180 };
  }
  const degPerKmLon = 1 / (111.320 * cosLat);
  return {
    latMin,
    latMax,
    lonMin: lon - radius * degPerKmLon,
    lonMax: lon + radius * degPerKmLon,
  };
}

/**
 * Union of one or more bboxes. Throws if the input is empty so callers
 * fail loudly rather than producing an `Infinity`/`-Infinity` bbox.
 */
export function unionBbox(bboxes: Bbox[]): Bbox {
  if (!Array.isArray(bboxes) || bboxes.length === 0) {
    throw new Error('unionBbox requires at least one bounding box');
  }
  return {
    latMin: Math.min(...bboxes.map(b => b.latMin)),
    latMax: Math.max(...bboxes.map(b => b.latMax)),
    lonMin: Math.min(...bboxes.map(b => b.lonMin)),
    lonMax: Math.max(...bboxes.map(b => b.lonMax)),
  };
}

/**
 * Choose terrain-grid target spacing and max resolution from coverage grid size.
 */
export function elevationGridShape(gridRes: number, radiusKm: number): { elevTargetM: number; ELEV_RES: number } {
  const elevTargetM = gridRes >= 384 ? 50 : gridRes >= 256 ? 75 : gridRes >= 128 ? 120 : 180;
  const maxRes = gridRes >= 384 ? 512 : gridRes >= 256 ? 384 : 256;
  return {
    elevTargetM,
    ELEV_RES: Math.min(Math.ceil(radiusKm * 2000 / elevTargetM), maxRes),
  };
}

/**
 * Generate a flat row-major array of lat/lon points sampling a bbox at
 * ELEV_RES by ELEV_RES resolution. Latitude decreases with row index so
 * `[0]` is the north-west corner.
 */
export function buildElevationGridPoints({
  latMin,
  latMax,
  lonMin,
  lonMax,
  ELEV_RES,
}: Bbox & { ELEV_RES: number }): ElevationGridPoint[] {
  const points = new Array<ElevationGridPoint>(ELEV_RES * ELEV_RES);
  let i = 0;
  for (let r = 0; r < ELEV_RES; r++) {
    const rowFrac = ELEV_RES > 1 ? r / (ELEV_RES - 1) : 0;
    const latitude = latMax - rowFrac * (latMax - latMin);
    for (let c = 0; c < ELEV_RES; c++) {
      const colFrac = ELEV_RES > 1 ? c / (ELEV_RES - 1) : 0;
      points[i++] = {
        latitude,
        longitude: lonMin + colFrac * (lonMax - lonMin),
      };
    }
  }
  return points;
}
