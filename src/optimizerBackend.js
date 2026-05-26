let _cudaStatus = null;

export function resolveOptimizerBackendOrder(preference, caps = {}) {
  const pref = preference || 'auto';
  if (pref === 'cuda') return ['cuda', 'cpu'];
  if (pref === 'cpu') return ['cpu'];
  const order = [];
  if (caps.cuda?.available) order.push('cuda');
  order.push('cpu');
  return order;
}

export async function runOptimizerBackend(data, {
  backendPreference = 'auto',
  onProgress = null,
  signal = null,
} = {}) {
  const caps = await _getOptimizerCaps(backendPreference);
  const order = resolveOptimizerBackendOrder(backendPreference, caps);
  const errors = [];

  for (const backend of order) {
    if (signal?.aborted) throw _abortError();
    try {
      if (backend === 'cuda') {
        const result = await _runCudaOptimizer(data, { signal, onProgress });
        if (result?.unsupported) {
          const msg = result.message || 'unsupported optimizer payload';
          errors.push(`Python CUDA optimizer: ${msg}`);
          continue;
        }
        return {
          results: Array.isArray(result.results) ? result.results : [],
          stats: result.stats ?? {},
          backend: 'cuda',
        };
      }

      return {
        results: await _runOptimizerWorker(data, onProgress, signal),
        stats: {},
        backend: 'cpu',
      };
    } catch (err) {
      if (err?.name === 'AbortError' || err?.cancelled) throw err;
      errors.push(`${backend}: ${err?.message || err}`);
      console.warn(`[optimizer] ${backend} backend failed:`, err);
    }
  }

  throw new Error(`All optimizer backends failed: ${errors.join('; ')}`);
}

async function _getOptimizerCaps(preference) {
  if (preference === 'cpu') return { cuda: { available: false, reason: 'CPU backend selected' } };
  if (_cudaStatus) return { cuda: _cudaStatus };
  if (!window.electronAPI?.cudaCoverageProbe) {
    _cudaStatus = { available: false, reason: 'CUDA IPC unavailable' };
    return { cuda: _cudaStatus };
  }
  try {
    _cudaStatus = await window.electronAPI.cudaCoverageProbe();
  } catch (err) {
    _cudaStatus = { available: false, reason: err?.message || 'Python CUDA probe failed' };
  }
  return { cuda: _cudaStatus };
}

async function _runCudaOptimizer(data, { signal, onProgress }) {
  if (!_cudaStatus?.available || !window.electronAPI?.cudaOptimizerCompute) {
    return { unsupported: true, message: _cudaStatus?.reason || 'Python CUDA optimizer unavailable' };
  }
  if (_hasObstacleHoles(data?.opts?.foliage) || _hasObstacleHoles(data?.opts?.buildings)) {
    return { unsupported: true, message: 'hole-aware OSM multipolygons require CPU backend' };
  }

  const cancelOnAbort = () => window.electronAPI.cudaOptimizerCancel?.().catch(() => {});
  signal?.addEventListener('abort', cancelOnAbort, { once: true });
  const progressListener = (msg) => {
    const pct = Number(msg?.pct);
    if (!Number.isFinite(pct)) return;
    const stage = msg?.stage ? `CUDA: ${_humanizeStage(msg.stage)}` : 'CUDA optimizer';
    onProgress?.(20 + 75 * Math.max(0, Math.min(1, pct)), stage);
  };
  window.electronAPI?.onCudaOptimizerProgress?.(progressListener);

  try {
    onProgress?.(20, 'Launching CUDA optimizer...');
    const response = await window.electronAPI.cudaOptimizerCompute(data);
    if (signal?.aborted) throw _abortError();
    if (!response || typeof response.ok !== 'boolean') {
      return { unsupported: true, message: 'Python CUDA optimizer returned malformed response' };
    }
    if (!response.ok) {
      return {
        unsupported: response.unsupported !== false,
        message: response.message || response.error || 'Python CUDA optimizer failed',
      };
    }
    onProgress?.(95, 'CUDA optimizer complete.');
    return response;
  } finally {
    signal?.removeEventListener('abort', cancelOnAbort);
    window.electronAPI?.offCudaOptimizerProgress?.(progressListener);
  }
}

function _runOptimizerWorker(data, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./optimizerWorker.js', import.meta.url),
      { type: 'module' }
    );
    const abort = () => {
      worker.terminate();
      reject(_abortError());
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data: msg }) => {
      if (msg.type === 'progress') {
        onProgress?.(msg.pct, msg.msg);
      } else if (msg.type === 'done') {
        signal?.removeEventListener('abort', abort);
        worker.terminate();
        resolve(msg.results);
      }
    };
    worker.onerror = (err) => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      reject(new Error(`Optimizer worker error: ${err.message}`));
    };
    worker.postMessage(data);
  });
}

function _abortError() {
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}

function _humanizeStage(stage) {
  return String(stage).replace(/[-_]/g, ' ');
}

function _hasObstacleHoles(layer) {
  return Array.isArray(layer?.holes) && layer.holes.some(polyHoles => Array.isArray(polyHoles) && polyHoles.length > 0);
}
