import { DEFAULT_PROFILE_MAX_SAMPLES, DEFAULT_PROFILE_TARGET_SPACING_M } from './signalModel.js';

export const COVERAGE_SETTING_IDS = [
  'rx-height', 'rx-sensitivity', 'fade-margin', 'analysis-radius', 'grid-res',
  'use-los', 'use-fresnel', 'use-foliage', 'foliage-loss-per-m',
  'use-buildings', 'building-loss-per-m',
];

export const PLANNING_SETTING_IDS = [
  'opt-n-repeaters', 'opt-height', 'opt-candidate-res',
  'p2p-tx-height', 'p2p-rx-height', 'p2p-tx-power', 'p2p-tx-gain',
  'p2p-rx-gain', 'p2p-freq', 'p2p-rx-sens',
];

export const MAP_LAYER_SETTING_IDS = [
  'layer-foliage', 'layer-buildings', 'layer-auto-refresh',
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

export function getCoverageSettings() {
  const gridRes = intNum('grid-res', 128);
  return {
    rxHeight: num('rx-height', 1.5),
    rxSens: num('rx-sensitivity', -137),
    fadeMargin: num('fade-margin', 0),
    radiusKm: num('analysis-radius', 15),
    gridRes,
    useLos: checked('use-los'),
    useFresnel: checked('use-fresnel'),
    useFoliage: checked('use-foliage'),
    foliageLossPerM: num('foliage-loss-per-m', 0.3),
    useBuildings: checked('use-buildings'),
    buildingLossPerM: num('building-loss-per-m', 0.5),
    profileTargetSpacingM: gridRes >= 384 ? 20 : gridRes >= 256 ? 35 : gridRes >= 128 ? DEFAULT_PROFILE_TARGET_SPACING_M : 90,
    profileMaxSamples: gridRes >= 384 ? 1280 : gridRes >= 256 ? 768 : DEFAULT_PROFILE_MAX_SAMPLES,
  };
}

export function getP2PSettings() {
  return {
    txHeight: num('p2p-tx-height', 10),
    rxHeight: num('p2p-rx-height', 1.5),
    txPower: num('p2p-tx-power', 20),
    txGain: num('p2p-tx-gain', 2),
    rxGain: num('p2p-rx-gain', 2),
    freqMHz: num('p2p-freq', 868),
    rxSens: num('p2p-rx-sens', -137),
    fadeMargin: num('fade-margin', 0),
    useFoliage: checked('use-foliage'),
    foliageLossPerM: num('foliage-loss-per-m', 0.3),
    useBuildings: checked('use-buildings'),
    buildingLossPerM: num('building-loss-per-m', 0.5),
    profileTargetSpacingM: 30,
    profileMaxSamples: 1024,
  };
}

export function getOptimizerSettings() {
  return {
    txParams: {
      height: num('opt-height', 10),
      power: num('repeater-power', 20),
      freq: num('repeater-freq', 868),
      gain: num('repeater-gain', 2),
    },
    opts: {
      rxHeight: num('rx-height', 1.5),
      rxSens: num('rx-sensitivity', -137),
      fadeMargin: num('fade-margin', 0),
      radiusKm: num('analysis-radius', 15),
      useLos: checked('use-los'),
      useFresnel: checked('use-fresnel'),
      useFoliage: checked('use-foliage'),
      foliageLossPerM: num('foliage-loss-per-m', 0.3),
      useBuildings: checked('use-buildings'),
      buildingLossPerM: num('building-loss-per-m', 0.5),
      candidateRes: intNum('opt-candidate-res', 20),
      evalRes: 48,
      profileTargetSpacingM: 100,
      profileMaxSamples: 256,
    },
    nRepeaters: intNum('opt-n-repeaters', 1),
  };
}
