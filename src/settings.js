import { DEFAULT_PROFILE_MAX_SAMPLES, DEFAULT_PROFILE_TARGET_SPACING_M } from './signalModel.js';

export const COVERAGE_SETTING_IDS = [
  'scenario-profile', 'compute-backend', 'obstacle-height-mode',
  'rx-height', 'rx-sensitivity', 'fade-margin', 'analysis-radius', 'grid-res',
  'use-los', 'use-fresnel', 'use-foliage', 'foliage-loss-per-m',
  'use-buildings', 'building-loss-per-m',
  'compute-worker-count',
  'dataset-batch-concurrency',
  'dem-tile-concurrency', 'foliage-tile-concurrency', 'building-tile-concurrency',
  'coverage-opacity',
];

export const PLANNING_SETTING_IDS = [
  'opt-n-repeaters', 'opt-height', 'opt-candidate-res',
  'p2p-tx-height', 'p2p-rx-height', 'p2p-tx-power', 'p2p-tx-gain',
  'p2p-rx-gain', 'p2p-freq', 'p2p-rx-sens',
  'path-use-fresnel',
];

export const MAP_LAYER_SETTING_IDS = [
  'layer-foliage', 'foliage-opacity',
  'layer-buildings', 'building-opacity',
  'layer-auto-refresh',
];

export const WS_SETTING_IDS = [
  'ws-url', 'ws-default-height', 'ws-default-power', 'ws-default-freq', 'ws-default-gain',
];

export const PERSISTED_SETTING_IDS = [
  ...COVERAGE_SETTING_IDS,
  ...PLANNING_SETTING_IDS,
  ...MAP_LAYER_SETTING_IDS,
  ...WS_SETTING_IDS,
];

function num(id, fallback) {
  const value = parseFloat(document.getElementById(id)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function intNum(id, fallback) {
  const value = parseInt(document.getElementById(id)?.value, 10);
  return Number.isFinite(value) ? value : fallback;
}

function checked(id) {
  return Boolean(document.getElementById(id)?.checked);
}

function intClamped(id, fallback, min, max) {
  const value = intNum(id, fallback);
  return Math.max(min, Math.min(max, value));
}

export function getCoverageSettings() {
  const qualityMult = num('grid-res', 1);
  return {
    rxHeight: num('rx-height', 1.5),
    rxSens: num('rx-sensitivity', -133),
    fadeMargin: num('fade-margin', 0),
    radiusKm: num('analysis-radius', 15),
    qualityMult,
    gridRes: qualityMult, // kept for downstream compatibility; actual px computed in coverage.js
    scenarioProfile: document.getElementById('scenario-profile')?.value || 'balanced',
    computeBackend: document.getElementById('compute-backend')?.value || 'auto',
    deriveObstacleHeights: document.getElementById('obstacle-height-mode')?.value === 'dsm-dem',
    useLos: checked('use-los'),
    useFresnel: checked('use-fresnel'),
    useFoliage: checked('use-foliage'),
    foliageLossPerM: num('foliage-loss-per-m', 0.3),
    useBuildings: checked('use-buildings'),
    buildingLossPerM: num('building-loss-per-m', 0.5),
    computeWorkerCount: intClamped('compute-worker-count', 0, 0, 8),
    datasetBatchConcurrency: intClamped('dataset-batch-concurrency', 2, 1, 4),
    demTileConcurrency: intClamped('dem-tile-concurrency', 6, 1, 16),
    foliageTileConcurrency: intClamped('foliage-tile-concurrency', 3, 1, 12),
    buildingTileConcurrency: intClamped('building-tile-concurrency', 3, 1, 12),
    profileTargetSpacingM: DEFAULT_PROFILE_TARGET_SPACING_M,
    profileMaxSamples: DEFAULT_PROFILE_MAX_SAMPLES,
  };
}

export function getP2PSettings() {
  return {
    txHeight: num('p2p-tx-height', 10),
    rxHeight: num('p2p-rx-height', 1.5),
    txPower: num('p2p-tx-power', 20),
    txGain: num('p2p-tx-gain', 2),
    rxGain: num('p2p-rx-gain', 2),
    freqMHz: num('p2p-freq', 869.525),
    rxSens: num('p2p-rx-sens', -133),
    fadeMargin: num('fade-margin', 0),
    useFoliage: checked('use-foliage'),
    foliageLossPerM: num('foliage-loss-per-m', 0.3),
    useBuildings: checked('use-buildings'),
    buildingLossPerM: num('building-loss-per-m', 0.5),
    deriveObstacleHeights: document.getElementById('obstacle-height-mode')?.value === 'dsm-dem',
    profileTargetSpacingM: 30,
    profileMaxSamples: 1024,
  };
}

export function getOptimizerSettings() {
  return {
    txParams: {
      height: num('opt-height', 10),
      power: num('repeater-power', 20),
      freq: num('repeater-freq', 869.525),
      gain: num('repeater-gain', 2),
    },
    opts: {
      rxHeight: num('rx-height', 1.5),
      rxSens: num('rx-sensitivity', -133),
      fadeMargin: num('fade-margin', 0),
      radiusKm: num('analysis-radius', 15),
      useLos: checked('use-los'),
      useFresnel: checked('use-fresnel'),
      useFoliage: checked('use-foliage'),
      foliageLossPerM: num('foliage-loss-per-m', 0.3),
      useBuildings: checked('use-buildings'),
      buildingLossPerM: num('building-loss-per-m', 0.5),
      deriveObstacleHeights: document.getElementById('obstacle-height-mode')?.value === 'dsm-dem',
      candidateRes: intNum('opt-candidate-res', 20),
      evalRes: 48,
      profileTargetSpacingM: 100,
      profileMaxSamples: 256,
    },
    nRepeaters: intNum('opt-n-repeaters', 1),
  };
}
