/**
 * Generic progressive disclosure.
 *
 * Any element marked `data-show-when="<checkboxId>"` is visible only while the
 * named checkbox is checked. This declutters panels by hiding dependent controls
 * until their feature is actually enabled.
 */

export function applyDisclosure(root: ParentNode = document): void {
  const byControl = new Map<string, Element[]>();
  for (const el of root.querySelectorAll('[data-show-when]')) {
    const id = el.getAttribute('data-show-when');
    if (!id) continue;
    const list = byControl.get(id) ?? [];
    list.push(el);
    byControl.set(id, list);
  }
  for (const [id, els] of byControl) {
    const ctrl = document.getElementById(id) as HTMLInputElement | null;
    if (!ctrl) continue;
    const update = () => {
      for (const el of els) el.classList.toggle('hidden', !ctrl.checked);
    };
    ctrl.addEventListener('change', update);
    update();
  }
}
