// @ts-check
/**
 * Small wrappers that read/write persisted UI control values, treating
 * checkboxes, <select>, and <input> uniformly. Used by `settings.js` to
 * round-trip control state through `localStorage`.
 *
 * @typedef {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} PersistedEl
 */

/**
 * @param {PersistedEl} el
 * @returns {boolean | string}
 */
export function readPersistedSettingValue(el) {
  return /** @type {HTMLInputElement} */ (el).type === 'checkbox'
    ? /** @type {HTMLInputElement} */ (el).checked
    : el.value;
}

/**
 * @param {PersistedEl | null} el
 * @param {unknown} value
 * @param {{ notify?: boolean }} [opts]
 * @returns {boolean}
 */
export function writePersistedSettingValue(el, value, { notify = false } = {}) {
  if (!el) return false;
  const input = /** @type {HTMLInputElement} */ (el);
  if (input.type === 'checkbox') {
    input.checked = value === 'false' ? false : Boolean(value);
  } else if (/** @type {HTMLSelectElement} */ (el).options) {
    const sel = /** @type {HTMLSelectElement} */ (el);
    const next = String(value);
    const hasOption = Array.from(sel.options).some(option => option.value === next);
    if (!hasOption) return false;
    sel.value = next;
  } else {
    el.value = /** @type {string} */ (value);
  }
  if (notify) el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/**
 * @param {Iterable<string>} ids
 * @param {EventListener} handler
 * @param {Document} [root]
 */
export function bindPersistedSettingChanges(ids, handler, root = document) {
  for (const id of ids) {
    root.getElementById(id)?.addEventListener('change', handler);
  }
}
