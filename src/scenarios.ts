export type ScenarioPreset = Record<string, string | boolean>;

const SCENARIOS: Record<string, ScenarioPreset> = {
  quick: {
    'grid-res': '0.5',
    'use-los': true,
    'use-fresnel': false,
    'use-foliage': false,
    'use-buildings': false,
    'obstacle-height-mode': 'osm',
    'compute-backend': 'auto',
    'compute-worker-count': '0',
    'dataset-batch-concurrency': '1',
    'dem-tile-concurrency': '4',
    'foliage-tile-concurrency': '2',
    'building-tile-concurrency': '2',
  },
  balanced: {
    'grid-res': '1',
    'use-los': true,
    'use-fresnel': true,
    'use-foliage': false,
    'use-buildings': false,
    'obstacle-height-mode': 'osm',
    'compute-backend': 'auto',
    'compute-worker-count': '0',
    'dataset-batch-concurrency': '2',
    'dem-tile-concurrency': '6',
    'foliage-tile-concurrency': '3',
    'building-tile-concurrency': '3',
  },
  urban: {
    'grid-res': '2',
    'use-los': true,
    'use-fresnel': true,
    'use-foliage': true,
    'use-buildings': true,
    'obstacle-height-mode': 'dsm-dem',
    'compute-backend': 'auto',
    'compute-worker-count': '0',
    'dataset-batch-concurrency': '3',
    'dem-tile-concurrency': '8',
    'foliage-tile-concurrency': '4',
    'building-tile-concurrency': '4',
  },
  offline: {
    'grid-res': '1',
    'use-los': true,
    'use-fresnel': true,
    'use-foliage': true,
    'use-buildings': true,
    'obstacle-height-mode': 'osm',
    'compute-backend': 'auto',
    'compute-worker-count': '0',
    'dataset-batch-concurrency': '1',
    'dem-tile-concurrency': '3',
    'foliage-tile-concurrency': '2',
    'building-tile-concurrency': '2',
  },
};

export function applyScenarioProfile(profileId: string): void {
  const values = SCENARIOS[profileId];
  if (!values) return;
  for (const [id, value] of Object.entries(values)) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    if ((el as HTMLInputElement).type === 'checkbox') (el as HTMLInputElement).checked = Boolean(value);
    else el.value = String(value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
