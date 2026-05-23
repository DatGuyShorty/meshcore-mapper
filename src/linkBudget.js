import { fetchElevations } from './elevation.js';
import { fetchFoliage, foliageLossDb } from './foliage.js';
import { fetchBuildings, buildingLossDb } from './buildings.js';
import { checkLoS, fspl, haversine, profileSampleCount } from './propagation.js';
import { drawTerrainProfile, sampleObstacleHeights } from './terrainProfileView.js';

export async function calculateLinkBudget(pointA, pointB, settings) {
  const distM = haversine(pointA.lat, pointA.lng, pointB.lat, pointB.lng);
  const sampleCount = profileSampleCount(distM, settings.profileTargetSpacingM, 32, settings.profileMaxSamples);
  const profilePoints = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / (sampleCount - 1);
    profilePoints.push({
      latitude: pointA.lat + (pointB.lat - pointA.lat) * t,
      longitude: pointA.lng + (pointB.lng - pointA.lng) * t,
    });
  }

  const PAD = 0.003;
  const latMin = Math.min(pointA.lat, pointB.lat) - PAD;
  const latMax = Math.max(pointA.lat, pointB.lat) + PAD;
  const lonMin = Math.min(pointA.lng, pointB.lng) - PAD;
  const lonMax = Math.max(pointA.lng, pointB.lng) + PAD;

  const elevs = await fetchElevations(profilePoints);
  const [foliage, buildings] = await Promise.all([
    settings.useFoliage
      ? fetchFoliage(latMin, latMax, lonMin, lonMax).catch(e => { console.warn('[p2p] foliage fetch failed:', e.message); return null; })
      : Promise.resolve(null),
    settings.useBuildings
      ? fetchBuildings(latMin, latMax, lonMin, lonMax).catch(e => { console.warn('[p2p] buildings fetch failed:', e.message); return null; })
      : Promise.resolve(null),
  ]);

  const txElev = elevs[0];
  const rxElev = elevs[sampleCount - 1];
  const profileLats = new Float64Array(sampleCount);
  const profileLons = new Float64Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    profileLats[i] = profilePoints[i].latitude;
    profileLons[i] = profilePoints[i].longitude;
  }

  const { vegH, bldH } = sampleObstacleHeights(profilePoints, foliage, buildings);
  const geoResult = checkLoS(txElev, rxElev, elevs, settings.txHeight, settings.rxHeight, distM, settings.freqMHz, false);
  const fresnelResult = checkLoS(txElev, rxElev, elevs, settings.txHeight, settings.rxHeight, distM, settings.freqMHz, true);
  const foliageLoss = foliage
    ? foliageLossDb(profileLats, profileLons, elevs, settings.txHeight, settings.rxHeight,
        foliage.polygons, foliage.bboxes, foliage.canopyHeights, foliage.factors,
        foliage.tileIndex, distM, settings.foliageLossPerM)
    : 0;
  const buildingLoss = buildings
    ? buildingLossDb(profileLats, profileLons, elevs, settings.txHeight, settings.rxHeight,
        buildings.polygons, buildings.bboxes, buildings.heights,
        buildings.tileIndex, distM, settings.buildingLossPerM)
    : 0;

  const pathLoss = fspl(distM, settings.freqMHz);
  const totalExtras = geoResult.diffractionLossDb + foliageLoss + buildingLoss;
  const rxPower = settings.txPower + settings.txGain + settings.rxGain - pathLoss - totalExtras;
  const requiredRx = settings.rxSens + (settings.fadeMargin ?? 0);
  const margin = rxPower - requiredRx;
  const profileSvg = drawTerrainProfile(elevs, txElev, rxElev, settings.txHeight, settings.rxHeight, distM, settings.freqMHz, vegH, bldH);

  return {
    distM,
    sampleCount,
    pathLoss,
    diffractionLoss: geoResult.diffractionLossDb,
    foliageLoss,
    buildingLoss,
    totalPathLoss: pathLoss + totalExtras,
    rxPower,
    margin,
    requiredRx,
    fadeMargin: settings.fadeMargin ?? 0,
    txEirp: settings.txPower + settings.txGain,
    geoResult,
    fresnelResult,
    profileSvg,
  };
}
