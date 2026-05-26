import { describe, expect, it } from 'vitest';
import {
  normalizeWsRepeaterSnapshot,
  parseConfigRepeater,
  parseConfigRepeaters,
} from '../../src/repeaterRows.js';

describe('repeater row validation helpers', () => {
  it('parses valid config repeaters and skips invalid rows before import', () => {
    const rows = parseConfigRepeaters([
      { name: 'A', lat: '48.1', lon: '18.2', height: '12', power: '20', freq: '869.525', gain: '' },
      { name: 'bad coords', lat: '91', lon: '18', height: '12', power: '20', freq: '869' },
      { name: 'bad freq', lat: '48', lon: '18', height: '12', power: '20', freq: '0' },
    ]);

    expect(rows).toEqual([{
      name: 'A',
      lat: 48.1,
      lon: 18.2,
      height: 12,
      power: 20,
      freq: 869.525,
      gain: 2,
    }]);
    expect(parseConfigRepeater({ lat: 48, lon: 18, height: 10, power: 20, freq: -1 })).toBeNull();
  });

  it('normalizes bare-array and payload WebSocket snapshots', () => {
    const snapshot = normalizeWsRepeaterSnapshot({
      payload: [
        { id: 'node-a', name: 'A', lat: '48', lon: '18' },
        { id: 'node-a', name: 'duplicate', lat: '48.1', lon: '18.1' },
        { id: 'bad', lat: 'nope', lon: '18' },
      ],
    });

    expect(snapshot.ok).toBe(true);
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({ lat: 48, lon: 18, wsKey: 'node-a' });
    expect(snapshot.duplicateCount).toBe(1);
    expect(snapshot.invalidCount).toBe(1);
  });

  it('distinguishes explicit WS clears from transient empty snapshots', () => {
    expect(normalizeWsRepeaterSnapshot([])).toMatchObject({
      ok: true,
      explicitClear: false,
      rows: [],
    });
    expect(normalizeWsRepeaterSnapshot({ clear: true })).toMatchObject({
      ok: true,
      explicitClear: true,
      rows: [],
    });
    expect(normalizeWsRepeaterSnapshot({ payload: [{ lat: 95, lon: 18 }] })).toMatchObject({
      ok: true,
      explicitClear: false,
      invalidCount: 1,
      rows: [],
    });
  });
});
