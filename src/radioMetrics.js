export const LORA_REQUIRED_SNR_DB = Object.freeze({
  7: -7.5,
  8: -10,
  9: -12.5,
  10: -15,
  11: -17.5,
  12: -20,
});

export function parseSpreadingFactor(text) {
  const match = String(text ?? '').match(/\bSF\s*(7|8|9|10|11|12)\b/i);
  return match ? Number(match[1]) : null;
}

export function inferSpreadingFactorFromSensitivity(rxSens) {
  const sens = Number(rxSens);
  if (!Number.isFinite(sens)) return 11;
  if (sens <= -136) return 12;
  if (sens <= -133) return 11;
  if (sens <= -130) return 10;
  if (sens <= -128) return 9;
  if (sens <= -125) return 8;
  return 7;
}

export function requiredSnrForSpreadingFactor(sf) {
  return LORA_REQUIRED_SNR_DB[sf] ?? LORA_REQUIRED_SNR_DB[11];
}

export function deriveRadioMetrics({ modemText = '', rxSens = -133, fadeMargin = 0 } = {}) {
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

export function selectedModemText(doc = globalThis.document) {
  const select = doc?.getElementById?.('modem-preset');
  if (!select) return '';
  const selected = select.selectedOptions?.[0] ?? select.options?.[select.selectedIndex];
  return `${select.value ?? ''} ${selected?.textContent ?? ''}`;
}
