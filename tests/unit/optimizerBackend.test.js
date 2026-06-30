import { afterEach, describe, expect, it, vi } from 'vitest';
import { optimizerCudaUnsupportedReason, resolveOptimizerBackendOrder, runOptimizerBackend } from '../../src/optimizerBackend.js';

describe('optimizer backend selection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers CUDA in auto mode when it is available', () => {
    expect(resolveOptimizerBackendOrder('auto', {
      cuda: { available: true },
    })).toEqual(['cuda', 'cpu']);
  });

  it('uses CPU fallback in auto mode when CUDA is unavailable', () => {
    expect(resolveOptimizerBackendOrder('auto', {
      cuda: { available: false },
    })).toEqual(['cpu']);
  });

  it('uses CUDA with CPU fallback when explicitly requested', () => {
    expect(resolveOptimizerBackendOrder('cuda')).toEqual(['cuda', 'cpu']);
  });

  it('treats unknown saved preferences as auto mode', () => {
    expect(resolveOptimizerBackendOrder('stale-setting', {
      cuda: { available: true },
    })).toEqual(['cuda', 'cpu']);
  });

  it('allows CUDA redundancy objective when CPU-only diagnostics are not needed', () => {
    expect(optimizerCudaUnsupportedReason({
      opts: { objective: 'redundancy' },
    })).toBeNull();
  });

  it('allows CUDA redundancy target filtering when existing-node diagnostics are not needed', () => {
    expect(optimizerCudaUnsupportedReason({
      opts: { minRedundancyRatio: 0.5 },
    })).toBeNull();
  });

  it('keeps CUDA fallback disabled for redundancy runs that need CPU diagnostics', () => {
    expect(optimizerCudaUnsupportedReason({
      opts: {
        objective: 'redundancy',
        existingNodes: [{ name: 'Existing' }],
      },
    })).toBe('gap-aware optimizer with existing nodes requires CPU diagnostics');
  });

  it('runs the CUDA optimizer for supported redundancy objective payloads', async () => {
    const originalWindow = globalThis.window;
    globalThis.window = globalThis.window || {};
    globalThis.window.electronAPI = {
      cudaCoverageProbe: vi.fn(async () => ({ available: true, device: 'Test GPU' })),
      cudaOptimizerCompute: vi.fn(async () => ({
        ok: true,
        results: [{
          lat: 1,
          lon: 2,
          score: 0.45,
          coverageRatio: 0.1,
          redundancyRatio: 0.2,
        }],
        stats: { cuda: true },
      })),
      onCudaOptimizerProgress: vi.fn(),
      offCudaOptimizerProgress: vi.fn(),
    };

    try {
      const result = await runOptimizerBackend({
        opts: { objective: 'redundancy' },
      }, { backendPreference: 'cuda' });

      expect(globalThis.window.electronAPI.cudaOptimizerCompute).toHaveBeenCalledWith({
        opts: { objective: 'redundancy' },
      });
      expect(result).toMatchObject({
        backend: 'cuda',
        stats: { cuda: true },
        results: [expect.objectContaining({ redundancyRatio: 0.2 })],
      });
    } finally {
      globalThis.window = originalWindow;
    }
  });
});
