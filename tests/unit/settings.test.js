import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCoverageSettings, getOptimizerSettings, getP2PSettings, PERSISTED_SETTING_IDS } from '../../src/settings.js';

describe('coverage settings parsing', () => {
  const originalDocument = globalThis.document;
  let elements;

  beforeEach(() => {
    elements = new Map();
    globalThis.document = {
      getElementById: id => elements.get(id) ?? null,
    };
  });

  afterEach(() => {
    globalThis.document = originalDocument;
  });

  it('parses backend and obstacle-height controls', () => {
    setValue('scenario-profile', 'urban');
    setValue('compute-backend', 'cuda');
    setValue('obstacle-height-mode', 'dsm-dem');
    setValue('grid-res', '2');
    setValue('rx-height', '1.5');
    setValue('rx-sensitivity', '-137');
    setValue('fade-margin', '10');
    setValue('analysis-radius', '15');
    setChecked('use-los', true);
    setChecked('use-fresnel', true);
    setChecked('use-reflection', true);
    setValue('reflection-model', 'six-ray');
    setValue('reflection-coeff', '0.6');
    setValue('side-reflection-coeff', '0.25');
    setValue('reflection-corridor-width-m', '18');
    setChecked('use-foliage', true);
    setChecked('use-buildings', true);
    setValue('foliage-loss-per-m', '0.3');
    setValue('building-loss-per-m', '0.5');
    setValue('compute-worker-count', '9');
    setValue('dataset-batch-concurrency', '3');
    setValue('dem-tile-concurrency', '8');
    setValue('foliage-tile-concurrency', '4');
    setValue('building-tile-concurrency', '4');

    const settings = getCoverageSettings();
    expect(PERSISTED_SETTING_IDS).toContain('coverage-overlay-mode');
    expect(PERSISTED_SETTING_IDS).toContain('reflection-model');
    expect(PERSISTED_SETTING_IDS).toContain('side-reflection-coeff');
    expect(PERSISTED_SETTING_IDS).toContain('layer-barriers');
    expect(PERSISTED_SETTING_IDS).toContain('barrier-opacity');
    expect(settings.computeBackend).toBe('cuda');
    expect(settings.deriveObstacleHeights).toBe(true);
    expect(settings.computeWorkerCount).toBe(8);
    expect(settings.qualityMult).toBe(2);
    expect(settings.diffractionModel).toBe('deygout');
    expect(settings.noiseFloorDbm).toBe(-117);
    expect(settings.reflectionModel).toBe('six-ray');
    expect(settings.reflectionCoeff).toBe(0.6);
    expect(settings.sideReflectionCoeff).toBe(0.25);
    expect(settings.reflectionCorridorWidthM).toBe(18);
  });

  it('persists and parses P2P shadow fading settings', () => {
    setValue('p2p-tx-height', '10');
    setValue('p2p-rx-height', '1.5');
    setValue('p2p-tx-power', '20');
    setValue('p2p-tx-gain', '2');
    setValue('p2p-rx-gain', '2');
    setValue('p2p-pattern', 'sector120');
    setValue('p2p-tx-azimuth', '45');
    setValue('p2p-rx-azimuth', '225');
    setValue('p2p-freq', '869.525');
    setValue('p2p-rx-sens', '-133');
    setValue('fade-margin', '10');
    setValue('path-hop-radius-km', '25');
    setValue('shadow-fading-sigma', '4.5');
    setChecked('p2p-shadow-stochastic', true);
    setValue('p2p-mc-trials', '333');
    setValue('p2p-dir-sector-deg', '75');
    setChecked('use-foliage', false);
    setChecked('use-buildings', false);
    setValue('obstacle-height-mode', 'osm');

    expect(PERSISTED_SETTING_IDS).toContain('shadow-fading-sigma');
    expect(PERSISTED_SETTING_IDS).toContain('p2p-shadow-stochastic');
    expect(PERSISTED_SETTING_IDS).toContain('p2p-dir-sector-deg');
    expect(getP2PSettings()).toMatchObject({
      antennaPattern: 'sector120',
      txAzimuthDeg: 45,
      rxAzimuthDeg: 225,
      shadowFadingSigmaDb: 4.5,
      shadowFadingStochastic: true,
      shadowFadingTrials: 333,
      directionalSectorDeg: 75,
    });
  });

  it('selects Deygout diffraction for optimizer scoring', () => {
    setValue('opt-height', '10');
    setValue('repeater-power', '20');
    setValue('repeater-freq', '869.525');
    setValue('repeater-gain', '2');
    setValue('rx-height', '1.5');
    setValue('rx-sensitivity', '-133');
    setValue('fade-margin', '10');
    setValue('analysis-radius', '15');
    setChecked('use-los', true);
    setChecked('use-fresnel', true);
    setChecked('use-reflection', true);
    setValue('reflection-model', 'six-ray');
    setValue('reflection-coeff', '0.55');
    setValue('side-reflection-coeff', '0.2');
    setValue('reflection-corridor-width-m', '30');
    setChecked('use-foliage', false);
    setChecked('use-buildings', false);
    setValue('foliage-loss-per-m', '0.3');
    setValue('building-loss-per-m', '0.5');
    setValue('obstacle-height-mode', 'osm');
    setValue('opt-candidate-res', '20');
    setValue('opt-n-repeaters', '1');

    expect(getOptimizerSettings().opts).toMatchObject({
      diffractionModel: 'deygout',
      useDeygout: true,
      useGroundReflection: true,
      reflectionModel: 'six-ray',
      reflectionCoeff: 0.55,
      sideReflectionCoeff: 0.2,
      reflectionCorridorWidthM: 30,
    });
  });

  it('accepts the building-facade reflection model value', () => {
    setChecked('use-reflection', true);
    setValue('reflection-model', 'facade');

    expect(getCoverageSettings().reflectionModel).toBe('facade');
  });

  it('clamps optimizer candidate resolution to a valid range', () => {
    setValue('opt-candidate-res', '0');

    expect(getOptimizerSettings().opts.candidateRes).toBe(1);
  });

  function setValue(id, value) {
    elements.set(id, { value });
  }

  function setChecked(id, checked) {
    elements.set(id, { checked });
  }
});
