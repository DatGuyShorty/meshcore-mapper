import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('CUDA kernel propagation parity', () => {
  const coverageKernel = readFileSync('scripts/meshcore_cuda/kernel_source.py', 'utf8');
  const optimizerKernel = readFileSync('scripts/meshcore_cuda/optimizer_kernel_source.py', 'utf8');

  it('does not add CUDA-only Fresnel attenuation', () => {
    for (const source of [coverageKernel, optimizerKernel]) {
      expect(source).not.toMatch(/fresnelLoss/);
      expect(source).not.toMatch(/0\.6f - r/);
    }
  });

  it('uses the CPU knife-edge loss threshold', () => {
    expect(coverageKernel).toContain('if (maxV >= -0.7f)');
    expect(optimizerKernel).toContain('if (maxV >= -0.7f)');
  });
});
