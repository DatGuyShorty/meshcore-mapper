import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/coveragePoint.js', () => ({
  inspectCoverageAtPoint: vi.fn(() => []),
}));

describe('mapContext helper functions', () => {
  let mapContext;
  let mapModule;
  let inspectCoverageAtPoint;

  beforeEach(async () => {
    const fakeMap = {
      getContainer: () => ({ style: { cursor: '' } }),
      getCenter: () => ({ lat: 10, lng: 20 }),
      getZoom: () => 8,
      on: vi.fn(),
      off: vi.fn(),
      createPane: vi.fn(() => ({ style: {} })),
    };

    const mapContainer = {
      appendChild: vi.fn(),
      style: {},
      querySelector: vi.fn(() => ({ addEventListener: vi.fn() })),
    };

    globalThis.L = {
      map: vi.fn(() => fakeMap),
      tileLayer: vi.fn(() => ({ addTo: vi.fn(), _url: 'https://fake', options: {} })),
      control: { layers: vi.fn(() => ({ addTo: vi.fn() })) },
      popup: vi.fn(() => ({ setLatLng() { return this; }, setContent() { return this; }, openOn() { return this; } })),
    };
    globalThis.document = {
      getElementById: id => id === 'map-container'
        ? mapContainer
        : { style: {}, addEventListener: vi.fn(), textContent: '' },
      createElement: vi.fn(() => ({ addEventListener: vi.fn(), querySelector: vi.fn(() => ({ addEventListener: vi.fn() })) })),
    };
    globalThis.localStorage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
      writable: true,
    });

    mapModule = await import('../../src/map.js');
    const coveragePoint = await import('../../src/coveragePoint.js');
    inspectCoverageAtPoint = coveragePoint.inspectCoverageAtPoint;
    mapContext = await import('../../src/mapContext.js');
  });

  it('formats dB values with sign and one decimal', () => {
    expect(mapContext._fmtDb(3.14159)).toBe('+3.1 dB');
    expect(mapContext._fmtDb(-2.45)).toBe('-2.5 dB');
  });

  it('formats dBm values correctly', () => {
    expect(mapContext._fmtDbm(-123.456)).toBe('-123.5 dBm');
  });

  it('formats distances in meters and kilometers', () => {
    expect(mapContext._fmtDistance(999)).toBe('999 m');
    expect(mapContext._fmtDistance(1000)).toBe('1.00 km');
    expect(mapContext._fmtDistance(2500)).toBe('2.50 km');
  });

  it('renders coverage rows with escaped names and LoS state', () => {
    const row = mapContext._coverageRow({
      repName: '<Node>',
      distM: 1200,
      rxPower: -80.4,
      snrDb: 10.5,
      margin: -1.2,
      los: { geometricLos: false },
    });
    expect(row).toContain('class="map-context-coverage-row weak"');
    expect(row).toContain('&lt;Node&gt;');
    expect(row).toContain('RSSI -80.4 dBm');
    expect(row).toContain('SNR +10.5 dB');
    expect(row).toContain('LoS blocked');
  });

  it('shows pending coverage text when no coverage is computed', () => {
    mapModule.state.coverageResults = [];
    inspectCoverageAtPoint.mockReturnValue([]);

    const html = mapContext._popupContent({ lat: 1, lng: 2 });
    expect(html).toContain('No coverage has been computed yet.');
    expect(html).toContain('1.00000, 2.00000');
  });

  it('shows no coverage reaches this point when coverage exists but no rows', () => {
    mapModule.state.coverageResults = [{}];
    inspectCoverageAtPoint.mockReturnValue([]);

    const html = mapContext._popupContent({ lat: 3, lng: 4 });
    expect(html).toContain('No computed coverage reaches this point.');
  });

  it('ignores clicks already handled by meshcore or when crosshair cursor is set', () => {
    const ignoreClick1 = mapContext._shouldIgnoreMapClick({ originalEvent: { _meshcoreHandled: true } });
    expect(ignoreClick1).toBe(true);

    const map = mapModule.map;
    map.getContainer = () => ({ style: { cursor: 'crosshair' } });
    const ignoreClick2 = mapContext._shouldIgnoreMapClick({ originalEvent: {} });
    expect(ignoreClick2).toBe(true);

    map.getContainer = () => ({ style: { cursor: '' } });
    const ignoreClick3 = mapContext._shouldIgnoreMapClick({ originalEvent: {} });
    expect(ignoreClick3).toBe(false);
  });
});
