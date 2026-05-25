const M_PER_LAT = 110574;
const M_PER_LON = 111320;

export function boundsFromLeaflet(leafletBounds) {
  return {
    latMin: leafletBounds.getSouth(),
    latMax: leafletBounds.getNorth(),
    lonMin: leafletBounds.getWest(),
    lonMax: leafletBounds.getEast(),
  };
}

export function buildTerrainGridPoints(bounds, res) {
  const gridRes = Math.max(2, Math.floor(res));
  const points = [];
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

export function terrainMetrics(bounds) {
  const latMid = (bounds.latMin + bounds.latMax) / 2;
  const lonMid = (bounds.lonMin + bounds.lonMax) / 2;
  const widthM = Math.max(1, Math.abs(bounds.lonMax - bounds.lonMin) * M_PER_LON * Math.cos(latMid * Math.PI / 180));
  const depthM = Math.max(1, Math.abs(bounds.latMax - bounds.latMin) * M_PER_LAT);
  return { latMid, lonMid, widthM, depthM };
}

export function projectLatLonToMeters(lat, lon, bounds) {
  const { latMid, lonMid } = terrainMetrics(bounds);
  return {
    x: (lon - lonMid) * M_PER_LON * Math.cos(latMid * Math.PI / 180),
    z: (latMid - lat) * M_PER_LAT,
  };
}

export function elevationStats(elevations) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of elevations ?? []) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0, span: 1 };
  return { min, max, span: Math.max(1, max - min) };
}

export function buildTerrainMeshArrays({ bounds, elevations, res, verticalScale = 1 }) {
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
      uvs[u++] = rf;
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

export function sampleTerrainElevation(lat, lon, { bounds, elevations, res }) {
  if (!elevations?.length || res <= 1) return 0;
  const latSpan = bounds.latMax - bounds.latMin;
  const lonSpan = bounds.lonMax - bounds.lonMin;
  if (latSpan === 0 || lonSpan === 0) return elevations[0] ?? 0;
  const rowF = (bounds.latMax - lat) / latSpan * (res - 1);
  const colF = (lon - bounds.lonMin) / lonSpan * (res - 1);
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

function terrainColor(t) {
  if (t < 0.35) return _mix([0.10, 0.32, 0.18], [0.30, 0.54, 0.24], t / 0.35);
  if (t < 0.72) return _mix([0.30, 0.54, 0.24], [0.60, 0.52, 0.33], (t - 0.35) / 0.37);
  return _mix([0.60, 0.52, 0.33], [0.78, 0.80, 0.76], (t - 0.72) / 0.28);
}

function _mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}
