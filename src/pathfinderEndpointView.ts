export type PathEndpointNode = {
  id: string | number;
  name: string;
};

export type PathEndpointOption = {
  value: string;
  label: string;
};

export function buildPathEndpointOptions(nodes: PathEndpointNode[]): PathEndpointOption[] {
  return [...nodes]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map(node => ({
      value: String(node.id),
      label: String(node.name),
    }));
}

export function renderPathEndpointSelects(
  fromSel: HTMLSelectElement,
  toSel: HTMLSelectElement,
  nodes: PathEndpointNode[],
): { hasNodes: boolean } {
  const savedFrom = fromSel.value;
  const savedTo = toSel.value;
  const options = buildPathEndpointOptions(nodes);

  replaceOptions(fromSel, options.length ? options : [{ value: '', label: '-- no nodes --' }]);
  replaceOptions(toSel, options.length ? options : [{ value: '', label: '-- no nodes --' }]);

  if (options.length === 0) return { hasNodes: false };

  if (savedFrom && hasOptionValue(fromSel, savedFrom)) fromSel.value = savedFrom;
  if (savedTo && hasOptionValue(toSel, savedTo)) toSel.value = savedTo;

  ensureDifferentPathEndpoints(fromSel, toSel);
  return { hasNodes: true };
}

export function ensureDifferentPathEndpoints(fromSel: HTMLSelectElement, toSel: HTMLSelectElement): void {
  if (fromSel.value !== toSel.value || toSel.options.length <= 1) return;
  const next = Array.from(toSel.options).find(opt => opt.value !== fromSel.value);
  if (next) toSel.value = next.value;
}

function replaceOptions(select: HTMLSelectElement, options: PathEndpointOption[]): void {
  select.innerHTML = '';
  for (const option of options) {
    select.appendChild(createOption(select, option));
  }
}

function createOption(select: HTMLSelectElement, option: PathEndpointOption): HTMLOptionElement {
  const el = select.ownerDocument.createElement('option');
  el.value = option.value;
  el.textContent = option.label;
  return el;
}

function hasOptionValue(select: HTMLSelectElement, value: string): boolean {
  return Array.from(select.options).some(option => option.value === value);
}
