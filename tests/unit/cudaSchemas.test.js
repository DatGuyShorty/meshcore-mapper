import { describe, expect, it } from 'vitest';
import {
  parseCudaCoveragePayload,
  parseCudaOptimizerPayload,
  serializeBuildingPayload,
  serializeFoliagePayload,
} from '../../src/main/cudaSchemas.js';

function validCoveragePayload(overrides = {}) {
  return {
    gridElevs: [10, 11, 12, 13],
    gridRes: 2,
    ELEV_RES: 2,
    rep: { lat: 48, lon: 18, height: 12, power: 22, freq: 869.5 },
    txElev: 240,
    latMin: 47,
    latMax: 49,
    lonMin: 17,
    lonMax: 19,
    radiusKm: 20,
    rxHeight: 1.5,
    effectiveSens: -129,
    ...overrides,
  };
}

function validOptimizerPayload(overrides = {}) {
  return {
    opts: {
      evalRes: 2,
      latMin: 47,
      latMax: 49,
      lonMin: 17,
      lonMax: 19,
      rxHeight: 1.5,
      rxSens: -129,
      radiusKm: 20,
    },
    txParams: { height: 12, power: 22, freq: 869.5 },
    candidates: [
      { lat: 48, lon: 18 },
      { latitude: 48.5, longitude: 18.5 },
    ],
    nRepeaters: 1,
    evalElevs: [100, 101, 102, 103],
    candidateElevs: [210, 211],
    ...overrides,
  };
}

describe('CUDA schema helpers', () => {
  it('normalizes a valid coverage payload', () => {
    const parsed = parseCudaCoveragePayload(validCoveragePayload());

    expect(parsed.gridElevs).toBeInstanceOf(Float32Array);
    expect(Array.from(parsed.gridElevs)).toEqual([10, 11, 12, 13]);
    expect(parsed.gridRes).toBe(2);
    expect(parsed.elevRes).toBe(2);
  });

  it('rejects coverage grids whose elevation count does not match ELEV_RES', () => {
    expect(() => parseCudaCoveragePayload(validCoveragePayload({ gridElevs: [1, 2, 3] })))
      .toThrow('gridElevs length mismatch: expected 4, got 3');
  });

  it('normalizes optimizer candidates and derived bounds', () => {
    const parsed = parseCudaOptimizerPayload(validOptimizerPayload());

    expect(parsed.candidateCount).toBe(2);
    expect(parsed.evalRes).toBe(2);
    expect(Array.from(parsed.candidateCoords)).toEqual([48, 18, 48.5, 18.5]);
    expect(parsed.bounds).toMatchObject({ latMin: 47, latMax: 49, lonMin: 17, lonMax: 19 });
  });

  it('rejects optimizer payloads that exceed one GPU scoring pass', () => {
    const candidates = Array.from({ length: 48 }, (_, index) => ({ lat: 48 + index / 1000, lon: 18 }));

    expect(() => parseCudaOptimizerPayload(validOptimizerPayload({
      opts: { ...validOptimizerPayload().opts, evalRes: 1024 },
      candidates,
    }))).toThrow('Optimizer CUDA payload is too large for one GPU scoring pass');
  });

  it('serializes foliage and building obstacle payloads for Python', () => {
    const tileIndex = { latMin: 47, lonMin: 17, latSpan: 1, lonSpan: 1, tiles: [[0, 1]] };
    const foliage = serializeFoliagePayload({
      polygons: [[[48, 18], [48.1, 18.1]]],
      bboxes: [{ latMin: 48, latMax: 48.1, lonMin: 18, lonMax: 18.1 }],
      canopyHeights: [14],
      factors: [0.4],
      holes: [[[[48.02, 18.02], [48.03, 18.03]]]],
      tileIndex,
    });
    const buildings = serializeBuildingPayload({
      polygons: [[[48, 18], [48.1, 18.1]]],
      bboxes: [[48, 48.1, 18, 18.1]],
      heights: [8],
      tileIndex,
    });

    expect(foliage).toMatchObject({
      bboxes: [[48, 48.1, 18, 18.1]],
      canopyHeights: [14],
      factors: [0.4],
      tileIndex,
    });
    expect(buildings).toMatchObject({
      bboxes: [[48, 48.1, 18, 18.1]],
      heights: [8],
      tileIndex,
    });
  });
});
