export const MAX_CUDA_GRID_RES = 4096;
export const MAX_CUDA_ELEV_RES = 4096;
export const MAX_CUDA_OPTIMIZER_EVAL_RES = 1024;
export const MAX_CUDA_OPTIMIZER_CANDIDATES = 100000;
export const MAX_CUDA_OPTIMIZER_SIGNAL_CELLS = 50000000;
export const MAX_CUDA_OBSTACLE_VERTICES = 6000000;
export const MAX_CUDA_OBSTACLE_PACKED_BYTES = 512 * 1024 * 1024;
export const MAX_CUDA_TILE_CELLS = 1000000;
export const MAX_CUDA_TILE_INDICES = 8000000;

export type AnyRecord = Record<string, any>;

export type SerializedTileIndex = {
  latMin: number;
  lonMin: number;
  latSpan: number;
  lonSpan: number;
  tiles: any[][];
};

type PackedSizeArgs = {
  label: string;
  polygons: any[];
  vertexCount: number;
  bboxes: any[];
  heights: any[];
  factors: any[];
  tileIndex: SerializedTileIndex | null;
  holeVertexCount?: number;
};

export type ValidatedCudaCoveragePayload = {
  gridElevs: Float32Array;
  gridRes: number;
  elevRes: number;
};

export type ValidatedCudaOptimizerPayload = {
  opts: AnyRecord;
  txParams: AnyRecord;
  candidates: AnyRecord[];
  candidateCount: number;
  evalRes: number;
  nRepeaters: unknown;
  evalElevs: Float32Array;
  candidateElevs: Float32Array;
  candidateCoords: Float32Array;
  bounds: AnyRecord;
};

export function parseCudaCoveragePayload(payload: AnyRecord): ValidatedCudaCoveragePayload {
  const gridElevs = toFloat32Array(payload?.gridElevs);
  const gridRes = boundedInt(payload?.gridRes, 'gridRes', 1, MAX_CUDA_GRID_RES);
  const elevRes = boundedInt(payload?.ELEV_RES, 'ELEV_RES', 1, MAX_CUDA_ELEV_RES);
  expectLength(gridElevs, elevRes * elevRes, 'gridElevs');
  expectFiniteObject(payload?.rep, 'rep', ['lat', 'lon', 'height', 'power', 'freq']);
  expectFiniteObject(payload, 'coverage payload', [
    'txElev', 'latMin', 'latMax', 'lonMin', 'lonMax',
    'radiusKm', 'rxHeight', 'effectiveSens',
  ]);

  return { gridElevs, gridRes, elevRes };
}

export function parseCudaOptimizerPayload(payload: AnyRecord): ValidatedCudaOptimizerPayload {
  const opts = { ...(payload?.opts ?? {}) };
  const txParams = { ...(payload?.txParams ?? {}) };
  expectFiniteObject(txParams, 'optimizer txParams', ['height', 'power', 'freq']);

  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const candidateCount = candidates.length;
  const evalRes = boundedInt(opts.evalRes, 'optimizer evalRes', 1, MAX_CUDA_OPTIMIZER_EVAL_RES);
  boundedInt(candidateCount, 'optimizer candidate count', 0, MAX_CUDA_OPTIMIZER_CANDIDATES);
  boundedInt(payload?.nRepeaters, 'optimizer repeater count', 1, 64);
  const evalCount = evalRes * evalRes;
  if (candidateCount * evalCount > MAX_CUDA_OPTIMIZER_SIGNAL_CELLS) {
    throw new Error('Optimizer CUDA payload is too large for one GPU scoring pass');
  }

  const evalElevs = toFloat32Array(payload?.evalElevs);
  const candidateElevs = toFloat32Array(payload?.candidateElevs);
  const candidateCoords = candidateCoordsToFloat32(candidates);
  expectLength(evalElevs, evalCount, 'evalElevs');
  if (candidateElevs.length !== candidateCount) {
    throw new Error('Candidate elevation count does not match candidate count');
  }

  const bounds = payload?.bounds ?? {
    latMin: opts.latMin,
    latMax: opts.latMax,
    lonMin: opts.lonMin,
    lonMax: opts.lonMax,
  };
  expectFiniteObject(bounds, 'optimizer bounds', ['latMin', 'latMax', 'lonMin', 'lonMax']);
  expectFiniteObject(opts, 'optimizer opts', ['rxHeight', 'rxSens', 'radiusKm']);

  return {
    opts,
    txParams,
    candidates,
    candidateCount,
    evalRes,
    nRepeaters: payload?.nRepeaters,
    evalElevs,
    candidateElevs,
    candidateCoords,
    bounds,
  };
}

export function toFloat32Array(value: unknown): Float32Array {
  if (value instanceof Float32Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Float32Array(value.buffer, value.byteOffset, Math.floor(value.byteLength / 4));
  }
  if (value instanceof ArrayBuffer) return new Float32Array(value);
  if (Array.isArray(value)) return Float32Array.from(value);
  throw new Error('Invalid gridElevs payload for Python CUDA backend');
}

export function candidateCoordsToFloat32(candidates: AnyRecord[]): Float32Array {
  const out = new Float32Array(candidates.length * 2);
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const lat = Number(c?.latitude ?? c?.lat);
    const lon = Number(c?.longitude ?? c?.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new Error(`Invalid optimizer candidate latitude at index ${i}`);
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new Error(`Invalid optimizer candidate longitude at index ${i}`);
    }
    out[i * 2] = lat;
    out[i * 2 + 1] = lon;
  }
  return out;
}

export function serializeFoliagePayload(foliage: any, label = 'foliage'): AnyRecord | null {
  if (!foliage) return null;
  const { polygons, vertexCount } = validateObstaclePolygons(foliage.polygons, label);
  const bboxes = serializeBboxes(foliage.bboxes);
  const canopyHeights = foliage.canopyHeights ?? [];
  const factors = foliage.factors ?? [];
  const tileIndex = serializeTileIndex(foliage.tileIndex, label);
  const { holes, holeVertexCount } = serializeHoles(foliage.holes, label);
  validateObstaclePackedSize({
    label, polygons, vertexCount, bboxes, heights: canopyHeights, factors, tileIndex, holeVertexCount,
  });
  return {
    polygons,
    bboxes,
    canopyHeights,
    factors,
    tileIndex,
    holes,
  };
}

export function serializeBuildingPayload(buildings: any, label = 'buildings'): AnyRecord | null {
  if (!buildings) return null;
  const { polygons, vertexCount } = validateObstaclePolygons(buildings.polygons, label);
  const bboxes = serializeBboxes(buildings.bboxes);
  const heights = buildings.heights ?? [];
  const tileIndex = serializeTileIndex(buildings.tileIndex, label);
  const { holes, holeVertexCount } = serializeHoles(buildings.holes, label);
  validateObstaclePackedSize({
    label, polygons, vertexCount, bboxes, heights, factors: [], tileIndex, holeVertexCount,
  });
  return {
    polygons,
    bboxes,
    heights,
    tileIndex,
    holes,
  };
}

export function boundedInt(value: unknown, name: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Invalid ${name}: expected integer ${min}-${max}`);
  }
  return n;
}

export function expectLength(array: { length: number }, expected: number, name: string): void {
  if (array.length !== expected) {
    throw new Error(`${name} length mismatch: expected ${expected}, got ${array.length}`);
  }
}

export function expectFiniteObject(value: any, name: string, fields: string[]): void {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid ${name} payload`);
  }
  for (const field of fields) {
    if (!Number.isFinite(Number(value[field]))) {
      throw new Error(`Invalid ${name}.${field}`);
    }
  }
}

function serializeTileIndex(tileIndex: any, label: string): SerializedTileIndex | null {
  if (!tileIndex) return null;
  const rawTiles = Array.isArray(tileIndex.tiles) ? tileIndex.tiles : [];
  if (rawTiles.length > MAX_CUDA_TILE_CELLS) {
    throw new Error(`${label} tile index has too many cells`);
  }
  let totalIndices = 0;
  const tiles = rawTiles.map((cell: any) => {
    const vals = Array.from(cell ?? []);
    totalIndices += vals.length;
    if (totalIndices > MAX_CUDA_TILE_INDICES) {
      throw new Error(`${label} tile index has too many entries`);
    }
    return vals;
  });
  return {
    latMin: tileIndex.latMin,
    lonMin: tileIndex.lonMin,
    latSpan: tileIndex.latSpan,
    lonSpan: tileIndex.lonSpan,
    tiles,
  };
}

function serializeBboxes(bboxes: any): any[] {
  if (!Array.isArray(bboxes)) return [];
  return bboxes.map(bb => [
    bb?.latMin ?? bb?.[0] ?? 0,
    bb?.latMax ?? bb?.[1] ?? 0,
    bb?.lonMin ?? bb?.[2] ?? 0,
    bb?.lonMax ?? bb?.[3] ?? 0,
  ]);
}

function validateObstaclePolygons(polygons: any, label: string): { polygons: any[]; vertexCount: number } {
  if (!Array.isArray(polygons)) return { polygons: [], vertexCount: 0 };
  let vertices = 0;
  for (const poly of polygons) {
    vertices += Array.isArray(poly) ? poly.length : 0;
    if (vertices > MAX_CUDA_OBSTACLE_VERTICES) {
      throw new Error(`${label} has too many polygon vertices`);
    }
  }
  return { polygons, vertexCount: vertices };
}

function serializeHoles(holes: any, label: string): { holes: any[]; holeVertexCount: number } {
  if (!Array.isArray(holes)) return { holes: [], holeVertexCount: 0 };
  let holeVertexCount = 0;
  const out = holes.map((ringList) => {
    if (!Array.isArray(ringList)) return [];
    return ringList.map((ring) => {
      if (!Array.isArray(ring)) return [];
      holeVertexCount += ring.length;
      return ring.map(pt => [pt?.[0] ?? 0, pt?.[1] ?? 0]);
    });
  });
  if (holeVertexCount > MAX_CUDA_OBSTACLE_VERTICES) {
    throw new Error(`${label} has too many hole vertices`);
  }
  return { holes: out, holeVertexCount };
}

function validateObstaclePackedSize({ label, polygons, vertexCount, bboxes, heights, factors, tileIndex, holeVertexCount = 0 }: PackedSizeArgs): void {
  const polygonCount = polygons.length;
  const bboxCount = bboxes.length || polygonCount;
  const heightCount = Math.max(polygonCount, Array.isArray(heights) ? heights.length : 0);
  const factorCount = Math.max(polygonCount, Array.isArray(factors) ? factors.length : 0);
  const tileCells = tileIndex?.tiles?.length ?? 0;
  const tileEntries = tileIndex?.tiles?.reduce((sum, cell) => sum + cell.length, 0) ?? 0;
  const packedBytes =
    vertexCount * 2 * 4
    + (polygonCount + 1) * 4
    + bboxCount * 4 * 4
    + heightCount * 4
    + factorCount * 4
    + tileCells * 2 * 4
    + tileEntries * 4
    + holeVertexCount * 2 * 4;
  if (packedBytes > MAX_CUDA_OBSTACLE_PACKED_BYTES) {
    const mb = (packedBytes / (1024 * 1024)).toFixed(1);
    const capMb = (MAX_CUDA_OBSTACLE_PACKED_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(`${label} payload is too large for CUDA (${mb} MB packed estimate, cap ${capMb} MB)`);
  }
}
