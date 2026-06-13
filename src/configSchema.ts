import type { ConfigRepeater } from './repeaterRows.js';
import { parseConfigRepeaters } from './repeaterRows.js';
import { parseSettingsRecord, type SettingsRecord } from './settingsSchema.js';
export type { SettingsRecord };

export type ParsedSavedConfig = {
  settings: SettingsRecord | null;
  repeaters: ConfigRepeater[] | null;
  inputRepeaterCount: number | null;
};

export type SavedConfigParseResult =
  | { ok: true; config: ParsedSavedConfig }
  | { ok: false; reason: 'invalid-json' | 'invalid-config' | 'no-valid-repeaters' };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseSavedConfigValue(value: unknown): SavedConfigParseResult {
  if (!isPlainRecord(value)) return { ok: false, reason: 'invalid-config' };

  const rawSettings = value.settings;
  const settings = parseSettingsRecord(rawSettings);
  const rawRepeaters = value.repeaters;
  const hasRepeaterArray = Array.isArray(rawRepeaters);
  const repeaters = hasRepeaterArray ? parseConfigRepeaters(rawRepeaters) : null;
  const inputRepeaterCount = hasRepeaterArray ? rawRepeaters.length : null;

  if (hasRepeaterArray && rawRepeaters.length > 0 && repeaters?.length === 0) {
    return { ok: false, reason: 'no-valid-repeaters' };
  }

  return {
    ok: true,
    config: {
      settings,
      repeaters,
      inputRepeaterCount,
    },
  };
}

export function parseSavedConfigJson(json: string): SavedConfigParseResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  return parseSavedConfigValue(value);
}
