OPTIMIZER_KERNEL = r'''
extern "C" __global__
void optimizer_signal_kernel(
    const float* elev,
    const float* candidateCoords,
    const float* candidateElevs,
    const unsigned char* covered,
    const unsigned char* selected,
    float* signals,
    int candidateCount,
    int evalRes,
    float latMin,
    float latMax,
    float lonMin,
    float lonMax,
    float txHeight,
    float txPower,
    float txGain,
    float freqMHz,
    float rxHeight,
    float effectiveSens,
    float radiusM,
    int useLos,
    int useFresnel,
    int useDeygout,
    float profileTargetSpacingM,
    int profileMaxSamples,
    int useFoliage,
    float foliageLossPerM,
    const float* fVerts,
    const int* fOffsets,
    const float* fBboxes,
    const float* fCanopy,
    const float* fFactors,
    int foliageCount,
    const int* fTileOffsets,
    const int* fTileCounts,
    const int* fTileIndices,
    int foliageTileN,
    float foliageTileLatMin,
    float foliageTileLatSpan,
    float foliageTileLonMin,
    float foliageTileLonSpan,
    const float* fHoleVerts,
    const int* fHoleRingOffsets,
    const int* fPolyHoleOffsets,
    int useBuildings,
    float buildingLossPerM,
    const float* bVerts,
    const int* bOffsets,
    const float* bBboxes,
    const float* bHeights,
    int buildingCount,
    const int* bTileOffsets,
    const int* bTileCounts,
    const int* bTileIndices,
    int buildingTileN,
    float buildingTileLatMin,
    float buildingTileLatSpan,
    float buildingTileLonMin,
    float buildingTileLonSpan,
    const float* bHoleVerts,
    const int* bHoleRingOffsets,
    const int* bPolyHoleOffsets,
    int useGroundReflection,
    float reflectionCoeff
) {
    int evalIdx = blockDim.x * blockIdx.x + threadIdx.x;
    int candIdx = blockDim.y * blockIdx.y + threadIdx.y;
    int evalCount = evalRes * evalRes;
    if (evalIdx >= evalCount || candIdx >= candidateCount) return;

    int outIdx = candIdx * evalCount + evalIdx;
    float sig = effectiveSens - 1.0f;

    if (selected[candIdx] != 0 || covered[evalIdx] != 0) {
        signals[outIdx] = sig;
        return;
    }

    int row = evalIdx / evalRes;
    int col = evalIdx - row * evalRes;
    float rowFrac = evalRes > 1 ? ((float)row / (float)(evalRes - 1)) : 0.0f;
    float colFrac = evalRes > 1 ? ((float)col / (float)(evalRes - 1)) : 0.0f;
    float ptLat = latMax - rowFrac * (latMax - latMin);
    float ptLon = lonMin + colFrac * (lonMax - lonMin);

    float txLat = candidateCoords[candIdx * 2];
    float txLon = candidateCoords[candIdx * 2 + 1];
    float txElev = candidateElevs[candIdx];

    float mPerLat = 110574.0f;
    float mPerLon = 111320.0f * cosf(txLat * 0.017453292519943295f);
    float dLat = (ptLat - txLat) * mPerLat;
    float dLon = (ptLon - txLon) * mPerLon;
    float dist = sqrtf(dLat * dLat + dLon * dLon);

    if (dist <= radiusM) {
        float fsplBase = 20.0f * log10f(freqMHz * 1000000.0f) - 147.55f;
        sig = txPower + txGain - (20.0f * log10f(fmaxf(1.0f, dist)) + fsplBase);

        float rxGround = bilinear_elev(ptLat, ptLon, elev, evalRes, latMin, latMax, lonMin, lonMax);
        float txAbs = txElev + txHeight;
        float rxAbs = rxGround + rxHeight;
        int samples = (int)ceilf(dist / fmaxf(1.0f, profileTargetSpacingM)) + 1;
        samples = max(16, min(profileMaxSamples, samples));
        float lambda = 299792458.0f / (freqMHz * 1000000.0f);
        float reEff = 6371000.0f * 1.3333333333333333f;

        if (useLos != 0 && dist > 50.0f) {
            float maxV = -1.0e9f;
            float minFresnelRatio = 1.0e9f;
            int losBlocked = 0;

            for (int i = 1; i < samples - 1; i++) {
                float frac = (float)i / (float)(samples - 1);
                float lat = txLat + (ptLat - txLat) * frac;
                float lon = txLon + (ptLon - txLon) * frac;
                float terrain = bilinear_elev(lat, lon, elev, evalRes, latMin, latMax, lonMin, lonMax);
                float d1 = frac * dist;
                float d2 = dist - d1;
                float lineH = txAbs + (rxAbs - txAbs) * frac;
                float bulge = d1 * d2 / (2.0f * reEff);
                float denom = lambda * d1 * d2;
                if (denom > 1.0e-30f) {
                    float terrainEff = terrain + bulge;
                    if (terrainEff > lineH) losBlocked = 1;
                    float clearance = lineH - terrainEff;
                    float r1 = sqrtf(denom / dist);
                    if (r1 > 1.0e-6f) {
                        minFresnelRatio = fminf(minFresnelRatio, clearance / r1);
                    }
                    float v = (terrainEff - lineH) * sqrtf(2.0f * dist / denom);
                    maxV = fmaxf(maxV, v);
                }
            }

            if (maxV >= -0.7f) {
                float diffLoss = useDeygout != 0
                    ? deygout_diffraction_loss(
                        txLat, txLon,
                        ptLat, ptLon,
                        elev, evalRes,
                        latMin, latMax,
                        lonMin, lonMax,
                        txAbs, rxAbs,
                        dist, samples,
                        lambda, reEff
                    )
                    : knife_edge_loss_from_v(maxV);
                sig -= diffLoss;
                if (diffLoss > 60.0f) sig = fminf(sig, effectiveSens - 10.0f);
            }

            // Ground reflection (2-ray) only on clear (geometric-LoS) paths.
            if (useGroundReflection != 0 && maxV < 0.0f) {
                sig += two_ray_reflection_gain_db(dist, txHeight, rxHeight, freqMHz, reflectionCoeff);
            }
        }

        if (useFoliage != 0 && foliageCount > 0 && dist > 50.0f) {
            sig -= foliage_ray_loss(
                txLat,
                txLon,
                ptLat,
                ptLon,
                txAbs,
                rxAbs,
                dist,
                samples,
                freqMHz,
                0,
                foliageLossPerM,
                elev,
                evalRes,
                latMin,
                latMax,
                lonMin,
                lonMax,
                fVerts,
                fOffsets,
                fBboxes,
                fCanopy,
                fFactors,
                foliageCount,
                fTileOffsets,
                fTileCounts,
                fTileIndices,
                foliageTileN,
                foliageTileLatMin,
                foliageTileLatSpan,
                foliageTileLonMin,
                foliageTileLonSpan,
                fHoleVerts,
                fHoleRingOffsets,
                fPolyHoleOffsets,
                reEff
            );
        }

        if (useBuildings != 0 && buildingCount > 0 && dist > 50.0f) {
            sig -= building_ray_loss(
                txLat,
                txLon,
                ptLat,
                ptLon,
                txAbs,
                rxAbs,
                dist,
                samples,
                buildingLossPerM,
                elev,
                evalRes,
                latMin,
                latMax,
                lonMin,
                lonMax,
                bVerts,
                bOffsets,
                bBboxes,
                bHeights,
                buildingCount,
                bTileOffsets,
                bTileCounts,
                bTileIndices,
                buildingTileN,
                buildingTileLatMin,
                buildingTileLatSpan,
                buildingTileLonMin,
                buildingTileLonSpan,
                bHoleVerts,
                bHoleRingOffsets,
                bPolyHoleOffsets,
                reEff
            );
        }
    }

    signals[outIdx] = sig;
}
'''
