import { describe, expect, it } from 'vitest';
import {
  assembleMultipolygon,
  assembleRings,
  clampedGridFractions,
  featureDedupeKey,
  holeCandidatesForOuter,
  normalizeBbox,
  overpassBboxString,
  ringBBox,
  splitAntimeridianBbox,
  tileDescriptorsForBbox,
} from '../../src/osmGeometry.js';
import { segmentPolygonIntervalsWithHoles } from '../../src/propagation.js';

describe('OSM geometry helpers', () => {
  it('assembles split multipolygon outer members into a closed ring', () => {
    const rings = assembleRings([
      [[0, 0], [0, 1]],
      [[1, 1], [1, 0]],
      [[0, 1], [1, 1]],
      [[1, 0], [0, 0]],
    ]);

    expect(rings).toHaveLength(1);
    expect(rings[0][0]).toEqual(rings[0][rings[0].length - 1]);
    expect(new Set(rings[0].map(pt => pt.join(',')))).toEqual(new Set([
      '0,0',
      '0,1',
      '1,1',
      '1,0',
    ]));
  });

  it('dedupes identical tile geometry without dropping same-id fragments', () => {
    const west = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
    const east = [[0, 1], [0, 2], [1, 2], [1, 1], [0, 1]];
    const westCopy = west.map(pt => pt.slice());
    const id = 'relation:123:outer:0';

    expect(featureDedupeKey(id, west, ringBBox(west))).toBe(featureDedupeKey(id, westCopy, ringBBox(westCopy)));
    expect(featureDedupeKey(id, west, ringBBox(west))).not.toBe(featureDedupeKey(id, east, ringBBox(east)));
  });

  it('normalizes and splits antimeridian bounding boxes for OSM tile iteration', () => {
    const bbox = normalizeBbox(-1, 1, 179.8, 180.2);
    const parts = splitAntimeridianBbox(bbox);
    const tiles = tileDescriptorsForBbox(-1, 1, 179.8, 180.2, 't:', 0.25);

    expect(bbox.crossesAntimeridian).toBe(true);
    expect(parts[0]).toMatchObject({ latMin: -1, latMax: 1, lonMax: 180 });
    expect(parts[0].lonMin).toBeCloseTo(179.8);
    expect(parts[1]).toMatchObject({ latMin: -1, latMax: 1, lonMin: -180 });
    expect(parts[1].lonMax).toBeCloseTo(-179.8);
    expect(tiles.some(t => t.lonMin >= 179.75 && t.lonMax <= 180)).toBe(true);
    expect(tiles.some(t => t.lonMin === -180 && t.lonMax <= -179.75)).toBe(true);
    expect(overpassBboxString(tiles[0])).toMatch(/^\(-?\d+\.\d{4},-?\d+\.\d{4},-?\d+\.\d{4},-?\d+\.\d{4}\)$/);
  });

  it('handles pole-safe full-world longitude spans', () => {
    const bbox = normalizeBbox(85, 90.5, -400, 20);
    const tiles = tileDescriptorsForBbox(85, 90.5, -400, 20, 'p:', 10);

    expect(bbox).toMatchObject({ latMin: 85, latMax: 90, lonMin: -180, lonMax: 180 });
    expect(tiles.every(t => t.latMax <= 90 && t.lonMin >= -180 && t.lonMax <= 180)).toBe(true);
  });

  it('assembles multipolygon holes and subtracts them from line intersections', () => {
    const geometries = new Map([
      ['way:1', [{ lat: 0, lon: 0 }, { lat: 0, lon: 4 }]],
      ['way:2', [{ lat: 0, lon: 4 }, { lat: 4, lon: 4 }, { lat: 4, lon: 0 }, { lat: 0, lon: 0 }]],
      ['way:3', [{ lat: 1, lon: 1 }, { lat: 1, lon: 3 }, { lat: 3, lon: 3 }, { lat: 3, lon: 1 }, { lat: 1, lon: 1 }]],
    ]);
    const multi = assembleMultipolygon([
      { type: 'way', ref: 1, role: 'outer' },
      { type: 'way', ref: 2, role: 'outer' },
      { type: 'way', ref: 3, role: 'inner' },
    ], member => geometries.get(`${member.type}:${member.ref}`));
    const outer = multi.outers[0];
    const holes = holeCandidatesForOuter(outer, multi.holes);
    const intervals = segmentPolygonIntervalsWithHoles(2, -1, 2, 5, outer, holes);

    expect(multi.outers).toHaveLength(1);
    expect(multi.holes).toHaveLength(1);
    expect(intervals).toEqual([[1 / 6, 1 / 3], [2 / 3, 5 / 6]]);
  });

  it('assigns a hole to the outer that contains it, not merely a bbox-overlapping one', () => {
    // A relation with two outer rings whose bounding boxes BOTH cover the
    // clearing, but only one geometrically contains it:
    //   outer A — solid square lon 0..6, lat 0..6, holds the clearing.
    //   outer B — C-shape opening downward; its bbox is lon 0..6, lat 7..13
    //             (north of A) so it does NOT overlap the clearing... we need
    //             overlap. Instead nest B's bbox around the clearing:
    //   outer B — C-shape with bbox lon 0..6 / lat 0..6 (same as A) but whose
    //             solid mass sits in the lon 4.5..6 band, leaving the clearing
    //             at lon 2..4 outside B's polygon though inside B's bbox.
    const geometries = new Map([
      ['way:1', [{ lat: 0, lon: 0 }, { lat: 0, lon: 6 }, { lat: 6, lon: 6 }, { lat: 6, lon: 0 }, { lat: 0, lon: 0 }]],
      // C-shape: spans the full bbox lon 0..6 / lat 0..6 but is hollow on the
      // left — only the right arm (lon 4.5..6) and the top/bottom bars are
      // solid. The clearing at lon 2..4 / lat 2..4 lies in the hollow, i.e.
      // inside B's bbox but OUTSIDE B's polygon.
      ['way:2', [
        { lat: 0, lon: 0 }, { lat: 0.5, lon: 0 }, { lat: 0.5, lon: 4.5 }, { lat: 5.5, lon: 4.5 },
        { lat: 5.5, lon: 0 }, { lat: 6, lon: 0 }, { lat: 6, lon: 6 }, { lat: 0, lon: 6 }, { lat: 0, lon: 0 },
      ]],
      ['way:3', [{ lat: 2, lon: 2 }, { lat: 2, lon: 4 }, { lat: 4, lon: 4 }, { lat: 4, lon: 2 }, { lat: 2, lon: 2 }]],
    ]);
    const multi = assembleMultipolygon([
      { type: 'way', ref: 1, role: 'outer' },
      { type: 'way', ref: 2, role: 'outer' },
      { type: 'way', ref: 3, role: 'inner' },
    ], member => geometries.get(`${member.type}:${member.ref}`));

    expect(multi.outers).toHaveLength(2);
    expect(multi.holes).toHaveLength(1);

    const outerA = geometries.get('way:1').map(p => [p.lat, p.lon]);
    const outerB = geometries.get('way:2').map(p => [p.lat, p.lon]);

    // A genuinely contains the clearing; B's bbox covers it but its polygon
    // does not. A correct (containment-aware) assigner gives the hole to A
    // only. The current bbox-overlap implementation wrongly gives it to BOTH.
    expect(holeCandidatesForOuter(outerA, multi.holes)).toHaveLength(1);
    expect(holeCandidatesForOuter(outerB, multi.holes)).toHaveLength(0);
  });

  it('clamps grid interpolation fractions to the sampled bounds', () => {
    expect(clampedGridFractions(20, -10, {
      latMin: 0,
      latMax: 10,
      lonMin: 0,
      lonMax: 10,
    })).toEqual({ row: 0, col: 0 });
    expect(clampedGridFractions(-5, 15, {
      latMin: 0,
      latMax: 10,
      lonMin: 0,
      lonMax: 10,
    })).toEqual({ row: 1, col: 1 });
  });
});
