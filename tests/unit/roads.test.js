import { describe, expect, it } from 'vitest';
import { buildRoadOverpassQuery, extractRoadLines } from '../../src/roads.js';

describe('road access data helpers', () => {
  it('builds an Overpass query for highway ways', () => {
    expect(buildRoadOverpassQuery('(48.0000,18.0000,48.2500,18.2500)')).toContain('way["highway"]');
  });

  it('extracts accessible road lines and skips private or pedestrian-only ways', () => {
    const lines = extractRoadLines({
      elements: [
        {
          type: 'way',
          id: 1,
          tags: { highway: 'service' },
          geometry: [{ lat: 48, lon: 18 }, { lat: 48.001, lon: 18.002 }],
        },
        {
          type: 'way',
          id: 2,
          tags: { highway: 'track', access: 'private' },
          geometry: [{ lat: 48, lon: 18 }, { lat: 48.001, lon: 18.002 }],
        },
        {
          type: 'way',
          id: 3,
          tags: { highway: 'footway' },
          geometry: [{ lat: 48, lon: 18 }, { lat: 48.001, lon: 18.002 }],
        },
      ],
    });

    expect(lines).toEqual([
      {
        id: 'way:1',
        type: 'service',
        points: [
          { latitude: 48, longitude: 18 },
          { latitude: 48.001, longitude: 18.002 },
        ],
      },
    ]);
  });
});
