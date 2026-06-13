/**
 * presets.ts — Populates radio, region, modem, and antenna select elements
 * from presets.yaml (loaded via IPC). Falls back to built-in defaults if the
 * file cannot be read.
 * Exports: init
 */

import { parsePresetData, type PresetData } from './presetsSchema.js';

type SelectOption = {
  value: string;
  text: string;
};

type ValueElement = EventTarget & {
  value: string | number;
  dispatchEvent(event: Event): boolean;
};

// ── Built-in fallback data (mirrors presets.yaml defaults) ───────
const DEFAULTS: PresetData = {
  hardware: [
    { id: 'rak4631',        label: 'RAK WisBlock 4631',                  tx_power: 22 },
    { id: 'rak_wismes_tap', label: 'RAK WisMesh Tap',                    tx_power: 22 },
    { id: 'rak3401_1w',     label: 'RAK WisMesh 1W Booster',             tx_power: 30 },
    { id: 'station_g2',     label: 'UnitEng Station G2 (1 W EU)',        tx_power: 30 },
    { id: 'nano_g2',        label: 'UnitEng Nano G2 Ultra (1 W EU)',     tx_power: 30 },
    { id: 'ikoka_1w',       label: 'Ikoka Stick E22-900M30S (1 W)',      tx_power: 30 },
    { id: 'heltec_v3',      label: 'Heltec V3',                          tx_power: 20 },
    { id: 'heltec_v4',      label: 'Heltec V4 (standard, 22 dBm RF)',    tx_power: 22 },
    { id: 'heltec_v4_hi',   label: 'Heltec V4 (high output, 28 dBm RF)', tx_power: 28 },
    { id: 'heltec_t114',    label: 'Heltec T114',                        tx_power: 20 },
    { id: 'tbeam_sx1262',   label: 'LilyGo T-Beam (SX1262)',             tx_power: 22 },
    { id: 'tbeam_sx1276',   label: 'LilyGo T-Beam 1.2 (SX1276)',        tx_power: 20 },
    { id: 'tdeck_pro',      label: 'LilyGo T-Deck Pro',                  tx_power: 22 },
    { id: 't_pager',        label: 'LilyGo T-Pager',                     tx_power: 20 },
    { id: 't1000e',         label: 'Seeed T1000-E',                      tx_power: 20 },
    { id: 'xiao_s3',        label: 'Seeed Xiao S3 WIO',                  tx_power: 20 },
    { id: 'xiao_c3',        label: 'Seeed Xiao C3',                      tx_power: 20 },
    { id: 'muzi_r1_neo',    label: 'Muzi Works R1 Neo',                  tx_power: 22 },
  ],
  radio_modes: [
    { id: 'at_hu_sk_narrow',        label: 'AT/HU/SK · 869.618 · SF8/BW62.5/CR5 ★',  sensitivity: -129, freq: 869.618 },
    { id: 'eu868_narrow',           label: 'EU868 · 867.5 · SF9/BW62.5/CR5 ★',        sensitivity: -132, freq: 867.5 },
    { id: 'uk_ire_narrow',          label: 'UK/IRE · 869.525 · SF8/BW62.5/CR5 ★',     sensitivity: -129, freq: 869.525 },
    { id: 'us_narrow',              label: 'US/CA · 910.525 · SF7/BW62.5/CR5 ★',      sensitivity: -126, freq: 910.525 },
    { id: 'au_narrow',              label: 'AU/NZ · 915.8 · SF9/BW62.5/CR5 ★',        sensitivity: -132, freq: 915.8 },
    { id: 'meshcore_legacy_default', label: 'MeshCore legacy · 869.525 · SF11/BW250/CR5', sensitivity: -133, freq: 869.525 },
    { id: 'eu868_legacy',           label: 'EU868 legacy · 867.5 · SF11/BW250/CR5',   sensitivity: -133, freq: 867.5 },
    { id: 'eu433_std',              label: 'EU433 · 433.175 · SF11/BW250/CR5',         sensitivity: -133, freq: 433.175 },
    { id: 'us_legacy',              label: 'US/CA legacy · 910.525 · SF11/BW250/CR5', sensitivity: -133, freq: 910.525 },
    { id: 'au_legacy',              label: 'AU/NZ legacy · 915.8 · SF11/BW250/CR5',   sensitivity: -133, freq: 915.8 },
    { id: 'sf12_bw125',  label: 'SF12/BW125/CR5  (−137 dBm)',  sensitivity: -137, freq: 868 },
    { id: 'sf11_bw125',  label: 'SF11/BW125/CR5  (−135 dBm)',  sensitivity: -135, freq: 868 },
    { id: 'sf10_bw125',  label: 'SF10/BW125/CR5  (−132 dBm)',  sensitivity: -132, freq: 868 },
    { id: 'sf9_bw125',   label: 'SF9/BW125/CR5   (−129 dBm)',  sensitivity: -129, freq: 868 },
    { id: 'sf8_bw125',   label: 'SF8/BW125/CR5   (−126 dBm)',  sensitivity: -126, freq: 868 },
    { id: 'sf7_bw125',   label: 'SF7/BW125/CR5   (−123 dBm)',  sensitivity: -123, freq: 868 },
    { id: 'sf7_bw250',   label: 'SF7/BW250/CR5   (−120 dBm)',  sensitivity: -120, freq: 868 },
  ],
  antenna: [
    { id: 'stubby',  label: 'Stock stub',            gain_dbi:  0 },
    { id: 'duck2',   label: 'Rubber duck (2 dBi)',   gain_dbi:  2 },
    { id: 'duck3',   label: 'Rubber duck (3 dBi)',   gain_dbi:  3 },
    { id: 'fibre5',  label: 'Fibreglass omni',        gain_dbi:  5 },
    { id: 'omni8',   label: 'High-gain omni',         gain_dbi:  8 },
    { id: 'yagi9',   label: 'Yagi 3-el (9 dBi)',      gain_dbi:  9 },
    { id: 'yagi12',  label: 'Yagi 6-el (12 dBi)',     gain_dbi: 12 },
  ],
};

function populateSelect<T>(id: string, items: T[], mapper: (item: T) => SelectOption): void {
  const sel = document.getElementById(id) as HTMLSelectElement | null;
  if (!sel) return;
  // preserve first placeholder option, clear the rest
  while (sel.options.length > 1) sel.remove(1);
  items.forEach(item => {
    const opt = document.createElement('option');
    const mapped = mapper(item);
    opt.value       = mapped.value;
    opt.textContent = mapped.text;
    sel.appendChild(opt);
  });
}

function setValueAndNotify(id: string, value: string | number): void {
  const el = document.getElementById(id) as ValueElement | null;
  if (!el) return;
  // Assign the raw value (number or string). Real DOM coerces to string,
  // but tests stub elements with a plain `value` property and assert against
  // the raw assignment.
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function init(): Promise<void> {
  let p: unknown = null;
  try {
    p = await window.electronAPI.getPresets();
  } catch { /* falls through to defaults */ }
  const presets = parsePresetData(p, DEFAULTS);

  // Hardware → TX power
  populateSelect('radio-preset', presets.hardware,
    h => ({ value: h.id, text: `${h.label}  (${h.tx_power} dBm)` }));

  // Radio mode → receiver sensitivity and frequency
  populateSelect('modem-preset', presets.radio_modes,
    m => ({ value: m.id, text: m.label }));

  // Antenna → gain
  populateSelect('antenna-preset', presets.antenna,
    a => ({ value: a.id, text: `${a.label}  (${a.gain_dbi} dBi)` }));

  // ── Event listeners ──────────────────────────────────────────
  document.getElementById('radio-preset')?.addEventListener('change', e => {
    const value = (e.target as HTMLSelectElement).value;
    const h = presets.hardware.find(x => x.id === value);
    if (h) setValueAndNotify('repeater-power', h.tx_power);
  });

  document.getElementById('modem-preset')?.addEventListener('change', e => {
    const value = (e.target as HTMLSelectElement).value;
    const m = presets.radio_modes.find(x => x.id === value);
    if (m) {
      setValueAndNotify('rx-sensitivity', m.sensitivity);
      if (m.freq !== undefined) setValueAndNotify('repeater-freq', m.freq);
    }
  });

  document.getElementById('antenna-preset')?.addEventListener('change', e => {
    const value = (e.target as HTMLSelectElement).value;
    const a = presets.antenna.find(x => x.id === value);
    if (a) setValueAndNotify('repeater-gain', a.gain_dbi);
  });
}

