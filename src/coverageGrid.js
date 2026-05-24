export function coverageBbox(rep, radiusKm) {
  const degPerKmLat = 1 / 110.574;
  const degPerKmLon = 1 / (111.320 * Math.cos(rep.lat * Math.PI / 180));
  return {
    latMin: rep.lat - radiusKm * degPerKmLat,
    latMax: rep.lat + radiusKm * degPerKmLat,
    lonMin: rep.lon - radiusKm * degPerKmLon,
    lonMax: rep.lon + radiusKm * degPerKmLon,
  };
}

export function unionBbox(bboxes) {
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

export function elevationGridShape(gridRes, radiusKm) {
  const elevTargetM = gridRes >= 384 ? 50 : gridRes >= 256 ? 75 : gridRes >= 128 ? 120 : 180;
  const maxRes = gridRes >= 384 ? 512 : gridRes >= 256 ? 384 : 256;
  return {
    elevTargetM,
    ELEV_RES: Math.min(Math.ceil(radiusKm * 2000 / elevTargetM), maxRes),
  };
}

export function buildElevationGridPoints({ latMin, latMax, lonMin, lonMax, ELEV_RES }) {
  const points = new Array(ELEV_RES * ELEV_RES);
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
