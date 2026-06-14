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
      className: 'repeater-item ri-hidden ri-selected editing',
      visibilityTitle: 'Show',
      visibilityText: 'Off',
    });
  });

  it('filters on name, coordinates, radio specs, and live feed metadata', () => {
    const rows = buildNodeListRows([
      node({ name: 'Manual Node', height: 30 }),
      node({ name: 'Live Node', fromWs: true, short: 'abc123', lastSeen: '2026-06-14T10:00Z' }),
    ], { filterText: 'abc123' });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'node',
      name: 'Live Node',
      subText: '48.2863, 18.5054 \u00b7 2026-06-14T10:00Z',
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
