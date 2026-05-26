import { describe, expect, it } from 'vitest';
import {
  buildBuildingsOverpassQuery,
  buildingLossDb,
  classifyStructureTags,
  inferBuildingHeight,
  parseOsmLengthMeters,
} from '../../src/buildings.js';

describe('building blocker extraction helpers', () => {
  it('parses common OSM length formats', () => {
    expect(parseOsmLengthMeters('12 m')).toBeCloseTo(12);
    expect(parseOsmLengthMeters('30 ft')).toBeCloseTo(9.144);
    expect(parseOsmLengthMeters('8,5')).toBeCloseTo(8.5);
    expect(parseOsmLengthMeters("10'6\"")).toBeCloseTo(3.2004);
  });

  it('infers heights from explicit tags, levels, and building type defaults', () => {
    expect(inferBuildingHeight({ building: 'house' })).toBe(6);
    expect(inferBuildingHeight({ building: 'cathedral' })).toBeGreaterThan(inferBuildingHeight({ building: 'house' }));
    expect(inferBuildingHeight({ building: 'industrial', 'building:levels': '2', 'roof:height': '2' })).toBeCloseTo(10.4);
    expect(inferBuildingHeight({ building: 'yes', 'building:height': '14 m' })).toBe(14);
    expect(inferBuildingHeight({ man_made: 'silo' })).toBe(18);
    expect(inferBuildingHeight({ barrier: 'city_wall' })).toBe(8);
  });

  it('classifies building-like blockers beyond building footprints', () => {
    expect(classifyStructureTags({ building: 'apartments' })?.kind).toBe('building:apartments');
    expect(classifyStructureTags({ 'building:part': 'yes', height: '7' })?.height).toBe(7);
    expect(classifyStructureTags({ man_made: 'storage_tank' })?.kind).toBe('man_made:storage_tank');
    expect(classifyStructureTags({ barrier: 'wall' })?.linearWidthM).toBeGreaterThan(0);
    expect(classifyStructureTags({ amenity: 'parking' })).toBeNull();
  });

  it('queries richer OSM blocker feature classes', () => {
    const query = buildBuildingsOverpassQuery('(1,2,3,4)');

    expect(query).toContain('["building"]');
    expect(query).toContain('["building:part"]');
    expect(query).toContain('storage_tank');
    expect(query).toContain('node["building"]');
    expect(query).toContain('node["man_made"');
    expect(query).toContain('retaining_wall');
    expect(query).toContain('["military"="bunker"]');
  });
});

describe('building attenuation', () => {
  it('adds traversal and wall loss when the ray crosses below rooftops', () => {
    const profileLats = new Float64Array([0, 0, 0]);
    const profileLons = new Float64Array([-1, 0, 1]);
    const profileElevs = new Float32Array([0, 0, 0]);
    const building = [[-0.1, -0.1], [-0.1, 0.1], [0.1, 0.1], [0.1, -0.1]];

    const loss = buildingLossDb(
      profileLats,
      profileLons,
      profileElevs,
      1,
      1,
      [building],
      [{ latMin: -0.1, latMax: 0.1, lonMin: -0.1, lonMax: 0.1 }],
      [10],
      null,
      200,
      0.5
    );

    expect(loss).toBeGreaterThan(20);
  });

  it('skips building loss when the ray clears the rooftop', () => {
    const profileLats = new Float64Array([0, 0, 0]);
    const profileLons = new Float64Array([-1, 0, 1]);
    const profileElevs = new Float32Array([0, 0, 0]);
    const building = [[-0.1, -0.1], [-0.1, 0.1], [0.1, 0.1], [0.1, -0.1]];

    const loss = buildingLossDb(
      profileLats,
      profileLons,
      profileElevs,
      50,
      50,
      [building],
      [{ latMin: -0.1, latMax: 0.1, lonMin: -0.1, lonMax: 0.1 }],
      [10],
      null,
      200,
      0.5
    );

    expect(loss).toBe(0);
  });

  it('preserves multipolygon holes when computing building loss', () => {
    const profileLats = new Float64Array([2, 2]);
    const profileLons = new Float64Array([-1, 5]);
    const profileElevs = new Float32Array([0, 0]);
    const outer = [[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]];
    const inner = [[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]];
    const bbox = { latMin: 0, latMax: 4, lonMin: 0, lonMax: 4 };

    const solidLoss = buildingLossDb(
      profileLats, profileLons, profileElevs,
      1, 1, [outer], [bbox], [10], null, 600, 1
    );
    const holeLoss = buildingLossDb(
      profileLats, profileLons, profileElevs,
      1, 1, [outer], [bbox], [10], null, 600, 1, [[inner]]
    );

    expect(holeLoss).toBeGreaterThan(0);
    expect(holeLoss).toBeLessThan(solidLoss);
  });
});
