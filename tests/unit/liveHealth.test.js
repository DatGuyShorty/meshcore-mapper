import { describe, expect, it } from 'vitest';
import { liveHealthSummary, nodeHealth } from '../../src/liveHealth.js';

describe('live health helpers', () => {
  const now = '2026-06-14T12:00:00Z';

  it('marks manual nodes as planned', () => {
    expect(nodeHealth({ fromWs: false }, { now })).toMatchObject({
      state: 'planned',
      label: 'Planned',
      detail: 'manual node',
      className: 'ri-planned',
    });
  });

  it('marks recent live nodes as live', () => {
    expect(nodeHealth({ fromWs: true, lastSeen: '2026-06-14T11:58:30Z' }, { now })).toMatchObject({
      state: 'live',
      label: 'Live',
      detail: 'seen 1m ago',
    });
  });

  it('marks old live nodes as stale', () => {
    expect(nodeHealth({ fromWs: true, lastSeen: '2026-06-14T11:20:00Z' }, { now })).toMatchObject({
      state: 'stale',
      label: 'Stale',
      detail: 'seen 40m ago',
    });
  });

  it('marks live nodes without timestamps as missing', () => {
    expect(nodeHealth({ fromWs: true, lastSeen: null }, { now })).toMatchObject({
      state: 'missing',
      label: 'Missing',
      detail: 'no live timestamp',
    });
  });

  it('summarizes live feed health counts', () => {
    expect(liveHealthSummary([
      { fromWs: false },
      { fromWs: true, lastSeen: '2026-06-14T11:59:00Z' },
      { fromWs: true, lastSeen: '2026-06-14T11:00:00Z' },
      { fromWs: true },
    ], { now })).toEqual({
      planned: 1,
      live: 1,
      stale: 1,
      missing: 1,
      alert: true,
      text: '1 live, 1 stale, 1 missing timestamp, 1 planned',
    });
  });
});
