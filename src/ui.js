/**
 * ui.js — Shared UI utilities: progress overlay, status bar, helpers.
 * No map or state dependencies.
 */

let _cancelHandler = null;

export function setCancelHandler(fn) {
  _cancelHandler = fn;
}

const progressOverlay = (() => {
  const el = document.createElement('div');
  el.id = 'progress-overlay';
  el.className = 'hidden';
  el.innerHTML = `
    <div class="progress-box">
      <h3>Working…</h3>
      <div id="progress-msg" style="font-size:12px;color:#8892a4;margin-bottom:8px;"></div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" id="progress-fill" style="width:0%"></div>
      </div>
      <button id="btn-cancel-coverage" class="btn-secondary btn-xs" style="margin-top:8px;width:100%">✕ Cancel</button>
    </div>`;
  document.getElementById('map-container').appendChild(el);
  el.querySelector('#btn-cancel-coverage').addEventListener('click', () => _cancelHandler?.());
  return el;
})();

export function setProgress(pct, msg) {
  progressOverlay.classList.remove('hidden');
  document.getElementById('progress-fill').style.width = pct + '%';
  if (msg) document.getElementById('progress-msg').textContent = msg;
}

export function hideProgress() {
  progressOverlay.classList.add('hidden');
}

export function setStatus(msg) {
  document.getElementById('status-msg').textContent = msg;
}

export function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export function escHtml(str) {
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
