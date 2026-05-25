const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MAX_CUDA_GRID_RES = 4096;
const MAX_CUDA_ELEV_RES = 4096;
const MAX_CUDA_OPTIMIZER_EVAL_RES = 1024;
const MAX_CUDA_OPTIMIZER_CANDIDATES = 100000;
const MAX_CUDA_OPTIMIZER_SIGNAL_CELLS = 50000000;
const MAX_CUDA_OBSTACLE_VERTICES = 6000000;
const MAX_CUDA_OBSTACLE_PACKED_BYTES = 512 * 1024 * 1024;
const MAX_CUDA_TILE_CELLS = 1000000;
const MAX_CUDA_TILE_INDICES = 8000000;

const currentChildren = {
  probe: null,
  coverage: null,
  optimizer: null,
};

function registerCudaCoverageHandlers(ipcMain, appRoot) {
  const helperPath = path.join(appRoot, 'scripts', 'cuda_coverage.py');

  ipcMain.handle('cuda-coverage-probe', async () => {
    try {
      return await _runPython(helperPath, ['--probe'], { jobKey: 'probe' });
    } catch (err) {
      return { available: false, reason: err.message };
    }
  });

  ipcMain.handle('cuda-coverage-cancel', () => {
    _cancelChild('coverage');
  });

  ipcMain.handle('cuda-optimizer-cancel', () => {
    _cancelChild('optimizer');
  });

  ipcMain.handle('cuda-coverage-compute', async (_event, payload) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshcore-cuda-'));
    try {
      const gridPath = path.join(tmpDir, 'grid_elevs.f32');
      const outPath = path.join(tmpDir, 'coverage.rgba');
      const signalPath = path.join(tmpDir, 'coverage_signal.f32');
      const paramsPath = path.join(tmpDir, 'params.json');
      const gridElevs = _toFloat32Array(payload.gridElevs);
      const gridRes = _boundedInt(payload.gridRes, 'gridRes', 1, MAX_CUDA_GRID_RES);
      const elevRes = _boundedInt(payload.ELEV_RES, 'ELEV_RES', 1, MAX_CUDA_ELEV_RES);
      _expectLength(gridElevs, elevRes * elevRes, 'gridElevs');
      _expectFiniteObject(payload.rep, 'rep', ['lat', 'lon', 'height', 'power', 'freq']);

      fs.writeFileSync(gridPath, Buffer.from(gridElevs.buffer, gridElevs.byteOffset, gridElevs.byteLength));
      const foliage = _serializeFoliagePayload(payload.foliage, 'foliage');
      const buildings = _serializeBuildingPayload(payload.buildings, 'buildings');
      fs.writeFileSync(paramsPath, JSON.stringify({
        gridPath,
        outPath,
        signalPath,
        gridRes,
        ELEV_RES: elevRes,
        rep: payload.rep,
        txElev: payload.txElev,
        latMin: payload.latMin,
        latMax: payload.latMax,
        lonMin: payload.lonMin,
        lonMax: payload.lonMax,
        radiusKm: payload.radiusKm,
        rxHeight: payload.rxHeight,
        effectiveSens: payload.effectiveSens,
        useLos: payload.useLos,
        useFresnel: payload.useFresnel,
        useDeygout: Boolean(payload.useDeygout || payload.diffractionModel === 'deygout'),
        useFoliage: payload.useFoliage,
        useBuildings: payload.useBuildings,
        profileTargetSpacingM: payload.profileTargetSpacingM,
        profileMaxSamples: payload.profileMaxSamples,
        foliage,
        buildings,
      }));

      const result = await _runPython(helperPath, ['--compute', paramsPath], {
        jobKey: 'coverage',
        onProgress: stage => {
          try {
            _event.sender.send('cuda-coverage-progress', stage);
          } catch {
            // Renderer may already be gone/cancelled.
          }
        },
      });
      if (!result.ok) return result;

      return {
        ...result,
        rgba: new Uint8Array(fs.readFileSync(outPath)),
        signalGrid: _readFloat32File(signalPath),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  ipcMain.handle('cuda-optimizer-compute', async (_event, payload) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshcore-cuda-opt-'));
    try {
      const evalElevsPath = path.join(tmpDir, 'eval_elevs.f32');
      const candidateCoordsPath = path.join(tmpDir, 'candidate_coords.f32');
      const candidateElevsPath = path.join(tmpDir, 'candidate_elevs.f32');
      const paramsPath = path.join(tmpDir, 'params.json');

      const opts = { ...(payload.opts ?? {}) };
      const txParams = { ...(payload.txParams ?? {}) };
      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      const candidateCount = candidates.length;
      const evalRes = _boundedInt(opts.evalRes, 'optimizer evalRes', 1, MAX_CUDA_OPTIMIZER_EVAL_RES);
      _boundedInt(candidateCount, 'optimizer candidate count', 0, MAX_CUDA_OPTIMIZER_CANDIDATES);
      _boundedInt(payload.nRepeaters, 'optimizer repeater count', 1, 64);
      const evalCount = evalRes * evalRes;
      if (candidateCount * evalCount > MAX_CUDA_OPTIMIZER_SIGNAL_CELLS) {
        throw new Error('Optimizer CUDA payload is too large for one GPU scoring pass');
      }

      const evalElevs = _toFloat32Array(payload.evalElevs);
      const candidateElevs = _toFloat32Array(payload.candidateElevs);
      const candidateCoords = _candidateCoordsToFloat32(candidates);
      _expectLength(evalElevs, evalCount, 'evalElevs');
      if (candidateElevs.length !== candidateCount) {
        throw new Error('Candidate elevation count does not match candidate count');
      }

      fs.writeFileSync(evalElevsPath, Buffer.from(evalElevs.buffer, evalElevs.byteOffset, evalElevs.byteLength));
      fs.writeFileSync(candidateElevsPath, Buffer.from(candidateElevs.buffer, candidateElevs.byteOffset, candidateElevs.byteLength));
      fs.writeFileSync(candidateCoordsPath, Buffer.from(candidateCoords.buffer, candidateCoords.byteOffset, candidateCoords.byteLength));

      const foliage = _serializeFoliagePayload(opts.foliage, 'optimizer foliage');
      const buildings = _serializeBuildingPayload(opts.buildings, 'optimizer buildings');
      delete opts.foliage;
      delete opts.buildings;

      const bounds = payload.bounds ?? {
        latMin: opts.latMin,
        latMax: opts.latMax,
        lonMin: opts.lonMin,
        lonMax: opts.lonMax,
      };

      fs.writeFileSync(paramsPath, JSON.stringify({
        evalElevsPath,
        candidateCoordsPath,
        candidateElevsPath,
        candidateCount,
        evalRes,
        nRepeaters: payload.nRepeaters,
        txParams,
        opts,
        bounds,
        rxSens: opts.rxSens,
        fadeMargin: opts.fadeMargin,
        foliage,
        buildings,
      }));

      return await _runPython(helperPath, ['--optimize', paramsPath], {
        jobKey: 'optimizer',
        onProgress: stage => {
          try {
            _event.sender.send('cuda-optimizer-progress', stage);
          } catch {
            // Renderer may already be gone/cancelled.
          }
        },
      });
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}

function _toFloat32Array(value) {
  if (value instanceof Float32Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Float32Array(value.buffer, value.byteOffset, Math.floor(value.byteLength / 4));
  }
  if (value instanceof ArrayBuffer) return new Float32Array(value);
  if (Array.isArray(value)) return Float32Array.from(value);
  throw new Error('Invalid gridElevs payload for Python CUDA backend');
}

function _readFloat32File(filePath) {
  const bytes = fs.readFileSync(filePath);
  const view = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  return new Float32Array(view);
}

function _candidateCoordsToFloat32(candidates) {
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

function _serializeTileIndex(tileIndex, label) {
  if (!tileIndex) return null;
  const rawTiles = Array.isArray(tileIndex.tiles) ? tileIndex.tiles : [];
  if (rawTiles.length > MAX_CUDA_TILE_CELLS) {
    throw new Error(`${label} tile index has too many cells`);
  }
  let totalIndices = 0;
  const tiles = rawTiles.map(cell => {
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

function _serializeBboxes(bboxes) {
  if (!Array.isArray(bboxes)) return [];
  return bboxes.map(bb => [
    bb?.latMin ?? bb?.[0] ?? 0,
    bb?.latMax ?? bb?.[1] ?? 0,
    bb?.lonMin ?? bb?.[2] ?? 0,
    bb?.lonMax ?? bb?.[3] ?? 0,
  ]);
}

function _validateObstaclePolygons(polygons, label) {
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

function _serializeFoliagePayload(foliage, label = 'foliage') {
  if (!foliage) return null;
  const { polygons, vertexCount } = _validateObstaclePolygons(foliage.polygons, label);
  const bboxes = _serializeBboxes(foliage.bboxes);
  const canopyHeights = foliage.canopyHeights ?? [];
  const factors = foliage.factors ?? [];
  const tileIndex = _serializeTileIndex(foliage.tileIndex, label);
  _validateObstaclePackedSize({
    label, polygons, vertexCount, bboxes, heights: canopyHeights, factors, tileIndex,
  });
  return {
    polygons,
    bboxes,
    canopyHeights,
    factors,
    tileIndex,
  };
}

function _serializeBuildingPayload(buildings, label = 'buildings') {
  if (!buildings) return null;
  const { polygons, vertexCount } = _validateObstaclePolygons(buildings.polygons, label);
  const bboxes = _serializeBboxes(buildings.bboxes);
  const heights = buildings.heights ?? [];
  const tileIndex = _serializeTileIndex(buildings.tileIndex, label);
  _validateObstaclePackedSize({
    label, polygons, vertexCount, bboxes, heights, factors: [], tileIndex,
  });
  return {
    polygons,
    bboxes,
    heights,
    tileIndex,
  };
}

function _validateObstaclePackedSize({ label, polygons, vertexCount, bboxes, heights, factors, tileIndex }) {
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
    + tileEntries * 4;
  if (packedBytes > MAX_CUDA_OBSTACLE_PACKED_BYTES) {
    const mb = (packedBytes / (1024 * 1024)).toFixed(1);
    const capMb = (MAX_CUDA_OBSTACLE_PACKED_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(`${label} payload is too large for CUDA (${mb} MB packed estimate, cap ${capMb} MB)`);
  }
}

function _runPython(helperPath, args, { jobKey = 'probe', onProgress = null } = {}) {
  return new Promise((resolve, reject) => {
    if (currentChildren[jobKey]) {
      reject(new Error(`Python CUDA ${jobKey} job already running`));
      return;
    }
    const python = process.env.MESHCORE_PYTHON || process.env.PYTHON || 'python';
    const child = spawn(python, [helperPath, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    currentChildren[jobKey] = child;
    let stdout = '';
    let lastMessage = null;
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg?.type === 'progress') {
            onProgress?.(msg);
          } else {
            lastMessage = msg;
          }
        } catch {
          // Ignore non-JSON progress noise, final parse handles strict return.
        }
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => {
      if (currentChildren[jobKey] === child) currentChildren[jobKey] = null;
      reject(err);
    });
    child.on('close', code => {
      if (currentChildren[jobKey] === child) currentChildren[jobKey] = null;
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Python CUDA helper exited ${code}`));
        return;
      }
      try {
        const trailing = stdout.trim();
        if (trailing) {
          const msg = JSON.parse(trailing);
          if (msg?.type === 'progress') {
            onProgress?.(msg);
          } else {
            lastMessage = msg;
          }
        }
        resolve(lastMessage ?? {});
      } catch (err) {
        reject(new Error(`Python CUDA helper returned invalid JSON: ${err.message}`));
      }
    });
  });
}

function _cancelChild(jobKey) {
  const child = currentChildren[jobKey];
  if (!child) return;
  child.kill();
  currentChildren[jobKey] = null;
}

function _boundedInt(value, name, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Invalid ${name}: expected integer ${min}-${max}`);
  }
  return n;
}

function _expectLength(array, expected, name) {
  if (array.length !== expected) {
    throw new Error(`${name} length mismatch: expected ${expected}, got ${array.length}`);
  }
}

function _expectFiniteObject(value, name, fields) {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid ${name} payload`);
  }
  for (const field of fields) {
    if (!Number.isFinite(Number(value[field]))) {
      throw new Error(`Invalid ${name}.${field}`);
    }
  }
}

module.exports = { registerCudaCoverageHandlers };
