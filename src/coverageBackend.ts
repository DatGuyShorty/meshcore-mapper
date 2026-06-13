import {
  createCoverageWorkerPoolJob,
  type CoverageWorkerJob,
  type CoverageWorkerPoolPayload,
  type CoverageWorkerResult,
} from './coverageWorkerPool.js';
import { createAbortError, runFallbackJob } from './jobRunner.js';

export type CudaProbeResult = {
  available: boolean;
  reason?: string;
  device?: string;
};

export type CoverageBackendStatus = {
  cuda: CudaProbeResult;
};

export type CoverageRunResult = {
  rgba: Uint8ClampedArray;
  signalGrid: Float32Array;
  losGrid?: Float32Array;
  stats: Record<string, unknown>;
  backend: 'cuda' | 'cpu';
};

export type CoverageBackendPreference = 'auto' | 'cuda' | 'cpu' | string;

export type CoverageBackendProgress = number | {
  pct: number;
  stage?: string;
};

export type ComputeCoverageOptions = {
  backendPreference?: CoverageBackendPreference;
  workerCount?: number;
  signal?: AbortSignal | null;
  onProgress?: ((progress: CoverageBackendProgress) => void) | null;
};

export type CoverageBackendPayload = Record<string, unknown> & {
  gridRes: number;
  foliage?: unknown;
  buildings?: unknown;
};

type CoverageRawResult = {
  rgba?: unknown;
  signalGrid?: unknown;
  losGrid?: unknown;
  stats?: unknown;
};

type UnsupportedBackendResult = {
  unsupported: boolean;
  message?: string;
};

let _cudaStatus: CudaProbeResult = { available: false, reason: 'Not probed yet' };
let _currentCpuJob: CoverageWorkerJob | null = null;

export async function initCoverageBackends(): Promise<CoverageBackendStatus> {
  const cudaStatus = await (
    window.electronAPI?.cudaCoverageProbe?.().catch((err: Error) => ({
      available: false,
      reason: err?.message || 'Python CUDA probe failed',
    })) ?? Promise.resolve({ available: false, reason: 'CUDA IPC unavailable' })
  );
  _cudaStatus = _normalizeCudaProbeResult(cudaStatus);
  return getCoverageBackendStatus();
}

export function getCoverageBackendStatus(): CoverageBackendStatus {
  return {
    cuda: _cudaStatus,
  };
}

export function formatCoverageBackendStatus(status: CoverageBackendStatus = getCoverageBackendStatus()): string {
  const cuda = status.cuda?.available
    ? `Python CUDA ready (${status.cuda.device || 'device detected'})`
    : `Python CUDA unavailable (${status.cuda?.reason || 'not available'})`;
  return `${cuda}; CPU fallback ready`;
}

export function resolveBackendOrder(
  preference: string | null | undefined,
  caps: CoverageBackendStatus = getCoverageBackendStatus(),
): Array<'cuda' | 'cpu'> {
  const pref = preference || 'auto';
  if (pref === 'cuda') return ['cuda', 'cpu'];
  if (pref === 'cpu') return ['cpu'];
  const order: Array<'cuda' | 'cpu'> = [];
  if (caps.cuda?.available) order.push('cuda');
  order.push('cpu');
  return order;
}

export function cancelCoverageCompute(): void {
  if (_currentCpuJob) {
    _currentCpuJob.cancel();
    _currentCpuJob = null;
  }
  window.electronAPI?.cudaCoverageCancel?.().catch(() => {});
}

export async function computeCoverage(
  payload: CoverageBackendPayload,
  {
    backendPreference = 'auto',
    workerCount = 0,
    signal = null,
    onProgress = null,
  }: ComputeCoverageOptions = {},
): Promise<CoverageRunResult> {
  const order = resolveBackendOrder(backendPreference);

  return runFallbackJob<'cuda' | 'cpu', CoverageRunResult, UnsupportedBackendResult>({
    backends: order,
    signal,
    runBackend: async backend => {
      if (backend === 'cuda') {
        const result = await _runCuda(payload, { signal, onProgress });
        if (_isUnsupportedBackendResult(result)) return result;
        return _validateCoverageResult(result, 'cuda', payload);
      }
      const result = await _runCpu(payload, { workerCount, onProgress });
      return _validateCoverageResult(result, 'cpu', payload);
    },
    isUnsupported: _isUnsupportedBackendResult,
    describeUnsupported: (_backend, result) => `Python CUDA: ${result.message || 'unsupported payload'}`,
    describeError: (backend, rawErr) => {
      const err = rawErr as Error;
      return `${backend}: ${err?.message || err}`;
    },
    allFailedMessage: errors => `All coverage backends failed: ${errors.join('; ')}`,
    onBackendError: (backend, rawErr) => {
      const err = rawErr as Error;
      console.warn(`[coverage] ${backend} backend failed:`, err);
    },
  });
}

async function _runCuda(
  payload: CoverageBackendPayload,
  {
    signal,
    onProgress,
  }: {
    signal: AbortSignal | null;
    onProgress: ((progress: CoverageBackendProgress) => void) | null;
  },
): Promise<CoverageRawResult | UnsupportedBackendResult> {
  if (!_cudaStatus.available || !window.electronAPI?.cudaCoverageCompute) {
    return { unsupported: true, message: _cudaStatus.reason || 'Python CUDA unavailable' };
  }

  onProgress?.({ pct: 0.02, stage: 'launching-python' });
  const cancelOnAbort = () => window.electronAPI.cudaCoverageCancel?.().catch(() => {});
  signal?.addEventListener('abort', cancelOnAbort, { once: true });
  const progressListener = (msg: unknown) => {
    const raw = msg as { pct?: unknown; stage?: unknown };
    const pct = Number(raw?.pct);
    if (!Number.isFinite(pct)) return;
    onProgress?.({
      pct: Math.max(0, Math.min(1, pct)),
      stage: typeof raw?.stage === 'string' ? raw.stage : 'cuda-compute',
    });
  };
  window.electronAPI?.onCudaCoverageProgress?.(progressListener);
  try {
    const response = await window.electronAPI.cudaCoverageCompute(payload);
    if (signal?.aborted) throw createAbortError();
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
    const losGrid = response.losGrid
      ? (response.losGrid instanceof Float32Array ? response.losGrid : new Float32Array(response.losGrid))
      : undefined;
    onProgress?.({ pct: 1, stage: 'completed' });
    return { rgba, signalGrid, losGrid, stats: response.stats ?? {} };
  } finally {
    signal?.removeEventListener('abort', cancelOnAbort);
    window.electronAPI?.offCudaCoverageProgress?.(progressListener);
  }
}

function _validateCoverageResult(
  result: CoverageRawResult,
  backend: 'cuda' | 'cpu',
  payload: { gridRes: number },
): CoverageRunResult {
  const rgba = result?.rgba;
  const signalGrid = result?.signalGrid;
  const expectedBytes = payload.gridRes * payload.gridRes * 4;
  const expectedSignals = payload.gridRes * payload.gridRes;
  if (!(rgba instanceof Uint8ClampedArray) || rgba.length !== expectedBytes) {
    throw new Error(
      `${backend} backend returned invalid RGBA buffer `
      + `(expected ${expectedBytes} bytes, got ${_lengthOf(rgba)})`,
    );
  }
  if (!(signalGrid instanceof Float32Array) || signalGrid.length !== expectedSignals) {
    throw new Error(
      `${backend} backend returned invalid signal grid `
      + `(expected ${expectedSignals} floats, got ${_lengthOf(signalGrid)})`,
    );
  }
  const losGrid = result?.losGrid instanceof Float32Array && result.losGrid.length === expectedSignals
    ? result.losGrid
    : undefined;
  return {
    rgba,
    signalGrid,
    losGrid,
    stats: _statsRecord(result?.stats),
    backend,
  };
}

async function _runCpu(
  payload: CoverageBackendPayload,
  {
    workerCount,
    onProgress,
  }: {
    workerCount: number;
    onProgress: ((progress: CoverageBackendProgress) => void) | null;
  },
): Promise<CoverageWorkerResult> {
  const job = createCoverageWorkerPoolJob(payload as CoverageWorkerPoolPayload, { workerCount, onProgress });
  _currentCpuJob = job;
  try {
    return await job.promise;
  } finally {
    if (_currentCpuJob === job) _currentCpuJob = null;
  }
}

function _isUnsupportedBackendResult(result: CoverageRawResult | UnsupportedBackendResult): result is UnsupportedBackendResult {
  return 'unsupported' in result && typeof result.unsupported === 'boolean';
}

function _normalizeCudaProbeResult(value: unknown): CudaProbeResult {
  const raw = value as Partial<CudaProbeResult> | null;
  return {
    available: Boolean(raw?.available),
    reason: typeof raw?.reason === 'string' ? raw.reason : undefined,
    device: typeof raw?.device === 'string' ? raw.device : undefined,
  };
}

function _statsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function _lengthOf(value: unknown): number | 'undefined' {
  return typeof (value as { length?: unknown } | null)?.length === 'number'
    ? (value as { length: number }).length
    : 'undefined';
}
