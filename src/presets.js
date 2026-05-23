/**
 * presets.js — Populates radio, region, modem, and antenna select elements
 * from presets.yaml (loaded via IPC). Falls back to built-in defaults if the
 * file cannot be read.
 * Exports: init
 */

// ── Built-in fallback data (mirrors presets.yaml defaults) ───────
const DEFAULTS = {
  hardware: [
    { id: 'rak4631',      label: 'RAK WisBlock 4631',      tx_power: 22 },
    { id: 'rak3401_1w',   label: 'RAK WisMesh 1W Booster',  tx_power: 19 },
    { id: 'station_g2',   label: 'UnitEng Station G2',      tx_power: 19 },
    { id: 'nano_g2',      label: 'UnitEng Nano G2 Ultra',   tx_power: 19 },
    { id: 'heltec_v3',    label: 'Heltec V3',              tx_power: 20 },
    { id: 'heltec_v4',    label: 'Heltec V4',              tx_power: 22 },
    { id: 'heltec_t114',  label: 'Heltec T114',            tx_power: 20 },
    { id: 'tbeam_sx1262', label: 'LilyGo T-Beam (SX1262)', tx_power: 22 },
    { id: 'tbeam_sx1276', label: 'LilyGo T-Beam 1.2 (SX1276)', tx_power: 20 },
    { id: 'tdeck_pro',    label: 'LilyGo T-Deck Pro',       tx_power: 22 },
    { id: 't1000e',       label: 'Seeed T1000-E',          tx_power: 20 },
    { id: 'xiao_s3',      label: 'Seeed Xiao S3 WIO',      tx_power: 20 },
    { id: 'muzi_r1_neo',  label: 'Muzi Works R1 Neo',      tx_power: 22 },
  ],
  radio_modes: [
    { id: 'at_hu_sk_Narrow',  label: 'AT/HU/SK (Narrow) · SF8/BW62.5/CR5 ★', sensitivity: -132, freq: 869.618 },
    { id: 'eu868_narrow', label: 'EU868 Narrow · SF9/BW62.5/CR5 ★', sensitivity: -135, freq: 867.5 },
    { id: 'eu868_legacy', label: 'EU868 Legacy · SF11/BW250/CR5',   sensitivity: -133, freq: 867.5 },
    { id: 'us_narrow',    label: 'US/CA Narrow · SF7/BW62.5/CR5 ★', sensitivity: -126, freq: 910.525 },
    { id: 'us_legacy',    label: 'US/CA Legacy · SF11/BW250/CR5',   sensitivity: -133, freq: 910.525 },
    { id: 'au_narrow',    label: 'AU/NZ Narrow · SF9/BW62.5/CR5 ★', sensitivity: -135, freq: 915.8 },
    { id: 'sf12_bw125',   label: 'SF12/BW125/CR5  (−137 dBm)',      sensitivity: -137, freq: 868 },
    { id: 'sf10_bw125',   label: 'SF10/BW125/CR5  (−132 dBm)',      sensitivity: -132, freq: 868 },
    { id: 'sf7_bw250',    label: 'SF7/BW250/CR5   (−120 dBm)',      sensitivity: -120, freq: 868 },
  ],
  antenna: [
    { id: 'stubby',  label: 'Stock stub',          gain_dbi:  0 },
    { id: 'duck2',   label: 'Rubber duck',          gain_dbi:  2 },
    { id: 'fibre5',  label: 'Fibreglass omni',      gain_dbi:  5 },
    { id: 'omni8',   label: 'High-gain omni',       gain_dbi:  8 },
    { id: 'yagi9',   label: 'Yagi 3-el (9 dBi)',    gain_dbi:  9 },
    { id: 'yagi12',  label: 'Yagi 6-el (12 dBi)',   gain_dbi: 12 },
  ],
};

function populateSelect(id, items, mapper) {
  const sel = document.getElementById(id);
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

export async function init() {
  let p = null;
  try {
    p = await window.electronAPI.getPresets();
  } catch { /* falls through to defaults */ }
  const presets = p || DEFAULTS;

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
  document.getElementById('radio-preset').addEventListener('change', e => {
    const h = presets.hardware.find(x => x.id === e.target.value);
    if (h) document.getElementById('repeater-power').value = h.tx_power;
  });

  document.getElementById('modem-preset').addEventListener('change', e => {
    const m = presets.radio_modes.find(x => x.id === e.target.value);
    if (m) {
      document.getElementById('rx-sensitivity').value = m.sensitivity;
      if (m.freq !== undefined) document.getElementById('repeater-freq').value = m.freq;
    }
  });

  document.getElementById('antenna-preset').addEventListener('change', e => {
    const a = presets.antenna.find(x => x.id === e.target.value);
    if (a) document.getElementById('repeater-gain').value = a.gain_dbi;
  });
}

