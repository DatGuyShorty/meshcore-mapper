import { beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '../../src/presets.js';

function createOption() {
  return {
    value: '',
    textContent: '',
    appendChild() {},
  };
}

function createSelect(id) {
  const el = {
    id,
    options: [{ value: '', textContent: 'Placeholder' }],
    value: '',
    _events: {},
    addEventListener(event, handler) {
      this._events[event] = handler;
    },
    dispatchEvent(event) {
      if (this._events[event.type]) {
        this._events[event.type]({ target: this });
      }
      return true;
    },
    appendChild(option) {
      this.options.push(option);
    },
    remove(index) {
      this.options.splice(index, 1);
    },
  };
  return el;
}

function createInput(id, value = '') {
  const el = {
    id,
    value,
    _events: {},
    addEventListener(event, handler) {
      this._events[event] = handler;
    },
    dispatchEvent(event) {
      if (this._events[event.type]) this._events[event.type]({ target: this });
      return true;
    },
  };
  return el;
}

describe('preset initialization', () => {
  let documentElements;

  beforeEach(() => {
    documentElements = {
      'radio-preset': createSelect('radio-preset'),
      'modem-preset': createSelect('modem-preset'),
      'antenna-preset': createSelect('antenna-preset'),
      'repeater-power': createInput('repeater-power', ''),
      'rx-sensitivity': createInput('rx-sensitivity', ''),
      'repeater-freq': createInput('repeater-freq', ''),
      'repeater-gain': createInput('repeater-gain', ''),
    };

    globalThis.document = {
      getElementById(id) {
        return documentElements[id] ?? null;
      },
      createElement(tag) {
        if (tag !== 'option') return null;
        return createOption();
      },
    };

    globalThis.window = { electronAPI: { getPresets: vi.fn(async () => { throw new Error('no presets'); }) } };
  });

  it('populates default selects when presets cannot be loaded', async () => {
    await expect(init()).resolves.not.toThrow();

    expect(documentElements['radio-preset'].options.length).toBeGreaterThan(1);
    expect(documentElements['modem-preset'].options.length).toBeGreaterThan(1);
    expect(documentElements['antenna-preset'].options.length).toBeGreaterThan(1);
  });

  it('updates repeater controls when preset selection changes', async () => {
    const customPresets = {
      hardware: [{ id: 'custom', label: 'Custom Device', tx_power: 21 }],
      radio_modes: [{ id: 'custom_mode', label: 'Custom Mode', sensitivity: -120, freq: 900 }],
      antenna: [{ id: 'custom_antenna', label: 'Custom Antenna', gain_dbi: 10 }],
    };
    globalThis.window.electronAPI.getPresets = vi.fn(async () => customPresets);

    await init();

    const radio = documentElements['radio-preset'];
    const modem = documentElements['modem-preset'];
    const antenna = documentElements['antenna-preset'];

    radio.value = 'custom';
    radio.dispatchEvent({ type: 'change' });
    expect(documentElements['repeater-power'].value).toBe(21);

    modem.value = 'custom_mode';
    modem.dispatchEvent({ type: 'change' });
    expect(documentElements['rx-sensitivity'].value).toBe(-120);
    expect(documentElements['repeater-freq'].value).toBe(900);

    antenna.value = 'custom_antenna';
    antenna.dispatchEvent({ type: 'change' });
    expect(documentElements['repeater-gain'].value).toBe(10);
  });

  it('falls back malformed preset groups without dropping valid groups', async () => {
    const partialPresets = {
      hardware: [{ id: 'custom_hw', label: 'Custom Hardware', tx_power: 21 }],
      radio_modes: [{ id: 'bad_mode', label: 'Bad Mode', sensitivity: 'not-a-number' }],
      antenna: [{ id: 'custom_antenna', label: 'Custom Antenna', gain_dbi: 10 }],
    };
    globalThis.window.electronAPI.getPresets = vi.fn(async () => partialPresets);

    await init();

    const radio = documentElements['radio-preset'];
    const modem = documentElements['modem-preset'];
    const antenna = documentElements['antenna-preset'];

    expect(radio.options.some(option => option.value === 'custom_hw')).toBe(true);
    expect(modem.options.length).toBeGreaterThan(1);
    expect(modem.options.some(option => option.value === 'bad_mode')).toBe(false);
    expect(antenna.options.some(option => option.value === 'custom_antenna')).toBe(true);

    radio.value = 'custom_hw';
    radio.dispatchEvent({ type: 'change' });
    expect(documentElements['repeater-power'].value).toBe(21);

    antenna.value = 'custom_antenna';
    antenna.dispatchEvent({ type: 'change' });
    expect(documentElements['repeater-gain'].value).toBe(10);
  });
});
