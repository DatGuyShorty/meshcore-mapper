import { describe, expect, it, vi } from 'vitest';
import {
  applyMap3dModeView,
  MAP3D_REFRESH_BUTTON_IDS,
  setMap3dRefreshBusy,
  toggleMap3dFullscreen,
  writeMap3dFocusAttrs,
  writeMap3dRetileCount,
  writeMap3dSceneStats,
  writeMap3dTerrainAttrs,
} from '../../src/map3dView.js';

describe('3D map view helpers', () => {
  it('applies 2D/3D mode classes and ARIA state', () => {
    const doc = fakeDocument({
      'map-container': fakeElement(),
      map3d: fakeElement('hidden'),
      'btn-view-2d': fakeElement('active'),
      'btn-view-3d': fakeElement(),
    });

    applyMap3dModeView(true, doc);

    expect(doc.getElementById('map-container').className).toContain('map3d-active');
    expect(doc.getElementById('map3d').className).not.toContain('hidden');
    expect(doc.getElementById('btn-view-2d').className).not.toContain('active');
    expect(doc.getElementById('btn-view-3d').className).toContain('active');
    expect(doc.getElementById('btn-view-2d').attrs['aria-pressed']).toBe('false');
    expect(doc.getElementById('btn-view-3d').attrs['aria-pressed']).toBe('true');

    applyMap3dModeView(false, doc);

    expect(doc.getElementById('map-container').className).not.toContain('map3d-active');
    expect(doc.getElementById('map3d').className).toContain('hidden');
    expect(doc.getElementById('btn-view-2d').className).toContain('active');
    expect(doc.getElementById('btn-view-3d').className).not.toContain('active');
    expect(doc.getElementById('btn-view-2d').attrs['aria-pressed']).toBe('true');
    expect(doc.getElementById('btn-view-3d').attrs['aria-pressed']).toBe('false');
  });

  it('keeps both 3D refresh buttons in the same busy state', () => {
    const setButtonBusy = vi.fn();

    setMap3dRefreshBusy(true, setButtonBusy);
    setMap3dRefreshBusy(false, setButtonBusy);

    expect(MAP3D_REFRESH_BUTTON_IDS).toEqual(['btn-refresh-3d', 'btn-map3d-refresh']);
    expect(setButtonBusy.mock.calls).toEqual([
      ['btn-refresh-3d', true, 'Loading...'],
      ['btn-map3d-refresh', true, 'Loading...'],
      ['btn-refresh-3d', false, undefined],
      ['btn-map3d-refresh', false, undefined],
    ]);
  });

  it('writes focus, terrain, scene stat, and retile attributes', () => {
    const panel = fakeElement();
    const doc = fakeDocument({ map3d: panel });

    writeMap3dFocusAttrs({ label: 'P2P Link', pointCount: 2 }, doc);
    writeMap3dTerrainAttrs({ ready: 'terrain', tileCount: 16, terrainSource: 'dem' }, doc);
    writeMap3dSceneStats({ buildings: 2, foliage: 3.4, nodes: 4, coverage: 1, links: 5 }, doc);
    writeMap3dRetileCount(3.2, doc);

    expect(panel.attrs).toMatchObject({
      'data-focus-label': 'P2P Link',
      'data-focus-points': '2',
      'data-ready': 'terrain',
      'data-terrain-tiles': '16',
      'data-terrain-source': 'dem',
      'data-buildings-count': '2',
      'data-foliage-count': '3',
      'data-nodes-count': '4',
      'data-coverage-count': '1',
      'data-p2p-links-count': '5',
      'data-retile-count': '3',
    });
  });

  it('normalizes invalid scene stat counts and allows preview-ready state', () => {
    const panel = fakeElement();
    const doc = fakeDocument({ map3d: panel });

    writeMap3dTerrainAttrs({ ready: 'preview' }, doc);
    writeMap3dSceneStats({ buildings: 'bad', foliage: -1 }, doc);
    writeMap3dRetileCount(-4, doc);

    expect(panel.attrs).toMatchObject({
      'data-ready': 'preview',
      'data-buildings-count': '0',
      'data-foliage-count': '0',
      'data-nodes-count': '0',
      'data-coverage-count': '0',
      'data-p2p-links-count': '0',
      'data-retile-count': '0',
    });
  });

  it('routes fullscreen actions through the map container', () => {
    const requestFullscreen = vi.fn();
    const exitFullscreen = vi.fn();
    const host = Object.assign(fakeElement(), { requestFullscreen });
    const doc = fakeDocument({ 'map-container': host });
    doc.exitFullscreen = exitFullscreen;

    expect(toggleMap3dFullscreen(doc)).toBe('enter');
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    doc.fullscreenElement = host;
    expect(toggleMap3dFullscreen(doc)).toBe('exit');
    expect(exitFullscreen).toHaveBeenCalledTimes(1);

    expect(toggleMap3dFullscreen(fakeDocument({}))).toBe('missing');
  });

  function fakeDocument(elements) {
    return {
      fullscreenElement: null,
      getElementById(id) {
        return elements[id] ?? null;
      },
    };
  }

  function fakeElement(className = '') {
    const element = {
      className,
      attrs: {},
      setAttribute(name, value) {
        this.attrs[name] = String(value);
      },
      classList: {
        toggle(name, force) {
          const classes = new Set(element.className.split(/\s+/).filter(Boolean));
          if (force === undefined ? !classes.has(name) : force) classes.add(name);
          else classes.delete(name);
          element.className = [...classes].join(' ');
        },
      },
    };
    return element;
  }
});
