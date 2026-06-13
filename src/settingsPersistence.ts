/**
 * Small wrappers that read/write persisted UI control values, treating
 * checkboxes, <select>, and <input> uniformly. Used by `settings.js` to
 * round-trip control state through `localStorage`.
 */

export type PersistedEl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

type SettingsRoot = {
  getElementById(id: string): Pick<EventTarget, 'addEventListener'> | null;
};

export function readPersistedSettingValue(el: PersistedEl): boolean | string {
  return (el as HTMLInputElement).type === 'checkbox'
    ? (el as HTMLInputElement).checked
    : el.value;
}

export function writePersistedSettingValue(
  el: PersistedEl | null,
  value: unknown,
  { notify = false }: { notify?: boolean } = {},
): boolean {
  if (!el) return false;
  const input = el as HTMLInputElement;
  if (input.type === 'checkbox') {
    input.checked = value === 'false' ? false : Boolean(value);
  } else if ((el as HTMLSelectElement).options) {
    const sel = el as HTMLSelectElement;
    const next = String(value);
    const hasOption = Array.from(sel.options).some(option => option.value === next);
    if (!hasOption) return false;
    sel.value = next;
  } else {
    el.value = value as string;
  }
  if (notify) el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

export function bindPersistedSettingChanges(
  ids: Iterable<string>,
  handler: EventListener,
  root: SettingsRoot = document,
): void {
  for (const id of ids) {
    root.getElementById(id)?.addEventListener('change', handler);
  }
}
