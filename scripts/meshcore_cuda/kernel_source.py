KERNEL = r'''
#define MAX_CANDIDATES 256
#define MAX_TS 48
#define MAX_DEYGOUT_STACK 64
#define EPS 1.0e-6f

extern "C" __device__ float bilinear_elev(
    float lat, float lon,
    const float* elev,
    int elevRes,
    float latMin, float latMax,
    float lonMin, float lonMax
);

extern "C" __device__ unsigned int hash_u32(unsigned int x) {
    x ^= x >> 16;
    x *= 0x7feb352dU;
    x ^= x >> 15;
    x *= 0x846ca68bU;
    x ^= x >> 16;
    return x;
}

extern "C" __device__ float uniform01(unsigned int x) {
    return ((float)((x & 0x00FFFFFFU) + 1U)) / 16777217.0f;
}

extern "C" __device__ float gaussian_from_seed(unsigned int seedA, unsigned int seedB) {
    float u1 = uniform01(hash_u32(seedA));
    float u2 = uniform01(hash_u32(seedB));
    return sqrtf(-2.0f * logf(fmaxf(u1, 1.0e-7f))) * cosf(6.283185307179586f * u2);
}

extern "C" __device__ float terr_eff_at_frac(
    float frac,
    float txLat,
    float txLon,
    float rxLat,
    float rxLon,
    const float* elev,
    int elevRes,
    float latMin,
    float latMax,
    float lonMin,
    float lonMax,
    float dist,
    float reEff
) {
    float lat = txLat + (rxLat - txLat) * frac;
    float lon = txLon + (rxLon - txLon) * frac;
    float terrain = bilinear_elev(lat, lon, elev, elevRes, latMin, latMax, lonMin, lonMax);
    float d1 = frac * dist;
    float d2 = dist - d1;
    float bulge = d1 * d2 / (2.0f * reEff);
    return terrain + bulge;
}

extern "C" __device__ float effective_k_factor(
    int useAtmosphericRefraction,
    float kFactor,
    float refractivityGradientNPerKm,
    float surfaceRefractivityN
) {
    if (useAtmosphericRefraction == 0) {
        return fmaxf(0.5f, kFactor);
    }

    // Standard-atmosphere approximation: dN/dh ~= -39 N/km gives k ~ 4/3.
    float denom = 157.0f + refractivityGradientNPerKm;
    float kAtm = 1.3333333f;
    if (fabsf(denom) > 1.0e-6f) {
        kAtm = 157.0f / denom;
    }

    // Light correction from surface refractivity around mid-latitude reference.
    float nCorr = 1.0f + (surfaceRefractivityN - 301.0f) / 3000.0f;
    kAtm *= fmaxf(0.9f, fminf(1.1f, nCorr));
    return fminf(3.0f, fmaxf(0.5f, kAtm));
}

extern "C" __device__ float langley_rice_irregular_loss_approx(
    float txLat,
    float txLon,
    float rxLat,
    float rxLon,
    const float* elev,
    int elevRes,
    float latMin,
    float latMax,
    float lonMin,
    float lonMax,
    float dist,
    int samples,
    float txHeight,
    float rxHeight,
    float txAbs,
    float rxAbs,
    float kEff,
    float freqMHz
) {
    if (samples < 3 || dist < 1000.0f) return 0.0f;

    float mean = 0.0f;
    float m2 = 0.0f;
    int n = 0;
    float maxResidual = -1.0e9f;

    for (int i = 1; i < samples - 1; i++) {
        float frac = (float)i / (float)(samples - 1);
        float terrEff = terr_eff_at_frac(
            frac,
            txLat, txLon,
            rxLat, rxLon,
            elev, elevRes,
            latMin, latMax,
            lonMin, lonMax,
            dist, 6371000.0f * fmaxf(0.5f, kEff)
        );
        float lineH = txAbs + (rxAbs - txAbs) * frac;
        float residual = terrEff - lineH;
        maxResidual = fmaxf(maxResidual, residual);
        n++;
        float delta = residual - mean;
        mean += delta / (float)n;
        m2 += delta * (residual - mean);
    }

    if (n < 2) return 0.0f;
    float sigmaTerrain = sqrtf(fmaxf(0.0f, m2 / (float)(n - 1)));
    float distKm = dist / 1000.0f;
    float freqGHz = fmaxf(0.1f, freqMHz / 1000.0f);
    float txH = fmaxf(1.0f, txHeight);
    float rxH = fmaxf(1.0f, rxHeight);
    float horizonKm = 3.57f * sqrtf(fmaxf(0.5f, kEff)) * (sqrtf(txH) + sqrtf(rxH));

    // ITM/Langley-Rice-inspired add-on for rough terrain, trans-horizon, and frequency scaling.
    float loss = 0.0f;
    loss += 0.10f * sigmaTerrain * log10f(1.0f + distKm);
    loss += 1.8f * log10f(freqGHz + 1.0f);
    if (maxResidual > 0.0f) {
        loss += 0.06f * maxResidual;
    }
    if (distKm > horizonKm) {
        float dExcess = distKm - horizonKm;
        loss += 0.9f * dExcess + 6.0f * log10f(1.0f + dExcess);
    }
    return fmaxf(0.0f, loss);
}

extern "C" __device__ float deygout_diffraction_loss(
    float txLat,
    float txLon,
    float rxLat,
    float rxLon,
    const float* elev,
    int elevRes,
    float latMin,
    float latMax,
    float lonMin,
    float lonMax,
    float txAbs,
    float rxAbs,
    float dist,
    int samples,
    float lambda,
    float reEff
) {
    if (samples < 3 || dist <= 0.0f) return 0.0f;

    int stackL[MAX_DEYGOUT_STACK];
    int stackR[MAX_DEYGOUT_STACK];
    int top = 0;
    stackL[top] = 0;
    stackR[top] = samples - 1;
    top++;

    float totalLoss = 0.0f;

    while (top > 0) {
        top--;
        int s = stackL[top];
        int e = stackR[top];
        if (e - s < 2) continue;

        float fS = (float)s / (float)(samples - 1);
        float fE = (float)e / (float)(samples - 1);
        float segDist = (fE - fS) * dist;
        if (segDist <= 0.0f) continue;

        float maxV = -1.0e9f;
        int maxIdx = -1;

        for (int i = s + 1; i < e; i++) {
            float frac = (float)i / (float)(samples - 1);
            float d1 = (frac - fS) * dist;
            float d2 = (fE - frac) * dist;
            float denom = lambda * d1 * d2;
            if (denom <= 1.0e-30f) continue;

            float lineH = txAbs + (rxAbs - txAbs) * frac;
            float terrEff = terr_eff_at_frac(
                frac,
                txLat, txLon,
                rxLat, rxLon,
                elev, elevRes,
                latMin, latMax,
                lonMin, lonMax,
                dist, reEff
            );
            float v = (terrEff - lineH) * sqrtf(2.0f * segDist / denom);
            if (v > maxV) {
                maxV = v;
                maxIdx = i;
            }
        }

        if (maxIdx < 0 || maxV < -0.78f) continue;

        float loss = 6.9f + 20.0f * log10f(sqrtf((maxV - 0.1f) * (maxV - 0.1f) + 1.0f) + maxV - 0.1f);
        totalLoss += fmaxf(0.0f, loss);

        if (top + 2 < MAX_DEYGOUT_STACK) {
            stackL[top] = s;
            stackR[top] = maxIdx;
            top++;
            stackL[top] = maxIdx;
            stackR[top] = e;
            top++;
        }
    }

    return totalLoss;
}

extern "C" __device__ float knife_edge_loss_from_v(float v) {
    if (v < -0.78f) return 0.0f;
    return fmaxf(0.0f, 6.9f + 20.0f * log10f(sqrtf((v - 0.1f) * (v - 0.1f) + 1.0f) + v - 0.1f));
}

extern "C" __device__ float delta_bullington_loss_approx(float bullingtonV, float dist, float lambda, float reEff) {
    float bullLoss = knife_edge_loss_from_v(bullingtonV);
    if (dist <= 1.0f || lambda <= 1.0e-9f || reEff <= 1.0f) return bullLoss;

    // Smooth-Earth correction term used by Delta-Bullington style models.
    float smoothBulge = (dist * dist) / (8.0f * reEff);
    float smoothV = smoothBulge * sqrtf(8.0f / fmaxf(lambda * dist, 1.0e-9f));
    float smoothLoss = knife_edge_loss_from_v(smoothV);
    return fmaxf(bullLoss, smoothLoss);
}

extern "C" __device__ float bilinear_elev(
    float lat, float lon,
    const float* elev,
    int elevRes,
    float latMin, float latMax,
    float lonMin, float lonMax
) {
    float cF = (lon - lonMin) / fmaxf(1.0e-9f, lonMax - lonMin) * (float)(elevRes - 1);
    float rF = (latMax - lat) / fmaxf(1.0e-9f, latMax - latMin) * (float)(elevRes - 1);
    int c0 = min(elevRes - 2, max(0, (int)floorf(cF)));
    int r0 = min(elevRes - 2, max(0, (int)floorf(rF)));
    float tc = cF - (float)c0;
    float tr = rF - (float)r0;
    float e00 = elev[r0 * elevRes + c0];
    float e10 = elev[r0 * elevRes + c0 + 1];
    float e01 = elev[(r0 + 1) * elevRes + c0];
    float e11 = elev[(r0 + 1) * elevRes + c0 + 1];
    return e00 * (1.0f - tc) * (1.0f - tr) + e10 * tc * (1.0f - tr) + e01 * (1.0f - tc) * tr + e11 * tc * tr;
}

extern "C" __device__ int point_in_poly(
    const float* verts,
    const int* offsets,
    int polyIdx,
    float lat,
    float lon
) {
    int start = offsets[polyIdx];
    int end = offsets[polyIdx + 1];
    int n = end - start;
    if (n < 3) return 0;
    int inside = 0;
    int j = n - 1;
    for (int i = 0; i < n; i++) {
        int ii = start + i;
        int jj = start + j;
        float yi = verts[ii * 2];
        float xi = verts[ii * 2 + 1];
        float yj = verts[jj * 2];
        float xj = verts[jj * 2 + 1];
        if (((yi > lat) != (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi + 1.0e-12f) + xi)) {
            inside = !inside;
        }
        j = i;
    }
    return inside;
}

extern "C" __device__ int append_unique(int* arr, int n, int val) {
    for (int i = 0; i < n; i++) {
        if (arr[i] == val) return n;
    }
    if (n < MAX_CANDIDATES) {
        arr[n] = val;
        return n + 1;
    }
    return n;
}

extern "C" __device__ int gather_candidates(
    float lat1,
    float lon1,
    float lat2,
    float lon2,
    const float* bboxes,
    int count,
    const int* tileOffsets,
    const int* tileCounts,
    const int* tileIndices,
    int tileN,
    float tileLatMin,
    float tileLatSpan,
    float tileLonMin,
    float tileLonSpan,
    int* outIndices
) {
    if (count <= 0) return 0;

    float latLo = fminf(lat1, lat2);
    float latHi = fmaxf(lat1, lat2);
    float lonLo = fminf(lon1, lon2);
    float lonHi = fmaxf(lon1, lon2);

    int n = 0;
    if (tileN <= 0) {
        for (int i = 0; i < count && n < MAX_CANDIDATES; i++) {
            int bb = i * 4;
            float bLatMin = bboxes[bb];
            float bLatMax = bboxes[bb + 1];
            float bLonMin = bboxes[bb + 2];
            float bLonMax = bboxes[bb + 3];
            if (latHi < bLatMin || latLo > bLatMax || lonHi < bLonMin || lonLo > bLonMax) continue;
            outIndices[n++] = i;
        }
        return n;
    }

    float tn = (float)tileN;
    int rMin = min(tileN - 1, max(0, (int)floorf((latLo - tileLatMin) / fmaxf(1.0e-9f, tileLatSpan) * tn)));
    int rMax = min(tileN - 1, max(0, (int)floorf((latHi - tileLatMin) / fmaxf(1.0e-9f, tileLatSpan) * tn)));
    int cMin = min(tileN - 1, max(0, (int)floorf((lonLo - tileLonMin) / fmaxf(1.0e-9f, tileLonSpan) * tn)));
    int cMax = min(tileN - 1, max(0, (int)floorf((lonHi - tileLonMin) / fmaxf(1.0e-9f, tileLonSpan) * tn)));

    for (int r = rMin; r <= rMax && n < MAX_CANDIDATES; r++) {
        for (int c = cMin; c <= cMax && n < MAX_CANDIDATES; c++) {
            int cell = r * tileN + c;
            int off = tileOffsets[cell];
            int cnt = tileCounts[cell];
            for (int k = 0; k < cnt && n < MAX_CANDIDATES; k++) {
                int pi = tileIndices[off + k];
                if (pi < 0 || pi >= count) continue;
                int bb = pi * 4;
                float bLatMin = bboxes[bb];
                float bLatMax = bboxes[bb + 1];
                float bLonMin = bboxes[bb + 2];
                float bLonMax = bboxes[bb + 3];
                if (latHi < bLatMin || latLo > bLatMax || lonHi < bLonMin || lonLo > bLonMax) continue;
                n = append_unique(outIndices, n, pi);
            }
        }
    }

    return n;
}

extern "C" __device__ int segment_polygon_intervals(
    float lat1,
    float lon1,
    float lat2,
    float lon2,
    int polyIdx,
    const float* verts,
    const int* offsets,
    float* ts
) {
    int start = offsets[polyIdx];
    int end = offsets[polyIdx + 1];
    int n = end - start;
    if (n < 3) return 0;

    float dx = lon2 - lon1;
    float dy = lat2 - lat1;

    ts[0] = 0.0f;
    ts[1] = 1.0f;
    int nTs = 2;

    int j = n - 1;
    for (int i = 0; i < n && nTs < (MAX_TS - 1); i++) {
        int ii = start + i;
        int jj = start + j;
        float y3 = verts[jj * 2];
        float x3 = verts[jj * 2 + 1];
        float y4 = verts[ii * 2];
        float x4 = verts[ii * 2 + 1];
        float sx = x4 - x3;
        float sy = y4 - y3;
        float denom = dx * sy - dy * sx;

        if (fabsf(denom) >= 1.0e-9f) {
            float qpx = x3 - lon1;
            float qpy = y3 - lat1;
            float t = (qpx * sy - qpy * sx) / denom;
            float u = (qpx * dy - qpy * dx) / denom;
            if (t > 1.0e-9f && t < (1.0f - 1.0e-9f) && u >= -1.0e-9f && u <= 1.0f + 1.0e-9f) {
                int dup = 0;
                for (int d = 0; d < nTs; d++) {
                    if (fabsf(ts[d] - t) <= 1.0e-6f) {
                        dup = 1;
                        break;
                    }
                }
                if (!dup) {
                    int pos = nTs;
                    while (pos > 0 && ts[pos - 1] > t) {
                        ts[pos] = ts[pos - 1];
                        pos--;
                    }
                    ts[pos] = t;
                    nTs++;
                }
            }
        }

        j = i;
    }

    return nTs;
}

extern "C" __device__ float weissberger_loss_db(float freqMHz, float depthM) {
    if (depthM <= 0.0f) return 0.0f;

    float fGHz = fmaxf(0.1f, freqMHz / 1000.0f);
    float d = fminf(400.0f, fmaxf(0.0f, depthM));
    if (d <= 14.0f) {
        return 0.45f * powf(fGHz, 0.284f) * d;
    }
    return 1.33f * powf(fGHz, 0.284f) * powf(d, 0.588f);
}

extern "C" __device__ float foliage_ray_loss(
    float txLat,
    float txLon,
    float rxLat,
    float rxLon,
    float txAbs,
    float rxAbs,
    float dist,
    int samples,
    float freqMHz,
    int useWeissberger,
    float foliageLossPerM,
    const float* elev,
    int elevRes,
    float latMin,
    float latMax,
    float lonMin,
    float lonMax,
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
    float reEff
) {
    if (foliageCount <= 0 || samples <= 1) return 0.0f;

    float segLen = dist / (float)(samples - 1);
    float lossPerM = fmaxf(0.0f, foliageLossPerM);
    float linearLoss = 0.0f;

    int candidates[MAX_CANDIDATES];
    float ts[MAX_TS];

    for (int si = 0; si < samples - 1; si++) {
        float f1 = (float)si / (float)(samples - 1);
        float f2 = (float)(si + 1) / (float)(samples - 1);
        float lat1 = txLat + (rxLat - txLat) * f1;
        float lon1 = txLon + (rxLon - txLon) * f1;
        float lat2 = txLat + (rxLat - txLat) * f2;
        float lon2 = txLon + (rxLon - txLon) * f2;

        int nCand = gather_candidates(
            lat1, lon1, lat2, lon2,
            fBboxes, foliageCount,
            fTileOffsets, fTileCounts, fTileIndices,
            foliageTileN,
            foliageTileLatMin, foliageTileLatSpan,
            foliageTileLonMin, foliageTileLonSpan,
            candidates
        );
        if (nCand <= 0) continue;

        float elev1 = bilinear_elev(lat1, lon1, elev, elevRes, latMin, latMax, lonMin, lonMax);
        float elev2 = bilinear_elev(lat2, lon2, elev, elevRes, latMin, latMax, lonMin, lonMax);

        for (int ci = 0; ci < nCand; ci++) {
            int pi = candidates[ci];
            int nTs = segment_polygon_intervals(lat1, lon1, lat2, lon2, pi, fVerts, fOffsets, ts);
            if (nTs < 2) continue;

            for (int k = 0; k < nTs - 1; k++) {
                float a = ts[k];
                float b = ts[k + 1];
                if (b - a < EPS) continue;

                float mid = 0.5f * (a + b);
                float t = f1 + (f2 - f1) * mid;
                float lat = lat1 + (lat2 - lat1) * mid;
                float lon = lon1 + (lon2 - lon1) * mid;
                if (!point_in_poly(fVerts, fOffsets, pi, lat, lon)) continue;

                float rayAbs = txAbs + (rxAbs - txAbs) * t;
                float terrainElev = elev1 + (elev2 - elev1) * mid;
                float d1 = t * dist;
                float d2 = dist - d1;
                float bulge = d1 * d2 / (2.0f * reEff);
                float canopyTop = terrainElev + bulge + fmaxf(0.0f, fCanopy[pi]);

                if (rayAbs <= canopyTop) {
                    float factor = fmaxf(0.1f, fFactors[pi]);
                    float depthM = segLen * (b - a);
                    linearLoss += depthM * lossPerM * factor;
                }
            }
        }
    }

    if (linearLoss <= 0.0f || lossPerM <= 0.0f) return linearLoss;
    float equivalentDepthM = linearLoss / lossPerM;
    float modelLoss = weissberger_loss_db(freqMHz, equivalentDepthM);
    if (useWeissberger != 0) return modelLoss;
    return fminf(linearLoss, modelLoss);
}

extern "C" __device__ float building_ray_loss(
    float txLat,
    float txLon,
    float rxLat,
    float rxLon,
    float txAbs,
    float rxAbs,
    float dist,
    int samples,
    float buildingLossPerM,
    const float* elev,
    int elevRes,
    float latMin,
    float latMax,
    float lonMin,
    float lonMax,
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
    float reEff
) {
    if (buildingCount <= 0 || samples <= 1) return 0.0f;

    const float wallCrossLossDb = 14.0f;
    float segLen = dist / (float)(samples - 1);
    float loss = 0.0f;

    int candidates[MAX_CANDIDATES];
    float ts[MAX_TS];

    for (int si = 0; si < samples - 1; si++) {
        float f1 = (float)si / (float)(samples - 1);
        float f2 = (float)(si + 1) / (float)(samples - 1);
        float lat1 = txLat + (rxLat - txLat) * f1;
        float lon1 = txLon + (rxLon - txLon) * f1;
        float lat2 = txLat + (rxLat - txLat) * f2;
        float lon2 = txLon + (rxLon - txLon) * f2;

        int nCand = gather_candidates(
            lat1, lon1, lat2, lon2,
            bBboxes, buildingCount,
            bTileOffsets, bTileCounts, bTileIndices,
            buildingTileN,
            buildingTileLatMin, buildingTileLatSpan,
            buildingTileLonMin, buildingTileLonSpan,
            candidates
        );
        if (nCand <= 0) continue;

        float elev1 = bilinear_elev(lat1, lon1, elev, elevRes, latMin, latMax, lonMin, lonMax);
        float elev2 = bilinear_elev(lat2, lon2, elev, elevRes, latMin, latMax, lonMin, lonMax);

        for (int ci = 0; ci < nCand; ci++) {
            int pi = candidates[ci];
            int nTs = segment_polygon_intervals(lat1, lon1, lat2, lon2, pi, bVerts, bOffsets, ts);
            if (nTs < 2) continue;

            for (int k = 0; k < nTs - 1; k++) {
                float a = ts[k];
                float b = ts[k + 1];
                if (b - a < EPS) continue;

                float mid = 0.5f * (a + b);
                float t = f1 + (f2 - f1) * mid;
                float lat = lat1 + (lat2 - lat1) * mid;
                float lon = lon1 + (lon2 - lon1) * mid;
                if (!point_in_poly(bVerts, bOffsets, pi, lat, lon)) continue;

                float rayAbs = txAbs + (rxAbs - txAbs) * t;
                float terrainElev = elev1 + (elev2 - elev1) * mid;
                float d1 = t * dist;
                float d2 = dist - d1;
                float bulge = d1 * d2 / (2.0f * reEff);
                float roofTop = terrainElev + bulge + fmaxf(0.0f, bHeights[pi]);

                if (rayAbs <= roofTop) {
                    loss += segLen * (b - a) * buildingLossPerM;
                    if (a > 1.0e-6f) loss += wallCrossLossDb;
                    if (b < 1.0f - 1.0e-6f) loss += wallCrossLossDb;
                }
            }
        }
    }

    return loss;
}

extern "C" __global__
void coverage_kernel(
    const float* elev,
    unsigned char* rgba,
    int gridRes,
    int elevRes,
    float latMin,
    float latMax,
    float lonMin,
    float lonMax,
    float txLat,
    float txLon,
    float txElev,
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
    int useLangleyRice,
    int useLogNormalFading,
    float fadingSigmaDb,
    unsigned int fadingSeed,
    float kFactor,
    int useAtmosphericRefraction,
    float refractivityGradientNPerKm,
    float surfaceRefractivityN,
    int useDeltaBullington,
    int useMultipathModel,
    float ricianKDb,
    float profileTargetSpacingM,
    int profileMaxSamples,
    int useFoliage,
    int useWeissberger,
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
    float buildingTileLonSpan
) {
    int col = blockDim.x * blockIdx.x + threadIdx.x;
    int row = blockDim.y * blockIdx.y + threadIdx.y;
    if (col >= gridRes || row >= gridRes) return;

    int pix = row * gridRes + col;
    float rowFrac = gridRes > 1 ? ((float)row / (float)(gridRes - 1)) : 0.0f;
    float colFrac = gridRes > 1 ? ((float)col / (float)(gridRes - 1)) : 0.0f;
    float ptLat = latMax - rowFrac * (latMax - latMin);
    float ptLon = lonMin + colFrac * (lonMax - lonMin);
    float mPerLat = 110574.0f;
    float mPerLon = 111320.0f * cosf(txLat * 0.017453292519943295f);
    float dLat = (ptLat - txLat) * mPerLat;
    float dLon = (ptLon - txLon) * mPerLon;
    float dist = sqrtf(dLat * dLat + dLon * dLon);
    float sig = effectiveSens - 1.0f;

    if (dist <= radiusM) {
        // 6) Free-Space Path Loss baseline.
        float fsplBase = 20.0f * log10f(freqMHz * 1000000.0f) - 147.55f;
        sig = txPower + txGain - (20.0f * log10f(fmaxf(1.0f, dist)) + fsplBase);

        float rxGround = bilinear_elev(ptLat, ptLon, elev, elevRes, latMin, latMax, lonMin, lonMax);
        float txAbs = txElev + txHeight;
        float rxAbs = rxGround + rxHeight;
        int samples = (int)ceilf(dist / fmaxf(1.0f, profileTargetSpacingM)) + 1;
        samples = max(16, min(profileMaxSamples, samples));
        float earthRadius = 6371000.0f;
        float kEff = effective_k_factor(
            useAtmosphericRefraction,
            kFactor,
            refractivityGradientNPerKm,
            surfaceRefractivityN
        );
        float reEff = earthRadius * kEff;

        if (useLos != 0 && dist > 50.0f) {
            // 7) Terrain LOS check with effective-Earth curvature (k-factor).
            float lambda = 299792458.0f / (freqMHz * 1000000.0f);
            float maxV = -1.0e9f;
            float minFresnelRatio = 1.0e9f;
            int losBlocked = 0;
            float residualMean = 0.0f;
            float residualM2 = 0.0f;
            int residualN = 0;
            for (int i = 1; i < samples - 1; i++) {
                float frac = (float)i / (float)(samples - 1);
                float lat = txLat + (ptLat - txLat) * frac;
                float lon = txLon + (ptLon - txLon) * frac;
                float terrain = bilinear_elev(lat, lon, elev, elevRes, latMin, latMax, lonMin, lonMax);
                float d1 = frac * dist;
                float d2 = dist - d1;
                float lineH = txAbs + (rxAbs - txAbs) * frac;
                float bulge = d1 * d2 / (2.0f * reEff);
                float denom = lambda * d1 * d2;
                if (denom > 1.0e-30f) {
                    float terrainEff = terrain + bulge;
                    if (terrainEff > lineH) losBlocked = 1;

                    float residual = terrainEff - lineH;
                    residualN++;
                    float delta = residual - residualMean;
                    residualMean += delta / (float)residualN;
                    residualM2 += delta * (residual - residualMean);

                    // 8) Fresnel zone clearance check uses 60% of first Fresnel radius.
                    float clearance = lineH - terrainEff;
                    float r1 = sqrtf(denom / dist);
                    if (r1 > 1.0e-6f) {
                        float ratio = clearance / r1;
                        minFresnelRatio = fminf(minFresnelRatio, ratio);
                    }
                    float v = (terrainEff - lineH) * sqrtf(2.0f * dist / denom);
                    maxV = fmaxf(maxV, v);
                }
            }

            // 9) Diffraction: Bullington / Delta-Bullington primary, Deygout optional.
            float diffLoss = 0.0f;
            if (maxV >= -0.7f) {
                if (useDeygout != 0) {
                    diffLoss = deygout_diffraction_loss(
                        txLat, txLon,
                        ptLat, ptLon,
                        elev, elevRes,
                        latMin, latMax,
                        lonMin, lonMax,
                        txAbs, rxAbs,
                        dist, samples,
                        lambda, reEff
                    );
                } else if (useDeltaBullington != 0) {
                    diffLoss = delta_bullington_loss_approx(maxV, dist, lambda, reEff);
                } else {
                    diffLoss = knife_edge_loss_from_v(maxV);
                }
            }

            if (diffLoss > 0.0f) {
                sig -= diffLoss;
                if (diffLoss > 60.0f) sig = fminf(sig, effectiveSens - 10.0f);
            }

            // 11) Earth curvature/refraction already included via reEff (k-factor).
            if (useLangleyRice != 0) {
                sig -= langley_rice_irregular_loss_approx(
                    txLat, txLon,
                    ptLat, ptLon,
                    elev, elevRes,
                    latMin, latMax,
                    lonMin, lonMax,
                    dist, samples,
                    txHeight,
                    rxHeight,
                    txAbs, rxAbs,
                    kEff,
                    freqMHz
                );
            }

            // 12) Shadow fading with terrain-dependent sigma fallback.
            if (useLogNormalFading != 0) {
                float sigmaDb = fadingSigmaDb;
                if (sigmaDb <= 0.0f) {
                    float terrainSigma = 0.0f;
                    if (residualN > 1) {
                        terrainSigma = sqrtf(fmaxf(0.0f, residualM2 / (float)(residualN - 1)));
                    }
                    sigmaDb = fminf(12.0f, fmaxf(2.0f, 2.0f + 0.06f * terrainSigma));
                }
                unsigned int baseSeed = ((unsigned int)pix) ^ fadingSeed;
                float fadeDb = gaussian_from_seed(baseSeed * 1664525U + 1013904223U, baseSeed ^ 0x9E3779B9U) * sigmaDb;
                sig += fadeDb;
            }

            // 13) Optional small-scale multipath model (Rayleigh/Rician).
            if (useMultipathModel != 0) {
                unsigned int mSeed = (((unsigned int)pix) ^ fadingSeed) * 2246822519U + 3266489917U;
                float amp = 1.0f;
                if (ricianKDb > -40.0f) {
                    float kLinear = powf(10.0f, ricianKDb / 10.0f);
                    float s = sqrtf(kLinear / (kLinear + 1.0f));
                    float sigma = sqrtf(1.0f / (2.0f * (kLinear + 1.0f)));
                    float nI = gaussian_from_seed(mSeed, mSeed ^ 0xA511E9B3U) * sigma;
                    float nQ = gaussian_from_seed(mSeed ^ 0x63D83595U, mSeed ^ 0xC2B2AE35U) * sigma;
                    amp = sqrtf((s + nI) * (s + nI) + nQ * nQ);
                } else {
                    float u = uniform01(hash_u32(mSeed));
                    amp = sqrtf(fmaxf(1.0e-6f, -2.0f * logf(fmaxf(u, 1.0e-7f))));
                }
                float mpDb = 20.0f * log10f(fmaxf(1.0e-3f, amp));
                sig += fminf(8.0f, fmaxf(-25.0f, mpDb));
            }
        }

        // 10) Clutter attenuation (foliage/buildings/walls).
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
                useWeissberger,
                foliageLossPerM,
                elev,
                elevRes,
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
                elevRes,
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
                reEff
            );
        }
    }

    unsigned char r, g, b, a;
    if (isnan(sig) || sig < effectiveSens) {
        r = 70;
        g = 0;
        b = 0;
        a = 70;
    } else {
        float t = fminf(1.0f, fmaxf(0.0f, (sig - effectiveSens) / 50.0f));
        float r0, g0, b0, a0, r1, g1, b1, a1, u;
        if (t > 0.75f) {
            r0 = 80;
            g0 = 210;
            b0 = 30;
            a0 = 165;
            r1 = 0;
            g1 = 200;
            b1 = 90;
            a1 = 180;
            u = (t - 0.75f) / 0.25f;
        } else if (t > 0.5f) {
            r0 = 230;
            g0 = 220;
            b0 = 0;
            a0 = 155;
            r1 = 80;
            g1 = 210;
            b1 = 30;
            a1 = 165;
            u = (t - 0.5f) / 0.25f;
        } else if (t > 0.25f) {
            r0 = 255;
            g0 = 160;
            b0 = 0;
            a0 = 145;
            r1 = 230;
            g1 = 220;
            b1 = 0;
            a1 = 155;
            u = (t - 0.25f) / 0.25f;
        } else {
            r0 = 220;
            g0 = 40;
            b0 = 0;
            a0 = 120;
            r1 = 255;
            g1 = 160;
            b1 = 0;
            a1 = 145;
            u = t / 0.25f;
        }
        r = (unsigned char)roundf(r0 + (r1 - r0) * u);
        g = (unsigned char)roundf(g0 + (g1 - g0) * u);
        b = (unsigned char)roundf(b0 + (b1 - b0) * u);
        a = (unsigned char)roundf(a0 + (a1 - a0) * u);
    }

    int base = pix * 4;
    rgba[base] = r;
    rgba[base + 1] = g;
    rgba[base + 2] = b;
    rgba[base + 3] = a;
}
'''
