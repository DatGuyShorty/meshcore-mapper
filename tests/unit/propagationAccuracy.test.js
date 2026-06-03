import { describe, expect, it, vi } from 'vitest';
import { RE_EFF, checkLoS, fspl, twoRayReflectionGainDb } from '../../src/propagation.js';
import { computeSignalToPoint, fsplBaseDb } from '../../src/signalModel.js';

// Deterministic accuracy checks: every expected value here comes from a
// closed-form physics reference (free-space path loss, the inverse-square law,
// the ITU-R P.526 knife-edge curve, and the flat-earth two-ray field factor),
// not from a recorded snapshot of the implementation. No randomness, no seeds —
// the same inputs must always produce the same physically-correct output.
describe('propagation accuracy (deterministic)', () => {
  const freq = 868;
  const tx = { lat: 0, lon: 0, height: 30, power: 20, gain: 3, freq };

  // Free-space-only call: useLos disabled and no clutter, so the model returns a
  // pure link budget with no terrain/diffraction/reflection terms.
  const freeSpace = (rxLon, rxGain = 2) => computeSignalToPoint({
    tx,
    txElev: 0,
    rxLat: 0,
    rxLon,
    rxHeight: 2,
    rxGain,
    effectiveSens: -130,
    useLos: false,
  });

  it('reproduces the free-space link budget exactly at several ranges', () => {
    for (const rxLon of [0.001, 0.003, 0.01, 0.05]) {
      const r = freeSpace(rxLon);
      // Omni antennas contribute zero pattern offset.
      expect(r.effectiveTxGain).toBe(tx.gain);
      expect(r.effectiveRxGain).toBe(2);
      // Reference: P_rx = P_tx + G_tx + G_rx - FSPL(d, f), with FSPL the
      // independent 20log10(d)+20log10(f)-147.55 closed form.
      const expected = tx.power + tx.gain + 2 - fspl(r.distM, freq);
      expect(r.rxPower).toBeCloseTo(expected, 9);
    }
  });

  it('matches the fsplBaseDb constant used by the model', () => {
    // 20·log10(868e6) − 147.55
    expect(fsplBaseDb(freq)).toBeCloseTo(20 * Math.log10(freq * 1e6) - 147.55, 12);
  });

  it('obeys the inverse-square law (−6.02 dB/octave, −20 dB/decade)', () => {
    const dNear = freeSpace(0.005); // half the distance of...
    const dFar = freeSpace(0.01); //   ...this one (exactly 2×)
    expect(dFar.distM).toBeCloseTo(2 * dNear.distM, 6);
    expect(dFar.rxPower - dNear.rxPower).toBeCloseTo(-20 * Math.log10(2), 9);

    const dDecade = freeSpace(0.05); // 10× the distance of dFar (0.005×10)
    const dBase = freeSpace(0.005);
    expect(dDecade.distM).toBeCloseTo(10 * dBase.distM, 6);
    expect(dDecade.rxPower - dBase.rxPower).toBeCloseTo(-20, 9);
  });

  it('is fully deterministic and independent of Math.random', () => {
    const a = freeSpace(0.01);
    const b = freeSpace(0.01);
    expect(b.rxPower).toBe(a.rxPower); // bit-identical, not just close

    // The core model must not depend on any random source.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const c = freeSpace(0.01);
    expect(c.rxPower).toBe(a.rxPower);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('adds no diffraction loss on a clear flat-terrain LoS path', () => {
    const flatGrid = new Float32Array([0, 0, 0, 0]);
    const bounds = { latMin: -0.01, latMax: 0.01, lonMin: -0.01, lonMax: 0.06 };
    const losArgs = {
      tx,
      txElev: 0,
      rxLat: 0,
      rxLon: 0.01,
      rxHeight: 2,
      rxGain: 2,
      effectiveSens: -130,
      useLos: true,
      useGroundReflection: false,
      elevGrid: flatGrid,
      elevRes: 2,
      bounds,
    };
    const withLos = computeSignalToPoint(losArgs);

    expect(withLos.los?.geometricLos).toBe(true);
    expect(withLos.los?.diffractionLossDb).toBe(0);
    // A clear LoS path must equal the free-space budget to the bit.
    const expected = tx.power + tx.gain + 2 - fspl(withLos.distM, freq);
    expect(withLos.rxPower).toBeCloseTo(expected, 9);
  });

  describe('ITU-R P.526 knife-edge diffraction', () => {
    const d = 2000;
    const H = 50; // equal antenna heights ⇒ flat LoS line at height H
    // Earth-curvature bulge at the midpoint, removed so the obstacle tip can sit
    // exactly on the LoS line (Fresnel parameter v = 0).
    const midBulge = (d / 2) * (d / 2) / (2 * RE_EFF);

    const lossForMidTerrain = (midElev) =>
      checkLoS(0, 0, new Float32Array([0, midElev, 0]), H, H, d, freq, false, 'knife-edge')
        .diffractionLossDb;

    it('gives ≈6.0 dB at grazing incidence (v ≈ 0)', () => {
      const loss = lossForMidTerrain(H - midBulge); // obstacle tip on the LoS line
      expect(loss).toBeGreaterThan(5.8);
      expect(loss).toBeLessThan(6.2);
    });

    it('gives 0 dB when the first Fresnel zone is fully cleared', () => {
      const result = checkLoS(0, 0, new Float32Array([0, 0, 0]), H, H, d, freq, false, 'knife-edge');
      expect(result.geometricLos).toBe(true);
      expect(result.diffractionLossDb).toBe(0);
    });

    it('increases monotonically as the obstacle rises into the path', () => {
      const grazing = lossForMidTerrain(H - midBulge);
      const shallow = lossForMidTerrain(H - midBulge + 10);
      const deep = lossForMidTerrain(H - midBulge + 40);
      expect(shallow).toBeGreaterThan(grazing);
      expect(deep).toBeGreaterThan(shallow);
    });
  });

  it('reaches the two-ray constructive ceiling and destructive floor', () => {
    const R = 0.7;
    const ceiling = 20 * Math.log10(1 + R); // |1 + R|, Δφ = π
    const floor = 20 * Math.log10(1 - R); //   |1 − R|, Δφ = 0
    let maxGain = -Infinity;
    let minGain = Infinity;
    // Fine sweep so the interference lobes are densely sampled near their extrema.
    for (let dm = 500; dm <= 5000; dm += 1) {
      const g = twoRayReflectionGainDb(dm, 20, 10, freq, R);
      if (g > maxGain) maxGain = g;
      if (g < minGain) minGain = g;
    }
    expect(maxGain).toBeCloseTo(ceiling, 1); // ≈ +4.61 dB
    expect(minGain).toBeCloseTo(floor, 1); //   ≈ −10.46 dB
  });
});
