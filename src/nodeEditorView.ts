type DocumentLike = Pick<Document, 'getElementById'>;

export type NodeEditorMode = 'add' | 'edit' | 'placing';

export type NodeEditorValues = {
  'repeater-name': string;
  'repeater-lat': string;
  'repeater-lon': string;
  'repeater-height': string;
  'repeater-power': string;
  'repeater-freq': string;
  'repeater-gain': string;
  'radio-preset': string;
  'antenna-preset': string;
};

export function nodeEditorValuesFromRepeater(repeater: any): NodeEditorValues {
  return {
    'repeater-name': String(repeater?.name ?? ''),
    'repeater-lat': String(repeater?.lat ?? ''),
    'repeater-lon': String(repeater?.lon ?? ''),
    'repeater-height': String(repeater?.height ?? ''),
    'repeater-power': String(repeater?.power ?? ''),
    'repeater-freq': String(repeater?.freq ?? ''),
    'repeater-gain': String(repeater?.gain ?? ''),
    'radio-preset': '',
    'antenna-preset': '',
  };
}

export function applyNodeEditorValues(doc: DocumentLike, values: NodeEditorValues): void {
  for (const [id, value] of Object.entries(values)) {
    const el = doc.getElementById(id);
    if (el && 'value' in el) {
      (el as HTMLInputElement | HTMLSelectElement).value = value;
    }
  }
}

export function setNodeEditorMode(doc: DocumentLike, mode: NodeEditorMode): void {
  const addBtn = doc.getElementById('btn-add-repeater');
  if (addBtn) addBtn.textContent = mode === 'edit' ? 'Update Node' : 'Add Node';

  const clickBtn = doc.getElementById('btn-add-click');
  if (clickBtn) clickBtn.textContent = mode === 'add' ? 'Place on Map' : 'Cancel';

  const hint = doc.getElementById('place-hint');
  if (hint) hint.classList.toggle('hidden', mode !== 'placing');
}

export function openNodeEditorPanel(doc: DocumentLike): void {
  const addPanel = doc.getElementById('add-repeater-summary')?.closest('details') as HTMLDetailsElement | null;
  if (addPanel) addPanel.open = true;
  doc.getElementById('sidebar')?.scrollTo({ top: 0, behavior: 'smooth' });
}
