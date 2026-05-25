import { describe, expect, it } from 'vitest';
import { resolveBackendOrder } from '../../src/coverageBackend.js';

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
});
