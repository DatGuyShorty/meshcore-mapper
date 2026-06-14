import {
  optimizerResultDiagnostics,
  optimizerShouldRenderDiagnostics,
  type OptimizerStats,
} from './optimizerDiagnostics.js';
import { optimizerResultCoreDetails } from './optimizerResultDetails.js';

export function optimizerCandidatePopupHtml(result: any, rank: number): string {
  const details = optimizerResultCoreDetails(result);
  const popup = [
    `<b>Suggested #${rank}</b>`,
    `${_fixed(result?.lat, 5)}, ${_fixed(result?.lon, 5)}`,
    ...details.map(_escHtml),
  ];
  if (result?.scoreBreakdown?.formula) popup.push(`Objective: ${_escHtml(result.scoreBreakdown.formula)}`);
  return popup.join('<br>');
}

export function optimizerCandidateItemHtml(result: any, rank: number): string {
  const details = optimizerResultCoreDetails(result);
  return `
      <span class="ori-rank">#${rank}</span>
      <div class="ori-info">
        <div class="ori-coords">${_fixed(result?.lat, 4)}, ${_fixed(result?.lon, 4)}</div>
        <div class="ori-score">${_escHtml(details.join(' | '))}</div>
      </div>
      <button class="ori-add" title="Add as repeater">+ Add</button>`;
}

export function optimizerDiagnosticsItemHtml(resultCount: number, stats: OptimizerStats | undefined): string {
  if (!optimizerShouldRenderDiagnostics(resultCount, stats)) return '';
  const details = optimizerResultDiagnostics(resultCount, stats);
  if (!details.length) return '';
  return `
    <span class="ori-rank">!</span>
    <div class="ori-info">
      <div class="ori-coords">Optimizer diagnostics</div>
      <div class="ori-score">${_escHtml(details.join(' | '))}</div>
    </div>`;
}

function _fixed(value: unknown, digits: number): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : 'NaN';
}

function _escHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
