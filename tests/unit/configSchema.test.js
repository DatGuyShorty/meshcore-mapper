import { describe, expect, it } from 'vitest';
import { parseSavedConfigJson, parseSavedConfigValue } from '../../src/configSchema.js';

describe('saved config schema helpers', () => {
  it('rejects invalid JSON and non-object config roots', () => {
    expect(parseSavedConfigJson('{bad')).toEqual({ ok: false, reason: 'invalid-json' });
    expect(parseSavedConfigValue(null)).toEqual({ ok: false, reason: 'invalid-config' });
    expect(parseSavedConfigValue([])).toEqual({ ok: false, reason: 'invalid-config' });
  });

  it('accepts settings only when they are a plain object', () => {
    expect(parseSavedConfigValue({ settings: { 'rx-height': '2' } })).toEqual({
      ok: true,
      config: {
        settings: { 'rx-height': '2' },
        repeaters: null,
        inputRepeaterCount: null,
      },
    });

    expect(parseSavedConfigValue({ settings: 'bad' })).toEqual({
      ok: true,
      config: {
        settings: null,
        repeaters: null,
        inputRepeaterCount: null,
      },
    });
  });

  it('normalizes valid repeaters and tracks skipped rows', () => {
    const parsed = parseSavedConfigValue({
      repeaters: [
        { name: 'A', lat: '48.1', lon: '18.2', height: '10', power: '20', freq: '869.525', gain: '3' },
        { name: 'bad', lat: '91', lon: '18', height: '10', power: '20', freq: '869.525' },
      ],
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.config.inputRepeaterCount).toBe(2);
    expect(parsed.ok && parsed.config.repeaters).toEqual([{
      name: 'A',
      lat: 48.1,
      lon: 18.2,
      height: 10,
      power: 20,
      freq: 869.525,
      gain: 3,
    }]);
  });

  it('rejects non-empty repeater arrays with no valid rows', () => {
    expect(parseSavedConfigValue({
      repeaters: [
        { name: 'bad coords', lat: '91', lon: '18', height: '10', power: '20', freq: '869.525' },
      ],
    })).toEqual({ ok: false, reason: 'no-valid-repeaters' });
  });
});
