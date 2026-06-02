// @ts-check
/**
 * LoRa modem metrics — pure helpers, type-checked under `npm run typecheck`.
 */

/** @type {Readonly<Record<7|8|9|10|11|12, number>>} */
export const LORA_REQUIRED_SNR_DB = Object.freeze({
  7: -7.5,
  8: -10,
  9: -12.5,
  10: -15,
  11: -17.5,
  12: -20,
});

/**
 * Pull the spreading factor out of a modem-preset label like "SF11 BW250".
 * @param {unknown} text
 * @returns {number | null}
 */
export function parseSpreadingFactor(text) {
  const match = String(text ?? '').match(/\bSF\s*(7|8|9|10|11|12)\b/i);
  return match ? Number(match[1]) : null;
}

/**
 * Best-effort SF guess from a sensitivity figure when the modem preset is
 * unknown. Thresholds match the SX1262 datasheet values.
 * @param {unknown} rxSens
 * @returns {number}
 */
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

/**
 * @param {number} sf
 * @returns {number}
 */
export function requiredSnrForSpreadingFactor(sf) {
  const key = /** @type {7|8|9|10|11|12} */ (sf);
  return LORA_REQUIRED_SNR_DB[key] ?? LORA_REQUIRED_SNR_DB[11];
}

/**
 * @typedef {Object} RadioMetrics
 * @property {number} spreadingFactor
 * @property {number} requiredSnrDb
 * @property {number} requiredSnrWithMarginDb
 * @property {number} noiseFloorDbm
 */

/**
 * @param {{ modemText?: string, rxSens?: number, fadeMargin?: number }} [opts]
 * @returns {RadioMetrics}
 */
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

/**
 * @param {Document} [doc]
 * @returns {string}
 */
export function selectedModemText(doc = globalThis.document) {
  const select = /** @type {HTMLSelectElement | null} */ (doc?.getElementById?.('modem-preset'));
  if (!select) return '';
  const selected = select.selectedOptions?.[0] ?? select.options?.[select.selectedIndex];
  return `${select.value ?? ''} ${selected?.textContent ?? ''}`;
}
