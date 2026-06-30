/**
 * ui.ts - Shared UI utilities: progress overlay, status bar, helpers.
 * No map or state dependencies.
 */

import { createJobStore, type JobMeta, type JobSnapshot } from './jobStore.js';
import {
  renderJobDrawerHistory,
  renderJobDrawerSnapshot,
} from './jobDrawerView.js';
import {
  createProgressOverlayElement,
  hideProgressOverlay,
  renderProgressOverlayProgress,
} from './progressOverlayView.js';

type CancelHandler = () => void;

let _cancelHandler: CancelHandler | null = null;
let _jobDrawerBound = false;
const _jobStore = createJobStore({ nowMs: _nowMs });

function _jobEl(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function _bindJobDrawerControls(): void {
  if (_jobDrawerBound) return;
  const cancelBtn = _jobEl('btn-job-drawer-cancel');
  const dismissBtn = _jobEl('btn-job-drawer-dismiss');
  if (!cancelBtn && !dismissBtn) return;
  _jobDrawerBound = true;
  cancelBtn?.addEventListener('click', () => {
    _cancelHandler?.();
    const state = _jobEl('job-drawer-state');
    const message = _jobEl('job-drawer-message');
    if (state) state.textContent = 'Cancelling';
    if (message) message.textContent = 'Cancellation requested...';
  });
  dismissBtn?.addEventListener('click', () => {
    _jobEl('job-drawer')?.classList.add('hidden');
  });
}

function _nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function _updateJobDrawer(snapshot: JobSnapshot): void {
  _bindJobDrawerControls();
  renderJobDrawerSnapshot({
    drawer: _jobEl('job-drawer'),
    state: _jobEl('job-drawer-state'),
    title: _jobEl('job-drawer-title'),
    message: _jobEl('job-drawer-message'),
    fill: _jobEl('job-drawer-fill'),
    cancelButton: _jobEl('btn-job-drawer-cancel') as HTMLButtonElement | null,
  }, snapshot, Boolean(_cancelHandler));
}

export function setCancelHandler(fn: CancelHandler | null): void {
  _cancelHandler = fn;
  const cancelBtn = _jobEl('btn-job-drawer-cancel') as HTMLButtonElement | null;
  if (cancelBtn) cancelBtn.disabled = !fn;
}

const progressOverlay = (() => {
  const el = createProgressOverlayElement();
  const container = document.getElementById('map-container');
  container?.appendChild(el);
  el.querySelector('#btn-cancel-coverage')?.addEventListener('click', () => _cancelHandler?.());
  return el;
})();

export function setProgress(pct: number, msg?: string, meta?: JobMeta): void {
  const snapshot = _jobStore.setProgress(pct, msg, meta);
  renderProgressOverlayProgress(progressOverlay, pct, msg);
  _updateJobDrawer(snapshot);
}

export function hideProgress(): void {
  hideProgressOverlay(progressOverlay);
  const fill = _jobEl('job-drawer-fill');
  const pct = parseFloat(fill?.style.width ?? '0') || 100;
  const snapshot = _jobStore.complete(pct);
  if (!snapshot) return;
  renderJobDrawerHistory(
    _jobEl('job-drawer-history'),
    _jobEl('job-drawer-history-list'),
    _jobStore.history,
  );
  _updateJobDrawer(snapshot);
}

export function setStatus(msg: string): void {
  const el = document.getElementById('status-msg');
  if (el) el.textContent = msg;
}

export function getEl(elOrId: HTMLElement | string | null | undefined): HTMLElement | null {
  return typeof elOrId === 'string' ? document.getElementById(elOrId) : (elOrId ?? null);
}

export function setButtonBusy(elOrId: HTMLElement | string | null | undefined, busy: boolean, busyText = 'Working...'): void {
  const btn = getEl(elOrId) as HTMLButtonElement | null;
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.idleText) btn.dataset.idleText = btn.textContent ?? '';
    btn.textContent = busyText;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  } else {
    if (btn.dataset.idleText) btn.textContent = btn.dataset.idleText;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

export async function withButtonBusy<T>(
  elOrId: HTMLElement | string | null | undefined,
  busyText: string,
  fn: () => Promise<T>,
): Promise<T> {
  setButtonBusy(elOrId, true, busyText);
  try {
    return await fn();
  } finally {
    setButtonBusy(elOrId, false);
  }
}

export function setInlineStatus(id: string, msg: string, kind = 'info'): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || '';
  el.className = `status-line status-${kind}`;
  el.classList.toggle('hidden', !msg);
}

export function confirmAction(message: string): boolean {
  return window.confirm(message);
}

export function setActiveTab(tabName: string): void {
  const el = document.querySelector(`.tab-btn[data-tab="${tabName}"]`) as HTMLElement | null;
  el?.click();
}

export function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Escape HTML special chars for safe inclusion in templated strings.
 */
export function escHtml(str: unknown): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str ?? '').replace(/[&<>"']/g, m => map[m]);
}
