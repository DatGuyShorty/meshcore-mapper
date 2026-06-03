// @ts-check
/**
 * coverageWorker.js - Web Worker row-band renderer for coverage analysis.
 * Runs in a DedicatedWorkerGlobalScope.
 */
import { writePixel } from './propagation.js';
import { computeSignalToPoint, ensureProfileBuffers, flatDistanceM, fsplBaseDb } from './signalModel.js';

/** @type {DedicatedWorkerGlobalScope} */
const ctx = /** @type {any} */ (self);

ctx.onmessage = (/** @type {MessageEvent<any>} */ { data }) => {
  const {
    gridElevs: gridElevsBuf,
    gridRes, ELEV_RES, rowStart, rowEnd,
    rep, txElev, latMin, latMax, lonMin, lonMax,
    radiusKm, rxHeight, effectiveSens, useLos, useFresnel,
    useGroundReflection, reflectionModel, reflectionCoeff, sideReflectionCoeff, reflectionCorridorWidthM,
    diffractionModel,
    useFoliage, foliageLossPerM, profileTargetSpacingM, profileMaxSamples, foliage,
    useBuildings, buildingLossPerM, buildings,
  } = data;

  const t0 = performance.now();
  const gridElevs = new Float32Array(gridElevsBuf);
  const rowCount = rowEnd - rowStart;
  const rgba = new Uint8ClampedArray(rowCount * gridRes * 4);
  const signalGrid = new Float32Array(rowCount * gridRes);
  // Parallel LoS-clearance grid: per pixel = minFresnelClearanceRatio (>=1 clear,
  // 0..1 grazing, <0 obstructed). NaN where no LoS data (beyond radius, or LoS off).
  const losGrid = new Float32Array(rowCount * gridRes);
  const fsplBase = fsplBaseDb(rep.freq);
  const profileBuffers = ensureProfileBuffers(profileMaxSamples);
  const bounds = { latMin, latMax, lonMin, lonMax };
  const radiusM = radiusKm * 1000;

  let insidePoints = 0;
  let processed = 0;
  const totalBandPts = rowCount * gridRes;

  for (let r = rowStart; r < rowEnd; r++) {
    const rowFrac = gridRes > 1 ? r / (gridRes - 1) : 0;
    const ptLat = latMax - rowFrac * (latMax - latMin);

    for (let c = 0; c < gridRes; c++) {
      const colFrac = gridRes > 1 ? c / (gridRes - 1) : 0;
      const ptLon = lonMin + colFrac * (lonMax - lonMin);
      const localBase = ((r - rowStart) * gridRes + c) * 4;
      const localIdx = (r - rowStart) * gridRes + c;
      const dist = flatDistanceM(rep.lat, rep.lon, ptLat, ptLon);

      if (dist > radiusM) {
        signalGrid[localIdx] = -200;
        losGrid[localIdx] = NaN;
        writePixel(rgba, localBase, -200, effectiveSens);
        continue;
      }

      insidePoints++;
      const { rxPower, los } = computeSignalToPoint({
        tx: rep, txElev, rxLat: ptLat, rxLon: ptLon,
        distM: dist, fsplBase, elevGrid: gridElevs, elevRes: ELEV_RES, bounds,
        rxHeight, effectiveSens, useLos, useFresnel, diffractionModel,
        useGroundReflection, reflectionModel, reflectionCoeff, sideReflectionCoeff, reflectionCorridorWidthM,
        foliage: useFoliage ? foliage : null,
        foliageLossPerM,
        buildings: (useBuildings || (useLos && useGroundReflection && reflectionModel === 'facade')) ? buildings : null,
        applyBuildingLoss: useBuildings,
        buildingLossPerM,
        profileTargetSpacingM, profileMaxSamples, profileBuffers,
      });

      signalGrid[localIdx] = rxPower;
      losGrid[localIdx] = Number.isFinite(los?.minFresnelClearanceRatio)
        ? los.minFresnelClearanceRatio
        : NaN;
      writePixel(rgba, localBase, rxPower, effectiveSens);
    }

    processed += gridRes;
    if ((r - rowStart) % 4 === 0) {
      ctx.postMessage({ type: 'progress', rowStart, pct: processed / totalBandPts });
    }
  }

  ctx.postMessage({
    type: 'done',
    rowStart,
    rowEnd,
    rgbaBuffer: rgba.buffer,
    signalBuffer: signalGrid.buffer,
    losBuffer: losGrid.buffer,
    stats: {
      computeMs: performance.now() - t0,
      insidePoints,
    },
  }, [rgba.buffer, signalGrid.buffer, losGrid.buffer]);
};
