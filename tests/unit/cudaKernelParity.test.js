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

  it('outputs the per-pixel LoS clearance grid', () => {
    expect(coverageKernel).toContain('float* losOut');
    expect(coverageKernel).toContain('losOut[pix] = losVal');
  });

  it('applies 2-ray ground reflection on both kernels (parity with twoRayReflectionGainDb)', () => {
    expect(coverageKernel).toContain('two_ray_reflection_gain_db');
    for (const source of [coverageKernel, optimizerKernel]) {
      expect(source).toContain('useGroundReflection');
      expect(source).toContain('two_ray_reflection_gain_db(dist, txHeight, rxHeight, freqMHz, reflectionCoeff)');
    }
  });

  it('applies six-ray corridor reflection on both kernels', () => {
    expect(coverageKernel).toContain('six_ray_reflection_gain_db');
    for (const source of [coverageKernel, optimizerKernel]) {
      expect(source).toContain('reflectionModel');
      expect(source).toContain('sideReflectionCoeff');
      expect(source).toContain('reflectionCorridorWidthM');
      expect(source).toContain('six_ray_reflection_gain_db(');
    }
  });

  it('traces building-facade reflections on both kernels (parity with _buildingFacadeMultipathGainDb)', () => {
    // The shared device helper lives in the coverage kernel; both kernels invoke
    // it for reflectionModel == 3 instead of regressing facade payloads to CPU.
    expect(coverageKernel).toContain('building_facade_multipath_gain_db');
    expect(coverageKernel).toContain('facade_leg_obstacle_loss');
    expect(coverageKernel).toContain('field_coeff_from_loss_db');
    expect(coverageKernel).toContain('coherent_add');
    for (const source of [coverageKernel, optimizerKernel]) {
      expect(source).toContain('reflectionModel == 3');
      expect(source).toContain('building_facade_multipath_gain_db(');
      // Direct-path clutter loss must be folded into the coherent sum, not
      // subtracted a second time below.
      expect(source).toContain('facadeHandledDirect');
    }
  });

  it('lets the facade leg loss skip the reflecting building', () => {
    // building_ray_loss must accept a skip index so a facade ray is not blocked
    // by its own mirror wall (parity with buildingLossDb skipPolygonIndex).
    expect(coverageKernel).toContain('int skipBuildingIndex');
    expect(coverageKernel).toContain('if (pi == skipBuildingIndex) continue;');
  });

  it('subtracts multipolygon holes on the GPU (parity with segmentPolygonIntervalsWithHoles)', () => {
    // The coverage kernel owns the shared device helpers (the optimizer kernel
    // is compiled as KERNEL + OPTIMIZER_KERNEL and reuses them).
    expect(coverageKernel).toContain('point_in_any_hole');
    expect(coverageKernel).toContain('segment_polygon_intervals_holes');
    // Both kernels must thread the per-polygon hole arrays through for foliage
    // and buildings, or holey payloads would silently regress to CPU again.
    for (const source of [coverageKernel, optimizerKernel]) {
      for (const sym of ['fHoleVerts', 'fHoleRingOffsets', 'fPolyHoleOffsets', 'bHoleVerts', 'bHoleRingOffsets', 'bPolyHoleOffsets']) {
        expect(source).toContain(sym);
      }
    }
  });
});
