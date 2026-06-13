import { describe, expect, it } from 'vitest';
import { resolveBackendOrder } from '../../src/coverageBackend.js';
import { resolveOptimizerBackendOrder } from '../../src/optimizerBackend.js';

describe('coverage backend selection', () => {
  it('prefers CUDA then CPU in auto mode when CUDA is available', () => {
    expect(resolveBackendOrder('auto', {
      cuda: { available: true },
    })).toEqual(['cuda', 'cpu']);
  });

  it('falls back to CPU when CUDA is unavailable', () => {
    expect(resolveBackendOrder('auto', {
      cuda: { available: false },
    })).toEqual(['cpu']);
  });

  it('uses CUDA with CPU fallback when explicitly requested', () => {
    expect(resolveBackendOrder('cuda')).toEqual(['cuda', 'cpu']);
  });

  it('treats unknown saved preferences as auto mode', () => {
    expect(resolveBackendOrder('stale-setting', {
      cuda: { available: true },
    })).toEqual(['cuda', 'cpu']);
  });

  it('keeps CUDA preferred in auto mode regardless of obstacle geometry (GPU subtracts holes)', () => {
    // Hole-aware OSM multipolygons used to force a CPU fallback; backend selection
    // no longer inspects obstacle geometry, so CUDA stays preferred when available.
    expect(resolveBackendOrder('auto', {
      cuda: { available: true },
      obstacleLayerHasHoles: true,
    })).toEqual(['cuda', 'cpu']);
    expect(resolveOptimizerBackendOrder('auto', {
      cuda: { available: true },
      obstacleLayerHasHoles: true,
    })).toEqual(['cuda', 'cpu']);
  });
});
