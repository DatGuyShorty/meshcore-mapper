import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/elevation.js', () => ({
  fetchElevations: vi.fn(async points => points.map(() => 0)),
}));

vi.mock('../../src/foliage.js', () => ({
  fetchFoliage: vi.fn(async () => null),
  foliageLossDb: vi.fn(() => 0),
}));

vi.mock('../../src/buildings.js', () => ({
  fetchBuildings: vi.fn(async () => null),
  buildingLossDb: vi.fn(() => 0),
}));

import { findBestPath } from '../../src/pathfinder.js';

describe('relay pathfinder', () => {
  const nodes = [
    node(1, 'A', 0, 0),
    node(2, 'B', 0, 0.09),
    node(3, 'C', 0, 0.18),
  ];

  it('prefers the higher-bottleneck relay path over a weaker direct path', async () => {
    const progress = [];
    const result = await findBestPath(nodes, 1, 3, -133, 2, false, {
      pathHopRadiusKm: 25,
      useFoliage: false,
      useBuildings: false,
      onProgress: (pct, msg) => progress.push({ pct, msg }),
    });

    expect(result).not.toBeNull();
    expect(result.numHops).toBe(2);
    expect(result.path.map(hop => hop.node.name)).toEqual(['A', 'B', 'C']);
    expect(result.edgeDistances).toHaveLength(2);
    expect(result.edgeRxPowers).toHaveLength(2);
    expect(result.edgeRxPowers[0]).toBeCloseTo(result.path[1].incomingMargin - 133, 1);
    expect(result.path[1].incomingMargin).toBeGreaterThan(result.bottleneck - 0.01);
    expect(progress[0]).toMatchObject({ pct: 2 });
    expect(progress.at(-1)).toMatchObject({ pct: 100, msg: 'Relay path ready.' });
  });

  it('returns null when the hop radius disconnects the graph', async () => {
    await expect(findBestPath(nodes, 1, 3, -133, 2, false, {
      pathHopRadiusKm: 5,
      useFoliage: false,
      useBuildings: false,
    })).resolves.toBeNull();
  });

  function node(id, name, lat, lon) {
    return {
      id,
      name,
      lat,
      lon,
      height: 10,
      power: 20,
      freq: 868,
      gain: 2,
    };
  }
});
