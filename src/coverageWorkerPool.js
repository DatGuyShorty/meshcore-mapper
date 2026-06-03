// @ts-check
const MAX_WORKERS = 8;

/**
 * @typedef {Object} CoverageBand
 * @property {number} rowStart
 * @property {number} rowEnd
 *
 * @typedef {Object} CoverageWorkerStats
 * @property {number} workerCount
 * @property {number} workerComputeMs
 * @property {number} insidePoints
 * @property {number} totalPoints
 * @property {boolean} sharedGridBuffer
 *
 * @typedef {Object} CoverageWorkerResult
 * @property {Uint8ClampedArray} rgba
 * @property {Float32Array} signalGrid
 * @property {Float32Array} losGrid
 * @property {CoverageWorkerStats} stats
 *
 * @typedef {Object} CoverageWorkerJob
 * @property {Promise<CoverageWorkerResult>} promise
 * @property {number} workerCount
 * @property {() => void} cancel
 */

/**
 * @param {{ gridRes: number, gridElevs: Float32Array | ArrayBufferLike } & Record<string, any>} payload
 * @param {{ workerCount?: number, onProgress?: ((p: number) => void) | null }} [opts]
 * @returns {CoverageWorkerJob}
 */
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
  /** @type {Set<Worker>} */
  const workers = new Set();
  /** @type {Map<number, number>} */
  const bandProgress = new Map();
  const rgba = new Uint8ClampedArray(gridRes * gridRes * 4);
  const signalGrid = new Float32Array(gridRes * gridRes);
  const losGrid = new Float32Array(gridRes * gridRes);
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
  /** @type {((err: any) => void) | null} */
  let rejectRun = null;

  /** @type {Promise<CoverageWorkerResult>} */
  const promise = new Promise((resolve, reject) => {
    rejectRun = reject;

    for (const { rowStart, rowEnd } of bands) {
      const worker = new Worker(new URL('./coverageWorker.js', import.meta.url), { type: 'module' });
      workers.add(worker);
      bandProgress.set(rowStart, 0);

      worker.onmessage = (/** @type {MessageEvent<any>} */ { data: msg }) => {
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
          const signalBand = new Float32Array(msg.signalBuffer);
          signalGrid.set(signalBand, msg.rowStart * gridRes);
          if (msg.losBuffer) {
            losGrid.set(new Float32Array(msg.losBuffer), msg.rowStart * gridRes);
          }
          stats.workerComputeMs += msg.stats?.computeMs ?? 0;
          stats.insidePoints += msg.stats?.insidePoints ?? 0;
          completed++;
          if (onProgress) onProgress(_weightedProgress(bandProgress, bands, gridRes));
          if (completed === count) {
            settled = true;
            resolve({ rgba, signalGrid, losGrid, stats });
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
      const err = /** @type {Error & { cancelled?: boolean }} */ (new Error('Cancelled'));
      err.cancelled = true;
      rejectRun?.(err);
    },
  };
}

/**
 * @param {number} gridRes
 * @param {number} [workerCount]
 * @param {number | null} [hardwareConcurrency]
 * @returns {CoverageBand[]}
 */
export function buildCoverageWorkerBands(gridRes, workerCount = 0, hardwareConcurrency = null) {
  const hardware = hardwareConcurrency ?? (
    typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 2
  );
  const requestedWorkers = workerCount || hardware || 2;
  const targetCount = Math.max(1, Math.min(MAX_WORKERS, requestedWorkers, gridRes));
  const rowsPerWorker = Math.ceil(gridRes / targetCount);
  /** @type {CoverageBand[]} */
  const bands = [];
  for (let wi = 0; wi < targetCount; wi++) {
    const rowStart = wi * rowsPerWorker;
    const rowEnd = Math.min(gridRes, rowStart + rowsPerWorker);
    if (rowStart < rowEnd) bands.push({ rowStart, rowEnd });
  }
  return bands;
}

/** @param {Float32Array | ArrayBufferLike} gridElevs */
function _sharedGridBuffer(gridElevs) {
  if (typeof SharedArrayBuffer === 'undefined') return null;
  try {
    const source = gridElevs instanceof Float32Array
      ? gridElevs
      : new Float32Array(/** @type {ArrayBufferLike} */ (gridElevs));
    const shared = new SharedArrayBuffer(source.byteLength);
    new Float32Array(shared).set(source);
    return shared;
  } catch {
    return null;
  }
}

/** @param {Float32Array | ArrayBufferLike} gridElevs */
function _copyGridBuffer(gridElevs) {
  if (gridElevs instanceof Float32Array) {
    return /** @type {ArrayBuffer} */ (gridElevs.buffer).slice(gridElevs.byteOffset, gridElevs.byteOffset + gridElevs.byteLength);
  }
  return /** @type {ArrayBuffer} */ (gridElevs).slice(0);
}

/**
 * @param {Map<number, number>} progressByRowStart
 * @param {CoverageBand[]} bands
 * @param {number} gridRes
 */
function _weightedProgress(progressByRowStart, bands, gridRes) {
  let doneRows = 0;
  for (const { rowStart, rowEnd } of bands) {
    const pct = progressByRowStart.get(rowStart) ?? 0;
    doneRows += (rowEnd - rowStart) * pct;
  }
  return Math.max(0, Math.min(1, doneRows / gridRes));
}

/** @param {Set<Worker>} workers */
function _terminateAll(workers) {
  for (const worker of workers) worker.terminate();
  workers.clear();
}
