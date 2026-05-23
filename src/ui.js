/**
 * ui.js — Shared UI utilities: progress overlay, status bar, helpers.
 * No map or state dependencies.
 */

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
    </div>`;
  document.getElementById('map-container').appendChild(el);
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
