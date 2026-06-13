import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('CUDA payload limits', () => {
  const source = readFileSync('src/main/cudaSchemas.ts', 'utf8');

  it('does not reject dense obstacle layers by polygon count alone', () => {
    expect(source).not.toContain('too many polygons');
    expect(source).not.toContain('MAX_CUDA_OBSTACLE_POLYGONS');
  });

  it('keeps payload protection based on packed GPU size', () => {
    expect(source).toContain('MAX_CUDA_OBSTACLE_PACKED_BYTES');
    expect(source).toContain('payload is too large for CUDA');
  });
});
