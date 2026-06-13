import { describe, expect, it } from 'vitest';
import {
  boundedInteger,
  safeSource,
  safeWsRow,
  validBlobPayload,
  validLatLon,
} from '../../src/main/ipcSchemas.js';

describe('IPC schema helpers', () => {
  it('validates coordinate bounds strictly', () => {
    expect(validLatLon(48, 18)).toBe(true);
    expect(validLatLon('48', 18)).toBe(true);
    expect(validLatLon(91, 18)).toBe(false);
    expect(validLatLon(48, -181)).toBe(false);
    expect(validLatLon(Number.NaN, 18)).toBe(false);
  });

  it('bounds integer payload fields', () => {
    expect(boundedInteger(12, 0, 30)).toBe(12);
    expect(boundedInteger('12', 0, 30)).toBe(12);
    expect(boundedInteger(12.5, 0, 30)).toBeNull();
    expect(boundedInteger(-1, 0, 30)).toBeNull();
    expect(boundedInteger(31, 0, 30)).toBeNull();
  });

  it('allows only compact cache source identifiers', () => {
    expect(safeSource(' terrarium ')).toBe('terrarium');
    expect(safeSource('srtm:1_arc-sec')).toBe('srtm:1_arc-sec');
    expect(safeSource('../bad')).toBeNull();
    expect(safeSource('x'.repeat(49))).toBeNull();
    expect(safeSource(null)).toBeNull();
  });

  it('accepts bounded blob payload shapes', () => {
    expect(validBlobPayload(new Uint8Array([1, 2]))).toBeInstanceOf(Uint8Array);
    expect(validBlobPayload(new ArrayBuffer(2))).toBeInstanceOf(ArrayBuffer);
    expect(validBlobPayload([1, 2, 3])).toEqual([1, 2, 3]);
    expect(validBlobPayload(new Array(8 * 1024 * 1024 + 1))).toBeNull();
    expect(validBlobPayload(null)).toBeNull();
  });

  it('sanitizes persisted WebSocket repeater rows', () => {
    const row = safeWsRow({
      name: 'n'.repeat(200),
      short: 's'.repeat(200),
      lastSeen: 't'.repeat(200),
      wsKey: 'k'.repeat(200),
      lat: '48.1',
      lon: '18.2',
    });

    expect(row).toMatchObject({ lat: 48.1, lon: 18.2 });
    expect(row?.name).toHaveLength(120);
    expect(row?.short).toHaveLength(80);
    expect(row?.lastSeen).toHaveLength(80);
    expect(row?.wsKey).toHaveLength(160);
    expect(safeWsRow({ lat: 95, lon: 18 })).toBeNull();
  });
});
