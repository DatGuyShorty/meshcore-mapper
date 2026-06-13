import { describe, expect, it } from 'vitest';
import { parsePresetData } from '../../src/presetsSchema.js';

const fallback = {
  hardware: [{ id: 'fallback_hw', label: 'Fallback Hardware', tx_power: 20 }],
  radio_modes: [{ id: 'fallback_mode', label: 'Fallback Mode', sensitivity: -130, freq: 868 }],
  antenna: [{ id: 'fallback_ant', label: 'Fallback Antenna', gain_dbi: 2 }],
};

describe('preset schema helpers', () => {
  it('falls back completely for non-object roots', () => {
    expect(parsePresetData(null, fallback)).toEqual(fallback);
    expect(parsePresetData([], fallback)).toEqual(fallback);
  });

  it('keeps valid custom groups and falls back invalid groups independently', () => {
    const parsed = parsePresetData({
      hardware: [
        { id: 'custom_hw', label: 'Custom Hardware', tx_power: '21' },
        { id: '', label: 'Bad Hardware', tx_power: 22 },
      ],
      radio_modes: [{ id: 'bad_mode', label: 'Bad Mode', sensitivity: 'nope' }],
      antenna: [{ id: 'custom_ant', label: 'Custom Antenna', gain_dbi: '5' }],
    }, fallback);

    expect(parsed.hardware).toEqual([{ id: 'custom_hw', label: 'Custom Hardware', tx_power: 21 }]);
    expect(parsed.radio_modes).toEqual(fallback.radio_modes);
    expect(parsed.antenna).toEqual([{ id: 'custom_ant', label: 'Custom Antenna', gain_dbi: 5 }]);
  });

  it('rejects radio modes with non-finite optional frequencies', () => {
    const parsed = parsePresetData({
      hardware: fallback.hardware,
      radio_modes: [{ id: 'bad_freq', label: 'Bad Freq', sensitivity: -120, freq: 'bad' }],
      antenna: fallback.antenna,
    }, fallback);

    expect(parsed.radio_modes).toEqual(fallback.radio_modes);
  });
});
