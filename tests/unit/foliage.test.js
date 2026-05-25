import { describe, expect, it } from 'vitest';
import {
  buildFoliageOverpassQuery,
  classifyFoliageTags,
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

  it('classifies narrow linear foliage blockers', () => {
    const hedge = classifyFoliageTags({ barrier: 'hedge' });

    expect(hedge.kind).toBe('hedge');
    expect(hedge.linearWidthM).toBeGreaterThan(0);
    expect(classifyFoliageTags({ landuse: 'grass' })).toBeNull();
  });

  it('queries expanded vegetation feature classes', () => {
    const query = buildFoliageOverpassQuery('(1,2,3,4)');

    expect(query).toContain('["landuse"="forest"]');
    expect(query).toContain('["landuse"="plant_nursery"]');
    expect(query).toContain('["natural"="tree_row"]');
    expect(query).toContain('["barrier"="hedge"]');
    expect(query).toContain('["natural"="mangrove"]');
  });
});
