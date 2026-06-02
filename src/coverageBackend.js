// @ts-check
import { createCoverageWorkerPoolJob } from './coverageWorkerPool.js';
import { obstacleLayerHasHoles } from './osmGeometry.js';

/**
 * @typedef {Object} CudaProbeResult
 * @property {boolean} available
 * @property {string} [reason]
 * @property {string} [device]
 *
 * @typedef {Object} CoverageBackendStatus
 * @property {CudaProbeResult} cuda
 *
 * @typedef {Object} CoverageRunResult
 * @property {Uint8ClampedArray} rgba
 * @property {Float32Array} signalGrid
 * @property {Record<string, any>} stats
 * @property {'cuda' | 'cpu'} backend
 */

/** @type {CudaProbeResult} */
let _cudaStatus = { available: false, reason: 'Not probed yet' };
/** @type {import('./coverageWorkerPool.js').CoverageWorkerJob | null} */
let _currentCpuJob = null;

export async function initCoverageBackends() {
  const cudaStatus = await (
    window.electronAPI?.cudaCoverageProbe?.().catch(err => ({
      available: false,
      reason: err?.message || 'Python CUDA probe failed',
    })) ?? Promise.resolve({ available: false, reason: 'CUDA IPC unavailable' })
  );
  _cudaStatus = cudaStatus ?? { available: false, reason: 'Python CUDA unavailable' };
  return getCoverageBackendStatus();
}

/** @returns {CoverageBackendStatus} */
export function getCoverageBackendStatus() {
  return {
    cuda: _cudaStatus,
  };
}

/** @param {CoverageBackendStatus} [status] */
export function formatCoverageBackendStatus(status = getCoverageBackendStatus()) {
  const cuda = status.cuda?.available
    ? `Python CUDA ready (${status.cuda.device || 'device detected'})`
    : `Python CUDA unavailable (${status.cuda?.reason || 'not available'})`;
  return `${cuda}; CPU fallback ready`;
}

/**
 * @param {string | null | undefined} preference
 * @param {CoverageBackendStatus} [caps]
 * @returns {Array<'cuda' | 'cpu'>}
 */
export function resolveBackendOrder(preference, caps = getCoverageBackendStatus()) {
  const pref = preference || 'auto';
  if (pref === 'cuda') return ['cuda', 'cpu'];
  if (pref === 'cpu') return ['cpu'];
  /** @type {Array<'cuda' | 'cpu'>} */
  const order = [];
  if (caps.cuda?.available) order.push('cuda');
  order.push('cpu');
  return order;
}

export function cancelCoverageCompute() {
  if (_currentCpuJob) {
    _currentCpuJob.cancel();
    _currentCpuJob = null;
  }
  window.electronAPI?.cudaCoverageCancel?.().catch(() => {});
}

/**
 * @param {Record<string, any> & { gridRes: number, foliage?: any, buildings?: any }} payload
 * @param {{ backendPreference?: string, workerCount?: number, signal?: AbortSignal | null, onProgress?: ((p: number | { pct: number, stage?: string }) => void) | null }} [opts]
 * @returns {Promise<CoverageRunResult>}
 */
export async function computeCoverage(payload, {
  backendPreference = 'auto',
  workerCount = 0,
  signal = null,
  onProgress = null,
} = {}) {
  /** @type {string[]} */
  const errors = [];
  const order = resolveBackendOrder(backendPreference);

  for (const backend of order) {
    if (signal?.aborted) throw _abortError();
    try {
      if (backend === 'cuda') {
        const result = await _runCuda(payload, { signal, onProgress });
        if (result?.unsupported) {
          const msg = result.message || 'unsupported payload';
          errors.push(`Python CUDA: ${msg}`);
          continue;
        }
        return _validateCoverageResult(result, 'cuda', payload);
      }
      const result = await _runCpu(payload, { workerCount, onProgress });
      return _validateCoverageResult(result, 'cpu', payload);
    } catch (rawErr) {
      const err = /** @type {Error & { cancelled?: boolean }} */ (rawErr);
      if (err?.name === 'AbortError' || err?.cancelled) throw err;
      errors.push(`${backend}: ${err?.message || err}`);
      console.warn(`[coverage] ${backend} backend failed:`, err);
    }
  }

  throw new Error(`All coverage backends failed: ${errors.join('; ')}`);
}

/**
 * @param {Record<string, any>} payload
 * @param {{ signal: AbortSignal | null, onProgress: ((p: { pct: number, stage?: string }) => void) | null }} ctx
 */
async function _runCuda(payload, { signal, onProgress }) {
  if (!_cudaStatus.available || !window.electronAPI?.cudaCoverageCompute) {
    return { unsupported: true, message: _cudaStatus.reason || 'Python CUDA unavailable' };
  }
  if (obstacleLayerHasHoles(payload.foliage) || obstacleLayerHasHoles(payload.buildings)) {
    return { unsupported: true, message: 'hole-aware OSM multipolygons require CPU backend' };
  }

  onProgress?.({ pct: 0.02, stage: 'launching-python' });
  const cancelOnAbort = () => window.electronAPI.cudaCoverageCancel?.().catch(() => {});
  signal?.addEventListener('abort', cancelOnAbort, { once: true });
  /** @param {any} msg */
  const progressListener = (msg) => {
    const pct = Number(msg?.pct);
    if (!Number.isFinite(pct)) return;
    onProgress?.({
      pct: Math.max(0, Math.min(1, pct)),
      stage: msg?.stage || 'cuda-compute',
    });
  };
  window.electronAPI?.onCudaCoverageProgress?.(progressListener);
  try {
    const response = await window.electronAPI.cudaCoverageCompute(payload);
    if (signal?.aborted) throw _abortError();
    if (!response || typeof response.ok !== 'boolean') {
      return {
        unsupported: true,
        message: 'Python CUDA returned malformed response',
      };
    }
    if (!response?.ok) {
      return {
        unsupported: response?.unsupported !== false,
        message: response?.message || response?.error || 'Python CUDA failed',
      };
    }
    const rgba = response.rgba instanceof Uint8ClampedArray
      ? response.rgba
      : new Uint8ClampedArray(response.rgba);
    const signalGrid = response.signalGrid instanceof Float32Array
      ? response.signalGrid
      : new Float32Array(response.signalGrid);
    onProgress?.({ pct: 1, stage: 'completed' });
    return { rgba, signalGrid, stats: response.stats ?? {} };
  } finally {
    signal?.removeEventListener('abort', cancelOnAbort);
    window.electronAPI?.offCudaCoverageProgress?.(progressListener);
  }
}

/**
 * @param {{ rgba?: any, signalGrid?: any, stats?: any }} result
 * @param {'cuda' | 'cpu'} backend
 * @param {{ gridRes: number }} payload
 * @returns {CoverageRunResult}
 */
function _validateCoverageResult(result, backend, payload) {
  const rgba = result?.rgba;
  const signalGrid = result?.signalGrid;
  const expectedBytes = payload.gridRes * payload.gridRes * 4;
  const expectedSignals = payload.gridRes * payload.gridRes;
  if (!(rgba instanceof Uint8ClampedArray) || rgba.length !== expectedBytes) {
    throw new Error(
      `${backend} backend returned invalid RGBA buffer `
      + `(expected ${expectedBytes} bytes, got ${rgba?.length ?? 'undefined'})`
    );
  }
  if (!(signalGrid instanceof Float32Array) || signalGrid.length !== expectedSignals) {
    throw new Error(
      `${backend} backend returned invalid signal grid `
      + `(expected ${expectedSignals} floats, got ${signalGrid?.length ?? 'undefined'})`
    );
  }
  return {
    rgba,
    signalGrid,
    stats: result?.stats ?? {},
    backend,
  };
}

/**
 * @param {any} payload
 * @param {{ workerCount: number, onProgress: any }} ctx
 */
async function _runCpu(payload, { workerCount, onProgress }) {
  const job = createCoverageWorkerPoolJob(payload, { workerCount, onProgress });
  _currentCpuJob = job;
  try {
    return await job.promise;
  } finally {
    if (_currentCpuJob === job) _currentCpuJob = null;
  }
}

function _abortError() {
  const err = /** @type {Error & { cancelled?: boolean }} */ (new Error('Cancelled'));
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}

