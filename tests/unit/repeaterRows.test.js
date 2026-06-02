import { describe, expect, it } from 'vitest';
import {
  normalizeWsRepeaterSnapshot,
  normalizeWsUrl,
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

  it('clamps WS snapshot string fields so a pathological payload cannot freeze the renderer', () => {
    const longName = 'n'.repeat(500);
    const longShort = 's'.repeat(500);
    const longLast = 't'.repeat(500);
    const longKey = 'k'.repeat(500);

    const snapshot = normalizeWsRepeaterSnapshot([
      {
        wsKey: longKey,
        name: longName,
        short: longShort,
        last_seen: longLast,
        lastSeen: longLast,
        lat: 48,
        lon: 18,
      },
    ]);

    expect(snapshot.ok).toBe(true);
    expect(snapshot.rows).toHaveLength(1);
    const row = snapshot.rows[0];
    // Caps mirror src/main/ipcHandlers.js#_safeWsRow.
    expect(row.name.length).toBe(120);
    expect(row.short.length).toBe(80);
    expect(row.last_seen.length).toBe(80);
    expect(row.lastSeen.length).toBe(80);
    expect(row.wsKey.length).toBe(160);
  });

  it('preserves null / undefined string fields when clamping', () => {
    const snapshot = normalizeWsRepeaterSnapshot([
      { name: null, short: undefined, lat: 48, lon: 18, id: 'k' },
    ]);

    expect(snapshot.ok).toBe(true);
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0].name).toBeNull();
    expect(snapshot.rows[0].short).toBeUndefined();
  });
});

describe('normalizeWsUrl', () => {
  it('passes ws:// and wss:// URLs through unchanged', () => {
    expect(normalizeWsUrl('ws://example.com:1880/ws')).toBe('ws://example.com:1880/ws');
    expect(normalizeWsUrl('wss://example.com/ws')).toBe('wss://example.com/ws');
  });

  it('upgrades http:// to ws:// and https:// to wss://', () => {
    expect(normalizeWsUrl('http://example.com:1880/ws')).toBe('ws://example.com:1880/ws');
    expect(normalizeWsUrl('https://example.com/ws')).toBe('wss://example.com/ws');
  });

  it('is case-insensitive on the scheme', () => {
    expect(normalizeWsUrl('HTTPS://Example.com/Ws')).toBe('wss://Example.com/Ws');
    expect(normalizeWsUrl('WS://host')).toBe('ws://host');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeWsUrl('  ws://host/  ')).toBe('ws://host/');
  });

  it('returns null for unsupported schemes', () => {
    expect(normalizeWsUrl('ftp://host/')).toBeNull();
    expect(normalizeWsUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeWsUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeWsUrl('//host:1880/ws')).toBeNull();
    expect(normalizeWsUrl('host:1880/ws')).toBeNull();
  });

  it('returns null for non-string or empty input', () => {
    expect(normalizeWsUrl(null)).toBeNull();
    expect(normalizeWsUrl(undefined)).toBeNull();
    expect(normalizeWsUrl(42)).toBeNull();
    expect(normalizeWsUrl('')).toBeNull();
    expect(normalizeWsUrl('   ')).toBeNull();
  });
});
