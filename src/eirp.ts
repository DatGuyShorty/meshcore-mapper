/**
 * Shared regulatory EIRP awareness for any TX power + antenna gain pair.
 * Used by the Add Node form, the P2P link budget, and the optimizer search inputs.
 */

export type EirpLimit = {
  limit: number;
  region: string;
};

export type EirpHintIds = {
  powerId: string;
  gainId: string;
  freqId: string;
  hintId: string;
};

/**
 * Regulatory EIRP ceiling for the band a frequency falls in, or null if unknown.
 * Common amateur/ISM mesh limits - not legal advice.
 */
export function regulatoryEirpLimit(freqMhz: number): EirpLimit | null {
  if (freqMhz >= 433 && freqMhz <= 435) return { limit: 10, region: 'EU 433 MHz' };
  if (freqMhz >= 863 && freqMhz <= 870) return { limit: 27, region: 'EU 868 MHz (1% duty)' };
  if (freqMhz >= 902 && freqMhz <= 928) return { limit: 30, region: 'US 915 MHz' };
  return null;
}

/**
 * Warning text when TX power + antenna gain exceeds the band's EIRP ceiling, or
 * '' when within limits or the band is unknown.
 */
export function eirpWarning(power: number, gain: number, freq: number): string {
  const reg = regulatoryEirpLimit(freq);
  if (!Number.isFinite(power) || !Number.isFinite(gain) || !reg) return '';
  const eirp = power + gain;
  if (eirp <= reg.limit) return '';
  return `EIRP ${eirp.toFixed(1)} dBm (TX ${power} + ${gain} dBi) exceeds the ${reg.region} ceiling of ${reg.limit} dBm.`;
}

/**
 * Wire a live EIRP hint element to a power/gain/freq input triplet. Updates the
 * hint text and visibility on input. No-op if the hint element is absent.
 */
export function attachEirpHint({ powerId, gainId, freqId, hintId }: EirpHintIds): () => void {
  const hint = document.getElementById(hintId);
  if (!hint) return () => {};
  const num = (id: string): number => parseFloat((document.getElementById(id) as HTMLInputElement | null)?.value ?? '');
  const update = () => {
    const msg = eirpWarning(num(powerId), num(gainId), num(freqId));
    hint.textContent = msg;
    hint.classList.toggle('hidden', !msg);
  };
  for (const id of [powerId, gainId, freqId]) {
    document.getElementById(id)?.addEventListener('input', update);
  }
  update();
  return update;
}
