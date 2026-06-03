// @ts-check
/**
 * coveragePersistence.js — durable storage for computed coverage layers.
 *
 * Heavy raster data (signal/los/elevation grids as typed arrays) lives in
 * IndexedDB, which stores structured-cloneable values natively without the
 * size limits or base64 overhead of localStorage. Lightweight per-layer UI
 * preferences (opacity, visibility) live in localStorage so toggling them
 * never rewrites megabytes of grid data.
 *
 * All functions degrade to no-ops when IndexedDB / localStorage are
 * unavailable (e.g. unit-test environments).
 */

const DB_NAME = 'meshcoreMapper_coverage';
const DB_VERSION = 1;
const STORE = 'layers';
const PREFS_KEY = 'meshcoreMapper_coverageLayerPrefs';

/** @returns {Promise<IDBDatabase | null>} */
function _openDb() {
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

/**
 * Persist (or overwrite) one layer's grid record.
 * @param {Record<string, any> & { layerId: string }} record
 */
export async function persistLayerData(record) {
  const db = await _openDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** @param {string} layerId */
export async function deleteLayerData(layerId) {
  const db = await _openDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(layerId);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** @returns {Promise<Record<string, any>[]>} */
export async function loadAllLayerData() {
  const db = await _openDb();
  if (!db) return [];
  const records = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return /** @type {Record<string, any>[]} */ (records);
}

export async function clearAllLayerData() {
  const db = await _openDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** @returns {Record<string, { opacity?: number, visible?: boolean }>} */
export function readLayerPrefs() {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

/**
 * @param {string} layerId
 * @param {{ opacity?: number, visible?: boolean }} pref
 */
export function writeLayerPref(layerId, pref) {
  if (typeof localStorage === 'undefined') return;
  const all = readLayerPrefs();
  all[layerId] = { ...all[layerId], ...pref };
  localStorage.setItem(PREFS_KEY, JSON.stringify(all));
}

/** @param {string} layerId */
export function deleteLayerPref(layerId) {
  if (typeof localStorage === 'undefined') return;
  const all = readLayerPrefs();
  delete all[layerId];
  localStorage.setItem(PREFS_KEY, JSON.stringify(all));
}

export function clearAllLayerPrefs() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(PREFS_KEY);
}
