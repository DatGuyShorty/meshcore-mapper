import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let originalL;
let originalDocument;
let originalLocalStorage;
let _originalNavigator;

function createFakeLayer(_name) {
  return {
    _blobUrl: null,
    _repeaterId: null,
    setStyle: vi.fn(),
    setOpacity: vi.fn(),
    remove: vi.fn(),
  };
}

describe('map module helpers', () => {
  let mapModule;
  let fakeMap;
  let baseLayer;

  beforeEach(async () => {
    originalL = globalThis.L;
    originalDocument = globalThis.document;
    originalLocalStorage = globalThis.localStorage;
    _originalNavigator = globalThis.navigator;

    baseLayer = { _url: 'https://test/{z}/{x}/{y}.png', options: { attribution: 'test' } };
    fakeMap = {
      getCenter: vi.fn(() => ({ lat: 50, lng: 14 })),
      getZoom: vi.fn(() => 10),
      removeLayer: vi.fn(),
      getBounds: vi.fn(() => ({ getSouth: () => 49, getNorth: () => 51, getWest: () => 13, getEast: () => 15 })),
      on: vi.fn(),
    };

    globalThis.L = {
      map: vi.fn(() => fakeMap),
      tileLayer: vi.fn(() => ({ addTo: vi.fn(), _url: baseLayer._url, options: baseLayer.options })),
      control: { layers: vi.fn(() => ({ addTo: vi.fn() })) },
    };
    globalThis.document = {
      getElementById: vi.fn(() => null),
      createElement: vi.fn(() => ({ addEventListener: vi.fn() })),
      dispatchEvent: vi.fn(),
    };
    globalThis.localStorage = { getItem: vi.fn(() => null), setItem: vi.fn() };

    mapModule = await import('../../src/map.js');
  });

  afterEach(() => {
    globalThis.L = originalL;
    globalThis.document = originalDocument;
    globalThis.localStorage = originalLocalStorage;
    vi.restoreAllMocks();
  });

  it('returns active base layer info for the default map layer', () => {
    void baseLayer; // mocked Leaflet layer is still required for module init
    const info = mapModule.getActiveBaseLayerInfo();
    expect(info.name).toBe('Streets (OSM)');
    // getActiveBaseLayerInfo() now reads from our own spec map rather than
    // Leaflet's private layer._url, so it returns the real tile URL.
    expect(info.url).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(info.options).toMatchObject({ maxZoom: 19 });
  });

  it('clears coverage overlay tiles and revokes blob URLs', () => {
    const overlayA = createFakeLayer('a');
    overlayA._blobUrl = 'blob://a';
    const overlayB = createFakeLayer('b');
    overlayB._blobUrl = 'blob://b';
    mapModule.state.coverageLayers = [overlayA, overlayB];

    globalThis.URL = { revokeObjectURL: vi.fn() };
    const removeLayerSpy = vi.fn();
    mapModule.map.removeLayer = removeLayerSpy;

    mapModule.clearCoverageOverlayTiles();

    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(removeLayerSpy).toHaveBeenCalledTimes(2);
    expect(mapModule.state.coverageLayers).toEqual([]);
  });

  it('clears all coverage layers and resets coverage results', () => {
    mapModule.state.coverageResults = [{}, {}];
    mapModule.state.coverageLayers = [createFakeLayer('x')];

    mapModule.clearCoverageLayers();

    expect(mapModule.state.coverageResults).toEqual([]);
    expect(mapModule.state.coverageLayers).toEqual([]);
    expect(globalThis.document.dispatchEvent).toHaveBeenCalled();
  });

  it('clears foliage, building, and barrier layer arrays without errors', () => {
    mapModule.state.foliageLayers = [createFakeLayer('f')];
    mapModule.state.buildingLayers = [createFakeLayer('b')];
    mapModule.state.barrierLayers = [createFakeLayer('r')];

    mapModule.clearFoliageLayers();
    mapModule.clearBuildingLayers();
    mapModule.clearBarrierLayers();

    expect(mapModule.state.foliageLayers).toEqual([]);
    expect(mapModule.state.buildingLayers).toEqual([]);
    expect(mapModule.state.barrierLayers).toEqual([]);
  });
});
