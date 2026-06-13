import { computeSignalToPoint, ensureProfileBuffers, flatDistanceM, fsplBaseDb } from './signalModel.js';
import { LORA_REQUIRED_SNR_DB } from './radioMetrics.js';

type LatLngLike = {
  lat?: unknown;
  lng?: unknown;
  lon?: unknown;
};

type Bounds = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

export type CoverageInspectLosses = {
  pathLossDb: number;
  diffractionLossDb: number;
  foliageLossDb: number;
  buildingLossDb: number;
  reflectionGainDb: number;
  obstacleLossAppliedDb: number;
};

export type CoverageInspectRow = {
  repId: number | string;
  repName: string;
  layerId: string | null;
  layerLabel: string;
  layerOrdinal: number;
  layerTotal: number;
  layerCreatedAt: number | null;
  rxPower: number;
  snrDb: number;
  requiredSnrDb: number;
  margin: number;
  distM: number;
  los: any;
  threshold: number;
  losses: CoverageInspectLosses;
  reason: string;
  rxPowerSource: 'grid' | 'computed';
};

const FALLBACK_REQUIRED_SNR_DB = LORA_REQUIRED_SNR_DB[11];

function _lon(latlng: Pick<LatLngLike, 'lng' | 'lon'> | null | undefined): number | undefined {
  const lng = latlng?.lng;
  if (Number.isFinite(lng)) return lng as number;
  const lon = latlng?.lon;
  return Number.isFinite(lon) ? lon as number : undefined;
}

function _insideBounds(lat: number, lon: number, bounds: Bounds): boolean {
  return lat >= bounds.latMin && lat <= bounds.latMax
    && lon >= bounds.lonMin && lon <= bounds.lonMax;
}

function _sampleSignalGrid(result: any, lat: number, lon: number): number {
  const grid = result?.signalGrid;
  const gridRes = Number(result?.gridRes);
  const bounds = result?.bounds;
  if (!grid || typeof grid.length !== 'number' || !Number.isInteger(gridRes) || gridRes < 1 || !bounds) {
    return NaN;
  }
  if (!_insideBounds(lat, lon, bounds)) return NaN;
  const den = Math.max(1, gridRes - 1);
  // Grid rows run north-to-south and columns west-to-east, matching the
  // coverage kernel's pixel mapping.
  const rf = (bounds.latMax - lat) / Math.max(1e-12, bounds.latMax - bounds.latMin);
  const cf = (lon - bounds.lonMin) / Math.max(1e-12, bounds.lonMax - bounds.lonMin);
  const row = Math.round(Math.min(1, Math.max(0, rf)) * den);
  const col = Math.round(Math.min(1, Math.max(0, cf)) * den);
  const value = grid[row * gridRes + col];
  return Number.isFinite(value) ? value : NaN;
}

function _finiteLoss(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function _lossesFromSignal(signal: any): CoverageInspectLosses {
  const b = signal?.breakdown ?? {};
  return {
    pathLossDb: _finiteLoss(b.pathLossDb),
    diffractionLossDb: _finiteLoss(b.diffractionLossDb),
    foliageLossDb: _finiteLoss(b.foliageLossDb),
    buildingLossDb: _finiteLoss(b.buildingLossDb),
    reflectionGainDb: _finiteLoss(b.reflectionGainDb),
    obstacleLossAppliedDb: _finiteLoss(b.obstacleLossAppliedDb),
  };
}

function _explainCoverage({
  margin,
  los,
  losses,
}: {
  margin: number;
  los: any;
  losses: CoverageInspectLosses;
}): string {
  if (margin >= 10) return 'Covered with comfortable margin.';
  if (margin >= 0) return 'Covered, but link margin is tight.';

  if (los && los.geometricLos === false) {
    const diff = losses.diffractionLossDb;
    return diff > 0
      ? `Below threshold; terrain obstruction adds about ${diff.toFixed(1)} dB diffraction loss.`
      : 'Below threshold; terrain blocks the direct path.';
  }

  if (losses.buildingLossDb >= 3 && losses.buildingLossDb >= losses.foliageLossDb) {
    return `Below threshold; building attenuation contributes about ${losses.buildingLossDb.toFixed(1)} dB.`;
  }

  if (losses.foliageLossDb >= 3) {
    return `Below threshold; vegetation attenuation contributes about ${losses.foliageLossDb.toFixed(1)} dB.`;
  }

  return 'Below threshold; distance/path loss is the dominant modeled limit.';
}

/**
 * Inspect the recorded coverage results at a clicked lat/lon, returning a
 * margin-sorted list of which repeaters cover that point and by how much.
 */
export function inspectCoverageAtPoint(
  latlng: LatLngLike | null | undefined,
  coverageResults: any[] | null | undefined,
  { limit = 4 }: { limit?: number } = {},
): CoverageInspectRow[] {
  const latRaw = latlng?.lat;
  const lat = Number.isFinite(latRaw) ? latRaw as number : NaN;
  const lon = _lon(latlng);
  if (!Number.isFinite(lat) || lon === undefined) return [];

  const rows: CoverageInspectRow[] = [];
  const visibleResults = (coverageResults ?? []).filter(result => result?.visible !== false);
  let layerOrdinal = 0;
  for (const result of visibleResults) {
    layerOrdinal += 1;
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
      includeBreakdown: true,
    }) as any;

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
    const losses = _lossesFromSignal(signal);
    const margin = rxPower - result.effectiveSens;

    rows.push({
      repId: result.rep.id,
      repName: result.rep.name,
      layerId: result.layerId ?? null,
      layerLabel: _layerLabel(result, layerOrdinal),
      layerOrdinal,
      layerTotal: visibleResults.length,
      layerCreatedAt: Number.isFinite(result.createdAt) ? result.createdAt : null,
      rxPower,
      snrDb: rxPower - noiseFloorDbm,
      requiredSnrDb,
      margin,
      distM,
      los: signal.los,
      threshold: result.effectiveSens,
      losses,
      reason: _explainCoverage({ margin, los: signal.los, losses }),
      rxPowerSource: Number.isFinite(gridRxPower) ? 'grid' : 'computed',
    });
  }

  return rows
    .sort((a, b) => (b.margin - a.margin) || ((b.layerCreatedAt ?? 0) - (a.layerCreatedAt ?? 0)))
    .slice(0, Math.max(1, limit));
}

function _layerLabel(result: any, ordinal: number): string {
  const label = typeof result?.label === 'string' ? result.label.trim() : '';
  if (label) return label;
  const name = typeof result?.rep?.name === 'string' && result.rep.name.trim()
    ? result.rep.name.trim()
    : 'Coverage';
  return `Layer ${ordinal}: ${name}`;
}
