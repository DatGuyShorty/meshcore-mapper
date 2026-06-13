/**
 * coverageWorker.ts - Web Worker row-band renderer for coverage analysis.
 * Runs in a DedicatedWorkerGlobalScope.
 */
import { writePixel } from './propagation.js';
import { computeSignalToPoint, ensureProfileBuffers, flatDistanceM, fsplBaseDb } from './signalModel.js';
import type { Bbox, ObstacleSet, TxSpec } from './signalModel.js';

type CoverageWorkerPayload = {
  gridElevs: ArrayBufferLike;
  gridRes: number;
  ELEV_RES: number;
  rowStart: number;
  rowEnd: number;
  rep: TxSpec;
  txElev: number;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  radiusKm: number;
  rxHeight: number;
  effectiveSens: number;
  useLos: boolean;
  useFresnel: boolean;
  useGroundReflection: boolean;
  reflectionModel: string;
  reflectionCoeff: number;
  sideReflectionCoeff: number;
  reflectionCorridorWidthM: number;
  diffractionModel: string;
  useFoliage: boolean;
  foliageLossPerM: number;
  profileTargetSpacingM: number;
  profileMaxSamples: number;
  foliage?: ObstacleSet | null;
  useBuildings: boolean;
  buildingLossPerM: number;
  buildings?: ObstacleSet | null;
};

type CoverageWorkerProgressMessage = {
  type: 'progress';
  rowStart: number;
  pct: number;
};

type CoverageWorkerDoneMessage = {
  type: 'done';
  rowStart: number;
  rowEnd: number;
  rgbaBuffer: ArrayBuffer;
  signalBuffer: ArrayBuffer;
  losBuffer: ArrayBuffer;
  stats: {
    computeMs: number;
    insidePoints: number;
  };
};

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = ({ data }: MessageEvent<CoverageWorkerPayload>): void => {
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
  const bounds: Bbox = { latMin, latMax, lonMin, lonMax };
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
      const fresnelClearance = los?.minFresnelClearanceRatio;
      losGrid[localIdx] = typeof fresnelClearance === 'number' && Number.isFinite(fresnelClearance)
        ? fresnelClearance
        : NaN;
      writePixel(rgba, localBase, rxPower, effectiveSens);
    }

    processed += gridRes;
    if ((r - rowStart) % 4 === 0) {
      const msg: CoverageWorkerProgressMessage = { type: 'progress', rowStart, pct: processed / totalBandPts };
      ctx.postMessage(msg);
    }
  }

  const doneMessage: CoverageWorkerDoneMessage = {
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
  };
  ctx.postMessage(doneMessage, [rgba.buffer, signalGrid.buffer, losGrid.buffer]);
};
