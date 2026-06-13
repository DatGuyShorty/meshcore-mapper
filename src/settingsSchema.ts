export type SettingsRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is SettingsRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseSettingsRecord(value: unknown, allowedIds?: Iterable<string>): SettingsRecord | null {
  if (!isPlainRecord(value)) return null;
  if (!allowedIds) return { ...value };

  const out: SettingsRecord = {};
  for (const id of allowedIds) {
    if (Object.prototype.hasOwnProperty.call(value, id)) out[id] = value[id];
  }
  return out;
}

export function parseSettingsJson(json: string, allowedIds?: Iterable<string>): SettingsRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  return parseSettingsRecord(value, allowedIds);
}
