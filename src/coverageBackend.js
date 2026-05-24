import { createCoverageWorkerPoolJob } from './coverageWorkerPool.js';
import { initGpu, isGpuAvailable, getGpuMaxGridRes, runCoverageGpu } from './coverageGpu.js';

let _cudaStatus = { available: false, reason: 'Not probed yet' };
let _gpuReady = false;
let _currentCpuJob = null;

export async function initCoverageBackends() {
  const [gpuReady, cudaStatus] = await Promise.all([
    initGpu().catch(() => false),
    window.electronAPI?.cudaCoverageProbe?.().catch(err => ({
      available: false,
      reason: err?.message || 'Python CUDA probe failed',
    })) ?? Promise.resolve({ available: false, reason: 'CUDA IPC unavailable' }),
  ]);
  _gpuReady = Boolean(gpuReady);
  _cudaStatus = cudaStatus ?? { available: false, reason: 'Python CUDA unavailable' };
  return getCoverageBackendStatus();
}

export function getCoverageBackendStatus() {
  return {
    webgpu: {
      available: _gpuReady && isGpuAvailable(),
      maxGridRes: getGpuMaxGridRes(),
    },
    cuda: _cudaStatus,
  };
}

export function formatCoverageBackendStatus(status = getCoverageBackendStatus()) {
  const cuda = status.cuda?.available
    ? `Python CUDA ready (${status.cuda.device || 'device detected'})`
    : `Python CUDA unavailable (${status.cuda?.reason || 'not available'})`;
  const webgpu = status.webgpu?.available
    ? `WebGPU ready (max ${status.webgpu.maxGridRes || '-'} px)`
    : 'WebGPU unavailable';
  return `${cuda}; ${webgpu}`;
}

export function resolveBackendOrder(preference, caps = getCoverageBackendStatus()) {
  const pref = preference || 'auto';
  if (pref === 'cuda') return ['cuda'];
  if (pref === 'webgpu') return ['webgpu', 'cpu'];
  if (pref === 'cpu') return ['cpu'];
  const order = [];
  if (caps.cuda?.available) order.push('cuda');
  if (caps.webgpu?.available) order.push('webgpu');
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

export async function computeCoverage(payload, {
  backendPreference = 'auto',
  workerCount = 0,
  signal = null,
  onProgress = null,
} = {}) {
  const errors = [];
  const order = resolveBackendOrder(backendPreference);
  const explicitCuda = backendPreference === 'cuda';

  for (const backend of order) {
    if (signal?.aborted) throw _abortError();
    try {
      if (backend === 'cuda') {
        const result = await _runCuda(payload, { signal, onProgress });
        if (result?.unsupported) {
          const msg = result.message || 'unsupported payload';
          if (explicitCuda) {
            throw new Error(`CUDA backend selected, but unavailable for this run: ${msg}`);
          }
          errors.push(`Python CUDA: ${msg}`);
          continue;
        }
        return result;
      }
      if (backend === 'webgpu') {
        const result = await _runWebGpu(payload, { signal, onProgress });
        return { ...result, backend: 'webgpu' };
      }
      const result = await _runCpu(payload, { workerCount, onProgress });
      return { ...result, backend: 'cpu' };
    } catch (err) {
      if (err?.name === 'AbortError' || err?.cancelled) throw err;
      errors.push(`${backend}: ${err?.message || err}`);
      console.warn(`[coverage] ${backend} backend failed:`, err);
    }
  }

  throw new Error(`All coverage backends failed: ${errors.join('; ')}`);
}

async function _runCuda(payload, { signal, onProgress }) {
  if (!_cudaStatus.available || !window.electronAPI?.cudaCoverageCompute) {
    return { unsupported: true, message: _cudaStatus.reason || 'Python CUDA unavailable' };
  }

  onProgress?.(0.02);
  const cancelOnAbort = () => window.electronAPI.cudaCoverageCancel?.().catch(() => {});
  signal?.addEventListener('abort', cancelOnAbort, { once: true });
  try {
    const response = await window.electronAPI.cudaCoverageCompute(payload);
    if (signal?.aborted) throw _abortError();
    if (!response?.ok) {
      return {
        unsupported: response?.unsupported,
        message: response?.message || response?.error || 'Python CUDA failed',
      };
    }
    const rgba = response.rgba instanceof Uint8ClampedArray
      ? response.rgba
      : new Uint8ClampedArray(response.rgba);
    onProgress?.(1);
    return {
      rgba,
      stats: response.stats ?? {},
      backend: 'cuda',
    };
  } finally {
    signal?.removeEventListener('abort', cancelOnAbort);
  }
}

async function _runWebGpu(payload, { signal, onProgress }) {
  if (!isGpuAvailable() || getGpuMaxGridRes() <= 0) {
    throw new Error('WebGPU unavailable');
  }
  const result = await runCoverageGpu(payload, { signal, onProgress });
  const expectedBytes = payload.gridRes * payload.gridRes * 4;
  if (!(result.rgba instanceof Uint8ClampedArray) || result.rgba.length !== expectedBytes) {
    throw new Error('WebGPU output buffer size/type mismatch');
  }
  return result;
}

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
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}
