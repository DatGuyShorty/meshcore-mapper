import { parseSettingsJson, type SettingsRecord } from './settingsSchema.js';
import {
  readPersistedSettingValue,
  writePersistedSettingValue,
  type PersistedEl,
} from './settingsPersistence.js';

type SettingsRoot = {
  getElementById(id: string): PersistedEl | null;
};

type SettingsStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type SettingsStoreOptions = {
  ids: Iterable<string>;
  storageKey: string;
  legacyKey?: string;
  root?: () => SettingsRoot;
  storage?: () => SettingsStorage;
};

function defaultRoot(): SettingsRoot {
  return {
    getElementById: id => document.getElementById(id) as PersistedEl | null,
  };
}

function defaultStorage(): SettingsStorage {
  return localStorage;
}

export function createSettingsStore({
  ids,
  storageKey,
  legacyKey,
  root = defaultRoot,
  storage = defaultStorage,
}: SettingsStoreOptions) {
  const settingIds = Array.from(ids);

  function gather(): SettingsRecord {
    const values: SettingsRecord = {};
    const currentRoot = root();
    for (const id of settingIds) {
      const el = currentRoot.getElementById(id);
      if (!el) continue;
      values[id] = readPersistedSettingValue(el);
    }
    return values;
  }

  function apply(values: SettingsRecord, { notify = false }: { notify?: boolean } = {}): void {
    const currentRoot = root();
    for (const id of settingIds) {
      if (!(id in values)) continue;
      writePersistedSettingValue(currentRoot.getElementById(id), values[id], { notify });
    }
  }

  function persist(): void {
    try {
      storage().setItem(storageKey, JSON.stringify(gather()));
    } catch {}
  }

  function restore(): void {
    try {
      const currentStorage = storage();
      const raw = currentStorage.getItem(storageKey) ?? (legacyKey ? currentStorage.getItem(legacyKey) : null);
      if (!raw) return;
      const values = parseSettingsJson(raw, settingIds);
      if (values) apply(values);
    } catch {}
  }

  return {
    gather,
    apply,
    persist,
    restore,
  };
}

export type { SettingsRecord };
