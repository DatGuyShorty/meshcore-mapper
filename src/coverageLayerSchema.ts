export type CoverageLayerRecord = Record<string, any> & { layerId: string };

export type CoverageLayerPref = {
  opacity?: number;
  visible?: boolean;
  label?: string;
};

export type CoverageLayerPrefs = Record<string, CoverageLayerPref>;

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseCoverageLayerRecord(value: unknown): CoverageLayerRecord | null {
  if (!isRecord(value)) return null;
  const layerId = typeof value.layerId === 'string' ? value.layerId.trim() : '';
  if (!layerId) return null;
  return { ...value, layerId };
}

export function parseCoverageLayerPref(value: unknown): CoverageLayerPref | null {
  if (!isRecord(value)) return null;
  const pref: CoverageLayerPref = {};
  const opacity = Number(value.opacity);
  if (Number.isFinite(opacity)) pref.opacity = Math.max(0.05, Math.min(1, opacity));
  if (typeof value.visible === 'boolean') pref.visible = value.visible;
  if (typeof value.label === 'string') pref.label = value.label.slice(0, 120);
  return Object.keys(pref).length ? pref : null;
}

export function parseCoverageLayerPrefs(value: unknown): CoverageLayerPrefs {
  if (!isRecord(value)) return {};
  const out: CoverageLayerPrefs = {};
  for (const [rawLayerId, rawPref] of Object.entries(value)) {
    const layerId = rawLayerId.trim();
    if (!layerId) continue;
    const pref = parseCoverageLayerPref(rawPref);
    if (pref) out[layerId] = pref;
  }
  return out;
}
