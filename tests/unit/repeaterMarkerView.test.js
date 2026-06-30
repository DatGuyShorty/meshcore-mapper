import { describe, expect, it } from 'vitest';
import {
  repeaterContextMenuHtml,
  repeaterPopupHtml,
  wsRepeaterPopupHtml,
} from '../../src/repeaterMarkerView.js';

describe('repeater marker view helpers', () => {
  it('renders escaped planned repeater popup content', () => {
    const html = repeaterPopupHtml({
      name: 'Alpha <site>',
      power: '27 & 1',
      gain: 6,
      freq: 869.525,
      height: 12,
    });

    expect(html).toContain('<b>Alpha &lt;site&gt;</b>');
    expect(html).toContain('TX: 27 &amp; 1 dBm + 6 dBi @ 869.525 MHz');
    expect(html).toContain('Ant. height: 12 m');
  });

  it('renders escaped live repeater popup metadata only when present', () => {
    const html = wsRepeaterPopupHtml({
      short: 'abc<123>',
      last_seen: '2026-06-30T12:00:00Z',
    }, 'Live & Node');

    expect(html).toBe('<b>Live &amp; Node</b><br>ID: <code>abc&lt;123&gt;</code><br>Last seen: 2026-06-30T12:00:00Z');
    expect(wsRepeaterPopupHtml({}, 'Only Name')).toBe('<b>Only Name</b>');
  });

  it('renders the node context menu action shell', () => {
    const html = repeaterContextMenuHtml();

    for (const action of ['info', 'p2p', 'edit', 'vis', 'coverage', 'optimize', 'pathfrom', 'delete']) {
      expect(html).toContain(`data-ctx="${action}"`);
    }
    expect(html).toContain('ctx-danger');
  });
});
