import type { PathResult } from './pathfinder.js';

export type PathStatusView = {
  text: string;
  isError: boolean;
};

export function pathMarginColor(margin: number): string {
  if (margin >= 15) return '#4ade80';
  if (margin >= 5) return '#86efac';
  if (margin >= 0) return '#facc15';
  if (margin >= -5) return '#fb923c';
  return '#f87171';
}

export function formatPathLineLabel(
  margin: number,
  distM: number,
  rxPower: number | null | undefined,
): string {
  const sign = margin >= 0 ? '+' : '';
  const rxText = Number.isFinite(rxPower) ? ` - ${(rxPower as number).toFixed(1)} dBm` : '';
  return `<b>${sign}${margin.toFixed(1)} dB</b><br>${(distM / 1000).toFixed(2)} km${rxText}`;
}

export function renderPathResultHtml(result: PathResult): string {
  const { path, bottleneck, numHops, edgeDistances } = result;
  const bottleneckColor = pathMarginColor(bottleneck);
  let html = `<div class="path-summary">
    <span class="path-hops">${numHops} hop${numHops !== 1 ? 's' : ''}</span>
    <span class="path-bottleneck" style="color:${bottleneckColor}">Bottleneck: ${bottleneck.toFixed(1)} dB</span>
  </div>
  <table class="p2p-table"><tbody>`;

  for (let i = 0; i < path.length; i++) {
    const { node, incomingMargin } = path[i];
    const distStr = i > 0 ? ` - ${(edgeDistances[i - 1] / 1000).toFixed(1)} km` : '';
    const marginStr = incomingMargin !== null
      ? `<span style="color:${pathMarginColor(incomingMargin)}">${incomingMargin >= 0 ? '+' : ''}${incomingMargin.toFixed(1)} dB</span>`
      : '';
    html += `<tr>
      <td class="p2p-key">${i === 0 ? '&bull;' : '&middot;'} ${_escHtml(node.name)}</td>
      <td class="p2p-val">${marginStr}${distStr}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  return html;
}

function _escHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch] ?? ch);
}

export function formatPathStatus(bottleneck: number): PathStatusView {
  if (bottleneck >= 0) {
    return {
      text: `Path found \u2014 bottleneck +${bottleneck.toFixed(1)} dB`,
      isError: false,
    };
  }
  if (bottleneck >= -50) {
    return {
      text: `Path found but bottleneck link is marginal (${bottleneck.toFixed(1)} dB) \u2014 may not work reliably`,
      isError: false,
    };
  }
  return {
    text: `Path found but bottleneck link is severely blocked (${bottleneck.toFixed(1)} dB) \u2014 link budget not met`,
    isError: true,
  };
}
