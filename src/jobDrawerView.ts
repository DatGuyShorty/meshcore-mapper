import type { JobHistoryEntry, JobSnapshot, JobState } from './jobStore.js';

export type JobDrawerElements = {
  drawer: HTMLElement | null;
  state: HTMLElement | null;
  title: HTMLElement | null;
  message: HTMLElement | null;
  fill: HTMLElement | null;
  cancelButton: HTMLButtonElement | null;
};

export function jobDrawerStateLabel(state: JobState): string {
  if (state === 'running') return 'Running';
  if (state === 'complete') return 'Completed';
  return 'Idle';
}

export function jobDrawerHistoryHtml(history: JobHistoryEntry[]): string {
  return history.map(entry => `
    <li>
      <strong>${_escHtml(entry.title)}</strong>
      <span>${_escHtml(entry.message)}</span>
      <em>${_escHtml(entry.detail)}</em>
    </li>
  `).join('');
}

export function renderJobDrawerHistory(
  details: HTMLElement | null,
  list: HTMLElement | null,
  history: JobHistoryEntry[],
): void {
  if (!details || !list) return;
  details.classList.toggle('hidden', history.length === 0);
  list.innerHTML = jobDrawerHistoryHtml(history);
}

export function renderJobDrawerSnapshot(
  elements: JobDrawerElements,
  snapshot: JobSnapshot,
  hasCancelHandler: boolean,
): void {
  if (!elements.drawer) return;
  elements.drawer.classList.remove('hidden');
  elements.drawer.dataset.state = snapshot.state;
  if (elements.state) elements.state.textContent = jobDrawerStateLabel(snapshot.state);
  if (elements.title) elements.title.textContent = snapshot.title;
  if (elements.message) elements.message.textContent = snapshot.message;
  if (elements.fill) elements.fill.style.width = `${snapshot.pct}%`;
  if (elements.cancelButton) elements.cancelButton.disabled = snapshot.state !== 'running' || !hasCancelHandler;
}

function _escHtml(str: unknown): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str ?? '').replace(/[&<>"']/g, m => map[m]);
}
