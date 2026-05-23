export function createCoverageWorkerPoolJob(payload, { workerCount = 0, onProgress = null } = {}) {
  const gridRes = payload.gridRes;
  const requestedWorkers = workerCount || navigator.hardwareConcurrency || 2;
  const count = Math.max(1, Math.min(4, requestedWorkers, gridRes));
  const rowsPerWorker = Math.ceil(gridRes / count);
  const workers = new Set();
  const bandProgress = new Map();
  const rgba = new Uint8ClampedArray(gridRes * gridRes * 4);
  const stats = {
    workerCount: count,
    workerComputeMs: 0,
    insidePoints: 0,
    totalPoints: gridRes * gridRes,
  };

  let settled = false;
  let completed = 0;
  let rejectRun = null;

  const promise = new Promise((resolve, reject) => {
    rejectRun = reject;

    for (let wi = 0; wi < count; wi++) {
      const rowStart = wi * rowsPerWorker;
      const rowEnd = Math.min(gridRes, rowStart + rowsPerWorker);
      if (rowStart >= rowEnd) continue;

      const worker = new Worker(new URL('./coverageWorker.js', import.meta.url), { type: 'module' });
      workers.add(worker);
      bandProgress.set(rowStart, 0);

      worker.onmessage = ({ data: msg }) => {
        if (settled) return;
        if (msg.type === 'progress') {
          bandProgress.set(msg.rowStart, msg.pct);
          if (onProgress) onProgress(_weightedProgress(bandProgress, gridRes, rowsPerWorker));
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
          if (onProgress) onProgress(_weightedProgress(bandProgress, gridRes, rowsPerWorker));
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

      const gridElevsBuffer = payload.gridElevs.buffer.slice(0);
      worker.postMessage({
        ...payload,
        gridElevs: gridElevsBuffer,
        rowStart,
        rowEnd,
      }, [gridElevsBuffer]);
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

function _weightedProgress(progressByRowStart, gridRes, rowsPerWorker) {
  let doneRows = 0;
  for (const [rowStart, pct] of progressByRowStart) {
    const rowEnd = Math.min(gridRes, rowStart + rowsPerWorker);
    doneRows += (rowEnd - rowStart) * pct;
  }
  return Math.max(0, Math.min(1, doneRows / gridRes));
}

function _terminateAll(workers) {
  for (const worker of workers) worker.terminate();
  workers.clear();
}
