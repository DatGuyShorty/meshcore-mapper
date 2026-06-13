/**
 * ui.ts - Shared UI utilities: progress overlay, status bar, helpers.
 * No map or state dependencies.
 */

import { createJobStore, type JobMeta, type JobSnapshot } from './jobStore.js';

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

function _renderJobDrawerHistory(): void {
  const details = _jobEl('job-drawer-history');
  const list = _jobEl('job-drawer-history-list');
  if (!details || !list) return;
  const history = _jobStore.history;
  details.classList.toggle('hidden', history.length === 0);
  list.innerHTML = history.map(entry => `
    <li>
      <strong>${escHtml(entry.title)}</strong>
      <span>${escHtml(entry.message)}</span>
      <em>${escHtml(entry.detail)}</em>
    </li>
  `).join('');
}

function _updateJobDrawer(snapshot: JobSnapshot): void {
  _bindJobDrawerControls();
  const drawer = _jobEl('job-drawer');
  if (!drawer) return;
  drawer.classList.remove('hidden');
  drawer.dataset.state = snapshot.state;
  const stateEl = _jobEl('job-drawer-state');
  const titleEl = _jobEl('job-drawer-title');
  const messageEl = _jobEl('job-drawer-message');
  const fillEl = _jobEl('job-drawer-fill');
  const cancelBtn = _jobEl('btn-job-drawer-cancel') as HTMLButtonElement | null;
  if (stateEl) stateEl.textContent = snapshot.state === 'running' ? 'Running' : snapshot.state === 'complete' ? 'Completed' : 'Idle';
  if (titleEl) titleEl.textContent = snapshot.title;
  if (messageEl) messageEl.textContent = snapshot.message;
  if (fillEl) fillEl.style.width = `${snapshot.pct}%`;
  if (cancelBtn) cancelBtn.disabled = snapshot.state !== 'running' || !_cancelHandler;
}

export function setCancelHandler(fn: CancelHandler | null): void {
  _cancelHandler = fn;
  const cancelBtn = _jobEl('btn-job-drawer-cancel') as HTMLButtonElement | null;
  if (cancelBtn) cancelBtn.disabled = !fn;
}

const progressOverlay = (() => {
  const el = document.createElement('div');
  el.id = 'progress-overlay';
  el.className = 'hidden';
  el.innerHTML = `
    <div class="progress-box">
      <h3>Working...</h3>
      <div id="progress-msg" style="font-size:12px;color:#8892a4;margin-bottom:8px;"></div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" id="progress-fill" style="width:0%"></div>
      </div>
      <button id="btn-cancel-coverage" class="btn-secondary btn-xs" style="margin-top:8px;width:100%">Cancel</button>
    </div>`;
  const container = document.getElementById('map-container');
  container?.appendChild(el);
  el.querySelector('#btn-cancel-coverage')?.addEventListener('click', () => _cancelHandler?.());
  return el;
})();

export function setProgress(pct: number, msg?: string, meta?: JobMeta): void {
  const snapshot = _jobStore.setProgress(pct, msg, meta);
  progressOverlay.classList.remove('hidden');
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = pct + '%';
  if (msg) {
    const m = document.getElementById('progress-msg');
    if (m) m.textContent = msg;
  }
  _updateJobDrawer(snapshot);
}

export function hideProgress(): void {
  progressOverlay.classList.add('hidden');
  const fill = _jobEl('job-drawer-fill');
  const pct = parseFloat(fill?.style.width ?? '0') || 100;
  const snapshot = _jobStore.complete(pct);
  if (!snapshot) return;
  _renderJobDrawerHistory();
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
