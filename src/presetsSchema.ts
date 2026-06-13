export type HardwarePreset = {
  id: string;
  label: string;
  tx_power: number;
};

export type RadioModePreset = {
  id: string;
  label: string;
  sensitivity: number;
  freq?: number;
};

export type AntennaPreset = {
  id: string;
  label: string;
  gain_dbi: number;
};

export type PresetData = {
  hardware: HardwarePreset[];
  radio_modes: RadioModePreset[];
  antenna: AntennaPreset[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseHardwarePreset(value: unknown): HardwarePreset | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = nonEmptyString(row.id);
  const label = nonEmptyString(row.label);
  const txPower = finiteNumber(row.tx_power);
  if (!id || !label || txPower === null) return null;
  return { id, label, tx_power: txPower };
}

function parseRadioModePreset(value: unknown): RadioModePreset | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = nonEmptyString(row.id);
  const label = nonEmptyString(row.label);
  const sensitivity = finiteNumber(row.sensitivity);
  if (!id || !label || sensitivity === null) return null;
  if (row.freq === undefined || row.freq === null) return { id, label, sensitivity };
  const freq = finiteNumber(row.freq);
  if (freq === null) return null;
  return { id, label, sensitivity, freq };
}

function parseAntennaPreset(value: unknown): AntennaPreset | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = nonEmptyString(row.id);
  const label = nonEmptyString(row.label);
  const gain = finiteNumber(row.gain_dbi);
  if (!id || !label || gain === null) return null;
  return { id, label, gain_dbi: gain };
}

function parseList<T>(value: unknown, parser: (row: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parser)
    .filter((row): row is T => row !== null);
}

function clonePresetData(data: PresetData): PresetData {
  return {
    hardware: data.hardware.map(item => ({ ...item })),
    radio_modes: data.radio_modes.map(item => ({ ...item })),
    antenna: data.antenna.map(item => ({ ...item })),
  };
}

export function parsePresetData(value: unknown, fallback: PresetData): PresetData {
  const root = asRecord(value);
  if (!root) return clonePresetData(fallback);

  const hardware = parseList(root.hardware, parseHardwarePreset);
  const radioModes = parseList(root.radio_modes, parseRadioModePreset);
  const antenna = parseList(root.antenna, parseAntennaPreset);

  return {
    hardware: hardware.length ? hardware : fallback.hardware.map(item => ({ ...item })),
    radio_modes: radioModes.length ? radioModes : fallback.radio_modes.map(item => ({ ...item })),
    antenna: antenna.length ? antenna : fallback.antenna.map(item => ({ ...item })),
  };
}
