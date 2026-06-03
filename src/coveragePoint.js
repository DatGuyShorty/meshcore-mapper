// @ts-check
import { computeSignalToPoint, ensureProfileBuffers, flatDistanceM, fsplBaseDb } from './signalModel.js';
import { LORA_REQUIRED_SNR_DB } from './radioMetrics.js';

// Fallback used when a coverage result was computed before noise/SNR metadata
// existed on the payload. SF11 (-17.5 dB required SNR) is the default LoRa
// modem we assume in the rest of the UI when no preset is selected.
const FALLBACK_REQUIRED_SNR_DB = LORA_REQUIRED_SNR_DB[11];

/**
 * Extract a longitude from either a Leaflet-style `{lat, lng}` or a
 * domain `{lat, lon}` point.
 * @param {{ lng?: unknown, lon?: unknown } | null | undefined} latlng
 * @returns {number | undefined}
 */
function _lon(latlng) {
  const lng = latlng?.lng;
  if (Number.isFinite(lng)) return /** @type {number} */ (lng);
  const lon = latlng?.lon;
  return Number.isFinite(lon) ? /** @type {number} */ (lon) : undefined;
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {{ latMin: number, latMax: number, lonMin: number, lonMax: number }} bounds
 */
function _insideBounds(lat, lon, bounds) {
  return lat >= bounds.latMin && lat <= bounds.latMax
    && lon >= bounds.lonMin && lon <= bounds.lonMax;
}

/**
 * Read the rxPower the heatmap was actually painted from, by sampling the stored
 * signal grid at the clicked cell. This is the source of truth for what the user
 * sees; recomputing on the CPU can diverge from the grid (e.g. CUDA vs CPU
 * backend), so prefer the grid whenever it is available.
 * @param {any} result a coverage result with `signalGrid`, `gridRes`, `bounds`
 * @param {number} lat
 * @param {number} lon
 * @returns {number} the grid dBm value, or NaN if the grid is missing/out of range
 */
function _sampleSignalGrid(result, lat, lon) {
  const grid = result?.signalGrid;
  const gridRes = Number(result?.gridRes);
  const bounds = result?.bounds;
  if (!grid || typeof grid.length !== 'number' || !Number.isInteger(gridRes) || gridRes < 1 || !bounds) {
    return NaN;
  }
  if (!_insideBounds(lat, lon, bounds)) return NaN;
  const den = Math.max(1, gridRes - 1);
  // Grid rows run north→south (latMax at row 0), columns west→east — matching the
  // coverage kernel's pixel mapping.
  const rf = (bounds.latMax - lat) / Math.max(1e-12, bounds.latMax - bounds.latMin);
  const cf = (lon - bounds.lonMin) / Math.max(1e-12, bounds.lonMax - bounds.lonMin);
  const row = Math.round(Math.min(1, Math.max(0, rf)) * den);
  const col = Math.round(Math.min(1, Math.max(0, cf)) * den);
  const value = grid[row * gridRes + col];
  return Number.isFinite(value) ? value : NaN;
}

/**
 * @typedef {Object} CoverageInspectRow
 * @property {number | string} repId
 * @property {string} repName
 * @property {number} rxPower
 * @property {number} snrDb
 * @property {number} requiredSnrDb
 * @property {number} margin
 * @property {number} distM
 * @property {any} los
 * @property {number} threshold
 */

/**
 * Inspect the recorded coverage results at a clicked lat/lon, returning a
 * margin-sorted list of which repeaters cover that point and by how much.
 * @param {{ lat?: unknown, lng?: unknown, lon?: unknown } | null | undefined} latlng
 * @param {any[] | null | undefined} coverageResults
 * @param {{ limit?: number }} [options]
 * @returns {CoverageInspectRow[]}
 */
export function inspectCoverageAtPoint(latlng, coverageResults, { limit = 4 } = {}) {
  const latRaw = latlng?.lat;
  const lat = Number.isFinite(latRaw) ? /** @type {number} */ (latRaw) : NaN;
  const lon = _lon(latlng);
  if (!Number.isFinite(lat) || lon === undefined) return [];

  /** @type {CoverageInspectRow[]} */
  const rows = [];
  for (const result of coverageResults ?? []) {
    const radiusKm = Number(result?.radiusKm);
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) continue;
    if (!_insideBounds(lat, lon, result.bounds)) continue;

    const distM = flatDistanceM(result.rep.lat, result.rep.lon, lat, lon);
    if (distM > radiusKm * 1000) continue;

    const profileMaxSamples = result.profileMaxSamples ?? 512;
    const signal = computeSignalToPoint({
      tx: result.rep,
      txElev: result.txElev,
      rxLat: lat,
      rxLon: lon,
      distM,
      fsplBase: fsplBaseDb(result.rep.freq),
      elevGrid: result.elevGrid,
      elevRes: result.elevRes,
      bounds: result.bounds,
      rxHeight: result.rxHeight,
      effectiveSens: result.effectiveSens,
      useLos: result.useLos,
      useFresnel: result.useFresnel,
      diffractionModel: result.diffractionModel,
      useGroundReflection: result.useGroundReflection,
      reflectionModel: result.reflectionModel,
      reflectionCoeff: result.reflectionCoeff,
      sideReflectionCoeff: result.sideReflectionCoeff,
      reflectionCorridorWidthM: result.reflectionCorridorWidthM,
      foliage: result.foliage,
      foliageLossPerM: result.foliageLossPerM,
      buildings: result.buildings,
      applyBuildingLoss: result.useBuildings ?? Boolean(result.buildings),
      buildingLossPerM: result.buildingLossPerM,
      profileTargetSpacingM: result.profileTargetSpacingM,
      profileMaxSamples,
      profileBuffers: ensureProfileBuffers(profileMaxSamples),
    });

    const noiseFloorDbm = Number.isFinite(result.noiseFloorDbm)
      ? result.noiseFloorDbm
      : result.effectiveSens - FALLBACK_REQUIRED_SNR_DB;
    const requiredSnrDb = Number.isFinite(result.requiredSnrWithMarginDb)
      ? result.requiredSnrWithMarginDb
      : result.effectiveSens - noiseFloorDbm;

    // Prefer the value the heatmap was painted from (stored grid). Fall back to
    // the freshly-computed point signal only when no grid is available.
    const gridRxPower = _sampleSignalGrid(result, lat, lon);
    const rxPower = Number.isFinite(gridRxPower) ? gridRxPower : signal.rxPower;

    rows.push({
      repId: result.rep.id,
      repName: result.rep.name,
      rxPower,
      snrDb: rxPower - noiseFloorDbm,
      requiredSnrDb,
      margin: rxPower - result.effectiveSens,
      distM,
      los: signal.los,
      threshold: result.effectiveSens,
    });
  }

  return rows
    .sort((a, b) => b.margin - a.margin)
    .slice(0, Math.max(1, limit));
}
