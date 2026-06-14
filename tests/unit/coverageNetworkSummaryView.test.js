import { describe, expect, it, vi } from 'vitest';
import {
  buildCoverageNetworkSummaryModel,
  coverageNetworkStatsRows,
  coverageNodeFailureRows,
  renderCoverageNetworkSummaryModel,
} from '../../src/coverageNetworkSummaryView.js';

describe('coverage network summary view', () => {
  it('builds empty states for missing and hidden coverage layers', () => {
    expect(buildCoverageNetworkSummaryModel({
      status: 'empty',
      totalLayerCount: 0,
      visibleLayerCount: 0,
    }, null, null)).toMatchObject({
      status: 'empty',
      emptyText: 'No combined coverage yet.',
      simulation: null,
    });

    expect(buildCoverageNetworkSummaryModel({
      status: 'no-visible-layers',
      totalLayerCount: 2,
      visibleLayerCount: 0,
    }, null, { sourceKey: 'node:a', label: 'Alpha' })).toMatchObject({
      status: 'empty',
      emptyText: 'No visible coverage layers.',
      simulation: { sourceKey: 'node:a', label: 'Alpha' },
    });
  });

  it('builds ready summary metrics, stats rows, and top-serving text', () => {
    const summary = readySummary();
    const model = buildCoverageNetworkSummaryModel(summary, null, null);

    expect(model).toMatchObject({
      status: 'ready',
      title: 'Combined Visible Network',
      visibleLayerText: '2 visible layers',
      topServingText: 'Top serving: Alpha 56%, Beta 45%',
    });
    expect(model.metrics).toEqual(expect.arrayContaining([
      { label: 'Covered area', value: '12.3 ha' },
      { label: 'Covered', value: '89%' },
      { label: 'Median margin', value: '+4.8 dB' },
    ]));
    expect(model.statsRows).toEqual(expect.arrayContaining([
      { label: 'Analysis area', value: '1.7 km2' },
      { label: 'Sample grid', value: '32 x 64' },
      { label: 'Top serving', value: 'Alpha 1.3 km2 (56%), Beta 97.0 ha (45%)' },
      { label: 'Node contributions', value: 'Alpha 1.3 km2 (56%), Beta 97.0 ha (45%), Gamma 25.0 ha (5.0%)' },
    ]));
  });

  it('marks simulated-offline failure actions and limits critical rows', () => {
    const rows = coverageNodeFailureRows({
      status: 'ready',
      totalLayerCount: 6,
      visibleLayerCount: 6,
      baselineCoveredAreaKm2: 2.3,
      impacts: Array.from({ length: 6 }, (_, index) => ({
        sourceKey: `node:${index}`,
        label: `Node ${index}`,
        coveredAreaKm2: 1,
        lostAreaKm2: 0.1 + index,
        lostPctOfNetwork: 5 + index,
        lostPctOfSourceCoverage: 20 + index,
      })),
    }, 'node:1');

    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ label: 'Baseline covered', value: '2.3 km2' });
    expect(rows[1].action).toMatchObject({ text: 'Sim', sourceKey: 'node:0', label: 'Node 0' });
    expect(rows[2].action).toMatchObject({ text: 'Active', sourceKey: 'node:1', label: 'Node 1' });
    expect(rows.at(-1).label).toBe('Node 4');
  });

  it('renders stable text, classes, and simulation callbacks', () => {
    const doc = fakeDocument();
    const container = fakeElement('div');
    const clearSimulation = vi.fn();
    const simulateOffline = vi.fn();
    const model = buildCoverageNetworkSummaryModel(
      readySummary(),
      {
        status: 'ready',
        totalLayerCount: 1,
        visibleLayerCount: 1,
        baselineCoveredAreaKm2: 2,
        impacts: [{
          sourceKey: 'node:b',
          label: 'Beta',
          coveredAreaKm2: 1,
          lostAreaKm2: 0.4,
          lostPctOfNetwork: 12.4,
          lostPctOfSourceCoverage: 50,
        }],
      },
      { sourceKey: 'node:a', label: 'Alpha' },
    );

    renderCoverageNetworkSummaryModel(container, model, {
      onClearSimulation: clearSimulation,
      onSimulateOffline: simulateOffline,
      doc,
    });

    expect(textOf(container)).toContain('Combined Network - Alpha offline');
    expect(textOf(container)).toContain('Simulating Alpha offline');
    expect(textOf(container)).toContain('Network stats');
    expect(textOf(container)).toContain('Critical nodes');
    expect(findByClass(container, 'coverage-network-sim')).toHaveLength(1);
    expect(findByClass(container, 'coverage-network-critical')).toHaveLength(1);

    const buttons = findByTag(container, 'button');
    expect(buttons.map(button => button.textContent)).toEqual(['Clear', 'Sim']);
    buttons[0].click();
    buttons[1].click();

    expect(clearSimulation).toHaveBeenCalledTimes(1);
    expect(simulateOffline).toHaveBeenCalledWith('node:b', 'Beta');
  });

  it('formats unavailable stats values as n/a or zero', () => {
    expect(coverageNetworkStatsRows({
      status: 'ready',
      totalLayerCount: 1,
      visibleLayerCount: 1,
      sampleRows: 0,
      sampleCols: 0,
      topServing: [],
    })).toEqual(expect.arrayContaining([
      { label: 'Analysis area', value: '0 km2' },
      { label: 'Average margin', value: 'n/a' },
      { label: 'Top serving', value: 'n/a' },
      { label: 'Node contributions', value: 'n/a' },
    ]));
  });

  function readySummary() {
    return {
      status: 'ready',
      totalLayerCount: 2,
      visibleLayerCount: 2,
      analysisAreaKm2: 1.7,
      coveredAreaKm2: 0.123,
      uncoveredAreaKm2: 1.577,
      overlapAreaKm2: 0.33,
      weakAreaKm2: 0.2,
      coveredPct: 88.88,
      redundancyPct: 12.2,
      weakPct: 3.4,
      averageMarginDb: -1.2,
      medianMarginDb: 4.75,
      bestMarginDb: 11.2,
      sampleRows: 32,
      sampleCols: 64,
      topServing: [
        { sourceKey: 'node:a', label: 'Alpha', areaKm2: 1.25, pct: 55.5 },
        { sourceKey: 'node:b', label: 'Beta', areaKm2: 0.97, pct: 44.5 },
      ],
      nodeContributions: [
        { sourceKey: 'node:a', label: 'Alpha', areaKm2: 1.25, pct: 55.5 },
        { sourceKey: 'node:b', label: 'Beta', areaKm2: 0.97, pct: 44.5 },
        { sourceKey: 'node:c', label: 'Gamma', areaKm2: 0.25, pct: 5 },
      ],
    };
  }

  function fakeDocument() {
    return {
      createElement: tagName => fakeElement(tagName),
    };
  }

  function fakeElement(tagName) {
    let text = '';
    const listeners = {};
    const element = {
      tagName,
      className: '',
      children: [],
      type: '',
      get textContent() {
        return text;
      },
      set textContent(value) {
        text = String(value ?? '');
        if (text === '') this.children = [];
      },
      append(...items) {
        this.children.push(...items);
      },
      appendChild(item) {
        this.children.push(item);
        return item;
      },
      addEventListener(event, handler) {
        listeners[event] = handler;
      },
      click() {
        listeners.click?.({ target: this });
      },
    };
    return element;
  }

  function textOf(element) {
    return [element.textContent, ...element.children.map(textOf)].filter(Boolean).join(' ');
  }

  function findByClass(element, className) {
    const here = element.className?.split(/\s+/).includes(className) ? [element] : [];
    return here.concat(element.children.flatMap(child => findByClass(child, className)));
  }

  function findByTag(element, tagName) {
    const here = element.tagName === tagName ? [element] : [];
    return here.concat(element.children.flatMap(child => findByTag(child, tagName)));
  }
});
