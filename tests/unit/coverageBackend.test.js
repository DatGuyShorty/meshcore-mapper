import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/coverageWorkerPool.js', () => ({
  createCoverageWorkerPoolJob: vi.fn(),
}));

import {
  cancelCoverageCompute,
  computeCoverage,
  formatCoverageBackendStatus,
  initCoverageBackends,
  resolveBackendOrder,
} from '../../src/coverageBackend.js';
import { createCoverageWorkerPoolJob } from '../../src/coverageWorkerPool.js';

describe('coverage backend helpers', () => {
  let originalElectronAPI;

  beforeEach(() => {
    originalElectronAPI = globalThis.window?.electronAPI;
    globalThis.window = globalThis.window || {};
    globalThis.window.electronAPI = {
      cudaCoverageCancel: vi.fn(async () => null),
    };
    createCoverageWorkerPoolJob.mockReset();
  });

  afterEach(() => {
    globalThis.window.electronAPI = originalElectronAPI;
    vi.restoreAllMocks();
  });

  it('formats unavailable CUDA status text correctly', () => {
    const text = formatCoverageBackendStatus({ cuda: { available: false, reason: 'No CUDA' } });
    expect(text).toContain('Python CUDA unavailable (No CUDA)');
    expect(text).toContain('CPU fallback ready');
  });

  it('formats available CUDA status text correctly', () => {
    const text = formatCoverageBackendStatus({ cuda: { available: true, device: 'Test GPU' } });
    expect(text).toContain('Python CUDA ready (Test GPU)');
    expect(text).toContain('CPU fallback ready');
  });

  it('resolves backend order for explicit cpu and cuda preferences', () => {
    expect(resolveBackendOrder('cpu')).toEqual(['cpu']);
    expect(resolveBackendOrder('cuda')).toEqual(['cuda', 'cpu']);
  });

  it('calls the CUDA cancel handler when cancelling coverage compute', () => {
    cancelCoverageCompute();
    expect(globalThis.window.electronAPI.cudaCoverageCancel).toHaveBeenCalled();
  });

  it('runs CPU coverage compute when CUDA is unavailable and validates the returned buffers', async () => {
    const payload = { gridRes: 2, foliage: null, buildings: null };
    const fakeResult = {
      rgba: new Uint8ClampedArray(16),
      signalGrid: new Float32Array(4),
      stats: { computed: true },
    };
    createCoverageWorkerPoolJob.mockReturnValue({ promise: Promise.resolve(fakeResult) });

    const result = await computeCoverage(payload, { backendPreference: 'cpu', workerCount: 1 });

    expect(result.backend).toBe('cpu');
    expect(result.rgba).toBeInstanceOf(Uint8ClampedArray);
    expect(result.signalGrid).toBeInstanceOf(Float32Array);
    expect(result.stats).toEqual({ computed: true });
  });

  it('runs building-facade ray tracing on the CUDA backend (no CPU fallback)', async () => {
    globalThis.window.electronAPI.cudaCoverageProbe = vi.fn(async () => ({ available: true, device: 'Test GPU' }));
    globalThis.window.electronAPI.cudaCoverageCompute = vi.fn(async () => ({
      ok: true,
      rgba: new Uint8ClampedArray(16),
      signalGrid: new Float32Array(4),
      stats: { facade: true },
    }));
    globalThis.window.electronAPI.onCudaCoverageProgress = vi.fn();
    globalThis.window.electronAPI.offCudaCoverageProgress = vi.fn();
    await initCoverageBackends();

    const payload = {
      gridRes: 2,
      useGroundReflection: true,
      reflectionModel: 'facade',
      foliage: null,
      buildings: null,
    };

    const result = await computeCoverage(payload, { backendPreference: 'cuda', workerCount: 1 });

    expect(globalThis.window.electronAPI.cudaCoverageCompute).toHaveBeenCalled();
    expect(result.backend).toBe('cuda');
    expect(result.stats).toEqual({ facade: true });
    expect(createCoverageWorkerPoolJob).not.toHaveBeenCalled();
  });
});
