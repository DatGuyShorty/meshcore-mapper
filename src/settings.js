// @ts-check
import { DEFAULT_PROFILE_MAX_SAMPLES, DEFAULT_PROFILE_TARGET_SPACING_M } from './signalModel.js';
import { deriveRadioMetrics, selectedModemText } from './radioMetrics.js';

export const COVERAGE_SETTING_IDS = [
  'scenario-profile', 'compute-backend', 'obstacle-height-mode',
  'rx-height', 'rx-sensitivity', 'fade-margin', 'analysis-radius', 'grid-res',
  'use-los', 'use-fresnel', 'use-reflection', 'reflection-coeff', 'use-foliage', 'foliage-loss-per-m',
  'use-buildings', 'building-loss-per-m',
  'compute-worker-count',
  'dataset-batch-concurrency',
  'dem-tile-concurrency', 'foliage-tile-concurrency', 'building-tile-concurrency',
  'coverage-opacity', 'coverage-overlay-mode',
];

export const PLANNING_SETTING_IDS = [
  'opt-n-repeaters', 'opt-height', 'opt-candidate-res',
  'p2p-tx-height', 'p2p-rx-height', 'p2p-tx-power', 'p2p-tx-gain',
  'p2p-rx-gain', 'p2p-freq', 'p2p-rx-sens',
  'p2p-pattern', 'p2p-tx-azimuth', 'p2p-rx-azimuth',
  'shadow-fading-sigma',
  'p2p-shadow-stochastic', 'p2p-mc-trials',
  'p2p-dir-sector-deg',
  'path-hop-radius-km',
  'path-use-fresnel',
];

export const MAP_LAYER_SETTING_IDS = [
  'layer-foliage', 'foliage-opacity',
  'layer-buildings', 'building-opacity',
  'layer-barriers', 'barrier-opacity',
  'layer-auto-refresh',
  'terrain3d-grid-res', 'terrain3d-vertical-scale',
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

/**
 * @param {string} id
 * @param {number} fallback
 */
function num(id, fallback) {
  const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
  const value = parseFloat(el?.value ?? '');
  return Number.isFinite(value) ? value : fallback;
}

/**
 * @param {string} id
 * @param {number} fallback
 */
function intNum(id, fallback) {
  const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
  const value = parseInt(el?.value ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

/** @param {string} id */
function checked(id) {
  return Boolean(/** @type {HTMLInputElement | null} */ (document.getElementById(id))?.checked);
}

/**
 * @param {string} id
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 */
function intClamped(id, fallback, min, max) {
  const value = intNum(id, fallback);
  return Math.max(min, Math.min(max, value));
}

export function getCoverageSettings() {
  const qualityMult = num('grid-res', 1);
  const rxSens = num('rx-sensitivity', -133);
  const fadeMargin = num('fade-margin', 0);
  const radioMetrics = deriveRadioMetrics({
    modemText: selectedModemText(),
    rxSens,
    fadeMargin,
  });
  return {
    rxHeight: num('rx-height', 1.5),
    rxSens,
    fadeMargin,
    ...radioMetrics,
    radiusKm: num('analysis-radius', 15),
    qualityMult,
    diffractionModel: 'deygout',
    useDeygout: true,
    scenarioProfile: /** @type {HTMLSelectElement | null} */ (document.getElementById('scenario-profile'))?.value || 'balanced',
    computeBackend: /** @type {HTMLSelectElement | null} */ (document.getElementById('compute-backend'))?.value || 'auto',
    deriveObstacleHeights: /** @type {HTMLSelectElement | null} */ (document.getElementById('obstacle-height-mode'))?.value === 'dsm-dem',
    useLos: checked('use-los'),
    useFresnel: checked('use-fresnel'),
    useGroundReflection: checked('use-reflection'),
    reflectionCoeff: num('reflection-coeff', 0.7),
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
    antennaPattern: /** @type {HTMLSelectElement | null} */ (document.getElementById('p2p-pattern'))?.value || 'omni',
    txAzimuthDeg: num('p2p-tx-azimuth', 0),
    rxAzimuthDeg: num('p2p-rx-azimuth', 180),
    freqMHz: num('p2p-freq', 869.525),
    rxSens: num('p2p-rx-sens', -133),
    fadeMargin: num('fade-margin', 0),
    pathHopRadiusKm: num('path-hop-radius-km', 25),
    shadowFadingSigmaDb: num('shadow-fading-sigma', 0),
    shadowFadingStochastic: checked('p2p-shadow-stochastic'),
    shadowFadingTrials: intClamped('p2p-mc-trials', 200, 16, 5000),
    directionalSectorDeg: intClamped('p2p-dir-sector-deg', 10, 10, 180),
    useFoliage: checked('use-foliage'),
    foliageLossPerM: num('foliage-loss-per-m', 0.3),
    useBuildings: checked('use-buildings'),
    buildingLossPerM: num('building-loss-per-m', 0.5),
    deriveObstacleHeights: /** @type {HTMLSelectElement | null} */ (document.getElementById('obstacle-height-mode'))?.value === 'dsm-dem',
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
      diffractionModel: 'deygout',
      useDeygout: true,
      radiusKm: num('analysis-radius', 15),
      useLos: checked('use-los'),
      useFresnel: checked('use-fresnel'),
      useGroundReflection: checked('use-reflection'),
      reflectionCoeff: num('reflection-coeff', 0.7),
      useFoliage: checked('use-foliage'),
      foliageLossPerM: num('foliage-loss-per-m', 0.3),
      useBuildings: checked('use-buildings'),
      buildingLossPerM: num('building-loss-per-m', 0.5),
      deriveObstacleHeights: /** @type {HTMLSelectElement | null} */ (document.getElementById('obstacle-height-mode'))?.value === 'dsm-dem',
      candidateRes: intClamped('opt-candidate-res', 20, 1, 256),
      evalRes: 48,
      profileTargetSpacingM: 100,
      profileMaxSamples: 256,
    },
    nRepeaters: intNum('opt-n-repeaters', 1),
  };
}
