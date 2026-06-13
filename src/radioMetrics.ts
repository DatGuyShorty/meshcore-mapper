/**
 * LoRa modem metrics - pure helpers, type-checked under `npm run typecheck`.
 */

export type SpreadingFactor = 7 | 8 | 9 | 10 | 11 | 12;

export type RadioMetrics = {
  spreadingFactor: SpreadingFactor;
  requiredSnrDb: number;
  requiredSnrWithMarginDb: number;
  noiseFloorDbm: number;
};

export const LORA_REQUIRED_SNR_DB: Readonly<Record<SpreadingFactor, number>> = Object.freeze({
  7: -7.5,
  8: -10,
  9: -12.5,
  10: -15,
  11: -17.5,
  12: -20,
});

/**
 * Pull the spreading factor out of a modem-preset label like "SF11 BW250".
 */
export function parseSpreadingFactor(text: unknown): SpreadingFactor | null {
  const match = String(text ?? '').match(/\bSF\s*(7|8|9|10|11|12)\b/i);
  return match ? Number(match[1]) as SpreadingFactor : null;
}

/**
 * Best-effort SF guess from a sensitivity figure when the modem preset is
 * unknown. Thresholds match the SX1262 datasheet values.
 */
export function inferSpreadingFactorFromSensitivity(rxSens: unknown): SpreadingFactor {
  const sens = Number(rxSens);
  if (!Number.isFinite(sens)) return 11;
  if (sens <= -136) return 12;
  if (sens <= -133) return 11;
  if (sens <= -130) return 10;
  if (sens <= -128) return 9;
  if (sens <= -125) return 8;
  return 7;
}

export function requiredSnrForSpreadingFactor(sf: number): number {
  const key = sf as SpreadingFactor;
  return LORA_REQUIRED_SNR_DB[key] ?? LORA_REQUIRED_SNR_DB[11];
}

export function deriveRadioMetrics({
  modemText = '',
  rxSens = -133,
  fadeMargin = 0,
}: { modemText?: string; rxSens?: number; fadeMargin?: number } = {}): RadioMetrics {
  const spreadingFactor = parseSpreadingFactor(modemText) ?? inferSpreadingFactorFromSensitivity(rxSens);
  const requiredSnrDb = requiredSnrForSpreadingFactor(spreadingFactor);
  const sens = Number.isFinite(Number(rxSens)) ? Number(rxSens) : -133;
  const fade = Number.isFinite(Number(fadeMargin)) ? Number(fadeMargin) : 0;
  const noiseFloorDbm = sens - requiredSnrDb;
  return {
    spreadingFactor,
    requiredSnrDb,
    requiredSnrWithMarginDb: requiredSnrDb + fade,
    noiseFloorDbm,
  };
}

export function selectedModemText(doc: Document | undefined = globalThis.document): string {
  const select = doc?.getElementById?.('modem-preset') as HTMLSelectElement | null;
  if (!select) return '';
  const selected = select.selectedOptions?.[0] ?? select.options?.[select.selectedIndex];
  return `${select.value ?? ''} ${selected?.textContent ?? ''}`;
}
