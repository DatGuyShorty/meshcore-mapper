import { createAbortError, runFallbackJob } from './jobRunner.js';

export type CudaProbeResult = {
  available: boolean;
  reason?: string;
  device?: string;
};

export type OptimizerCaps = {
  cuda?: CudaProbeResult;
};

export type OptimizerBackend = 'cuda' | 'cpu';

export type OptimizerBackendResult = {
  results: any[];
  stats: Record<string, any>;
  backend: OptimizerBackend;
};

export type OptimizerBackendOptions = {
  backendPreference?: string;
  onProgress?: ((pct: number, msg: string) => void) | null;
  signal?: AbortSignal | null;
};

type OptimizerPayload = Record<string, any>;

type UnsupportedOptimizerResult = {
  unsupported: true;
  message?: string;
};

type RawOptimizerResult = {
  ok?: boolean;
  unsupported?: boolean;
  message?: string;
  error?: string;
  results?: any[];
  stats?: Record<string, any>;
};

type OptimizerWorkerResult = {
  results: any[];
  stats: Record<string, any>;
};

type OptimizerWorkerMessage = {
  type: 'progress' | 'done';
  pct?: number;
  msg?: string;
  results?: any[];
  stats?: Record<string, any>;
};

let _cudaStatus: CudaProbeResult | null = null;

export function resolveOptimizerBackendOrder(
  preference: string | null | undefined,
  caps: OptimizerCaps = {},
): OptimizerBackend[] {
  const pref = preference || 'auto';
  if (pref === 'cuda') return ['cuda', 'cpu'];
  if (pref === 'cpu') return ['cpu'];
  const order: OptimizerBackend[] = [];
  if (caps.cuda?.available) order.push('cuda');
  order.push('cpu');
  return order;
}

export async function runOptimizerBackend(
  data: OptimizerPayload,
  {
    backendPreference = 'auto',
    onProgress = null,
    signal = null,
  }: OptimizerBackendOptions = {},
): Promise<OptimizerBackendResult> {
  const caps = await _getOptimizerCaps(backendPreference);
  const order = resolveOptimizerBackendOrder(backendPreference, caps);

  return runFallbackJob<OptimizerBackend, OptimizerBackendResult, UnsupportedOptimizerResult>({
    backends: order,
    signal,
    runBackend: async backend => {
      if (backend === 'cuda') {
        const result = await _runCudaOptimizer(data, { signal, onProgress });
        if (_isUnsupportedOptimizerResult(result)) return result;
        return {
          results: Array.isArray(result.results) ? result.results : [],
          stats: result.stats ?? {},
          backend: 'cuda',
        };
      }

      const cpuResult = await _runOptimizerWorker(data, onProgress, signal);
      return {
        results: Array.isArray(cpuResult) ? cpuResult : (cpuResult.results ?? []),
        stats: Array.isArray(cpuResult) ? {} : (cpuResult.stats ?? {}),
        backend: 'cpu',
      };
    },
    isUnsupported: _isUnsupportedOptimizerResult,
    describeUnsupported: (_backend, result) => `Python CUDA optimizer: ${result.message || 'unsupported optimizer payload'}`,
    describeError: (backend, rawErr) => {
      const err = rawErr as Error;
      return `${backend}: ${err?.message || err}`;
    },
    allFailedMessage: errors => `All optimizer backends failed: ${errors.join('; ')}`,
    onBackendError: (backend, rawErr) => {
      const err = rawErr as Error;
      console.warn(`[optimizer] ${backend} backend failed:`, err);
    },
  });
}

async function _getOptimizerCaps(preference: string): Promise<OptimizerCaps> {
  if (preference === 'cpu') return { cuda: { available: false, reason: 'CPU backend selected' } };
  if (_cudaStatus) return { cuda: _cudaStatus };
  if (!window.electronAPI?.cudaCoverageProbe) {
    _cudaStatus = { available: false, reason: 'CUDA IPC unavailable' };
    return { cuda: _cudaStatus };
  }
  try {
    _cudaStatus = _normalizeCudaProbeResult(await window.electronAPI.cudaCoverageProbe());
  } catch (rawErr) {
    const err = rawErr as Error;
    _cudaStatus = { available: false, reason: err?.message || 'Python CUDA probe failed' };
  }
  return { cuda: _cudaStatus };
}

async function _runCudaOptimizer(
  data: OptimizerPayload,
  {
    signal,
    onProgress,
  }: {
    signal: AbortSignal | null;
    onProgress: ((pct: number, msg: string) => void) | null;
  },
): Promise<RawOptimizerResult | UnsupportedOptimizerResult> {
  if (!_cudaStatus?.available || !window.electronAPI?.cudaOptimizerCompute) {
    return { unsupported: true, message: _cudaStatus?.reason || 'Python CUDA optimizer unavailable' };
  }
  if (data?.opts?.sourceNode) {
    return { unsupported: true, message: 'source-linked optimizer scoring requires CPU link diagnostics' };
  }
  if (data?.opts?.existingNodes?.length > 0) {
    return { unsupported: true, message: 'gap-aware optimizer with existing nodes requires CPU diagnostics' };
  }
  if (data?.opts?.objective === 'redundancy') {
    return { unsupported: true, message: 'redundancy objective requires CPU scoring' };
  }
  if (data?.opts?.objective === 'min-repeaters') {
    return { unsupported: true, message: 'target-coverage objective requires CPU scoring' };
  }
  if (data?.opts?.preferHighGround) {
    return { unsupported: true, message: 'high-ground preference requires CPU scoring' };
  }
  if (data?.opts?.preferRoadAdjacent) {
    return { unsupported: true, message: 'road-adjacent preference requires CPU scoring' };
  }
  if (Number.isFinite(data?.opts?.minCandidateElevationM)) {
    return { unsupported: true, message: 'minimum-elevation constraint requires CPU scoring' };
  }
  if (Number.isFinite(data?.opts?.minRedundancyRatio)) {
    return { unsupported: true, message: 'redundancy-target constraint requires CPU scoring' };
  }
  if (Array.isArray(data?.opts?.exclusionZones) && data.opts.exclusionZones.length > 0) {
    return { unsupported: true, message: 'exclusion-zone constraints require CPU scoring' };
  }

  const cancelOnAbort = () => window.electronAPI.cudaOptimizerCancel?.().catch(() => {});
  signal?.addEventListener('abort', cancelOnAbort, { once: true });
  const progressListener = (msg: unknown) => {
    const raw = msg as { pct?: unknown; stage?: unknown };
    const pct = Number(raw?.pct);
    if (!Number.isFinite(pct)) return;
    const stage = raw?.stage ? `CUDA: ${_humanizeStage(String(raw.stage))}` : 'CUDA optimizer';
    onProgress?.(20 + 75 * Math.max(0, Math.min(1, pct)), stage);
  };
  window.electronAPI?.onCudaOptimizerProgress?.(progressListener);

  try {
    onProgress?.(20, 'Launching CUDA optimizer...');
    const response = await window.electronAPI.cudaOptimizerCompute(data);
    if (signal?.aborted) throw createAbortError();
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

function _runOptimizerWorker(
  data: OptimizerPayload,
  onProgress: ((pct: number, msg: string) => void) | null,
  signal: AbortSignal | null,
): Promise<OptimizerWorkerResult | any[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./optimizerWorker.js', import.meta.url),
      { type: 'module' },
    );
    const abort = () => {
      worker.terminate();
      reject(createAbortError());
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data: msg }: MessageEvent<OptimizerWorkerMessage>) => {
      if (msg.type === 'progress') {
        onProgress?.(msg.pct ?? 0, msg.msg ?? '');
      } else if (msg.type === 'done') {
        signal?.removeEventListener('abort', abort);
        worker.terminate();
        resolve({ results: msg.results ?? [], stats: msg.stats ?? {} });
      }
    };
    worker.onerror = err => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      reject(new Error(`Optimizer worker error: ${err.message}`));
    };
    worker.postMessage(data);
  });
}

function _humanizeStage(stage: string): string {
  return String(stage).replace(/[-_]/g, ' ');
}

function _isUnsupportedOptimizerResult(
  result: RawOptimizerResult | UnsupportedOptimizerResult,
): result is UnsupportedOptimizerResult {
  return 'unsupported' in result && result.unsupported === true;
}

function _normalizeCudaProbeResult(value: unknown): CudaProbeResult {
  const raw = value as Partial<CudaProbeResult> | null;
  return {
    available: Boolean(raw?.available),
    reason: typeof raw?.reason === 'string' ? raw.reason : undefined,
    device: typeof raw?.device === 'string' ? raw.device : undefined,
  };
}
