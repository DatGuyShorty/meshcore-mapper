const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let currentChild = null;

function registerCudaCoverageHandlers(ipcMain, appRoot) {
  const helperPath = path.join(appRoot, 'scripts', 'cuda_coverage.py');

  ipcMain.handle('cuda-coverage-probe', async () => {
    try {
      return await _runPython(helperPath, ['--probe']);
    } catch (err) {
      return { available: false, reason: err.message };
    }
  });

  ipcMain.handle('cuda-coverage-cancel', () => {
    if (currentChild) {
      currentChild.kill();
      currentChild = null;
    }
  });

  ipcMain.handle('cuda-coverage-compute', async (_event, payload) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshcore-cuda-'));
    try {
      const gridPath = path.join(tmpDir, 'grid_elevs.f32');
      const outPath = path.join(tmpDir, 'coverage.rgba');
      const paramsPath = path.join(tmpDir, 'params.json');
      const gridElevs = _toFloat32Array(payload.gridElevs);

      fs.writeFileSync(gridPath, Buffer.from(gridElevs.buffer, gridElevs.byteOffset, gridElevs.byteLength));
      const foliage = _serializeFoliagePayload(payload.foliage);
      const buildings = _serializeBuildingPayload(payload.buildings);
      fs.writeFileSync(paramsPath, JSON.stringify({
        gridPath,
        outPath,
        gridRes: payload.gridRes,
        ELEV_RES: payload.ELEV_RES,
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
        useFoliage: payload.useFoliage,
        useBuildings: payload.useBuildings,
        profileTargetSpacingM: payload.profileTargetSpacingM,
        profileMaxSamples: payload.profileMaxSamples,
        foliage,
        buildings,
      }));

      const result = await _runPython(helperPath, ['--compute', paramsPath]);
      if (!result.ok) return result;

      return {
        ...result,
        rgba: new Uint8Array(fs.readFileSync(outPath)),
      };
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

function _serializeTileIndex(tileIndex) {
  if (!tileIndex) return null;
  const tiles = Array.isArray(tileIndex.tiles)
    ? tileIndex.tiles.map(cell => Array.from(cell ?? []))
    : [];
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

function _serializeFoliagePayload(foliage) {
  if (!foliage) return null;
  return {
    polygons: foliage.polygons ?? [],
    bboxes: _serializeBboxes(foliage.bboxes),
    canopyHeights: foliage.canopyHeights ?? [],
    factors: foliage.factors ?? [],
    tileIndex: _serializeTileIndex(foliage.tileIndex),
  };
}

function _serializeBuildingPayload(buildings) {
  if (!buildings) return null;
  return {
    polygons: buildings.polygons ?? [],
    bboxes: _serializeBboxes(buildings.bboxes),
    heights: buildings.heights ?? [],
    tileIndex: _serializeTileIndex(buildings.tileIndex),
  };
}

function _runPython(helperPath, args) {
  return new Promise((resolve, reject) => {
    const python = process.env.MESHCORE_PYTHON || process.env.PYTHON || 'python';
    const child = spawn(python, [helperPath, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    currentChild = child;
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => {
      if (currentChild === child) currentChild = null;
      reject(err);
    });
    child.on('close', code => {
      if (currentChild === child) currentChild = null;
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Python CUDA helper exited ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim() || '{}'));
      } catch (err) {
        reject(new Error(`Python CUDA helper returned invalid JSON: ${err.message}`));
      }
    });
  });
}

module.exports = { registerCudaCoverageHandlers };
