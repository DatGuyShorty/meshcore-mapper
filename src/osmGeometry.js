export const M_PER_LAT = 110574;
export const M_PER_LON = 111320;

export const TILE_SIZE_DEG = 0.25;

export function clampLat(lat) {
  const n = Number(lat);
  if (!Number.isFinite(n)) return null;
  return Math.max(-90, Math.min(90, n));
}

export function normalizeLon(lon) {
  const n = Number(lon);
  if (!Number.isFinite(n)) return null;
  let wrapped = ((n + 180) % 360 + 360) % 360 - 180;
  if (wrapped === -180 && n > 0) wrapped = 180;
  return wrapped;
}

export function isFiniteLatLon(lat, lon) {
  return Number.isFinite(Number(lat))
    && Number.isFinite(Number(lon))
    && Number(lat) >= -90
    && Number(lat) <= 90
    && Number(lon) >= -180
    && Number(lon) <= 180;
}

export function normalizeBbox(latMin, latMax, lonMin, lonMax) {
  const south = clampLat(Math.min(Number(latMin), Number(latMax)));
  const north = clampLat(Math.max(Number(latMin), Number(latMax)));
  const westRaw = Number(lonMin);
  const eastRaw = Number(lonMax);
  if (south === null || north === null || !Number.isFinite(westRaw) || !Number.isFinite(eastRaw)) return null;
  if (north <= south) return null;
  const span = Math.abs(eastRaw - westRaw);
  if (span >= 360) {
    return { latMin: south, latMax: north, lonMin: -180, lonMax: 180, crossesAntimeridian: false, fullWorldLon: true };
  }
  const west = normalizeLon(westRaw);
  const east = normalizeLon(eastRaw);
  if (west === null || east === null) return null;
  return {
    latMin: south,
    latMax: north,
    lonMin: west,
    lonMax: east,
    crossesAntimeridian: west > east,
    fullWorldLon: false,
  };
}

export function splitAntimeridianBbox(bbox) {
  const normalized = normalizeBbox(bbox?.latMin, bbox?.latMax, bbox?.lonMin, bbox?.lonMax);
  if (!normalized) return [];
  const { latMin, latMax, lonMin, lonMax } = normalized;
  if (normalized.crossesAntimeridian) {
    return [
      { latMin, latMax, lonMin, lonMax: 180 },
      { latMin, latMax, lonMin: -180, lonMax },
    ];
  }
  return [{ latMin, latMax, lonMin, lonMax }];
}

export function tileDescriptorsForBbox(latMin, latMax, lonMin, lonMax, cacheVersion = '', tileSize = TILE_SIZE_DEG) {
  const descriptors = [];
  for (const part of splitAntimeridianBbox({ latMin, latMax, lonMin, lonMax })) {
    for (let la = Math.floor(part.latMin / tileSize) * tileSize; la < part.latMax; la += tileSize) {
      const tileLatMin = Math.max(-90, la);
      const tileLatMax = Math.min(90, la + tileSize);
      if (tileLatMax <= tileLatMin) continue;
      for (let lo = Math.floor(part.lonMin / tileSize) * tileSize; lo < part.lonMax; lo += tileSize) {
        const tileLonMin = Math.max(-180, lo);
        const tileLonMax = Math.min(180, lo + tileSize);
        if (tileLonMax <= tileLonMin) continue;
        descriptors.push({
          la: tileLatMin,
          lo: tileLonMin,
          latMin: tileLatMin,
          latMax: tileLatMax,
          lonMin: tileLonMin,
          lonMax: tileLonMax,
          key: `${cacheVersion}${tileLatMin.toFixed(4)}:${tileLonMin.toFixed(4)}`,
        });
      }
    }
  }
  return descriptors;
}

export function overpassBboxString(tile) {
  return `(${tile.latMin.toFixed(4)},${tile.lonMin.toFixed(4)},${tile.latMax.toFixed(4)},${tile.lonMax.toFixed(4)})`;
}

export function clampUnit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function clampedGridFractions(lat, lon, bounds) {
  const latSpan = bounds.latMax - bounds.latMin;
  const lonSpan = bounds.lonMax - bounds.lonMin;
  if (latSpan === 0 || lonSpan === 0) return { row: 0, col: 0 };
  return {
    row: clampUnit((bounds.latMax - lat) / latSpan),
    col: clampUnit((lon - bounds.lonMin) / lonSpan),
  };
}

function _coordKey(pt) {
  return `${pt[0].toFixed(8)},${pt[1].toFixed(8)}`;
}

function _hashInt(hash, value) {
  let v = value | 0;
  for (let i = 0; i < 4; i++) {
    hash ^= (v >>> (i * 8)) & 0xff;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function isClosedRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return !!first && !!last && first[0] === last[0] && first[1] === last[1];
}

export function ringBBox(ring) {
  let latMin = Infinity;
  let latMax = -Infinity;
  let lonMin = Infinity;
  let lonMax = -Infinity;
  for (const [lat, lon] of ring) {
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
    if (lon < lonMin) lonMin = lon;
    if (lon > lonMax) lonMax = lon;
  }
  return { latMin, latMax, lonMin, lonMax };
}

export function fallbackFeatureId(prefix, ring, bbox) {
  if (bbox) {
    return `${prefix}:bb:${bbox.latMin.toFixed(6)}:${bbox.latMax.toFixed(6)}:${bbox.lonMin.toFixed(6)}:${bbox.lonMax.toFixed(6)}:${ring?.length ?? 0}`;
  }
  if (!ring?.length) return `${prefix}:empty`;
  const first = ring[0];
  const mid = ring[Math.floor(ring.length / 2)] ?? first;
  const last = ring[ring.length - 1] ?? first;
  return `${prefix}:rg:${ring.length}:${first[0].toFixed(6)}:${first[1].toFixed(6)}:${mid[0].toFixed(6)}:${mid[1].toFixed(6)}:${last[0].toFixed(6)}:${last[1].toFixed(6)}`;
}

export function ringFingerprint(ring, bbox = null) {
  let hash = 2166136261;
  hash = _hashInt(hash, ring?.length ?? 0);
  for (const [lat, lon] of ring ?? []) {
    hash = _hashInt(hash, Math.round(lat * 1e7));
    hash = _hashInt(hash, Math.round(lon * 1e7));
  }
  const bb = bbox ?? (ring?.length ? ringBBox(ring) : null);
  if (bb) {
    hash = _hashInt(hash, Math.round(bb.latMin * 1e7));
    hash = _hashInt(hash, Math.round(bb.latMax * 1e7));
    hash = _hashInt(hash, Math.round(bb.lonMin * 1e7));
    hash = _hashInt(hash, Math.round(bb.lonMax * 1e7));
  }
  return `${ring?.length ?? 0}:${(hash >>> 0).toString(16)}`;
}

export function featureDedupeKey(id, ring, bbox = null) {
  return `${id ?? ''}|${ringFingerprint(ring, bbox)}`;
}

export function lineCorridorRings(ring, widthM) {
  if (!Array.isArray(ring) || ring.length < 2 || !Number.isFinite(widthM) || widthM <= 0) return [];
  const half = widthM / 2;
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [lat1, lon1] = ring[i];
    const [lat2, lon2] = ring[i + 1];
    const latMid = (lat1 + lat2) / 2;
    const lonScale = Math.max(1e-6, M_PER_LON * Math.cos(latMid * Math.PI / 180));
    const dx = (lon2 - lon1) * lonScale;
    const dy = (lat2 - lat1) * M_PER_LAT;
    const len = Math.hypot(dx, dy);
    if (len <= 0) continue;
    const nx = -dy / len;
    const ny = dx / len;
    const dLat = (ny * half) / M_PER_LAT;
    const dLon = (nx * half) / lonScale;
    out.push([
      [lat1 + dLat, lon1 + dLon],
      [lat2 + dLat, lon2 + dLon],
      [lat2 - dLat, lon2 - dLon],
      [lat1 - dLat, lon1 - dLon],
    ]);
  }
  return out;
}

export function pointCircleRing(lat, lon, diameterM, sides = 12) {
  const radius = Math.max(0.5, diameterM / 2);
  const latScale = 1 / M_PER_LAT;
  const lonScale = 1 / Math.max(1e-6, M_PER_LON * Math.cos(lat * Math.PI / 180));
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const theta = (i / sides) * 2 * Math.PI;
    ring.push([
      lat + Math.sin(theta) * radius * latScale,
      lon + Math.cos(theta) * radius * lonScale,
    ]);
  }
  ring.push(ring[0]);
  return ring;
}

export function assembleRings(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const pending = [];
  const rings = [];

  for (const segment of segments) {
    if (!Array.isArray(segment) || segment.length < 2) continue;
    const copy = segment.slice();
    if (_coordKey(copy[0]) === _coordKey(copy[copy.length - 1])) {
      rings.push(copy);
    } else {
      pending.push(copy);
    }
  }

  while (pending.length > 0) {
    let ring = pending.shift();
    let extended = true;

    while (extended) {
      extended = false;
      const startKey = _coordKey(ring[0]);
      const endKey = _coordKey(ring[ring.length - 1]);

      for (let i = 0; i < pending.length; i++) {
        const segment = pending[i];
        const segStart = _coordKey(segment[0]);
        const segEnd = _coordKey(segment[segment.length - 1]);

        if (endKey === segStart) {
          ring = ring.concat(segment.slice(1));
          pending.splice(i, 1);
          extended = true;
          break;
        }
        if (endKey === segEnd) {
          ring = ring.concat(segment.slice(0, -1).reverse());
          pending.splice(i, 1);
          extended = true;
          break;
        }
        if (startKey === segEnd) {
          ring = segment.slice(0, -1).concat(ring);
          pending.splice(i, 1);
          extended = true;
          break;
        }
        if (startKey === segStart) {
          ring = segment.slice(1).reverse().concat(ring);
          pending.splice(i, 1);
          extended = true;
          break;
        }
      }
    }

    if (ring.length >= 3 && _coordKey(ring[0]) === _coordKey(ring[ring.length - 1])) {
      ring = ring.slice();
      ring[ring.length - 1] = ring[0];
    }
    rings.push(ring);
  }
  return rings;
}

export function assembleMultipolygon(members, memberGeometry) {
  const outerSegments = [];
  const innerSegments = [];
  for (const member of members ?? []) {
    const role = String(member?.role || 'outer').trim().toLowerCase();
    const geometry = memberGeometry(member);
    if (!geometry || geometry.length < 2) continue;
    const ring = geometry.map(n => [n.lat, n.lon]);
    if (role === 'inner') innerSegments.push(ring);
    else outerSegments.push(ring);
  }
  return {
    outers: assembleRings(outerSegments).filter(r => r.length >= 3),
    holes: assembleRings(innerSegments).filter(r => r.length >= 3),
  };
}

export function holeCandidatesForOuter(outer, holes) {
  if (!Array.isArray(holes) || !holes.length) return [];
  const outerBb = ringBBox(outer);
  return holes.filter(hole => {
    const holeBb = ringBBox(hole);
    return !(holeBb.latMax < outerBb.latMin
      || holeBb.latMin > outerBb.latMax
      || holeBb.lonMax < outerBb.lonMin
      || holeBb.lonMin > outerBb.lonMax);
  });
}
