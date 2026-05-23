/**
 * coverageWorker.js — Web Worker for the coverage signal-computation inner loop.
 * Runs off the main thread so the UI stays responsive during heavy calculations.
 *
 * Receives a postMessage with all required pre-fetched data, computes a
 * Float32Array signalGrid, and returns it via postMessage (transferred).
 */
import { checkLoS, bilinearElev } from './propagation.js';
import { foliageLossDb } from './foliage.js';
import { buildingLossDb } from './buildings.js';

self.onmessage = ({ data }) => {
  const {
    gridLats: gridLatsBuf, gridLons: gridLonsBuf, gridElevs: gridElevsBuf,
    gridRes, ELEV_RES,
    rep, txElev, latMin, latMax, lonMin, lonMax,
    radiusKm, rxHeight, effectiveSens, useLos, useFresnel,
    useFoliage, foliageLossPerM, profileSamples, foliage,
    useBuildings, buildingLossPerM, buildings,
  } = data;

  // Reconstruct typed arrays from transferred ArrayBuffers
  const gridLats  = new Float64Array(gridLatsBuf);
  const gridLons  = new Float64Array(gridLonsBuf);
  const gridElevs = new Float32Array(gridElevsBuf);

  const totalPts = gridRes * gridRes;
  const signalGrid = new Float32Array(totalPts);

  const mPerLat  = 110574;
  const mPerLon  = 111320 * Math.cos(rep.lat * Math.PI / 180);
  const fsplBase = 20 * Math.log10(rep.freq * 1e6) - 147.55;
  const profile  = new Float32Array(profileSamples);

  for (let idx = 0; idx < totalPts; idx++) {
    const ptLat = gridLats[idx];
    const ptLon = gridLons[idx];

    const dLat = (ptLat - rep.lat) * mPerLat;
    const dLon = (ptLon - rep.lon) * mPerLon;
    const dist = Math.sqrt(dLat * dLat + dLon * dLon);

    if (dist > radiusKm * 1000) { signalGrid[idx] = -200; continue; }

    let rxPower = rep.power + (rep.gain ?? 0) - (20 * Math.log10(Math.max(1, dist)) + fsplBase);

    if (useLos && dist > 50) {
      const profileLatLons = (foliage || buildings) ? [] : null;
      for (let s = 0; s < profileSamples; s++) {
        const t = s / (profileSamples - 1);
        const sLat = rep.lat + (ptLat - rep.lat) * t;
        const sLon = rep.lon + (ptLon - rep.lon) * t;
        profile[s] = bilinearElev(sLat, sLon, gridElevs, ELEV_RES, latMin, latMax, lonMin, lonMax);
        if (profileLatLons) profileLatLons.push([sLat, sLon]);
      }
      const rxElev = bilinearElev(ptLat, ptLon, gridElevs, ELEV_RES, latMin, latMax, lonMin, lonMax);
      const los = checkLoS(txElev, rxElev, profile, rep.height, rxHeight, dist, rep.freq, useFresnel);
      rxPower -= los.diffractionLossDb;
      if (!los.los && los.diffractionLossDb > 60) rxPower = Math.min(rxPower, effectiveSens - 10);
      if (foliage) {
        rxPower -= foliageLossDb(
          profileLatLons, profile, rep.height, rxHeight,
          foliage.polygons, foliage.bboxes, foliage.canopyHeights, foliage.factors,
          foliage.tileIndex, dist, foliageLossPerM
        );
      }
      if (buildings) {
        rxPower -= buildingLossDb(
          profileLatLons, profile, rep.height, rxHeight,
          buildings.polygons, buildings.bboxes, buildings.heights,
          buildings.tileIndex, dist, buildingLossPerM
        );
      }
    } else if ((foliage || buildings) && dist > 50) {
      const profileLatLons = [];
      for (let s = 0; s < profileSamples; s++) {
        const t = s / (profileSamples - 1);
        const sLat = rep.lat + (ptLat - rep.lat) * t;
        const sLon = rep.lon + (ptLon - rep.lon) * t;
        profile[s] = bilinearElev(sLat, sLon, gridElevs, ELEV_RES, latMin, latMax, lonMin, lonMax);
        profileLatLons.push([sLat, sLon]);
      }
      if (foliage) {
        rxPower -= foliageLossDb(
          profileLatLons, profile, rep.height, rxHeight,
          foliage.polygons, foliage.bboxes, foliage.canopyHeights, foliage.factors,
          foliage.tileIndex, dist, foliageLossPerM
        );
      }
      if (buildings) {
        rxPower -= buildingLossDb(
          profileLatLons, profile, rep.height, rxHeight,
          buildings.polygons, buildings.bboxes, buildings.heights,
          buildings.tileIndex, dist, buildingLossPerM
        );
      }
    }

    signalGrid[idx] = rxPower;

    // Report progress every 4096 points so the main thread can update the progress bar
    if (idx % 4096 === 0) {
      self.postMessage({ type: 'progress', pct: idx / totalPts });
    }
  }

  self.postMessage({ type: 'done', signalGrid }, [signalGrid.buffer]);
};
