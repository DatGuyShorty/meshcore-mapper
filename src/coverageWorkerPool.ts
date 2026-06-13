const MAX_WORKERS = 8;

export type CoverageBand = {
  rowStart: number;
  rowEnd: number;
};

export type CoverageWorkerStats = {
  workerCount: number;
  workerComputeMs: number;
  insidePoints: number;
  totalPoints: number;
  sharedGridBuffer: boolean;
};

export type CoverageWorkerResult = {
  rgba: Uint8ClampedArray;
  signalGrid: Float32Array;
  losGrid: Float32Array;
  stats: CoverageWorkerStats;
};

export type CoverageWorkerJob = {
  promise: Promise<CoverageWorkerResult>;
  workerCount: number;
  cancel: () => void;
};

export type CoverageWorkerPoolPayload = {
  gridRes: number;
  gridElevs: Float32Array | ArrayBufferLike;
  [key: string]: unknown;
};

export type CoverageWorkerPoolOptions = {
  workerCount?: number;
  onProgress?: ((progress: number) => void) | null;
};

type CoverageWorkerDoneMessage = {
  type: 'done';
  rowStart: number;
  rowEnd: number;
  rgbaBuffer: ArrayBuffer;
  signalBuffer: ArrayBuffer;
  losBuffer?: ArrayBuffer;
  stats?: {
    computeMs?: number;
    insidePoints?: number;
  };
};

type CoverageWorkerProgressMessage = {
  type: 'progress';
  rowStart: number;
  pct: number;
};

type CoverageWorkerMessage = CoverageWorkerDoneMessage | CoverageWorkerProgressMessage;

type CancelledError = Error & {
  cancelled?: boolean;
};

export function createCoverageWorkerPoolJob(
  payload: CoverageWorkerPoolPayload,
  { workerCount = 0, onProgress = null }: CoverageWorkerPoolOptions = {},
): CoverageWorkerJob {
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
  const workers = new Set<Worker>();
  const bandProgress = new Map<number, number>();
  const rgba = new Uint8ClampedArray(gridRes * gridRes * 4);
  const signalGrid = new Float32Array(gridRes * gridRes);
  const losGrid = new Float32Array(gridRes * gridRes);
  const stats: CoverageWorkerStats = {
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
  let rejectRun: ((err: unknown) => void) | null = null;

  const promise = new Promise<CoverageWorkerResult>((resolve, reject) => {
    rejectRun = reject;

    for (const { rowStart, rowEnd } of bands) {
      const worker = new Worker(new URL('./coverageWorker.js', import.meta.url), { type: 'module' });
      workers.add(worker);
      bandProgress.set(rowStart, 0);

      worker.onmessage = ({ data: msg }: MessageEvent<CoverageWorkerMessage>) => {
        if (settled) return;
        if (msg.type === 'progress') {
          bandProgress.set(msg.rowStart, msg.pct);
          if (onProgress) onProgress(_weightedProgress(bandProgress, bands, gridRes));
          return;
        }

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
      };

      worker.onerror = err => {
        if (settled) return;
        settled = true;
        _terminateAll(workers);
        reject(new Error(`Coverage worker error: ${err.message}`));
      };

      const message = {
        ...payload,
        rowStart,
        rowEnd,
      };
      if (sharedGridElevsBuffer) {
        worker.postMessage({ ...message, gridElevs: sharedGridElevsBuffer });
      } else {
        const gridElevsBuffer = _copyGridBuffer(payload.gridElevs);
        worker.postMessage({ ...message, gridElevs: gridElevsBuffer }, [gridElevsBuffer]);
      }
    }
  });

  return {
    promise,
    workerCount: count,
    cancel() {
      if (settled) return;
      settled = true;
      _terminateAll(workers);
      const err = new Error('Cancelled') as CancelledError;
      err.cancelled = true;
      rejectRun?.(err);
    },
  };
}

export function buildCoverageWorkerBands(
  gridRes: number,
  workerCount = 0,
  hardwareConcurrency: number | null = null,
): CoverageBand[] {
  const hardware = hardwareConcurrency ?? (
    typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 2
  );
  const requestedWorkers = workerCount || hardware || 2;
  const targetCount = Math.max(1, Math.min(MAX_WORKERS, requestedWorkers, gridRes));
  const rowsPerWorker = Math.ceil(gridRes / targetCount);
  const bands: CoverageBand[] = [];
  for (let wi = 0; wi < targetCount; wi++) {
    const rowStart = wi * rowsPerWorker;
    const rowEnd = Math.min(gridRes, rowStart + rowsPerWorker);
    if (rowStart < rowEnd) bands.push({ rowStart, rowEnd });
  }
  return bands;
}

function _sharedGridBuffer(gridElevs: Float32Array | ArrayBufferLike): SharedArrayBuffer | null {
  if (typeof SharedArrayBuffer === 'undefined') return null;
  try {
    const source = gridElevs instanceof Float32Array
      ? gridElevs
      : new Float32Array(gridElevs);
    const shared = new SharedArrayBuffer(source.byteLength);
    new Float32Array(shared).set(source);
    return shared;
  } catch {
    return null;
  }
}

function _copyGridBuffer(gridElevs: Float32Array | ArrayBufferLike): ArrayBuffer {
  const source = gridElevs instanceof Float32Array
    ? gridElevs
    : new Float32Array(gridElevs);
  const copy = new ArrayBuffer(source.byteLength);
  new Uint8Array(copy).set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  return copy;
}

function _weightedProgress(progressByRowStart: Map<number, number>, bands: CoverageBand[], gridRes: number): number {
  let doneRows = 0;
  for (const { rowStart, rowEnd } of bands) {
    const pct = progressByRowStart.get(rowStart) ?? 0;
    doneRows += (rowEnd - rowStart) * pct;
  }
  return Math.max(0, Math.min(1, doneRows / gridRes));
}

function _terminateAll(workers: Set<Worker>): void {
  for (const worker of workers) worker.terminate();
  workers.clear();
}
