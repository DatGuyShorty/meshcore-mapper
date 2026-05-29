// @ts-check
/**
 * ui.js - Shared UI utilities: progress overlay, status bar, helpers.
 * No map or state dependencies.
 */

/** @type {(() => void) | null} */
let _cancelHandler = null;

/** @param {(() => void) | null} fn */
export function setCancelHandler(fn) {
  _cancelHandler = fn;
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
  /** @type {HTMLElement | null} */
  const container = document.getElementById('map-container');
  container?.appendChild(el);
  el.querySelector('#btn-cancel-coverage')?.addEventListener('click', () => _cancelHandler?.());
  return el;
})();

/**
 * @param {number} pct
 * @param {string} [msg]
 */
export function setProgress(pct, msg) {
  progressOverlay.classList.remove('hidden');
  const fill = /** @type {HTMLElement | null} */ (document.getElementById('progress-fill'));
  if (fill) fill.style.width = pct + '%';
  if (msg) {
    const m = document.getElementById('progress-msg');
    if (m) m.textContent = msg;
  }
}

export function hideProgress() {
  progressOverlay.classList.add('hidden');
}

/** @param {string} msg */
export function setStatus(msg) {
  const el = document.getElementById('status-msg');
  if (el) el.textContent = msg;
}

/**
 * @param {HTMLElement | string | null | undefined} elOrId
 * @returns {HTMLElement | null}
 */
export function getEl(elOrId) {
  return typeof elOrId === 'string' ? document.getElementById(elOrId) : (elOrId ?? null);
}

/**
 * @param {HTMLElement | string | null | undefined} elOrId
 * @param {boolean} busy
 * @param {string} [busyText]
 */
export function setButtonBusy(elOrId, busy, busyText = 'Working...') {
  const btn = /** @type {HTMLButtonElement | null} */ (getEl(elOrId));
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

/**
 * @template T
 * @param {HTMLElement | string | null | undefined} elOrId
 * @param {string} busyText
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withButtonBusy(elOrId, busyText, fn) {
  setButtonBusy(elOrId, true, busyText);
  try {
    return await fn();
  } finally {
    setButtonBusy(elOrId, false);
  }
}

/**
 * @param {string} id
 * @param {string} msg
 * @param {string} [kind]
 */
export function setInlineStatus(id, msg, kind = 'info') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || '';
  el.className = `status-line status-${kind}`;
  el.classList.toggle('hidden', !msg);
}

/** @param {string} message */
export function confirmAction(message) {
  return window.confirm(message);
}

/** @param {string} tabName */
export function setActiveTab(tabName) {
  /** @type {HTMLElement | null} */
  const el = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  el?.click();
}

export function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Escape HTML special chars for safe inclusion in templated strings.
 * @param {unknown} str
 * @returns {string}
 */
export function escHtml(str) {
  /** @type {Record<string, string>} */
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str ?? '').replace(/[&<>"']/g, m => map[m]);
}
