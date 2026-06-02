import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

var fakeMap;
var fakeState;

vi.mock('../../src/map.js', () => {
  fakeMap = {
    getCenter: vi.fn(() => ({ lat: 51.5074, lng: -0.1278 })),
    getZoom: vi.fn(() => 12),
    on: vi.fn(),
    off: vi.fn(),
  };
  fakeState = { coverageLayers: [] };
  return { map: fakeMap, state: fakeState };
});

import {
  getMapViewportMetrics,
  onMapViewportChanged,
  addCoverageOverlayTile,
  setCoverageLayerOpacity,
} from '../../src/mapAdapter.js';

describe('map adapter helpers', () => {
  beforeEach(() => {
    fakeMap.getCenter.mockReturnValue({ lat: 51.5074, lng: -0.1278 });
    fakeMap.getZoom.mockReturnValue(12);
    fakeMap.on.mockClear();
    fakeMap.off.mockClear();
    fakeState.coverageLayers = [];
    globalThis.L = {
      imageOverlay: vi.fn((_blobUrl, _bounds, _options) => {
        const overlay = {
          _repeaterId: null,
          _blobUrl: null,
          setOpacity: vi.fn(),
          addTo: vi.fn(() => overlay),
        };
        return overlay;
      }),
    };
  });

  afterEach(() => {
    delete globalThis.L;
    vi.restoreAllMocks();
  });

  it('returns center and zoom metrics from the map', () => {
    expect(getMapViewportMetrics()).toEqual({
      center: { lat: 51.5074, lng: -0.1278 },
      centerLat: 51.5074,
      zoom: 12,
    });
  });

  it('attaches and removes viewport change handlers correctly', () => {
    const handler = vi.fn();
    const unsubscribe = onMapViewportChanged(handler);

    expect(fakeMap.on).toHaveBeenCalledWith('zoomend moveend', handler);

    unsubscribe();

    expect(fakeMap.off).toHaveBeenCalledWith('zoomend moveend', handler);
  });

  it('creates a coverage overlay and stores it in state', () => {
    const config = { blobUrl: 'blob://tile', bounds: [[0, 0], [1, 1]], opacity: 0.5, repId: 123 };
    const overlay = addCoverageOverlayTile(config);

    expect(globalThis.L.imageOverlay).toHaveBeenCalledWith(config.blobUrl, config.bounds, { opacity: 0.5, interactive: false });
    expect(overlay._repeaterId).toBe(123);
    expect(overlay._blobUrl).toBe('blob://tile');
    expect(fakeState.coverageLayers).toContain(overlay);
  });

  it('updates opacity on all stored coverage layers', () => {
    const overlayA = { setOpacity: vi.fn() };
    const overlayB = { setOpacity: vi.fn() };
    fakeState.coverageLayers = [overlayA, overlayB];

    setCoverageLayerOpacity(0.25);

    expect(overlayA.setOpacity).toHaveBeenCalledWith(0.25);
    expect(overlayB.setOpacity).toHaveBeenCalledWith(0.25);
  });
});
