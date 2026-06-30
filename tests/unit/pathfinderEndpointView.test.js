import { describe, expect, it } from 'vitest';
import {
  buildPathEndpointOptions,
  ensureDifferentPathEndpoints,
  renderPathEndpointSelects,
} from '../../src/pathfinderEndpointView.js';

describe('pathfinder endpoint view helpers', () => {
  it('sorts endpoint options by display name and stringifies ids', () => {
    expect(buildPathEndpointOptions([
      { id: 2, name: 'Bravo' },
      { id: '1', name: 'Alpha' },
    ])).toEqual([
      { value: '1', label: 'Alpha' },
      { value: '2', label: 'Bravo' },
    ]);
  });

  it('renders the empty endpoint state into both selects', () => {
    const fromSel = fakeSelect();
    const toSel = fakeSelect();

    expect(renderPathEndpointSelects(fromSel, toSel, [])).toEqual({ hasNodes: false });
    expect(fromSel.options).toEqual([{ value: '', textContent: '-- no nodes --' }]);
    expect(toSel.options).toEqual([{ value: '', textContent: '-- no nodes --' }]);
  });

  it('preserves saved endpoints and moves TO when both endpoints match', () => {
    const fromSel = fakeSelect('2');
    const toSel = fakeSelect('2');

    expect(renderPathEndpointSelects(fromSel, toSel, [
      { id: 2, name: 'Bravo' },
      { id: 1, name: 'Alpha' },
      { id: 3, name: 'Charlie' },
    ])).toEqual({ hasNodes: true });

    expect(fromSel.options.map(option => option.textContent)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(fromSel.value).toBe('2');
    expect(toSel.value).toBe('1');
  });

  it('leaves different endpoints unchanged', () => {
    const fromSel = fakeSelect('1', ['1', '2']);
    const toSel = fakeSelect('2', ['1', '2']);

    ensureDifferentPathEndpoints(fromSel, toSel);

    expect(fromSel.value).toBe('1');
    expect(toSel.value).toBe('2');
  });

  function fakeSelect(value = '', optionValues = []) {
    let options = optionValues.map(optionValue => ({ value: optionValue, textContent: optionValue }));
    const select = {
      value,
      get innerHTML() {
        return '';
      },
      set innerHTML(_value) {
        options = [];
        this.value = '';
      },
      get options() {
        return options;
      },
      ownerDocument: {
        createElement(tagName) {
          expect(tagName).toBe('option');
          return { value: '', textContent: '' };
        },
      },
      appendChild(option) {
        options.push(option);
        if (options.length === 1) this.value = option.value;
        return option;
      },
    };
    return select;
  }
});
