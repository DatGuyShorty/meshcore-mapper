import { describe, expect, it } from 'vitest';
import {
  buildFoliageOverpassQuery,
  classifyFoliageTags,
  foliageLossDb,
} from '../../src/foliage.js';

describe('foliage blocker extraction helpers', () => {
  it('classifies dense and sparse vegetation with different canopy defaults', () => {
    const forest = classifyFoliageTags({ landuse: 'forest' });
    const heath = classifyFoliageTags({ natural: 'heath' });
    const mangrove = classifyFoliageTags({ natural: 'wetland', wetland: 'mangrove' });

    expect(forest.kind).toBe('forest');
    expect(forest.factor).toBeGreaterThan(heath.factor);
    expect(mangrove.canopyHeight).toBeGreaterThan(heath.canopyHeight);
  });

  it('uses explicit vegetation height tags when present', () => {
    const treeRow = classifyFoliageTags({ natural: 'tree_row', height: '18 m' });

    expect(treeRow.kind).toBe('tree_row');
    expect(treeRow.canopyHeight).toBe(18);
    expect(treeRow.linearWidthM).toBeGreaterThan(0);
  });

  it('supports point-based tree nodes', () => {
    const tree = classifyFoliageTags({ natural: 'tree' });

    expect(tree).not.toBeNull();
    expect(tree.kind).toBe('forest');
    expect(tree.canopyHeight).toBeGreaterThan(0);
  });

  it('supports natural=forest areas', () => {
    const forest = classifyFoliageTags({ natural: 'forest' });

    expect(forest).not.toBeNull();
    expect(forest.kind).toBe('forest');
    expect(forest.canopyHeight).toBe(20);
  });

  it('supports meadow areas', () => {
    const meadow = classifyFoliageTags({ natural: 'meadow' });

    expect(meadow).not.toBeNull();
    expect(meadow.kind).toBe('meadow');
    expect(meadow.canopyHeight).toBe(0.5);
  });

  it('supports farmland areas', () => {
    const farmland = classifyFoliageTags({ landuse: 'farmland' });

    expect(farmland).not.toBeNull();
    expect(farmland.kind).toBe('farmland');
    expect(farmland.canopyHeight).toBe(0.5);
  });

  it('supports grassland areas', () => {
    const grassland = classifyFoliageTags({ natural: 'grassland' });

    expect(grassland).not.toBeNull();
    expect(grassland.kind).toBe('meadow');
    expect(grassland.canopyHeight).toBe(0.5);
  });

  it('supports park areas', () => {
    const park = classifyFoliageTags({ leisure: 'park' });

    expect(park).not.toBeNull();
    expect(park.kind).toBe('park');
    expect(park.canopyHeight).toBe(2);
  });

  it('supports landuse=grass areas', () => {
    const grass = classifyFoliageTags({ landuse: 'grass' });

    expect(grass).not.toBeNull();
    expect(grass.kind).toBe('meadow');
    expect(grass.canopyHeight).toBe(0.5);
  });

  it('classifies narrow linear foliage blockers', () => {
    const hedge = classifyFoliageTags({ barrier: 'hedge' });

    expect(hedge.kind).toBe('hedge');
    expect(hedge.linearWidthM).toBeGreaterThan(0);
  });

  it('queries expanded vegetation feature classes', () => {
    const query = buildFoliageOverpassQuery('(1,2,3,4)');

    expect(query).toContain('["landuse"="forest"]');
    expect(query).toContain('["landuse"="plant_nursery"]');
    expect(query).toContain('["landuse"="plantation"]');
    expect(query).toContain('["landuse"="meadow"]');
    expect(query).toContain('["landuse"="farmland"]');
    expect(query).toContain('["landuse"="park"]');
    expect(query).toContain('["landuse"="grass"]');
    expect(query).toContain('["landcover"="grass"]');
    expect(query).toContain('["leisure"="park"]');
    expect(query).toContain('["natural"="tree"]');
    expect(query).toContain('["natural"="park"]');
    expect(query).toContain('["natural"="farmland"]');
    expect(query).toContain('["natural"="meadow"]');
    expect(query).toContain('["natural"="grassland"]');
    expect(query).toContain('["natural"="tree_row"]');
    expect(query).toContain('["barrier"="hedge"]');
    expect(query).toContain('node["barrier"="hedge"]');
    expect(query).toContain('["natural"="mangrove"]');
  });

  it('preserves multipolygon holes when computing foliage loss', () => {
    const profileLats = new Float64Array([2, 2]);
    const profileLons = new Float64Array([-1, 5]);
    const profileElevs = new Float32Array([0, 0]);
    const outer = [[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]];
    const inner = [[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]];
    const bbox = { latMin: 0, latMax: 4, lonMin: 0, lonMax: 4 };

    const solidLoss = foliageLossDb(
      profileLats, profileLons, profileElevs,
      1, 1, [outer], [bbox], [20], [1], null, 600, 0.5, 868
    );
    const holeLoss = foliageLossDb(
      profileLats, profileLons, profileElevs,
      1, 1, [outer], [bbox], [20], [1], null, 600, 0.5, 868, [[inner]]
    );

    expect(holeLoss).toBeGreaterThan(0);
    expect(holeLoss).toBeLessThan(solidLoss);
  });
});
