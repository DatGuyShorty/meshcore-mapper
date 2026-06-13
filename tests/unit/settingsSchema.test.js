import { describe, expect, it } from 'vitest';
import { parseSettingsJson, parseSettingsRecord } from '../../src/settingsSchema.js';

describe('settings schema helpers', () => {
  it('accepts plain setting records and rejects non-object roots', () => {
    expect(parseSettingsRecord({ a: 1, b: false })).toEqual({ a: 1, b: false });
    expect(parseSettingsRecord(null)).toBeNull();
    expect(parseSettingsRecord([])).toBeNull();
    expect(parseSettingsRecord('bad')).toBeNull();
  });

  it('filters to known setting ids when an allowlist is supplied', () => {
    expect(parseSettingsRecord(
      { known: 'yes', other: 'ignored', checked: true },
      ['known', 'checked', 'missing'],
    )).toEqual({ known: 'yes', checked: true });
  });

  it('parses JSON safely', () => {
    expect(parseSettingsJson('{"known":"yes","extra":"no"}', ['known'])).toEqual({ known: 'yes' });
    expect(parseSettingsJson('{bad')).toBeNull();
    expect(parseSettingsJson('[]')).toBeNull();
  });
});
