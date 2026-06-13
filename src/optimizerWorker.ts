/**
 * optimizerWorker.ts - Pure greedy scoring loop for the optimizer.
 * Receives pre-fetched grids, elevations, and obstacle layers from the UI.
 */
import { runOptimizerScoring } from './optimizer.js';

type OptimizerScoringArgs = Parameters<typeof runOptimizerScoring>[0];

type OptimizerWorkerPayload = {
  evalPoints: OptimizerScoringArgs['evalPoints'];
  evalElevs: OptimizerScoringArgs['evalElevs'];
  candidates: OptimizerScoringArgs['candidates'];
  candidateElevs: OptimizerScoringArgs['candidateElevs'];
  nRepeaters: number;
  txParams: OptimizerScoringArgs['txParams'];
  opts: Record<string, any>;
};

type OptimizerProgressMessage = {
  type: 'progress';
  pct: number;
  msg: string;
};

type OptimizerDoneMessage = {
  type: 'done';
  results: unknown;
  stats: unknown;
};

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = function ({ data }: MessageEvent<OptimizerWorkerPayload>): void {
  const { evalPoints, evalElevs, candidates, candidateElevs, nRepeaters, txParams, opts } = data;
  const needsFacadeBuildings = opts.useLos && opts.useGroundReflection && opts.reflectionModel === 'facade';

  const scoreOpts = {
    rxHeight: opts.rxHeight,
    rxSens: opts.rxSens,
    fadeMargin: opts.fadeMargin ?? 0,
    radiusKm: opts.radiusKm,
    useLos: opts.useLos,
    useFresnel: opts.useFresnel,
    useGroundReflection: opts.useGroundReflection,
    reflectionModel: opts.reflectionModel,
    reflectionCoeff: opts.reflectionCoeff,
    sideReflectionCoeff: opts.sideReflectionCoeff,
    reflectionCorridorWidthM: opts.reflectionCorridorWidthM,
    diffractionModel: opts.diffractionModel,
    foliage: opts.useFoliage ? opts.foliage : null,
    foliageLossPerM: opts.foliageLossPerM ?? 0.3,
    buildings: (opts.useBuildings || needsFacadeBuildings) ? opts.buildings : null,
    applyBuildingLoss: opts.useBuildings,
    buildingLossPerM: opts.buildingLossPerM ?? 0.5,
    gridRes: opts.evalRes,
    latMin: opts.latMin,
    latMax: opts.latMax,
    lonMin: opts.lonMin,
    lonMax: opts.lonMax,
    profileTargetSpacingM: opts.profileTargetSpacingM,
    profileMaxSamples: opts.profileMaxSamples,
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
  } as OptimizerScoringArgs['opts'];

  const { results, stats } = runOptimizerScoring({
    evalPoints,
    evalElevs,
    candidates,
    candidateElevs,
    nRepeaters,
    txParams,
    opts: scoreOpts,
    onProgress: (pct: number, msg: string) => {
      const progressMessage: OptimizerProgressMessage = { type: 'progress', pct, msg };
      ctx.postMessage(progressMessage);
    },
  });

  const doneMessage: OptimizerDoneMessage = { type: 'done', results, stats };
  ctx.postMessage(doneMessage);
};
