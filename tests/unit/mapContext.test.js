import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/coveragePoint.js', () => ({
  inspectCoverageAtPoint: vi.fn(() => []),
}));

describe('mapContext helper functions', () => {
  let mapContext;
  let mapModule;
  let inspectCoverageAtPoint;
  let fakeElements;

  beforeEach(async () => {
    const fakeMap = {
      getContainer: () => ({ style: { cursor: '' } }),
      getCenter: () => ({ lat: 10, lng: 20 }),
      getZoom: () => 8,
      on: vi.fn(),
      off: vi.fn(),
      closePopup: vi.fn(),
      createPane: vi.fn(() => ({ style: {} })),
    };

    const makeElement = () => ({
      style: {},
      addEventListener: vi.fn(),
      textContent: '',
      innerHTML: '',
      focus: vi.fn(),
      closest: vi.fn(() => ({ open: false })),
    });
    const mapContainer = {
      appendChild: vi.fn(),
      style: {},
      querySelector: vi.fn(() => ({ addEventListener: vi.fn() })),
    };
    fakeElements = new Map([
      ['map-container', mapContainer],
      ['selection-inspector-title', makeElement()],
      ['selection-inspector-body', makeElement()],
    ]);

    globalThis.L = {
      map: vi.fn(() => fakeMap),
      tileLayer: vi.fn(() => ({ addTo: vi.fn(), _url: 'https://fake', options: {} })),
      control: { layers: vi.fn(() => ({ addTo: vi.fn() })) },
      popup: vi.fn(() => ({ setLatLng() { return this; }, setContent() { return this; }, openOn() { return this; } })),
    };
    globalThis.document = {
      getElementById: id => {
        if (!fakeElements.has(id)) fakeElements.set(id, makeElement());
        return fakeElements.get(id);
      },
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
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
    mapModule.state.repeaters = [];
    mapModule.state.coverageResults = [];
    mapModule.state.p2pLinks = [];
    mapModule.state.pathLinks = [];
    mapContext.updateSelectionInspector(null);
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
      layerLabel: '<Layer A>',
      layerOrdinal: 2,
      layerTotal: 3,
      rxPowerSource: 'grid',
      distM: 1200,
      rxPower: -80.4,
      snrDb: 10.5,
      margin: -1.2,
      los: { geometricLos: false, fresnelClear: false },
      reason: 'Below threshold; terrain obstruction adds about 12.3 dB diffraction loss.',
      losses: {
        pathLossDb: 112.5,
        diffractionLossDb: 12.3,
        foliageLossDb: 0,
        buildingLossDb: 4.2,
        reflectionGainDb: 0,
        obstacleLossAppliedDb: 4.2,
      },
    });
    expect(row).toContain('class="map-context-coverage-row weak"');
    expect(row).toContain('&lt;Node&gt;');
    expect(row).toContain('Layer 2/3');
    expect(row).toContain('&lt;Layer A&gt;');
    expect(row).toContain('Heatmap sample');
    expect(row).toContain('RSSI -80.4 dBm');
    expect(row).toContain('SNR +10.5 dB');
    expect(row).toContain('LoS blocked');
    expect(row).toContain('Fresnel blocked');
    expect(row).toContain('Below threshold; terrain obstruction');
    expect(row).toContain('FSPL');
    expect(row).toContain('Diffraction');
    expect(row).toContain('Buildings');
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
    expect(html).toContain('No visible coverage layer reaches this point.');
  });

  it('shows hidden-layer empty text when all coverage layers are hidden', () => {
    mapModule.state.coverageResults = [{ visible: false }];
    inspectCoverageAtPoint.mockReturnValue([]);

    const html = mapContext._popupContent({ lat: 3, lng: 4 });
    expect(html).toContain('All coverage layers are hidden.');
  });

  it('labels inspected rows as visible coverage', () => {
    mapModule.state.coverageResults = [{ visible: true }];
    inspectCoverageAtPoint.mockReturnValue([{
      repName: 'Node',
      layerLabel: 'Layer A',
      layerOrdinal: 1,
      layerTotal: 1,
      rxPowerSource: 'computed',
      distM: 10,
      rxPower: -80,
      snrDb: 35,
      margin: 10,
      los: null,
      reason: 'Covered with comfortable margin.',
      losses: {},
    }]);

    const html = mapContext._popupContent({ lat: 3, lng: 4 });
    expect(html).toContain('Visible Coverage At Point');
    expect(html).toContain('Point model');
  });

  it('renders project summary inspector content with current app counts', () => {
    mapModule.state.repeaters = [{ visible: true }, { visible: false }];
    mapModule.state.coverageResults = [{ visible: true }, { visible: false }];
    mapModule.state.p2pLinks = [{}];
    mapModule.state.pathLinks = [{}, {}];

    const html = mapContext._projectSummaryContent();
    expect(html).toContain('Nodes');
    expect(html).toContain('1 visible');
    expect(html).toContain('Coverage Layers');
    expect(html).toContain('P2P Links');
    expect(html).toContain('Relay Paths');
    expect(html).toContain('data-inspector-tab="coverage"');
  });

  it('renders map point inspector content with coverage rows and actions', () => {
    mapModule.state.coverageResults = [{ visible: true }];
    inspectCoverageAtPoint.mockReturnValue([{
      repName: 'Node',
      layerLabel: 'Layer A',
      layerOrdinal: 1,
      layerTotal: 1,
      rxPowerSource: 'computed',
      distM: 10,
      rxPower: -80,
      snrDb: 35,
      margin: 10,
      los: null,
      reason: 'Covered with comfortable margin.',
      losses: {},
    }]);

    const html = mapContext._pointInspectorContent({ lat: 3, lng: 4 });
    expect(html).toContain('Map Point');
    expect(html).toContain('Visible Coverage At Point');
    expect(html).toContain('Node');
    expect(html).toContain('Add Node Here');
    expect(html).toContain('data-inspector-action="point-view-3d"');
  });

  it('renders node inspector content with radio details and actions', () => {
    const html = mapContext._nodeInspectorContent({
      id: 7,
      name: '<Hilltop>',
      lat: 48.28625,
      lon: 18.5054,
      height: 12,
      power: 22,
      gain: 8,
      freq: 869.525,
      color: '#61dafb',
      visible: true,
    });

    expect(html).toContain('&lt;Hilltop&gt;');
    expect(html).toContain('48.28625, 18.50540');
    expect(html).toContain('22.0 dBm + 8.0 dBi');
    expect(html).toContain('869.525 MHz');
    expect(html).toContain('Visible');
    expect(html).toContain('data-inspector-action="node-coverage"');
    expect(html).toContain('data-inspector-action="node-view-3d"');
    expect(html).toContain('data-inspector-action="node-optimize"');
  });

  it('renders live node health in the node inspector', () => {
    const html = mapContext._nodeInspectorContent({
      id: 8,
      name: 'Live Node',
      lat: 48.28625,
      lon: 18.5054,
      height: 12,
      power: 22,
      gain: 8,
      freq: 869.525,
      color: '#61dafb',
      visible: true,
      fromWs: true,
      short: 'abc123',
      lastSeen: null,
    });

    expect(html).toContain('Live feed');
    expect(html).toContain('Health');
    expect(html).toContain('Missing (no live timestamp)');
    expect(html).toContain('abc123');
  });

  it('updates the persistent selection inspector body', () => {
    const body = fakeElements.get('selection-inspector-body');
    const title = fakeElements.get('selection-inspector-title');
    mapModule.state.repeaters = [{ visible: true }];

    mapContext.updateSelectionInspector(null);
    expect(title.textContent).toBe('Project Summary');
    expect(body.innerHTML).toContain('Nodes');

    mapContext.updateSelectionInspector({ lat: 3, lng: 4 });
    expect(title.textContent).toBe('Map Point');
    expect(body.innerHTML).toContain('Map Point');
    expect(body.innerHTML).toContain('3.00000, 4.00000');
  });

  it('updates the persistent inspector for a selected node', () => {
    const body = fakeElements.get('selection-inspector-body');
    const title = fakeElements.get('selection-inspector-title');
    mapModule.state.repeaters = [{
      id: 3,
      name: 'Node A',
      lat: 48.28625,
      lon: 18.5054,
      height: 10,
      power: 20,
      gain: 2,
      freq: 869.525,
      visible: false,
    }];

    mapContext.updateNodeInspector(3);
    expect(title.textContent).toBe('Node');
    expect(body.innerHTML).toContain('Node A');
    expect(body.innerHTML).toContain('Hidden');
    expect(body.innerHTML).toContain('Show');
  });

  it('renders and updates the persistent inspector for selected nodes', () => {
    const body = fakeElements.get('selection-inspector-body');
    const title = fakeElements.get('selection-inspector-title');
    mapModule.state.repeaters = [{
      id: 3,
      name: 'Node A',
      lat: 48.28625,
      lon: 18.5054,
      visible: true,
    }, {
      id: 4,
      name: 'Node B',
      lat: 48.3,
      lon: 18.6,
      visible: false,
      fromWs: true,
    }];
    document.dispatchEvent.mockClear();

    const html = mapContext._nodesInspectorContent(mapModule.state.repeaters);
    expect(html).toContain('2 Selected Nodes');
    expect(html).toContain('1 visible, 1 live-feed');
    expect(html).toContain('Node A');
    expect(html).toContain('data-inspector-action="nodes-view-3d"');

    mapContext.updateNodesInspector([3, 4]);
    expect(title.textContent).toBe('Selected Nodes');
    expect(body.innerHTML).toContain('2 Selected Nodes');
    expect(body.innerHTML).toContain('Node B');

    const selectedEvent = document.dispatchEvent.mock.calls.at(-1)[0];
    expect(selectedEvent.type).toBe('selection:changed');
    expect(selectedEvent.detail).toMatchObject({ kind: 'nodes', ids: [3, 4] });
  });

  it('emits a shared selection event after inspector selection changes', () => {
    mapModule.state.repeaters = [{
      id: 3,
      name: 'Node A',
      lat: 48.28625,
      lon: 18.5054,
      height: 10,
      power: 20,
      gain: 2,
      freq: 869.525,
      visible: true,
    }];
    document.dispatchEvent.mockClear();

    mapContext.updateNodeInspector(3);

    const selectedEvent = document.dispatchEvent.mock.calls.at(-1)[0];
    expect(selectedEvent.type).toBe('selection:changed');
    expect(selectedEvent.detail).toMatchObject({ kind: 'node', id: 3 });

    document.dispatchEvent.mockClear();
    mapContext.updateSelectionInspector(null);
    const clearedEvent = document.dispatchEvent.mock.calls.at(-1)[0];
    expect(clearedEvent.type).toBe('selection:changed');
    expect(clearedEvent.detail).toMatchObject({ kind: 'summary' });
  });

  it('renders obstacle inspector content with modeling assumptions and actions', () => {
    const html = mapContext._obstacleInspectorContent({
      id: 'building:way/42',
      category: 'building',
      title: '<Building>',
      source: 'OpenStreetMap structures',
      rawOsmType: 'building:residential',
      heightM: 8,
      heightLabel: 'Structure height',
      heightSource: 'OSM tags and local defaults',
      attenuationDbPerM: 0.5,
      attenuationFactor: 1,
      attenuationLabel: 'Building/barrier loss',
      geometry: 'Polygon',
    });

    expect(html).toContain('&lt;Building&gt;');
    expect(html).toContain('building:residential');
    expect(html).toContain('8.0 m');
    expect(html).toContain('OSM tags and local defaults');
    expect(html).toContain('0.50 dB/m');
    expect(html).toContain('1.00x');
    expect(html).toContain('OpenStreetMap structures');
    expect(html).toContain('data-inspector-action="obstacle-open-map"');
    expect(html).toContain('data-inspector-action="obstacle-edit-model"');
  });

  it('updates the persistent inspector for a selected obstacle', () => {
    const body = fakeElements.get('selection-inspector-body');
    const title = fakeElements.get('selection-inspector-title');

    mapContext.updateObstacleInspector({
      id: 'foliage:way/7',
      category: 'foliage',
      title: 'Vegetation',
      source: 'OpenStreetMap vegetation',
      osmType: 'forest',
      heightM: 14,
      heightLabel: 'Canopy height',
      heightSource: 'DSM-DEM sampled where available; OSM/default fallback',
      attenuationDbPerM: 0.36,
      attenuationFactor: 1.2,
      attenuationLabel: 'Vegetation loss',
      geometry: 'Polygon',
    });

    expect(title.textContent).toBe('Obstacle');
    expect(body.innerHTML).toContain('Vegetation');
    expect(body.innerHTML).toContain('Canopy height');
    expect(body.innerHTML).toContain('0.36 dB/m');
    expect(body.innerHTML).toContain('1.20x');
  });

  it('renders link inspector content with budget details and actions', () => {
    const html = mapContext._linkInspectorContent({
      id: 'active-p2p',
      kind: 'p2p',
      endpointAName: 'Node A',
      endpointBName: 'Node B',
      distM: 2450,
      margin: 12.4,
      rxPower: -88.2,
      pathLoss: 118.3,
      totalPathLoss: 121.7,
      diffractionLoss: 3.2,
      geometricLos: true,
      fresnelClear: false,
      sampleCount: 128,
      color: '#4ade80',
    });

    expect(html).toContain('P2P Link');
    expect(html).toContain('Node A -> Node B');
    expect(html).toContain('Healthy');
    expect(html).toContain('2.45 km');
    expect(html).toContain('12.4 dB');
    expect(html).toContain('LoS clear');
    expect(html).toContain('Fresnel blocked');
    expect(html).toContain('data-inspector-action="link-view-3d"');
    expect(html).toContain('data-inspector-action="link-p2p-profile"');
    expect(html).toContain('data-inspector-action="link-p2p-recompute"');
  });

  it('updates the persistent inspector for a selected link', () => {
    const body = fakeElements.get('selection-inspector-body');
    const title = fakeElements.get('selection-inspector-title');
    mapModule.state.p2pLinks = [{
      id: 'active-p2p',
      kind: 'p2p',
      endpointAName: 'Node A',
      endpointBName: 'Node B',
      distM: 1000,
      margin: -2,
      rxPower: -135,
      color: '#fc8181',
    }];

    mapContext.updateLinkInspector('p2p', 'active-p2p');
    expect(title.textContent).toBe('P2P Link');
    expect(body.innerHTML).toContain('Node A -> Node B');
    expect(body.innerHTML).toContain('Failed');
    expect(body.innerHTML).toContain('Recompute');
  });

  it('renders optimizer candidate inspector content with shared details and actions', () => {
    const html = mapContext._optimizerCandidateInspectorContent({
      rank: 2,
      lat: 48.28625,
      lon: 18.5054,
      score: 0.62,
      coverageRatio: 0.42,
      elevM: 318,
      avgMarginDb: 8.5,
      backhaulPeerName: 'Source A',
      backhaulMarginDb: 12.4,
      backhaulRxPowerDbm: -91,
      backhaulDistanceM: 1500,
      backhaulLos: true,
      backhaulFresnelClear: true,
      backhaulPeerLat: 48.29,
      backhaulPeerLon: 18.51,
      scoreBreakdown: {
        formula: 'coverage + margin',
        label: 'Balanced',
        components: {
          coverage: { weight: 0.6, contribution: 0.25 },
          margin: { weight: 0.25, contribution: 0.04 },
        },
      },
    });

    expect(html).toContain('Suggested #2');
    expect(html).toContain('48.28625, 18.50540');
    expect(html).toContain('New coverage: 42.0%');
    expect(html).toContain('Backhaul to Source A: 12.4 dB');
    expect(html).toContain('Objective: coverage + margin');
    expect(html).toContain('data-inspector-action="optimizer-add"');
    expect(html).toContain('data-inspector-action="optimizer-view-3d"');
    expect(html).toContain('data-inspector-action="optimizer-show-backhaul"');
  });

  it('updates the persistent inspector for a selected optimizer candidate', () => {
    const body = fakeElements.get('selection-inspector-body');
    const title = fakeElements.get('selection-inspector-title');

    mapContext.updateOptimizerCandidateInspector({
      rank: 1,
      lat: 48.28625,
      lon: 18.5054,
      score: 0.5,
      coverageRatio: 0.4,
      elevM: 300,
    });

    expect(title.textContent).toBe('Optimizer Candidate');
    expect(body.innerHTML).toContain('Suggested #1');
    expect(body.innerHTML).toContain('Score: 50.0%');
    expect(body.innerHTML).toContain('Add Node');
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
