const MAX_WORKERS = 8;

export function createCoverageWorkerPoolJob(payload, { workerCount = 0, onProgress = null } = {}) {
  const gridRes = payload.gridRes;
  const totalPixels = gridRes * gridRes;
  if (!Number.isFinite(totalPixels) || totalPixels <= 0) {
    throw new Error(`Invalid grid resolution: ${gridRes}`);
  }
  if (totalPixels > 256_000_000) {
    throw new Error(`Grid too large (${gridRes}x${gridRes}) for CPU workers. Use Python CUDA or reduce quality.`);
  }
  const bands = buildCoverageWorkerBands(gridRes, workerCount);
  const count = bands.length;
  const workers = new Set();
  const bandProgress = new Map();
  const rgba = new Uint8ClampedArray(gridRes * gridRes * 4);
  const stats = {
    workerCount: count,
    workerComputeMs: 0,
    insidePoints: 0,
    totalPoints: gridRes * gridRes,
    sharedGridBuffer: false,
  };
  const sharedGridElevsBuffer = _sharedGridBuffer(payload.gridElevs);
  if (sharedGridElevsBuffer) stats.sharedGridBuffer = true;

  let settled = false;
  let completed = 0;
  let rejectRun = null;

  const promise = new Promise((resolve, reject) => {
    rejectRun = reject;

    for (const { rowStart, rowEnd } of bands) {
      const worker = new Worker(new URL('./coverageWorker.js', import.meta.url), { type: 'module' });
      workers.add(worker);
      bandProgress.set(rowStart, 0);

      worker.onmessage = ({ data: msg }) => {
        if (settled) return;
        if (msg.type === 'progress') {
          bandProgress.set(msg.rowStart, msg.pct);
          if (onProgress) onProgress(_weightedProgress(bandProgress, bands, gridRes));
          return;
        }

        if (msg.type === 'done') {
          workers.delete(worker);
          worker.terminate();
          bandProgress.set(msg.rowStart, 1);
          const band = new Uint8ClampedArray(msg.rgbaBuffer);
          rgba.set(band, msg.rowStart * gridRes * 4);
          stats.workerComputeMs += msg.stats?.computeMs ?? 0;
          stats.insidePoints += msg.stats?.insidePoints ?? 0;
          completed++;
          if (onProgress) onProgress(_weightedProgress(bandProgress, bands, gridRes));
          if (completed === count) {
            settled = true;
            resolve({ rgba, stats });
          }
        }
      };

      worker.onerror = (err) => {
        if (settled) return;
        settled = true;
        _terminateAll(workers);
        reject(new Error(`Coverage worker error: ${err.message}`));
      };

      const gridElevsBuffer = sharedGridElevsBuffer ?? _copyGridBuffer(payload.gridElevs);
      worker.postMessage({
        ...payload,
        gridElevs: gridElevsBuffer,
        rowStart,
        rowEnd,
      }, sharedGridElevsBuffer ? [] : [gridElevsBuffer]);
    }
  });

  return {
    promise,
    workerCount: count,
    cancel() {
      if (settled) return;
      settled = true;
      _terminateAll(workers);
      const err = new Error('Cancelled');
      err.cancelled = true;
      rejectRun?.(err);
    },
  };
}

export function buildCoverageWorkerBands(gridRes, workerCount = 0, hardwareConcurrency = null) {
  const hardware = hardwareConcurrency ?? (
    typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 2
  );
  const requestedWorkers = workerCount || hardware || 2;
  const targetCount = Math.max(1, Math.min(MAX_WORKERS, requestedWorkers, gridRes));
  const rowsPerWorker = Math.ceil(gridRes / targetCount);
  const bands = [];
  for (let wi = 0; wi < targetCount; wi++) {
    const rowStart = wi * rowsPerWorker;
    const rowEnd = Math.min(gridRes, rowStart + rowsPerWorker);
    if (rowStart < rowEnd) bands.push({ rowStart, rowEnd });
  }
  return bands;
}

function _sharedGridBuffer(gridElevs) {
  if (typeof SharedArrayBuffer === 'undefined') return null;
  try {
    const source = gridElevs instanceof Float32Array ? gridElevs : new Float32Array(gridElevs);
    const shared = new SharedArrayBuffer(source.byteLength);
    new Float32Array(shared).set(source);
    return shared;
  } catch {
    return null;
  }
}

function _copyGridBuffer(gridElevs) {
  if (gridElevs instanceof Float32Array) {
    return gridElevs.buffer.slice(gridElevs.byteOffset, gridElevs.byteOffset + gridElevs.byteLength);
  }
  return gridElevs.buffer.slice(0);
}

function _weightedProgress(progressByRowStart, bands, gridRes) {
  let doneRows = 0;
  for (const { rowStart, rowEnd } of bands) {
    const pct = progressByRowStart.get(rowStart) ?? 0;
    doneRows += (rowEnd - rowStart) * pct;
  }
  return Math.max(0, Math.min(1, doneRows / gridRes));
}

function _terminateAll(workers) {
  for (const worker of workers) worker.terminate();
  workers.clear();
}
