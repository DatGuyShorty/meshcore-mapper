/**
 * coverageWorker.js - Web Worker row-band renderer for coverage analysis.
 */
import { writePixel } from './propagation.js';
import { computeSignalToPoint, ensureProfileBuffers, flatDistanceM, fsplBaseDb } from './signalModel.js';

self.onmessage = ({ data }) => {
  const {
    gridElevs: gridElevsBuf,
    gridRes, ELEV_RES, rowStart, rowEnd,
    rep, txElev, latMin, latMax, lonMin, lonMax,
    radiusKm, rxHeight, effectiveSens, useLos, useFresnel,
    useFoliage, foliageLossPerM, profileTargetSpacingM, profileMaxSamples, foliage,
    useBuildings, buildingLossPerM, buildings,
  } = data;

  const t0 = performance.now();
  const gridElevs = new Float32Array(gridElevsBuf);
  const rowCount = rowEnd - rowStart;
  const rgba = new Uint8ClampedArray(rowCount * gridRes * 4);
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
      const dist = flatDistanceM(rep.lat, rep.lon, ptLat, ptLon);

      if (dist > radiusM) {
        writePixel(rgba, localBase, -200, effectiveSens);
        continue;
      }

      insidePoints++;
      const { rxPower } = computeSignalToPoint({
        tx: rep, txElev, rxLat: ptLat, rxLon: ptLon,
        distM: dist, fsplBase, elevGrid: gridElevs, elevRes: ELEV_RES, bounds,
        rxHeight, effectiveSens, useLos, useFresnel,
        foliage: useFoliage ? foliage : null,
        foliageLossPerM,
        buildings: useBuildings ? buildings : null,
        buildingLossPerM,
        profileTargetSpacingM, profileMaxSamples, profileBuffers,
      });

      writePixel(rgba, localBase, rxPower, effectiveSens);
    }

    processed += gridRes;
    if ((r - rowStart) % 4 === 0) {
      self.postMessage({ type: 'progress', rowStart, pct: processed / totalBandPts });
    }
  }

  self.postMessage({
    type: 'done',
    rowStart,
    rowEnd,
    rgbaBuffer: rgba.buffer,
    stats: {
      computeMs: performance.now() - t0,
      insidePoints,
    },
  }, [rgba.buffer]);
};
