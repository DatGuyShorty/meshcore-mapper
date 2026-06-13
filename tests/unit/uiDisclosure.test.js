import { afterEach, describe, expect, it } from 'vitest';
import { applyDisclosure } from '../../src/uiDisclosure.js';

function fakeDependent(controlId) {
  return {
    _attr: { 'data-show-when': controlId },
    getAttribute(name) { return this._attr[name] ?? null; },
    hidden: false,
    classList: { toggle(_cls, on) { this._owner.hidden = on; } },
  };
}

function fakeCheckbox(checked) {
  const listeners = [];
  return {
    checked,
    addEventListener: (_ev, fn) => listeners.push(fn),
    fire() { listeners.forEach((fn) => fn()); },
  };
}

describe('applyDisclosure', () => {
  afterEach(() => {
    delete globalThis.document;
  });

  it('hides dependents when the control is unchecked and reveals them on change', () => {
    const dep = fakeDependent('use-reflection');
    dep.classList._owner = dep;
    const ctrl = fakeCheckbox(false);
    const root = { querySelectorAll: () => [dep] };
    globalThis.document = { getElementById: (id) => (id === 'use-reflection' ? ctrl : null) };

    applyDisclosure(root);
    expect(dep.hidden).toBe(true); // initial: unchecked -> hidden

    ctrl.checked = true;
    ctrl.fire();
    expect(dep.hidden).toBe(false); // change -> revealed
  });

  it('ignores dependents whose control id does not resolve', () => {
    const dep = fakeDependent('missing-control');
    dep.classList._owner = dep;
    const root = { querySelectorAll: () => [dep] };
    globalThis.document = { getElementById: () => null };

    expect(() => applyDisclosure(root)).not.toThrow();
    expect(dep.hidden).toBe(false); // left untouched
  });
});
