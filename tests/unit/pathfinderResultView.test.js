import { describe, expect, it } from 'vitest';
import {
  formatPathLineLabel,
  formatPathStatus,
  pathMarginColor,
  renderPathResultHtml,
} from '../../src/pathfinderResultView.js';

describe('pathfinder result view', () => {
  it('maps hop margins to stable result colors', () => {
    expect(pathMarginColor(20)).toBe('#4ade80');
    expect(pathMarginColor(8)).toBe('#86efac');
    expect(pathMarginColor(0)).toBe('#facc15');
    expect(pathMarginColor(-2)).toBe('#fb923c');
    expect(pathMarginColor(-10)).toBe('#f87171');
  });

  it('formats relay hop map labels with distance and optional receive power', () => {
    expect(formatPathLineLabel(4.25, 1234, -102.34))
      .toBe('<b>+4.3 dB</b><br>1.23 km - -102.3 dBm');
    expect(formatPathLineLabel(-6.2, 900, null))
      .toBe('<b>-6.2 dB</b><br>0.90 km');
  });

  it('renders escaped relay result summary and hop rows', () => {
    const html = renderPathResultHtml({
      path: [
        { node: node(1, 'A <site>'), incomingMargin: null },
        { node: node(2, 'B & Relay'), incomingMargin: 4.25 },
        { node: node(3, 'C'), incomingMargin: -6.2 },
      ],
      bottleneck: -6.2,
      numHops: 2,
      edgeDistances: [1234, 3456],
      edgeRxPowers: [-102.3, -115.4],
    });

    expect(html).toContain('2 hops');
    expect(html).toContain('Bottleneck: -6.2 dB');
    expect(html).toContain('style="color:#f87171"');
    expect(html).toContain('&bull; A &lt;site&gt;');
    expect(html).toContain('&middot; B &amp; Relay');
    expect(html).toContain('+4.3 dB');
    expect(html).toContain('3.5 km');
  });

  it('formats success, marginal, and blocked path status text', () => {
    expect(formatPathStatus(3.2)).toEqual({
      text: 'Path found \u2014 bottleneck +3.2 dB',
      isError: false,
    });
    expect(formatPathStatus(-4.4)).toEqual({
      text: 'Path found but bottleneck link is marginal (-4.4 dB) \u2014 may not work reliably',
      isError: false,
    });
    expect(formatPathStatus(-70)).toEqual({
      text: 'Path found but bottleneck link is severely blocked (-70.0 dB) \u2014 link budget not met',
      isError: true,
    });
  });

  function node(id, name) {
    return {
      id,
      name,
      lat: 48 + id / 1000,
      lon: 18 + id / 1000,
      height: 10,
      power: 30,
      gain: 2,
      freq: 868,
    };
  }
});
