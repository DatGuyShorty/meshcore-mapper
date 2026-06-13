import { afterEach, describe, expect, it } from 'vitest';
import { regulatoryEirpLimit, eirpWarning, attachEirpHint } from '../../src/eirp.js';

describe('regulatoryEirpLimit', () => {
  it('maps frequencies to their band ceiling', () => {
    expect(regulatoryEirpLimit(434)).toEqual({ limit: 10, region: 'EU 433 MHz' });
    expect(regulatoryEirpLimit(869.525)).toEqual({ limit: 27, region: 'EU 868 MHz (1% duty)' });
    expect(regulatoryEirpLimit(915)).toEqual({ limit: 30, region: 'US 915 MHz' });
  });

  it('returns null for frequencies outside known bands', () => {
    expect(regulatoryEirpLimit(500)).toBeNull();
    expect(regulatoryEirpLimit(Number.NaN)).toBeNull();
  });
});

describe('eirpWarning', () => {
  it('warns only when power + gain exceeds the band ceiling', () => {
    expect(eirpWarning(20, 2, 869.525)).toBe(''); // 22 <= 27
    expect(eirpWarning(20, 12, 869.525)).toContain('exceeds the EU 868 MHz');
  });

  it('is silent for unknown bands or non-finite inputs', () => {
    expect(eirpWarning(40, 20, 500)).toBe('');
    expect(eirpWarning(Number.NaN, 2, 915)).toBe('');
  });
});

describe('attachEirpHint', () => {
  afterEach(() => {
    delete globalThis.document;
  });

  function fakeInput(value) {
    const listeners = [];
    return {
      value: String(value),
      classList: { hidden: false, toggle(_cls, on) { this.hidden = on; } },
      textContent: '',
      addEventListener: (_ev, fn) => listeners.push(fn),
      fire: () => listeners.forEach((fn) => fn()),
    };
  }

  it('shows the hint when the combo is over the limit and hides it otherwise', () => {
    const power = fakeInput(20);
    const gain = fakeInput(12);
    const freq = fakeInput(869.525);
    const hint = fakeInput('');
    const els = { power, gain, freq, hint };
    globalThis.document = { getElementById: (id) => els[id] ?? null };

    const update = attachEirpHint({ powerId: 'power', gainId: 'gain', freqId: 'freq', hintId: 'hint' });

    expect(hint.classList.hidden).toBe(false);
    expect(hint.textContent).toContain('exceeds');

    gain.value = '2'; // 22 dBm — within limit
    update();
    expect(hint.classList.hidden).toBe(true);
    expect(hint.textContent).toBe('');
  });

  it('is a no-op when the hint element is missing', () => {
    globalThis.document = { getElementById: () => null };
    expect(() => attachEirpHint({ powerId: 'p', gainId: 'g', freqId: 'f', hintId: 'missing' })()).not.toThrow();
  });
});
