/**
 * Durable storage for computed coverage layers.
 *
 * Heavy raster data (signal/los/elevation grids as typed arrays) lives in
 * IndexedDB, which stores structured-cloneable values natively without the
 * size limits or base64 overhead of localStorage. Lightweight per-layer UI
 * preferences (opacity, visibility, label) live in localStorage so small UI
 * edits never rewrite megabytes of grid data.
 *
 * All functions degrade to no-ops when IndexedDB / localStorage are
 * unavailable (e.g. unit-test environments).
 */

import {
  parseCoverageLayerPref,
  parseCoverageLayerPrefs,
  parseCoverageLayerRecord,
  type CoverageLayerPref,
  type CoverageLayerPrefs,
  type CoverageLayerRecord,
} from './coverageLayerSchema.js';

export type { CoverageLayerPref, CoverageLayerPrefs, CoverageLayerRecord };

const DB_NAME = 'meshcoreMapper_coverage_v2';
const DB_VERSION = 1;
const STORE = 'layers';
const PREFS_KEY = 'meshcoreMapper_coverageLayerPrefs';

function _openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'layerId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function persistLayerData(record: CoverageLayerRecord): Promise<void> {
  const safeRecord = parseCoverageLayerRecord(record);
  if (!safeRecord) return;
  const db = await _openDb();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(safeRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function deleteLayerData(layerId: string): Promise<void> {
  const db = await _openDb();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(layerId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadAllLayerData(): Promise<CoverageLayerRecord[]> {
  const db = await _openDb();
  if (!db) return [];
  const records = await new Promise<CoverageLayerRecord[]>((resolve, reject) => {
    const out: CoverageLayerRecord[] = [];
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(out);
        return;
      }
      const record = parseCoverageLayerRecord(cursor.value);
      if (record) out.push(record);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  return records;
}

export async function clearAllLayerData(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function readLayerPrefs(): CoverageLayerPrefs {
  if (typeof localStorage === 'undefined') return {};
  try {
    return parseCoverageLayerPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'));
  } catch {
    return {};
  }
}

export function writeLayerPref(layerId: string, pref: CoverageLayerPref): void {
  if (typeof localStorage === 'undefined') return;
  const safeLayerId = layerId.trim();
  if (!safeLayerId) return;
  const all = readLayerPrefs();
  const nextPref = parseCoverageLayerPref({ ...all[safeLayerId], ...pref });
  if (nextPref) all[safeLayerId] = nextPref;
  else delete all[safeLayerId];
  localStorage.setItem(PREFS_KEY, JSON.stringify(all));
}

export function deleteLayerPref(layerId: string): void {
  if (typeof localStorage === 'undefined') return;
  const all = readLayerPrefs();
  delete all[layerId.trim()];
  localStorage.setItem(PREFS_KEY, JSON.stringify(all));
}

export function clearAllLayerPrefs(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(PREFS_KEY);
}
