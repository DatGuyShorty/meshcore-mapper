/**
 * optimizer.js
 * Finds the best repeater placement location(s) within a bounding box.
 * Main-thread fallback for optimizer scoring. The UI normally uses
 * optimizerWorker.js after pre-fetching terrain and obstacle layers.
 *
 * Algorithm: exhaustive grid search over candidate TX locations, scoring each
 * with scoreCoverage(). For multiple repeaters, a greedy incremental pass is
 * used (place each repeater to maximise marginal new coverage).
 *
 * @typedef {import('./signalModel.js').TxSpec}        TxSpec
 * @typedef {import('./signalModel.js').ObstacleSet}   ObstacleSet
 * @typedef {import('./signalModel.js').ProfileBuffers} ProfileBuffers
 * @typedef {import('./roads.js').RoadLine}             RoadLine
 *
 * @typedef {Object} Bounds
 * @property {number} latMin
 * @property {number} latMax
 * @property {number} lonMin
 * @property {number} lonMax
 *
 * @typedef {Object} TxParams
 * @property {number} height
 * @property {number} power
 * @property {number} freq
 * @property {number} [gain]
 *
 * @typedef {Object} OptimizerOpts
 * @property {number} rxHeight
 * @property {number} rxSens
 * @property {number} [fadeMargin]
 * @property {number} radiusKm
 * @property {boolean} [useLos]
 * @property {boolean} [useFresnel]
 * @property {boolean} [useFoliage]
 * @property {boolean} [useBuildings]
 * @property {string}  [diffractionModel]
 * @property {boolean | undefined} [useGroundReflection]
 * @property {string | undefined} [reflectionModel]
 * @property {number | undefined} [reflectionCoeff]
 * @property {number | undefined} [sideReflectionCoeff]
 * @property {number | undefined} [reflectionCorridorWidthM]
 * @property {number}  [candidateRes]
 * @property {number}  [evalRes]
 * @property {number}  [foliageLossPerM]
 * @property {number}  [buildingLossPerM]
 * @property {number}  [profileTargetSpacingM]
 * @property {number}  [profileMaxSamples]
 * @property {SourceNode | null | undefined} [sourceNode]
 * @property {boolean | undefined} [requireSourceLink]
 * @property {boolean | undefined} [requireSourceLos]
 * @property {boolean | undefined} [requireSourceFresnel]
 * @property {number | undefined} [sourceMinMarginDb]
 * @property {boolean | undefined} [refineCandidates]
 * @property {boolean | undefined} [gapAware]
 * @property {string | undefined} [objective]
 * @property {number | undefined} [targetCoverageRatio]
 * @property {boolean | undefined} [preferHighGround]
 * @property {number | undefined} [minCandidateElevationM]
 * @property {number | undefined} [minRedundancyRatio]
 * @property {boolean | undefined} [preferRoadAdjacent]
 * @property {RoadLine[] | undefined} [roadLines]
 * @property {Bounds[] | undefined} [exclusionZones]
 * @property {SourceNode[] | undefined} [existingNodes]
 *
 * @typedef {Object} SourceNode
 * @property {number} lat
 * @property {number} lon
 * @property {number} height
 * @property {number} power
 * @property {number} freq
 * @property {number} [gain]
 * @property {number} [elevM]
 * @property {string | number} [id]
 * @property {string} [name]
 *
 * @typedef {Object} BestLocation
 * @property {number} lat
 * @property {number} lon
 * @property {number} score
 * @property {number} elevM
 * @property {number} [coverageRatio]
 * @property {number} [redundancyRatio]
 * @property {number} [avgMarginDb]
 * @property {number} [losRatio]
 * @property {number} [fresnelRatio]
 * @property {number} [coveredPoints]
 * @property {number} [redundantPoints]
 * @property {number} [candidateCoveredPoints]
 * @property {number} [backhaulMarginDb]
 * @property {number} [backhaulRxPowerDbm]
 * @property {number} [backhaulDistanceM]
 * @property {boolean} [backhaulLos]
 * @property {boolean} [backhaulFresnelClear]
 * @property {string} [backhaulPeerName]
 * @property {number} [backhaulPeerLat]
 * @property {number} [backhaulPeerLon]
 * @property {OptimizerScoreBreakdown} [scoreBreakdown]
 *
 * @typedef {Object} OptimizerObjectiveWeights
 * @property {number} coverage
 * @property {number} [redundancy]
 * @property {number} margin
 * @property {number} los
 * @property {number} fresnel
 * @property {number} backhaul
 *
 * @typedef {Object} OptimizerObjectiveDefinition
 * @property {string} id
 * @property {string} label
 * @property {string} formula
 * @property {OptimizerObjectiveWeights} weights
 *
 * @typedef {Object} OptimizerScoreComponent
 * @property {number} value
 * @property {number} weight
 * @property {number} contribution
 *
 * @typedef {Object} OptimizerScoreBreakdown
 * @property {string} objective
 * @property {string} label
 * @property {string} formula
 * @property {OptimizerObjectiveWeights} weights
 * @property {Record<string, OptimizerScoreComponent>} components
 * @property {number} radioScore
 * @property {number | null} backhaulScore
 * @property {number} scoreBeforeProminence
 * @property {{ value: number, weight: number, contribution: number }} [prominence]
 * @property {{ value: number, weight: number, contribution: number }} [roadAdjacency]
 * @property {number} [finalScore]
 *
 * @typedef {Object} ScoreOpts
 * @property {number} rxHeight
 * @property {number} rxSens
 * @property {number} fadeMargin
 * @property {number} radiusKm
 * @property {boolean | undefined} useLos
 * @property {boolean | undefined} useFresnel
 * @property {boolean | undefined} [useGroundReflection]
 * @property {string | undefined} [reflectionModel]
 * @property {number | undefined} [reflectionCoeff]
 * @property {number | undefined} [sideReflectionCoeff]
 * @property {number | undefined} [reflectionCorridorWidthM]
 * @property {string | undefined}  diffractionModel
 * @property {number}  gridRes
 * @property {number}  latMin
 * @property {number}  latMax
 * @property {number}  lonMin
 * @property {number}  lonMax
 * @property {number | undefined} profileTargetSpacingM
 * @property {number | undefined} profileMaxSamples
 * @property {ObstacleSet | null} foliage
 * @property {number | undefined} foliageLossPerM
 * @property {ObstacleSet | null} buildings
 * @property {number | undefined} buildingLossPerM
 * @property {boolean | undefined} applyBuildingLoss
 * @property {SourceNode | null | undefined} [sourceNode]
 * @property {boolean | undefined} [requireSourceLink]
 * @property {boolean | undefined} [requireSourceLos]
 * @property {boolean | undefined} [requireSourceFresnel]
 * @property {number | undefined} [sourceMinMarginDb]
 * @property {boolean | undefined} [gapAware]
 * @property {string | undefined} [objective]
 * @property {number | undefined} [targetCoverageRatio]
 * @property {boolean | undefined} [preferHighGround]
 * @property {number | undefined} [minCandidateElevationM]
 * @property {number | undefined} [minRedundancyRatio]
 * @property {boolean | undefined} [preferRoadAdjacent]
 * @property {RoadLine[] | undefined} [roadLines]
 * @property {Bounds[] | undefined} [exclusionZones]
 * @property {SourceNode[] | undefined} [existingNodes]
  */
import { fetchElevations } from './elevation.js';
import { fetchFoliage } from './foliage.js';
import { fetchBuildings } from './buildings.js';
import type { ObstacleSet, ProfileBuffers, SignalToPointResult, TxSpec } from './signalModel.js';
import { computeSignalToPoint, ensureProfileBuffers, flatDistanceM, fsplBaseDb } from './signalModel.js';
import type { RoadLine } from './roads.js';
import { M_PER_LAT, M_PER_LON } from './osmGeometry.js';

type LatLonPoint = {
  latitude: number;
  longitude: number;
};

type Bounds = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

type TxParams = {
  height: number;
  power: number;
  freq: number;
  gain?: number;
};

type SourceNode = {
  lat: number;
  lon: number;
  height: number;
  power: number;
  freq: number;
  gain?: number;
  elevM?: number;
  id?: string | number;
  name?: string;
};

type OptimizerOpts = {
  rxHeight: number;
  rxSens: number;
  fadeMargin?: number;
  radiusKm: number;
  useLos?: boolean;
  useFresnel?: boolean;
  useFoliage?: boolean;
  useBuildings?: boolean;
  diffractionModel?: string;
  useGroundReflection?: boolean;
  reflectionModel?: string;
  reflectionCoeff?: number;
  sideReflectionCoeff?: number;
  reflectionCorridorWidthM?: number;
  candidateRes?: number;
  evalRes?: number;
  foliageLossPerM?: number;
  buildingLossPerM?: number;
  profileTargetSpacingM?: number;
  profileMaxSamples?: number;
  sourceNode?: SourceNode | null;
  requireSourceLink?: boolean;
  requireSourceLos?: boolean;
  requireSourceFresnel?: boolean;
  sourceMinMarginDb?: number;
  refineCandidates?: boolean;
  gapAware?: boolean;
  objective?: string;
  targetCoverageRatio?: number;
  preferHighGround?: boolean;
  minCandidateElevationM?: number;
  minRedundancyRatio?: number;
  preferRoadAdjacent?: boolean;
  roadLines?: RoadLine[];
  exclusionZones?: Bounds[];
  existingNodes?: SourceNode[];
};

export type BestLocation = {
  lat: number;
  lon: number;
  score: number;
  elevM: number;
  coverageRatio?: number;
  redundancyRatio?: number;
  avgMarginDb?: number;
  losRatio?: number;
  fresnelRatio?: number;
  coveredPoints?: number;
  redundantPoints?: number;
  candidateCoveredPoints?: number;
  backhaulMarginDb?: number;
  backhaulRxPowerDbm?: number;
  backhaulDistanceM?: number;
  backhaulLos?: boolean;
  backhaulFresnelClear?: boolean;
  backhaulPeerName?: string;
  backhaulPeerLat?: number;
  backhaulPeerLon?: number;
  scoreBreakdown?: OptimizerScoreBreakdown;
};

type OptimizerObjectiveWeights = {
  coverage: number;
  redundancy?: number;
  margin: number;
  los: number;
  fresnel: number;
  backhaul: number;
};

export type OptimizerObjectiveDefinition = {
  id: string;
  label: string;
  formula: string;
  weights: OptimizerObjectiveWeights;
};

type OptimizerScoreComponent = {
  value: number;
  weight: number;
  contribution: number;
};

type OptimizerScoreBreakdown = {
  objective: string;
  label: string;
  formula: string;
  weights: OptimizerObjectiveWeights;
  components: Record<string, OptimizerScoreComponent>;
  radioScore: number;
  backhaulScore: number | null;
  scoreBeforeProminence: number;
  prominence?: OptimizerScoreComponent;
  roadAdjacency?: OptimizerScoreComponent;
  finalScore?: number;
};

type ScoreOpts = {
  rxHeight: number;
  rxSens: number;
  fadeMargin: number;
  radiusKm: number;
  useLos?: boolean;
  useFresnel?: boolean;
  useGroundReflection?: boolean;
  reflectionModel?: string;
  reflectionCoeff?: number;
  sideReflectionCoeff?: number;
  reflectionCorridorWidthM?: number;
  diffractionModel?: string;
  gridRes: number;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  profileTargetSpacingM?: number;
  profileMaxSamples?: number;
  foliage: ObstacleSet | null;
  foliageLossPerM?: number;
  buildings: ObstacleSet | null;
  buildingLossPerM?: number;
  applyBuildingLoss?: boolean;
  sourceNode?: SourceNode | null;
  requireSourceLink?: boolean;
  requireSourceLos?: boolean;
  requireSourceFresnel?: boolean;
  sourceMinMarginDb?: number;
  gapAware?: boolean;
  objective?: string;
  targetCoverageRatio?: number;
  preferHighGround?: boolean;
  minCandidateElevationM?: number;
  minRedundancyRatio?: number;
  preferRoadAdjacent?: boolean;
  roadLines?: RoadLine[];
  exclusionZones?: Bounds[];
  existingNodes?: SourceNode[];
};

type ProgressCallback = (pct: number, msg: string) => void;

type OptimizerScoringArgs = {
  evalPoints: LatLonPoint[];
  evalElevs: number[];
  candidates: LatLonPoint[];
  candidateElevs: number[];
  nRepeaters: number;
  txParams: TxParams;
  opts: ScoreOpts;
  onProgress?: ProgressCallback | null;
};

type OptimizerStats = {
  evalPoints: number;
  candidates: number;
  initialCoveredPoints: number;
  initialCoverageRatio: number;
  candidatesScored: number;
  rejectedByMargin: number;
  rejectedByLos: number;
  rejectedByFresnel: number;
  rejectedByBackhaul: number;
  rejectedByElevation: number;
  rejectedByExclusion: number;
  rejectedByRedundancy: number;
  zeroNewCoverage: number;
  roundsCompleted: number;
  preferHighGround: boolean;
  prominenceWeight: number;
  preferRoadAdjacent: boolean;
  roadLineCount: number;
  roadAdjacencyWeight: number;
  exclusionZones: number;
  minCandidateElevationM?: number;
  minRedundancyRatio?: number;
  targetCoverageRatio?: number;
  targetReached?: boolean;
  finalCoveredPoints?: number;
  finalCoverageRatio?: number;
};

type OptimizerScoringResult = {
  results: BestLocation[];
  stats: OptimizerStats;
};

type BackhaulScore = {
  ok: boolean;
  marginDb: number;
  rxPowerDbm: number;
  distanceM: number;
  geometricLos: boolean;
  fresnelClear: boolean;
  peerName: string;
  peerLat: number;
  peerLon: number;
  reason: string | null;
};

type CoverageScore = {
  score: number;
  coverageRatio: number;
  redundancyRatio: number;
  avgMarginDb: number;
  losRatio: number;
  fresnelRatio: number;
  coveredPoints: number;
  redundantPoints: number;
  redundancyScoreRatio: number;
  candidateCoveredPoints: number;
  scoreBreakdown: OptimizerScoreBreakdown;
};

type ScoreBreakdownInput = {
  objective?: string | null;
  coverageRatio: number;
  redundancyRatio: number;
  marginRatio: number;
  losRatio: number;
  fresnelRatio: number;
  backhaulScore: number | null;
};

const OPTIMIZER_OBJECTIVES: Readonly<Record<string, OptimizerObjectiveDefinition>> = Object.freeze({
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    formula: 'RF = 0.60 coverage + 0.25 margin + 0.10 LoS + 0.05 Fresnel; source-linked objective = RF x 0.85 + source margin x 0.15; final can add 0.06 terrain prominence and 0.04 road proximity when preferences are enabled.',
    weights: Object.freeze({ coverage: 0.60, redundancy: 0, margin: 0.25, los: 0.10, fresnel: 0.05, backhaul: 0.15 }),
  },
  coverage: {
    id: 'coverage',
    label: 'Coverage First',
    formula: 'RF = 0.80 coverage + 0.15 margin + 0.05 LoS; source-linked objective = RF x 0.95 + source margin x 0.05; final can add 0.06 terrain prominence and 0.04 road proximity when preferences are enabled.',
    weights: Object.freeze({ coverage: 0.80, redundancy: 0, margin: 0.15, los: 0.05, fresnel: 0, backhaul: 0.05 }),
  },
  'min-repeaters': {
    id: 'min-repeaters',
    label: 'Min Repeaters To Target',
    formula: 'RF = 0.85 new coverage + 0.10 margin + 0.05 LoS; source-linked objective = RF x 0.95 + source margin x 0.05; stops when target coverage is reached or max repeaters are placed; final can add 0.06 terrain prominence and 0.04 road proximity when preferences are enabled.',
    weights: Object.freeze({ coverage: 0.85, redundancy: 0, margin: 0.10, los: 0.05, fresnel: 0, backhaul: 0.05 }),
  },
  robust: {
    id: 'robust',
    label: 'Robust Links',
    formula: 'RF = 0.45 coverage + 0.30 margin + 0.15 LoS + 0.10 Fresnel; source-linked objective = RF x 0.80 + source margin x 0.20; final can add 0.06 terrain prominence and 0.04 road proximity when preferences are enabled.',
    weights: Object.freeze({ coverage: 0.45, redundancy: 0, margin: 0.30, los: 0.15, fresnel: 0.10, backhaul: 0.20 }),
  },
  backhaul: {
    id: 'backhaul',
    label: 'Backhaul First',
    formula: 'RF = 0.45 coverage + 0.25 margin + 0.20 LoS + 0.10 Fresnel; source-linked objective = RF x 0.65 + source margin x 0.35; final can add 0.06 terrain prominence and 0.04 road proximity when preferences are enabled.',
    weights: Object.freeze({ coverage: 0.45, redundancy: 0, margin: 0.25, los: 0.20, fresnel: 0.10, backhaul: 0.35 }),
  },
  redundancy: {
    id: 'redundancy',
    label: 'Redundancy First',
    formula: 'RF = 0.25 new coverage + 0.45 weighted redundant coverage + 0.15 margin + 0.05 LoS + 0.05 Fresnel; first backup coverage is valued above repeatedly stacked backups; source-linked objective = RF x 0.85 + source margin x 0.15; final can add 0.06 terrain prominence and 0.04 road proximity when preferences are enabled.',
    weights: Object.freeze({ coverage: 0.25, redundancy: 0.45, margin: 0.15, los: 0.05, fresnel: 0.05, backhaul: 0.15 }),
  },
});

/**
 * @param {string | null | undefined} objective
 * @returns {string}
 */
export function normalizeOptimizerObjective(objective: string | null | undefined): string {
  const key = typeof objective === 'string' ? objective : '';
  return Object.prototype.hasOwnProperty.call(OPTIMIZER_OBJECTIVES, key) ? key : 'balanced';
}

/** @returns {OptimizerObjectiveDefinition[]} */
export function optimizerObjectiveDefinitions(): OptimizerObjectiveDefinition[] {
  return Object.values(OPTIMIZER_OBJECTIVES).map(cloneOptimizerObjective);
}

/**
 * @param {string | null | undefined} objective
 * @returns {OptimizerObjectiveDefinition}
 */
export function optimizerObjectiveDetails(objective: string | null | undefined): OptimizerObjectiveDefinition {
  return cloneOptimizerObjective(OPTIMIZER_OBJECTIVES[normalizeOptimizerObjective(objective)]);
}

/**
 * @param {OptimizerObjectiveDefinition} objective
 * @returns {OptimizerObjectiveDefinition}
 */
function cloneOptimizerObjective(objective: OptimizerObjectiveDefinition): OptimizerObjectiveDefinition {
  return {
    ...objective,
    weights: { ...objective.weights },
  };
}

/**
 * @param {{ useLos?: boolean, useFoliage?: boolean, useBuildings?: boolean, useGroundReflection?: boolean, reflectionModel?: string, sourceNode?: SourceNode | null, requireSourceLos?: boolean, requireSourceFresnel?: boolean, preferHighGround?: boolean, minCandidateElevationM?: number }} [opts]
 * @returns {boolean}
 */
export function optimizerNeedsTerrain(opts: Partial<OptimizerOpts> = {}): boolean {
  return Boolean(
    opts.useLos
    || opts.useFoliage
    || opts.useBuildings
    || opts.preferHighGround
    || Number.isFinite(opts.minCandidateElevationM)
    || (opts.sourceNode && (opts.requireSourceLos || opts.requireSourceFresnel))
    || (opts.useLos && opts.useGroundReflection && opts.reflectionModel === 'facade')
  );
}

/**
 * Find the best N repeater locations within a bounding box.
 *
 * @param {Bounds} bounds
 * @param {number} nRepeaters
 * @param {TxParams} txParams
 * @param {OptimizerOpts} opts
 * @param {((pct: number, msg: string) => void) | null} [onProgress]
 * @returns {Promise<BestLocation[]>}
 */
export async function findBestLocations(
  bounds: Bounds,
  nRepeaters: number,
  txParams: TxParams,
  opts: OptimizerOpts,
  onProgress: ProgressCallback | null = null
): Promise<BestLocation[]> {
  const { latMin, latMax, lonMin, lonMax } = bounds;
  const { rxHeight, rxSens, fadeMargin = 0, radiusKm, useLos, useFresnel } = opts;
  const candidateRes = opts.candidateRes ?? 16;
  const evalRes      = opts.evalRes      ?? 48;

  const progress: ProgressCallback = onProgress ?? (() => {});

  // ── Build evaluation grid (where we measure how many devices get covered) ──
  progress(2, 'Building evaluation grid…');
  const evalPoints = buildGrid(latMin, latMax, lonMin, lonMax, evalRes);

  // ── Build candidate TX locations ──
  const candidates = opts.refineCandidates
    ? buildRefinedGrid(latMin, latMax, lonMin, lonMax, candidateRes)
    : buildGrid(latMin, latMax, lonMin, lonMax, candidateRes);

  // ── Fetch elevations for eval grid + all candidates in one round-trip ──
  progress(5, `Fetching elevation for ${evalPoints.length + candidates.length} points…`);
  const allPoints = [...evalPoints, ...candidates];
  const allElevs  = optimizerNeedsTerrain(opts) ? await fetchElevations(allPoints) : allPoints.map(() => 0);
  console.info(`[optimizer] elevation fetched — ${evalPoints.length} eval pts, ${candidates.length} candidates`);

  const evalElevs      = allElevs.slice(0, evalPoints.length);
  const candidateElevs = allElevs.slice(evalPoints.length);

  let foliage: ObstacleSet | null = null;
  let buildings: ObstacleSet | null = null;
  const needsFacadeBuildings = opts.useLos && opts.useGroundReflection && opts.reflectionModel === 'facade';
  const needsBuildings = opts.useBuildings || needsFacadeBuildings;
  if (opts.useFoliage || needsBuildings) {
    progress(12, 'Fetching obstacle layers...');
    [foliage, buildings] = await Promise.all([
      opts.useFoliage
        ? fetchFoliage(latMin, latMax, lonMin, lonMax)
            .catch(e => { console.warn('[optimizer] foliage fetch failed, skipping:', e); return null; })
        : Promise.resolve(null),
      needsBuildings
        ? fetchBuildings(latMin, latMax, lonMin, lonMax)
            .catch(e => { console.warn('[optimizer] buildings fetch failed, skipping:', e); return null; })
        : Promise.resolve(null),
    ]);
    if (opts.useFoliage && !foliage) progress(18, 'Warning: foliage loss requested but vegetation data was unavailable.');
    if (needsBuildings && !buildings) progress(18, 'Warning: structure data was unavailable.');
  }

  progress(20, 'Scoring candidate locations…');

  // shared opts for scoreCoverage
  /** @type {ScoreOpts} */
  const scoreOpts = {
    rxHeight, rxSens, fadeMargin, radiusKm, useLos, useFresnel,
    useGroundReflection: opts.useGroundReflection,
    reflectionModel: opts.reflectionModel,
    reflectionCoeff: opts.reflectionCoeff,
    sideReflectionCoeff: opts.sideReflectionCoeff,
    reflectionCorridorWidthM: opts.reflectionCorridorWidthM,
    diffractionModel: opts.diffractionModel,
    gridRes: evalRes,
    latMin, latMax, lonMin, lonMax,
    profileTargetSpacingM: opts.profileTargetSpacingM,
    profileMaxSamples: opts.profileMaxSamples,
    foliage: /** @type {ObstacleSet | null} */ (foliage),
    foliageLossPerM: opts.foliageLossPerM,
    buildings: /** @type {ObstacleSet | null} */ (buildings),
    buildingLossPerM: opts.buildingLossPerM,
    applyBuildingLoss: opts.useBuildings,
    sourceNode: opts.sourceNode,
    requireSourceLink: opts.requireSourceLink,
    requireSourceLos: opts.requireSourceLos,
    requireSourceFresnel: opts.requireSourceFresnel,
    sourceMinMarginDb: opts.sourceMinMarginDb,
    gapAware: opts.gapAware,
    objective: opts.objective,
    targetCoverageRatio: opts.targetCoverageRatio,
    preferHighGround: opts.preferHighGround,
    minCandidateElevationM: opts.minCandidateElevationM,
    minRedundancyRatio: opts.minRedundancyRatio,
    preferRoadAdjacent: opts.preferRoadAdjacent,
    roadLines: opts.roadLines,
    exclusionZones: opts.exclusionZones,
    existingNodes: opts.existingNodes,
  };

  return scoreOptimizerCandidates({
    evalPoints,
    evalElevs,
    candidates,
    candidateElevs,
    nRepeaters,
    txParams,
    opts: scoreOpts,
    onProgress: progress,
  });
}

/**
 * Pure greedy scoring pass used by the worker and the main-thread fallback.
 * @param {Object} data
 * @param {Array<{ latitude: number, longitude: number }>} data.evalPoints
 * @param {number[]} data.evalElevs
 * @param {Array<{ latitude: number, longitude: number }>} data.candidates
 * @param {number[]} data.candidateElevs
 * @param {number} data.nRepeaters
 * @param {TxParams} data.txParams
 * @param {ScoreOpts} data.opts
 * @param {((pct: number, msg: string) => void) | null} [data.onProgress]
 * @returns {BestLocation[]}
 */
export function scoreOptimizerCandidates({
  evalPoints,
  evalElevs,
  candidates,
  candidateElevs,
  nRepeaters,
  txParams,
  opts,
  onProgress = null,
}: OptimizerScoringArgs): BestLocation[] {
  return runOptimizerScoring({
    evalPoints,
    evalElevs,
    candidates,
    candidateElevs,
    nRepeaters,
    txParams,
    opts,
    onProgress,
  }).results;
}

/**
 * @param {Object} data
 * @param {Array<{ latitude: number, longitude: number }>} data.evalPoints
 * @param {number[]} data.evalElevs
 * @param {Array<{ latitude: number, longitude: number }>} data.candidates
 * @param {number[]} data.candidateElevs
 * @param {number} data.nRepeaters
 * @param {TxParams} data.txParams
 * @param {ScoreOpts} data.opts
 * @param {((pct: number, msg: string) => void) | null} [data.onProgress]
 * @returns {{ results: BestLocation[], stats: Record<string, any> }}
 */
export function runOptimizerScoring({
  evalPoints,
  evalElevs,
  candidates,
  candidateElevs,
  nRepeaters,
  txParams,
  opts,
  onProgress = null,
}: OptimizerScoringArgs): OptimizerScoringResult {
  const { height, power, freq, gain } = txParams;
  const progress: ProgressCallback = onProgress ?? (() => {});
  const stopAtTargetCoverage = normalizeOptimizerObjective(opts.objective) === 'min-repeaters';
  const targetCoverageRatio = normalizeTargetCoverageRatio(opts.targetCoverageRatio);
  const exclusionZones = normalizeExclusionZones(opts.exclusionZones);
  const roadLines = normalizeRoadLines(opts.roadLines);

  // Elevation prominence: 1 = local peak, 0 = local valley.
  // Only meaningful when real terrain data was fetched.
  const prominences = computeElevationProminence(candidates, candidateElevs);
  const prominenceWeight = opts.preferHighGround ? 0.06 : 0;
  const roadAdjacencyScores = computeRoadAdjacencyScores(candidates, roadLines);
  const roadAdjacencyWeight = opts.preferRoadAdjacent && roadAdjacencyScores.some(score => score > 0) ? 0.04 : 0;
  const preferenceWeight = Math.min(0.20, prominenceWeight + roadAdjacencyWeight);

  const placed: BestLocation[] = [];
  const covered = new Uint8Array(evalPoints.length);
  const coverageCounts = new Uint16Array(evalPoints.length);
  const selectedCandidates = new Uint8Array(candidates.length);
  const requireSourceLink = Boolean(opts.sourceNode && opts.requireSourceLink !== false);
  const stats: OptimizerStats = {
    evalPoints: evalPoints.length,
    candidates: candidates.length,
    initialCoveredPoints: 0,
    initialCoverageRatio: 0,
    candidatesScored: 0,
    rejectedByMargin: 0,
    rejectedByLos: 0,
    rejectedByFresnel: 0,
    rejectedByBackhaul: 0,
    rejectedByElevation: 0,
    rejectedByExclusion: 0,
    rejectedByRedundancy: 0,
    zeroNewCoverage: 0,
    roundsCompleted: 0,
    preferHighGround: Boolean(opts.preferHighGround),
    prominenceWeight,
    preferRoadAdjacent: Boolean(opts.preferRoadAdjacent),
    roadLineCount: roadLines.length,
    roadAdjacencyWeight,
    exclusionZones: exclusionZones.length,
  };
  if (Number.isFinite(opts.minCandidateElevationM)) {
    stats.minCandidateElevationM = Number(opts.minCandidateElevationM);
  }
  if (Number.isFinite(opts.minRedundancyRatio)) {
    stats.minRedundancyRatio = clamp01(Number(opts.minRedundancyRatio));
  }
  if (stopAtTargetCoverage) {
    stats.targetCoverageRatio = targetCoverageRatio;
    stats.targetReached = false;
  }

  if ((opts.gapAware || Number.isFinite(opts.minRedundancyRatio)) && opts.existingNodes?.length) {
    markExistingCoverage(opts.existingNodes, evalPoints, evalElevs, covered, coverageCounts, opts);
    stats.initialCoveredPoints = countCovered(covered);
    stats.initialCoverageRatio = evalPoints.length ? stats.initialCoveredPoints / evalPoints.length : 0;
  }

  if (stopAtTargetCoverage && stats.initialCoverageRatio >= targetCoverageRatio) {
    stats.targetReached = true;
    stats.finalCoveredPoints = stats.initialCoveredPoints;
    stats.finalCoverageRatio = stats.initialCoverageRatio;
    progress(100, 'Target coverage already reached.');
    return { results: placed, stats };
  }

  for (let round = 0; round < nRepeaters; round++) {
    let bestScore = -1;
    let bestIdx = -1;
    /** @type {ReturnType<typeof scoreCoverageIncremental> | null} */
    let bestStats: CoverageScore | null = null;
    let bestBackhaul: BackhaulScore | null = null;
    const scratchSignals = new Float32Array(evalPoints.length);
    const bestSignals = new Float32Array(evalPoints.length);
    let hasBestSignals = false;
    const backhaulPeers = opts.sourceNode
      ? buildBackhaulPeers(opts.sourceNode, placed, txParams)
      : [];

    for (let ci = 0; ci < candidates.length; ci++) {
      if (selectedCandidates[ci]) continue;
      if (isCandidateInExclusionZone(candidates[ci], exclusionZones)) {
        stats.rejectedByExclusion++;
        continue;
      }
      if (Number.isFinite(opts.minCandidateElevationM) && candidateElevs[ci] < Number(opts.minCandidateElevationM)) {
        stats.rejectedByElevation++;
        continue;
      }
      const cand = candidates[ci];
      const tx = { lat: cand.latitude, lon: cand.longitude, height, power, freq, gain };
      const profileBuffers = ensureProfileBuffers(opts.profileMaxSamples ?? 256);
      const backhaul = backhaulPeers.length
        ? scoreBestBackhaulLink(tx, candidateElevs[ci], evalElevs, opts, profileBuffers, backhaulPeers)
        : null;
      if (requireSourceLink && !backhaul?.ok) {
        markBackhaulRejection(stats, backhaul?.reason);
        continue;
      }

      const coverageStats = scoreCoverageIncremental(
        tx, candidateElevs[ci], evalPoints, evalElevs, covered, coverageCounts, opts, scratchSignals, backhaul
      );
      stats.candidatesScored++;
      if (Number.isFinite(opts.minRedundancyRatio) && coverageStats.redundancyRatio < clamp01(Number(opts.minRedundancyRatio))) {
        stats.rejectedByRedundancy++;
        continue;
      }
      if (coverageStats.coveredPoints <= 0) stats.zeroNewCoverage++;

      // Blend small planning preferences in after RF scoring.
      const finalScore = coverageStats.score > 0
        ? coverageStats.score * (1 - preferenceWeight)
          + prominences[ci] * prominenceWeight
          + roadAdjacencyScores[ci] * roadAdjacencyWeight
        : 0;

      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestIdx = ci;
        bestStats = coverageStats;
        bestBackhaul = backhaul;
        bestSignals.set(scratchSignals);
        hasBestSignals = true;
      }

      if (ci % 16 === 0) {
        const pct = 20 + 75 * ((round + ci / Math.max(1, candidates.length)) / Math.max(1, nRepeaters));
        progress(pct, `Round ${round + 1}/${nRepeaters}: scoring candidate ${ci + 1}/${candidates.length}...`);
      }
    }

    if (bestIdx === -1 || !bestStats || (bestStats.coveredPoints <= 0 && bestStats.redundantPoints <= 0) || bestScore <= 0 || !hasBestSignals) break;
    selectedCandidates[bestIdx] = 1;
    markCovered(bestSignals, covered, coverageCounts, opts);
    stats.roundsCompleted++;
    if (stopAtTargetCoverage) {
      const currentCoveredPoints = countCovered(covered);
      const currentCoverageRatio = evalPoints.length ? currentCoveredPoints / evalPoints.length : 0;
      if (currentCoverageRatio >= targetCoverageRatio) {
        stats.targetReached = true;
        stats.finalCoveredPoints = currentCoveredPoints;
        stats.finalCoverageRatio = currentCoverageRatio;
      }
    }

    const best = candidates[bestIdx];
    const result: BestLocation = {
      lat: best.latitude,
      lon: best.longitude,
      score: bestScore,
      elevM: candidateElevs[bestIdx],
      coverageRatio: bestStats.coverageRatio,
      redundancyRatio: bestStats.redundancyRatio,
      avgMarginDb: bestStats.avgMarginDb,
      losRatio: bestStats.losRatio,
      fresnelRatio: bestStats.fresnelRatio,
      coveredPoints: bestStats.coveredPoints,
      redundantPoints: bestStats.redundantPoints,
      candidateCoveredPoints: bestStats.candidateCoveredPoints,
      scoreBreakdown: finalizeScoreBreakdown(
        bestStats.scoreBreakdown,
        prominences[bestIdx],
        prominenceWeight,
        roadAdjacencyScores[bestIdx],
        roadAdjacencyWeight,
        bestScore
      ),
    };
    if (bestBackhaul) {
      Object.assign(result, {
        backhaulMarginDb: bestBackhaul.marginDb,
        backhaulRxPowerDbm: bestBackhaul.rxPowerDbm,
        backhaulDistanceM: bestBackhaul.distanceM,
        backhaulLos: bestBackhaul.geometricLos,
        backhaulFresnelClear: bestBackhaul.fresnelClear,
        backhaulPeerName: bestBackhaul.peerName,
        backhaulPeerLat: bestBackhaul.peerLat,
        backhaulPeerLon: bestBackhaul.peerLon,
      });
    }
    placed.push(result);
    console.info(`[optimizer] round ${round + 1}/${nRepeaters}: best candidate at (${best.latitude.toFixed(5)}, ${best.longitude.toFixed(5)}), score=${bestScore.toFixed(3)}, elev=${candidateElevs[bestIdx].toFixed(1)} m`);
    if (stopAtTargetCoverage && stats.targetReached) break;
  }

  progress(100, 'Done.');
  stats.finalCoveredPoints = countCovered(covered);
  stats.finalCoverageRatio = evalPoints.length ? stats.finalCoveredPoints / evalPoints.length : 0;
  return { results: placed, stats };
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Generate a regular lat/lon grid of `res × res` sample points inside a bbox.
 * Latitude decreases with row index so `[0]` is the north-west corner.
 * @param {number} latMin
 * @param {number} latMax
 * @param {number} lonMin
 * @param {number} lonMax
 * @param {number} res
 * @returns {Array<{ latitude: number, longitude: number }>}
 */
export function buildGrid(latMin: number, latMax: number, lonMin: number, lonMax: number, res: number): LatLonPoint[] {
  const gridRes = Math.max(1, Math.floor(Number(res) || 1));
  const pts: LatLonPoint[] = [];
  const rowDen = Math.max(1, gridRes - 1);
  const colDen = Math.max(1, gridRes - 1);
  for (let r = 0; r < gridRes; r++) {
    for (let c = 0; c < gridRes; c++) {
      pts.push({
        latitude:  latMax - r * (latMax - latMin) / rowDen,
        longitude: lonMin + c * (lonMax - lonMin) / colDen,
      });
    }
  }
  return pts;
}

/**
 * @param {Bounds[] | undefined} zones
 * @returns {Bounds[]}
 */
function normalizeExclusionZones(zones: Bounds[] | undefined): Bounds[] {
  if (!Array.isArray(zones)) return [];
  return zones
    .map(zone => ({
      latMin: Math.min(Number(zone?.latMin), Number(zone?.latMax)),
      latMax: Math.max(Number(zone?.latMin), Number(zone?.latMax)),
      lonMin: Math.min(Number(zone?.lonMin), Number(zone?.lonMax)),
      lonMax: Math.max(Number(zone?.lonMin), Number(zone?.lonMax)),
    }))
    .filter(zone => (
      Number.isFinite(zone.latMin)
      && Number.isFinite(zone.latMax)
      && Number.isFinite(zone.lonMin)
      && Number.isFinite(zone.lonMax)
      && zone.latMax > zone.latMin
      && zone.lonMax > zone.lonMin
    ));
}

/**
 * @param {{ latitude: number, longitude: number }} candidate
 * @param {Bounds[]} zones
 */
function isCandidateInExclusionZone(candidate: LatLonPoint, zones: Bounds[]): boolean {
  return zones.some(zone => (
    candidate.latitude >= zone.latMin
    && candidate.latitude <= zone.latMax
    && candidate.longitude >= zone.lonMin
    && candidate.longitude <= zone.lonMax
  ));
}

/**
 * @param {Array<{ latitude: number, longitude: number }>} candidates
 * @param {RoadLine[] | undefined} roadLines
 * @param {number} [maxDistanceM]
 * @returns {Float32Array}
 */
export function computeRoadAdjacencyScores(
  candidates: LatLonPoint[],
  roadLines?: RoadLine[],
  maxDistanceM = 500
): Float32Array {
  const lines = normalizeRoadLines(roadLines);
  const maxDistance = Number.isFinite(maxDistanceM) && maxDistanceM > 0 ? maxDistanceM : 500;
  const scores = new Float32Array(candidates.length);
  if (!lines.length) return scores;

  for (let ci = 0; ci < candidates.length; ci++) {
    const candidate = candidates[ci];
    let bestM = Infinity;
    for (const line of lines) {
      for (let pi = 1; pi < line.points.length; pi++) {
        bestM = Math.min(bestM, pointToSegmentDistanceM(candidate, line.points[pi - 1], line.points[pi]));
      }
    }
    scores[ci] = Number.isFinite(bestM) ? clamp01(1 - bestM / maxDistance) : 0;
  }
  return scores;
}

/**
 * @param {RoadLine[] | undefined} roadLines
 * @returns {RoadLine[]}
 */
function normalizeRoadLines(roadLines?: RoadLine[]): RoadLine[] {
  if (!Array.isArray(roadLines)) return [];
  const normalized: RoadLine[] = [];
  for (const line of roadLines) {
    const rawPoints = Array.isArray(line?.points) ? line.points : [];
    const points = rawPoints
      .map(point => {
        const raw = point as Partial<LatLonPoint> & { lat?: unknown; lon?: unknown };
        return {
          latitude: Number(raw?.latitude ?? raw?.lat),
          longitude: Number(raw?.longitude ?? raw?.lon),
        };
      })
      .filter(point => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
    if (points.length < 2) continue;
    normalized.push({
      id: String(line?.id ?? `road:${normalized.length}`),
      type: String(line?.type ?? 'road'),
      points,
    });
  }
  return normalized;
}

/**
 * @param {{ latitude: number, longitude: number }} point
 * @param {{ latitude: number, longitude: number }} a
 * @param {{ latitude: number, longitude: number }} b
 * @returns {number}
 */
function pointToSegmentDistanceM(point: LatLonPoint, a: LatLonPoint, b: LatLonPoint): number {
  const cosLat = Math.cos(point.latitude * Math.PI / 180);
  const ax = (a.longitude - point.longitude) * M_PER_LON * cosLat;
  const ay = (a.latitude - point.latitude) * M_PER_LAT;
  const bx = (b.longitude - point.longitude) * M_PER_LON * cosLat;
  const by = (b.latitude - point.latitude) * M_PER_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0) return Math.hypot(ax, ay);
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
  return Math.hypot(ax + dx * t, ay + dy * t);
}

/**
 * Build the regular candidate grid plus bounded local offset candidates.
 * @param {number} latMin
 * @param {number} latMax
 * @param {number} lonMin
 * @param {number} lonMax
 * @param {number} res
 * @returns {Array<{ latitude: number, longitude: number }>}
 */
export function buildRefinedGrid(latMin: number, latMax: number, lonMin: number, lonMax: number, res: number): LatLonPoint[] {
  const gridRes = Math.max(1, Math.floor(Number(res) || 1));
  const pts = buildGrid(latMin, latMax, lonMin, lonMax, gridRes);
  if (gridRes < 2) return pts;

  const latStep = (latMax - latMin) / (gridRes - 1);
  const lonStep = (lonMax - lonMin) / (gridRes - 1);
  const seen = new Set(pts.map(pointKey));
  for (let r = 0; r < gridRes - 1; r++) {
    for (let c = 0; c < gridRes - 1; c++) {
      const latNorth = latMax - r * latStep;
      const lonWest = lonMin + c * lonStep;
      for (const [latOffset, lonOffset] of [[0.5, 0.5], [0.25, 0.25], [0.25, 0.75], [0.75, 0.25], [0.75, 0.75]]) {
        const pt = {
          latitude: latNorth - latOffset * latStep,
          longitude: lonWest + lonOffset * lonStep,
        };
        const key = pointKey(pt);
        if (!seen.has(key)) {
          seen.add(key);
          pts.push(pt);
        }
      }
    }
  }
  return pts;
}

/**
 * Score marginal new coverage and return the per-point signal array for the winner.
 * @param {TxSpec} tx
 * @param {number} txElev
 * @param {Array<{ latitude: number, longitude: number }>} evalPoints
 * @param {number[]} evalElevs
 * @param {Uint8Array} covered
 * @param {ScoreOpts} opts
 * @param {Float32Array} signals
 * @param {ReturnType<typeof scoreBestBackhaulLink> | null} [backhaul]
 * @returns {{ score: number, coverageRatio: number, redundancyRatio: number, avgMarginDb: number, losRatio: number, fresnelRatio: number, coveredPoints: number, redundantPoints: number, redundancyScoreRatio: number, candidateCoveredPoints: number, scoreBreakdown: OptimizerScoreBreakdown }}
 */
function scoreCoverageIncremental(
  tx: TxSpec,
  txElev: number,
  evalPoints: LatLonPoint[],
  evalElevs: number[],
  covered: Uint8Array,
  coverageCounts: Uint16Array,
  opts: ScoreOpts,
  signals: Float32Array,
  backhaul: BackhaulScore | null = null
): CoverageScore {
  const { rxSens, radiusKm } = opts;
  const threshold = rxSens + (opts.fadeMargin ?? 0);
  const objective = optimizerObjectiveDetails(opts.objective);
  const scoreRedundancy = (objective.weights.redundancy ?? 0) > 0 || Number.isFinite(opts.minRedundancyRatio);

  const fsplBase = fsplBaseDb(tx.freq);
  const profileBuffers = ensureProfileBuffers(opts.profileMaxSamples ?? 256);

  let newCovered = 0;
  let redundantPoints = 0;
  let redundancyScoreSum = 0;
  let candidateCoveredPoints = 0;
  let marginScoreSum = 0;
  let marginDbSum = 0;
  let losCovered = 0;
  let fresnelCovered = 0;
  signals.fill(-200);

  for (let idx = 0; idx < evalPoints.length; idx++) {
    const coverageCount = coverageCounts[idx] || (covered[idx] ? 1 : 0);
    if (coverageCount > 0 && !scoreRedundancy) continue;
    const pt   = evalPoints[idx];
    const dist = flatDistanceM(tx.lat, tx.lon, pt.latitude, pt.longitude);
    if (dist > radiusKm * 1000) continue;
    const result = computeSignalResult(tx, txElev, pt, evalElevs[idx], dist, fsplBase, evalElevs, opts, profileBuffers);
    const sig = result.rxPower;
    signals[idx] = sig;
    const marginDb = sig - threshold;
    if (marginDb >= 0) {
      candidateCoveredPoints++;
      if (coverageCount > 0) {
        redundantPoints++;
        redundancyScoreSum += 1 / coverageCount;
      } else {
        newCovered++;
      }
      marginDbSum += marginDb;
      marginScoreSum += clamp01(marginDb / 20);
      if (!opts.useLos || result.los?.geometricLos) losCovered++;
      if (!opts.useFresnel || result.los?.fresnelClear) fresnelCovered++;
    }
  }

  if (evalPoints.length === 0 || candidateCoveredPoints === 0) {
    return {
      score: 0,
      coverageRatio: 0,
      redundancyRatio: 0,
      avgMarginDb: 0,
      losRatio: 0,
      fresnelRatio: 0,
      coveredPoints: 0,
      redundantPoints: 0,
      redundancyScoreRatio: 0,
      candidateCoveredPoints: 0,
      scoreBreakdown: buildScoreBreakdown({
        objective: opts.objective,
        coverageRatio: 0,
        redundancyRatio: 0,
        marginRatio: 0,
        losRatio: 0,
        fresnelRatio: 0,
        backhaulScore: null,
      }),
    };
  }
  const coverageRatio = newCovered / evalPoints.length;
  const redundancyRatio = redundantPoints / evalPoints.length;
  const redundancyScoreRatio = redundancyScoreSum / evalPoints.length;
  const marginRatio = marginScoreSum / evalPoints.length;
  const losRatio = losCovered / evalPoints.length;
  const fresnelRatio = fresnelCovered / evalPoints.length;
  const minMargin = opts.sourceMinMarginDb ?? 0;
  const backhaulScore = backhaul ? clamp01((backhaul.marginDb - minMargin) / 20) : null;
  const scoreBreakdown = buildScoreBreakdown({
    objective: opts.objective,
    coverageRatio,
    redundancyRatio: redundancyScoreRatio,
    marginRatio,
    losRatio,
    fresnelRatio,
    backhaulScore,
  });

  return {
    score: scoreBreakdown.scoreBeforeProminence,
    coverageRatio,
    redundancyRatio,
    avgMarginDb: marginDbSum / candidateCoveredPoints,
    losRatio,
    fresnelRatio,
    coveredPoints: newCovered,
    redundantPoints,
    redundancyScoreRatio,
    candidateCoveredPoints,
    scoreBreakdown,
  };
}

/**
 * @param {Object} input
 * @param {string | null | undefined} input.objective
 * @param {number} input.coverageRatio
 * @param {number} input.redundancyRatio
 * @param {number} input.marginRatio
 * @param {number} input.losRatio
 * @param {number} input.fresnelRatio
 * @param {number | null} input.backhaulScore
 * @returns {OptimizerScoreBreakdown}
 */
function buildScoreBreakdown({
  objective,
  coverageRatio,
  redundancyRatio,
  marginRatio,
  losRatio,
  fresnelRatio,
  backhaulScore,
}: ScoreBreakdownInput): OptimizerScoreBreakdown {
  const details = optimizerObjectiveDetails(objective);
  const weights = details.weights;
  const hasBackhaulScore = Number.isFinite(backhaulScore);
  const rfScale = hasBackhaulScore ? 1 - weights.backhaul : 1;
  const normalizedBackhaul = hasBackhaulScore ? clamp01(Number(backhaulScore)) : null;
  const radioScore = coverageRatio * weights.coverage
    + redundancyRatio * (weights.redundancy ?? 0)
    + marginRatio * weights.margin
    + losRatio * weights.los
    + fresnelRatio * weights.fresnel;
  const components: Record<string, OptimizerScoreComponent> = {
    coverage: scoreComponent(coverageRatio, weights.coverage, rfScale),
    redundancy: scoreComponent(redundancyRatio, weights.redundancy ?? 0, rfScale),
    margin: scoreComponent(marginRatio, weights.margin, rfScale),
    los: scoreComponent(losRatio, weights.los, rfScale),
    fresnel: scoreComponent(fresnelRatio, weights.fresnel, rfScale),
    backhaul: scoreComponent(normalizedBackhaul ?? 0, weights.backhaul, hasBackhaulScore ? 1 : 0),
  };
  const backhaulContribution = normalizedBackhaul === null ? 0 : components.backhaul.contribution;
  return {
    objective: details.id,
    label: details.label,
    formula: details.formula,
    weights,
    components,
    radioScore,
    backhaulScore: normalizedBackhaul,
    scoreBeforeProminence: radioScore * rfScale + backhaulContribution,
  };
}

/**
 * @param {number} value
 * @param {number} weight
 * @param {number} scale
 * @returns {OptimizerScoreComponent}
 */
function scoreComponent(value: number, weight: number, scale = 1): OptimizerScoreComponent {
  return {
    value,
    weight,
    contribution: value * weight * scale,
  };
}

/**
 * @param {OptimizerScoreBreakdown} breakdown
 * @param {number} prominence
 * @param {number} prominenceWeight
 * @param {number} roadAdjacency
 * @param {number} roadAdjacencyWeight
 * @param {number} finalScore
 * @returns {OptimizerScoreBreakdown}
 */
function finalizeScoreBreakdown(
  breakdown: OptimizerScoreBreakdown,
  prominence: number,
  prominenceWeight: number,
  roadAdjacency: number,
  roadAdjacencyWeight: number,
  finalScore: number
): OptimizerScoreBreakdown {
  const preferenceWeight = Math.min(0.20, prominenceWeight + roadAdjacencyWeight);
  const components: Record<string, OptimizerScoreComponent> = {};
  for (const [key, component] of Object.entries(breakdown.components)) {
    components[key] = {
      ...component,
      contribution: component.contribution * (1 - preferenceWeight),
    };
  }
  return {
    ...breakdown,
    weights: { ...breakdown.weights },
    components,
    prominence: {
      value: prominence,
      weight: prominenceWeight,
      contribution: prominence * prominenceWeight,
    },
    roadAdjacency: {
      value: roadAdjacency,
      weight: roadAdjacencyWeight,
      contribution: roadAdjacency * roadAdjacencyWeight,
    },
    finalScore,
  };
}

/** @param {number | null | undefined} value */
function normalizeTargetCoverageRatio(value: number | null | undefined): number {
  const ratio = Number.isFinite(value) ? Number(value) : 0.90;
  return clamp01(ratio);
}

/**
 * Mark covered cells using the pre-computed signal array from the winning pass.
 * @param {Float32Array} signals
 * @param {Uint8Array} covered
 * @param {Uint16Array} coverageCounts
 * @param {ScoreOpts} opts
 */
function markCovered(signals: Float32Array, covered: Uint8Array, coverageCounts: Uint16Array, opts: ScoreOpts): void {
  const threshold = opts.rxSens + (opts.fadeMargin ?? 0);
  for (let idx = 0; idx < signals.length; idx++) {
    if (signals[idx] >= threshold) {
      covered[idx] = 1;
      coverageCounts[idx] = Math.min(65535, coverageCounts[idx] + 1);
    }
  }
}

/**
 * @param {SourceNode[]} nodes
 * @param {Array<{ latitude: number, longitude: number }>} evalPoints
 * @param {number[]} evalElevs
 * @param {Uint8Array} covered
 * @param {Uint16Array} coverageCounts
 * @param {ScoreOpts} opts
 */
function markExistingCoverage(
  nodes: SourceNode[],
  evalPoints: LatLonPoint[],
  evalElevs: number[],
  covered: Uint8Array,
  coverageCounts: Uint16Array,
  opts: ScoreOpts
): void {
  const threshold = opts.rxSens + (opts.fadeMargin ?? 0);
  for (const node of nodes) {
    const tx = txFromNode(node, opts);
    const txElev = finiteOr(node.elevM, 0);
    const fsplBase = fsplBaseDb(tx.freq);
    const profileBuffers = ensureProfileBuffers(opts.profileMaxSamples ?? 256);
    for (let idx = 0; idx < evalPoints.length; idx++) {
      const pt = evalPoints[idx];
      const dist = flatDistanceM(tx.lat, tx.lon, pt.latitude, pt.longitude);
      if (dist > opts.radiusKm * 1000) continue;
      const result = computeSignalResult(tx, txElev, pt, evalElevs[idx], dist, fsplBase, evalElevs, opts, profileBuffers);
      if (result.rxPower >= threshold) {
        covered[idx] = 1;
        coverageCounts[idx] = Math.min(65535, coverageCounts[idx] + 1);
      }
    }
  }
}

/**
 * @param {TxSpec} tx
 * @param {number} txElev
 * @param {number[]} gridElevs
 * @param {ScoreOpts} opts
 * @param {ProfileBuffers} profileBuffers
 * @param {SourceNode[]} peers
 * @returns {{ ok: boolean, marginDb: number, rxPowerDbm: number, distanceM: number, geometricLos: boolean, fresnelClear: boolean, peerName: string, peerLat: number, peerLon: number, reason: string | null }}
 */
function scoreBestBackhaulLink(
  tx: TxSpec,
  txElev: number,
  gridElevs: number[],
  opts: ScoreOpts,
  profileBuffers: ProfileBuffers,
  peers: SourceNode[]
): BackhaulScore {
  let best: BackhaulScore | null = null;
  for (const peer of peers) {
    const link = scoreBackhaulPeer(tx, txElev, gridElevs, opts, profileBuffers, peer);
    if (!best
      || (link.ok && !best.ok)
      || (link.ok === best.ok && link.marginDb > best.marginDb)) {
      best = link;
    }
  }
  return best ?? {
    ok: false,
    marginDb: -Infinity,
    rxPowerDbm: -Infinity,
    distanceM: Infinity,
    geometricLos: false,
    fresnelClear: false,
    peerName: 'source node',
    peerLat: NaN,
    peerLon: NaN,
    reason: 'backhaul',
  };
}

/**
 * @param {TxSpec} tx
 * @param {number} txElev
 * @param {number[]} gridElevs
 * @param {ScoreOpts} opts
 * @param {ProfileBuffers} profileBuffers
 * @param {SourceNode} peer
 */
function scoreBackhaulPeer(
  tx: TxSpec,
  txElev: number,
  gridElevs: number[],
  opts: ScoreOpts,
  profileBuffers: ProfileBuffers,
  peer: SourceNode
): BackhaulScore {
  const peerTx = txFromNode(peer, opts, tx);
  const peerElev = finiteOr(peer.elevM, 0);
  const dist = flatDistanceM(peerTx.lat, peerTx.lon, tx.lat, tx.lon);
  const threshold = opts.rxSens + (opts.fadeMargin ?? 0);
  const sourceLinkOpts = { ...opts, useLos: opts.useLos || opts.requireSourceLos || opts.requireSourceFresnel };

  const forward = computeSignalResult(
    peerTx,
    peerElev,
    { latitude: tx.lat, longitude: tx.lon },
    txElev,
    dist,
    fsplBaseDb(peerTx.freq),
    gridElevs,
    { ...sourceLinkOpts, rxHeight: tx.height },
    profileBuffers
  );
  const reverse = computeSignalResult(
    tx,
    txElev,
    { latitude: peerTx.lat, longitude: peerTx.lon },
    peerElev,
    dist,
    fsplBaseDb(tx.freq),
    gridElevs,
    { ...sourceLinkOpts, rxHeight: peerTx.height },
    profileBuffers
  );

  const forwardMargin = forward.rxPower - threshold;
  const reverseMargin = reverse.rxPower - threshold;
  const marginDb = Math.min(forwardMargin, reverseMargin);
  const geometricLos = Boolean((forward.los?.geometricLos ?? true) && (reverse.los?.geometricLos ?? true));
  const fresnelClear = Boolean((forward.los?.fresnelClear ?? true) && (reverse.los?.fresnelClear ?? true));
  const minMargin = opts.sourceMinMarginDb ?? 0;
  let reason: string | null = null;
  if (marginDb < minMargin) reason = 'margin';
  else if (opts.requireSourceLos && !geometricLos) reason = 'los';
  else if (opts.requireSourceFresnel && !fresnelClear) reason = 'fresnel';
  const ok = !reason;

  return {
    ok,
    marginDb,
    rxPowerDbm: Math.min(forward.rxPower, reverse.rxPower),
    distanceM: dist,
    geometricLos,
    fresnelClear,
    peerName: peer.name || 'source node',
    peerLat: peerTx.lat,
    peerLon: peerTx.lon,
    reason,
  };
}

/**
 * @param {SourceNode} source
 * @param {BestLocation[]} placed
 * @param {TxParams} txParams
 * @returns {SourceNode[]}
 */
function buildBackhaulPeers(source: SourceNode, placed: BestLocation[], txParams: TxParams): SourceNode[] {
  return [
    source,
    ...placed.map((r, idx) => ({
      lat: r.lat,
      lon: r.lon,
      height: txParams.height,
      power: txParams.power,
      freq: txParams.freq,
      gain: txParams.gain,
      elevM: r.elevM,
      name: `Suggested ${idx + 1}`,
    })),
  ];
}

/**
 * @param {SourceNode} node
 * @param {ScoreOpts} opts
 * @param {TxSpec} [fallback]
 * @returns {TxSpec}
 */
function txFromNode(node: SourceNode, opts: ScoreOpts, fallback?: TxSpec): TxSpec {
  return {
    lat: Number(node.lat),
    lon: Number(node.lon),
    height: finiteOr(node.height, opts.rxHeight),
    power: finiteOr(node.power, fallback?.power ?? 20),
    freq: finiteOr(node.freq, fallback?.freq ?? 869.525),
    gain: finiteOr(node.gain, fallback?.gain ?? 0),
    name: node.name,
    id: node.id,
  };
}

/**
 * @param {Record<string, any>} stats
 * @param {string | null | undefined} reason
 */
function markBackhaulRejection(stats: OptimizerStats, reason: string | null | undefined): void {
  stats.rejectedByBackhaul++;
  if (reason === 'margin') stats.rejectedByMargin++;
  else if (reason === 'los') stats.rejectedByLos++;
  else if (reason === 'fresnel') stats.rejectedByFresnel++;
}

/** @param {Uint8Array} covered */
function countCovered(covered: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < covered.length; i++) {
    if (covered[i]) count++;
  }
  return count;
}

/**
 * @param {TxSpec} tx
 * @param {number} txElev
 * @param {{ latitude: number, longitude: number }} pt
 * @param {number} rxElev
 * @param {number} dist
 * @param {number} fsplBase
 * @param {number[]} gridElevs
 * @param {ScoreOpts} opts
 * @param {ProfileBuffers} profileBuffers
 * @returns {import('./signalModel.js').SignalToPointResult}
 */
function computeSignalResult(
  tx: TxSpec,
  txElev: number,
  pt: LatLonPoint,
  rxElev: number,
  dist: number,
  fsplBase: number,
  gridElevs: number[],
  opts: ScoreOpts,
  profileBuffers: ProfileBuffers
): SignalToPointResult {
  return computeSignalToPoint({
    tx, txElev, rxLat: pt.latitude, rxLon: pt.longitude, rxElev,
    distM: dist, fsplBase, elevGrid: gridElevs, elevRes: opts.gridRes,
    bounds: { latMin: opts.latMin, latMax: opts.latMax, lonMin: opts.lonMin, lonMax: opts.lonMax },
    rxHeight: opts.rxHeight,
    effectiveSens: opts.rxSens + (opts.fadeMargin ?? 0),
    useLos: opts.useLos,
    useFresnel: opts.useFresnel,
    useGroundReflection: opts.useGroundReflection,
    reflectionModel: opts.reflectionModel,
    reflectionCoeff: opts.reflectionCoeff,
    sideReflectionCoeff: opts.sideReflectionCoeff,
    reflectionCorridorWidthM: opts.reflectionCorridorWidthM,
    diffractionModel: opts.diffractionModel,
    foliage: opts.foliage,
    foliageLossPerM: opts.foliageLossPerM,
    buildings: opts.buildings,
    applyBuildingLoss: opts.applyBuildingLoss,
    buildingLossPerM: opts.buildingLossPerM,
    profileTargetSpacingM: opts.profileTargetSpacingM,
    profileMaxSamples: opts.profileMaxSamples,
    profileBuffers,
  });
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function finiteOr(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/** @param {{ latitude: number, longitude: number }} pt */
function pointKey(pt: LatLonPoint): string {
  return `${pt.latitude.toFixed(8)},${pt.longitude.toFixed(8)}`;
}

/**
 * Compute local elevation prominence for each candidate in [0, 1].
 * 1.0 = local peak (all neighbours lower), 0.0 = local valley.
 * Prominence = fraction of candidates within 25 % of the bbox diagonal
 * that have strictly lower elevation.  Falls back to 0.5 when there are no
 * neighbours in range (single candidate or very sparse grid).
 *
 * @param {Array<{ latitude: number, longitude: number }>} candidates
 * @param {number[]} elevs
 * @returns {Float32Array}
 */
export function computeElevationProminence(candidates: LatLonPoint[], elevs: number[]): Float32Array {
  const n = candidates.length;
  const result = new Float32Array(n).fill(0.5);
  if (n <= 1) return result;

  // bbox diagonal in metres → neighbourhood radius = 25 % of it
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const c of candidates) {
    if (c.latitude  < latMin) latMin = c.latitude;
    if (c.latitude  > latMax) latMax = c.latitude;
    if (c.longitude < lonMin) lonMin = c.longitude;
    if (c.longitude > lonMax) lonMax = c.longitude;
  }
  const midLatRad = ((latMin + latMax) / 2) * (Math.PI / 180);
  const latSpanM  = (latMax - latMin) * 111320;
  const lonSpanM  = (lonMax - lonMin) * 111320 * Math.cos(midLatRad);
  const radiusM   = Math.sqrt(latSpanM * latSpanM + lonSpanM * lonSpanM) * 0.25;

  for (let i = 0; i < n; i++) {
    const ci  = candidates[i];
    const ei  = elevs[i];
    let lower = 0;
    let total = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const cj = candidates[j];
      const dx = (ci.latitude  - cj.latitude)  * 111320;
      const dy = (ci.longitude - cj.longitude) * 111320 * Math.cos(midLatRad);
      if (Math.sqrt(dx * dx + dy * dy) <= radiusM) {
        total++;
        if (elevs[j] < ei) lower++;
      }
    }
    result[i] = total > 0 ? lower / total : 0.5;
  }
  return result;
}

/** @param {number} value */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
