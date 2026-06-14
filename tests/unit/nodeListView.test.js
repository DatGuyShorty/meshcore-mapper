import { describe, expect, it } from 'vitest';
import { buildNodeListRows } from '../../src/nodeListView.js';

describe('node list view model', () => {
  it('shows the empty node-list state before any repeaters exist', () => {
    expect(buildNodeListRows([])).toEqual([
      { kind: 'empty', text: 'No repeaters added yet.' },
    ]);
  });

  it('shows the filtered-empty state when nodes exist but do not match', () => {
    expect(buildNodeListRows([node({ name: 'Alpha' })], { filterText: 'bravo' })).toEqual([
      { kind: 'empty', text: 'No nodes match the filter.' },
    ]);
  });

  it('sorts by name and renders hidden, selected, and editing classes', () => {
    const rows = buildNodeListRows([
      node({ id: 2, name: 'Bravo', visible: false }),
      node({ id: 1, name: 'Alpha' }),
    ], {
      selectedNodeId: 2,
      editingId: 2,
    });

    expect(rows.map(row => row.kind === 'node' ? row.name : row.text)).toEqual(['Alpha', 'Bravo']);
    expect(rows[1]).toMatchObject({
      kind: 'node',
      id: '2',
      className: 'repeater-item ri-hidden ri-selected editing ri-planned',
      visibilityTitle: 'Show',
      visibilityText: 'Off',
    });
  });

  it('filters on name, coordinates, radio specs, and live feed metadata', () => {
    const rows = buildNodeListRows([
      node({ name: 'Manual Node', height: 30 }),
      node({ name: 'Live Node', fromWs: true, short: 'abc123', lastSeen: '2026-06-14T10:00Z' }),
    ], { filterText: 'abc123', now: '2026-06-14T10:05:00Z' });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'node',
      name: 'Live Node',
      subText: '48.2863, 18.5054 \u00b7 seen 5m ago',
      healthState: 'live',
      healthLabel: 'Live',
    });
  });

  it('marks stale and missing live nodes for scanning', () => {
    const rows = buildNodeListRows([
      node({ id: 1, name: 'Old Live', fromWs: true, lastSeen: '2026-06-14T09:00:00Z' }),
      node({ id: 2, name: 'No Timestamp', fromWs: true, lastSeen: null }),
    ], { now: '2026-06-14T10:00:00Z' });

    expect(rows[0]).toMatchObject({
      kind: 'node',
      className: expect.stringContaining('ri-missing'),
      healthLabel: 'Missing',
      subText: '48.2863, 18.5054 \u00b7 no live timestamp',
    });
    expect(rows[1]).toMatchObject({
      kind: 'node',
      className: expect.stringContaining('ri-stale'),
      healthLabel: 'Stale',
      subText: '48.2863, 18.5054 \u00b7 seen 1h ago',
    });
  });

  it('can sort names descending', () => {
    const rows = buildNodeListRows([
      node({ name: 'Alpha' }),
      node({ name: 'Bravo' }),
    ], { sortMode: 'name-za' });

    expect(rows.map(row => row.kind === 'node' ? row.name : row.text)).toEqual(['Bravo', 'Alpha']);
  });

  function node(overrides = {}) {
    return {
      id: 1,
      name: 'Alpha',
      lat: 48.28625,
      lon: 18.5054,
      height: 12,
      power: 22,
      freq: 869.525,
      gain: 8,
      color: '#61dafb',
      visible: true,
      ...overrides,
    };
  }
});
