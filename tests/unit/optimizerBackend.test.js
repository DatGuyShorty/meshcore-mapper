import { describe, expect, it } from 'vitest';
import { resolveOptimizerBackendOrder } from '../../src/optimizerBackend.js';

describe('optimizer backend selection', () => {
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

  it('uses only CUDA when explicitly requested', () => {
    expect(resolveOptimizerBackendOrder('cuda')).toEqual(['cuda']);
  });

  it('treats unknown saved preferences as auto mode', () => {
    expect(resolveOptimizerBackendOrder('stale-setting', {
      cuda: { available: true },
    })).toEqual(['cuda', 'cpu']);
  });
});
