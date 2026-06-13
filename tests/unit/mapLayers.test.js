import { describe, it, expect, beforeEach, vi } from 'vitest';

const elements = new Map();
const documentStub = {
  body: { children: [], appendChild(el) { this.children.push(el); el.parentNode = this; } },
  createElement(tagName) {
    const el = {
      tagName,
      style: {},
      children: [],
      dataset: {},
      className: '',
      innerHTML: '',
      id: '',
      value: '',
      checked: false,
      parentNode: null,
      setAttribute() {},
      appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        if (child.id) elements.set(child.id, child);
      },
      querySelector: (selector) => {
        if (selector === '#btn-cancel-coverage') {
          return { addEventListener: () => {} };
        }
        return null;
      },
    };
    return el;
  },
  addEventListener: () => {},
  dispatchEvent: () => true,
  getElementById(id) {
    if (elements.has(id)) return elements.get(id);
    return null;
  },
  querySelector(selector) {
    if (selector === '#map-container') return elements.get('map-container');
    return null;
  },
};

globalThis.document = documentStub;
globalThis.window = globalThis;
globalThis.confirm = () => true;

const container = { id: 'map-container', appendChild() {} };
const status = { id: 'status-msg', textContent: '' };
const cursor = { id: 'cursor-coords', textContent: '' };
const progressMsg = { id: 'progress-msg', textContent: '' };
const progressFill = { id: 'progress-fill', style: {} };
const cancelButton = { id: 'btn-cancel-coverage', addEventListener: () => {} };

globalThis.document.body.appendChild(container);
globalThis.document.body.appendChild(status);
globalThis.document.body.appendChild(cursor);
globalThis.document.body.appendChild(progressMsg);
globalThis.document.body.appendChild(progressFill);
globalThis.document.body.appendChild(cancelButton);

elements.set('map-container', container);
elements.set('status-msg', status);
elements.set('cursor-coords', cursor);
elements.set('progress-msg', progressMsg);
elements.set('progress-fill', progressFill);
elements.set('btn-cancel-coverage', cancelButton);

const stubLeaflet = {
  map: () => ({
    on: () => {},
    getCenter: () => ({ lat: 0, lng: 0 }),
    getZoom: () => 1,
    setView: () => {},
    getContainer: () => ({ style: {} }),
    addLayer: () => {},
    createPane: () => ({ style: {} }),
  }),
  canvas: () => ({ padding: 0.1 }),
  polygon: () => ({ addTo: () => {} }),
  marker: () => ({ addTo: () => {}, bindTooltip: () => {} }),
  rectangle: () => ({ addTo: () => {}, getBounds: () => ({ getSouth: () => 0, getNorth: () => 0, getWest: () => 0, getEast: () => 0 }) }),
  divIcon: () => ({}),
  tileLayer: () => ({ addTo: () => {}, options: {}, _url: 'url' }),
  control: { layers: () => ({ addTo: () => {} }) },
};

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

if (!Object.getOwnPropertyDescriptor(globalThis, 'navigator')?.writable) {
  Object.defineProperty(globalThis, 'navigator', {
    value: globalThis.navigator || {},
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

globalThis.navigator = globalThis.navigator || {};

globalThis.L = stubLeaflet;
const {
  _opacityFromSlider,
  _outlineOpacity,
  _foliageStyle,
  _buildingStyle,
  _barrierStyle,
  _obstacleMetadata,
  _selectObstacle,
} = await import('../../src/mapLayers.js');

describe('mapLayers style helpers', () => {
  beforeEach(() => {
    const makeInput = (id, value) => {
      const el = document.createElement('input');
      el.id = id;
      el.value = value;
      elements.set(id, el);
      return el;
    };

    makeInput('foliage-opacity', '20');
    makeInput('building-opacity', '60');
    makeInput('barrier-opacity', '40');
    makeInput('obstacle-height-mode', 'osm');
    document.dispatchEvent = vi.fn(() => true);
  });

  it('parses slider values into normalized opacity', () => {
    expect(_opacityFromSlider('foliage-opacity', 0.18)).toBeCloseTo(0.2);
    expect(_opacityFromSlider('building-opacity', 0.45)).toBeCloseTo(0.6);
    expect(_opacityFromSlider('barrier-opacity', 0.35)).toBeCloseTo(0.4);
  });

  it('clamps opacity values between 0 and 1', () => {
    document.getElementById('foliage-opacity').value = '150';
    expect(_opacityFromSlider('foliage-opacity', 0.18)).toBe(1);
    document.getElementById('foliage-opacity').value = '-20';
    expect(_opacityFromSlider('foliage-opacity', 0.18)).toBe(0);
  });

  it('uses fallback opacity when input is missing or invalid', () => {
    expect(_opacityFromSlider('missing-opacity', 0.25)).toBe(0.25);
    document.getElementById('foliage-opacity').value = 'abc';
    expect(_opacityFromSlider('foliage-opacity', 0.25)).toBe(0.25);
  });

  it('adds outline boost to foliage style but not above 1', () => {
    const style = _foliageStyle('park');
    expect(style.fillColor).toBe('#22c55e');
    expect(style.fillOpacity).toBeCloseTo(0.2);
    expect(style.opacity).toBeCloseTo(style.fillOpacity + 0.42);
  });

  it('returns a building style with color and clamped outline opacity', () => {
    const style = _buildingStyle('#123456');
    expect(style.fillColor).toBe('#123456');
    expect(style.fillOpacity).toBeCloseTo(0.6);
    expect(style.opacity).toBeCloseTo(0.85);
  });

  it('builds a barrier style with expected color and opacity', () => {
    const style = _barrierStyle();
    expect(style.fillColor).toBe('#fb923c');
    expect(style.fillOpacity).toBeCloseTo(0.4);
    expect(style.opacity).toBeCloseTo(0.8);
  });

  it('uses stronger outlines for selected obstacle layer styles', () => {
    const foliage = _foliageStyle('park', true);
    const building = _buildingStyle('#123456', true);
    const barrier = _barrierStyle(true);

    expect(foliage.weight).toBeGreaterThan(_foliageStyle('park').weight);
    expect(foliage.opacity).toBe(1);
    expect(building.color).toBe('#facc15');
    expect(building.weight).toBeGreaterThan(_buildingStyle('#123456').weight);
    expect(barrier.color).toBe('#facc15');
    expect(barrier.weight).toBeGreaterThan(_barrierStyle().weight);
  });

  it('builds obstacle metadata for vegetation and structures', () => {
    document.getElementById('obstacle-height-mode').value = 'dsm-dem';
    const foliage = _obstacleMetadata({
      category: 'foliage',
      id: 'way/1',
      osmType: 'tree_row',
      heightM: 12,
      attenuationDbPerM: 0.45,
      attenuationFactor: 1.5,
    });
    const barrier = _obstacleMetadata({
      category: 'barrier',
      id: 'way/2',
      osmType: 'barrier:wall',
      heightM: 3,
      attenuationDbPerM: 0.5,
      attenuationFactor: 1,
    });

    expect(foliage).toMatchObject({
      id: 'foliage:way/1',
      title: 'Vegetation',
      source: 'OpenStreetMap vegetation',
      osmType: 'tree row',
      rawOsmType: 'tree_row',
      heightLabel: 'Canopy height',
      heightSource: 'DSM-DEM sampled where available; OSM/default fallback',
      attenuationLabel: 'Vegetation loss',
      geometry: 'Polygon',
    });
    expect(foliage.heightM).toBe(12);
    expect(foliage.attenuationDbPerM).toBeCloseTo(0.45);
    expect(foliage.attenuationFactor).toBeCloseTo(1.5);
    expect(barrier).toMatchObject({
      id: 'barrier:way/2',
      title: 'Barrier',
      source: 'OpenStreetMap structures',
      rawOsmType: 'barrier:wall',
      heightLabel: 'Structure height',
      attenuationLabel: 'Building/barrier loss',
    });
  });

  it('dispatches obstacle selection and marks the original click as handled', () => {
    const obstacle = { id: 'building:way/3', category: 'building' };
    const event = { originalEvent: {} };

    _selectObstacle(obstacle, event);

    expect(event.originalEvent._meshcoreHandled).toBe(true);
    expect(document.dispatchEvent).toHaveBeenCalledTimes(1);
    const dispatched = document.dispatchEvent.mock.calls[0][0];
    expect(dispatched.type).toBe('obstacle:selected');
    expect(dispatched.detail.obstacle).toBe(obstacle);
  });
});
