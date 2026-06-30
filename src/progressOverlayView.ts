export type ProgressOverlayDocumentLike = Pick<Document, 'createElement' | 'getElementById'>;

export function createProgressOverlayElement(doc: ProgressOverlayDocumentLike = document): HTMLElement {
  const el = doc.createElement('div');
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
  return el;
}

export function renderProgressOverlayProgress(
  overlay: HTMLElement,
  pct: number,
  msg?: string,
  doc: ProgressOverlayDocumentLike = document,
): void {
  overlay.classList.remove('hidden');
  const fill = doc.getElementById('progress-fill');
  if (fill) fill.style.width = `${pct}%`;
  if (msg) {
    const message = doc.getElementById('progress-msg');
    if (message) message.textContent = msg;
  }
}

export function hideProgressOverlay(overlay: HTMLElement): void {
  overlay.classList.add('hidden');
}
