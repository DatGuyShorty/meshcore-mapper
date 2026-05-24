import { describe, expect, it } from 'vitest';
import { resolveBackendOrder } from '../../src/coverageBackend.js';

describe('coverage backend selection', () => {
  it('prefers CUDA then WebGPU then CPU in auto mode when all are available', () => {
    expect(resolveBackendOrder('auto', {
      cuda: { available: true },
      webgpu: { available: true },
    })).toEqual(['cuda', 'webgpu', 'cpu']);
  });

  it('falls back to CPU when accelerators are unavailable', () => {
    expect(resolveBackendOrder('auto', {
      cuda: { available: false },
      webgpu: { available: false },
    })).toEqual(['cpu']);
  });

  it('uses only CUDA when explicitly requested', () => {
    expect(resolveBackendOrder('cuda')).toEqual(['cuda']);
  });
});
