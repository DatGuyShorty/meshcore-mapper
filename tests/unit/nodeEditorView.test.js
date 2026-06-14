import { describe, expect, it, vi } from 'vitest';
import {
  applyNodeEditorValues,
  nodeEditorValuesFromRepeater,
  openNodeEditorPanel,
  setNodeEditorMode,
} from '../../src/nodeEditorView.js';

describe('node editor view helpers', () => {
  it('builds form values from a repeater and clears stale presets', () => {
    expect(nodeEditorValuesFromRepeater({
      name: 'Hilltop',
      lat: 48.28625,
      lon: 18.5054,
      height: 12,
      power: 22,
      freq: 869.525,
      gain: 8,
    })).toEqual({
      'repeater-name': 'Hilltop',
      'repeater-lat': '48.28625',
      'repeater-lon': '18.5054',
      'repeater-height': '12',
      'repeater-power': '22',
      'repeater-freq': '869.525',
      'repeater-gain': '8',
      'radio-preset': '',
      'antenna-preset': '',
    });
  });

  it('applies node editor field values to matching inputs', () => {
    const doc = fakeDocument([
      'repeater-name',
      'repeater-lat',
      'radio-preset',
      'antenna-preset',
    ]);

    applyNodeEditorValues(doc, {
      'repeater-name': 'Node A',
      'repeater-lat': '48',
      'repeater-lon': '18',
      'repeater-height': '10',
      'repeater-power': '20',
      'repeater-freq': '869.525',
      'repeater-gain': '2',
      'radio-preset': '',
      'antenna-preset': '',
    });

    expect(doc.getElementById('repeater-name').value).toBe('Node A');
    expect(doc.getElementById('repeater-lat').value).toBe('48');
    expect(doc.getElementById('radio-preset').value).toBe('');
  });

  it('sets add, edit, and placing control states', () => {
    const doc = fakeDocument(['btn-add-repeater', 'btn-add-click', 'place-hint']);

    setNodeEditorMode(doc, 'edit');
    expect(doc.getElementById('btn-add-repeater').textContent).toBe('Update Node');
    expect(doc.getElementById('btn-add-click').textContent).toBe('Cancel');
    expect(doc.getElementById('place-hint').className).toContain('hidden');

    setNodeEditorMode(doc, 'placing');
    expect(doc.getElementById('btn-add-repeater').textContent).toBe('Add Node');
    expect(doc.getElementById('btn-add-click').textContent).toBe('Cancel');
    expect(doc.getElementById('place-hint').className).not.toContain('hidden');

    setNodeEditorMode(doc, 'add');
    expect(doc.getElementById('btn-add-repeater').textContent).toBe('Add Node');
    expect(doc.getElementById('btn-add-click').textContent).toBe('Place on Map');
    expect(doc.getElementById('place-hint').className).toContain('hidden');
  });

  it('opens the editor panel and scrolls the sidebar to the form', () => {
    const details = { open: false };
    const sidebar = { scrollTo: vi.fn() };
    const summary = { closest: () => details };
    const doc = {
      getElementById(id) {
        if (id === 'add-repeater-summary') return summary;
        if (id === 'sidebar') return sidebar;
        return null;
      },
    };

    openNodeEditorPanel(doc);

    expect(details.open).toBe(true);
    expect(sidebar.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  function fakeDocument(ids) {
    const elements = new Map(ids.map(id => [id, fakeElement()]));
    return {
      getElementById: id => elements.get(id) ?? null,
    };
  }

  function fakeElement() {
    const el = {
      value: 'stale',
      textContent: '',
      className: 'hidden',
      classList: {
        toggle(name, force) {
          const parts = new Set(el.className.split(' ').filter(Boolean));
          if (force) parts.add(name);
          else parts.delete(name);
          el.className = [...parts].join(' ');
        },
      },
    };
    return el;
  }
});
