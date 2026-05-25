export function readPersistedSettingValue(el) {
  return el.type === 'checkbox' ? el.checked : el.value;
}

export function writePersistedSettingValue(el, value, { notify = false } = {}) {
  if (!el) return false;
  if (el.type === 'checkbox') {
    el.checked = value === 'false' ? false : Boolean(value);
  } else if (el.options) {
    const next = String(value);
    const hasOption = Array.from(el.options).some(option => option.value === next);
    if (!hasOption) return false;
    el.value = next;
  } else {
    el.value = value;
  }
  if (notify) el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

export function bindPersistedSettingChanges(ids, handler, root = document) {
  for (const id of ids) {
    root.getElementById(id)?.addEventListener('change', handler);
  }
}
