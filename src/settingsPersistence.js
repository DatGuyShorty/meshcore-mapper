export function bindPersistedSettingChanges(ids, handler, root = document) {
  for (const id of ids) {
    root.getElementById(id)?.addEventListener('change', handler);
  }
}
