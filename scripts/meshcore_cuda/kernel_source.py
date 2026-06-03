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

extern "C" __device__ int add_ring_crossings(
    float lat1,
    float lon1,
    float lat2,
    float lon2,
    const float* verts,
    int start,
    int end,
    float* ts,
    int nTs
) {
    int n = end - start;
    if (n < 3) return nTs;

    float dx = lon2 - lon1;
    float dy = lat2 - lat1;

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
    if (end - start < 3) return 0;

    ts[0] = 0.0f;
    ts[1] = 1.0f;
    int nTs = 2;

    return add_ring_crossings(lat1, lon1, lat2, lon2, verts, start, end, ts, nTs);
}

// True if (lat, lon) falls inside any inner ring (hole) of polygon polyIdx.
extern "C" __device__ int point_in_any_hole(
    const float* holeVerts,
    const int* holeRingOffsets,
    const int* polyHoleOffsets,
    int polyIdx,
    float lat,
    float lon
) {
    int hStart = polyHoleOffsets[polyIdx];
    int hEnd = polyHoleOffsets[polyIdx + 1];
    for (int h = hStart; h < hEnd; h++) {
        int start = holeRingOffsets[h];
        int end = holeRingOffsets[h + 1];
        int n = end - start;
        if (n < 3) continue;
        int inside = 0;
        int j = n - 1;
        for (int i = 0; i < n; i++) {
            int ii = start + i;
            int jj = start + j;
            float yi = holeVerts[ii * 2];
            float xi = holeVerts[ii * 2 + 1];
            float yj = holeVerts[jj * 2];
            float xj = holeVerts[jj * 2 + 1];
            if (((yi > lat) != (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi + 1.0e-12f) + xi)) {
                inside = !inside;
            }
            j = i;
        }
        if (inside) return 1;
    }
    return 0;
}

// Breakpoints from the outer ring AND every hole ring of polyIdx, so no
// sub-interval straddles a hole boundary. Mirrors the CPU
// segmentPolygonIntervalsWithHoles: callers attenuate a sub-interval only when
// its midpoint is inside the outer ring and not inside any hole.
extern "C" __device__ int segment_polygon_intervals_holes(
    float lat1,
    float lon1,
    float lat2,
    float lon2,
    int polyIdx,
    const float* verts,
    const int* offsets,
    const float* holeVerts,
    const int* holeRingOffsets,
    const int* polyHoleOffsets,
    float* ts
) {
    int nTs = segment_polygon_intervals(lat1, lon1, lat2, lon2, polyIdx, verts, offsets, ts);
    if (nTs < 2) return nTs;
    int hStart = polyHoleOffsets[polyIdx];
    int hEnd = polyHoleOffsets[polyIdx + 1];
    for (int h = hStart; h < hEnd && nTs < (MAX_TS - 1); h++) {
        int rs = holeRingOffsets[h];
        int re = holeRingOffsets[h + 1];
        nTs = add_ring_crossings(lat1, lon1, lat2, lon2, holeVerts, rs, re, ts, nTs);
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
    const float* fHoleVerts,
    const int* fHoleRingOffsets,
    const int* fPolyHoleOffsets,
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
            int nTs = segment_polygon_intervals_holes(lat1, lon1, lat2, lon2, pi, fVerts, fOffsets, fHoleVerts, fHoleRingOffsets, fPolyHoleOffsets, ts);
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
                if (point_in_any_hole(fHoleVerts, fHoleRingOffsets, fPolyHoleOffsets, pi, lat, lon)) continue;

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
    const float* bHoleVerts,
    const int* bHoleRingOffsets,
    const int* bPolyHoleOffsets,
    float reEff,
    int skipBuildingIndex
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
            if (pi == skipBuildingIndex) continue;
            int nTs = segment_polygon_intervals_holes(lat1, lon1, lat2, lon2, pi, bVerts, bOffsets, bHoleVerts, bHoleRingOffsets, bPolyHoleOffsets, ts);
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
                if (point_in_any_hole(bHoleVerts, bHoleRingOffsets, bPolyHoleOffsets, pi, lat, lon)) continue;

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

// Two-ray (direct + ground-reflected) interference gain (dB to add to free-space
// rxPower). Mirrors twoRayReflectionGainDb in src/propagation.js.
extern "C" __device__ float two_ray_reflection_gain_db(
    float dist, float txHeight, float rxHeight, float freqMHz, float reflectionCoeff
) {
    if (dist <= 0.0f || freqMHz <= 0.0f || reflectionCoeff <= 0.0f) return 0.0f;
    float ht = fmaxf(0.0f, txHeight);
    float hr = fmaxf(0.0f, rxHeight);
    float Rc = fminf(1.0f, fmaxf(0.0f, reflectionCoeff));
    float lambda = 299792458.0f / (freqMHz * 1000000.0f);
    float rDirect = sqrtf(dist * dist + (ht - hr) * (ht - hr));
    float rRefl = sqrtf(dist * dist + (ht + hr) * (ht + hr));
    float dPhi = 6.283185307179586f * (rRefl - rDirect) / lambda;
    float f2 = fmaxf(0.01f, 1.0f + Rc * Rc - 2.0f * Rc * cosf(dPhi));
    return 10.0f * log10f(f2);
}

// Six-ray urban corridor model: direct, ground, two side-wall rays, and two
// wall+ground rays. This mirrors sixRayReflectionGainDb in src/propagation.js.
extern "C" __device__ float six_ray_reflection_gain_db(
    float dist,
    float txHeight,
    float rxHeight,
    float freqMHz,
    float groundReflectionCoeff,
    float wallReflectionCoeff,
    float corridorWidthM
) {
    if (dist <= 0.0f || freqMHz <= 0.0f) return 0.0f;
    float ht = fmaxf(0.0f, txHeight);
    float hr = fmaxf(0.0f, rxHeight);
    float Rg = fminf(1.0f, fmaxf(0.0f, groundReflectionCoeff));
    float Rw = fminf(1.0f, fmaxf(0.0f, wallReflectionCoeff));
    if (Rg <= 0.0f && Rw <= 0.0f) return 0.0f;

    float width = fmaxf(1.0f, corridorWidthM);
    float lambda = 299792458.0f / (freqMHz * 1000000.0f);
    float k = 6.283185307179586f / lambda;
    float rDirect = sqrtf(dist * dist + (ht - hr) * (ht - hr));
    float rGround = sqrtf(dist * dist + (ht + hr) * (ht + hr));
    float rWall = sqrtf(dist * dist + width * width + (ht - hr) * (ht - hr));
    float rWallGround = sqrtf(dist * dist + width * width + (ht + hr) * (ht + hr));
    float real = 1.0f;
    float imag = 0.0f;
    float amp;
    float phase;

    amp = -Rg * rDirect / rGround;
    phase = -k * (rGround - rDirect);
    real += amp * cosf(phase);
    imag += amp * sinf(phase);

    amp = -Rw * rDirect / rWall;
    phase = -k * (rWall - rDirect);
    real += 2.0f * amp * cosf(phase);
    imag += 2.0f * amp * sinf(phase);

    amp = Rg * Rw * rDirect / rWallGround;
    phase = -k * (rWallGround - rDirect);
    real += 2.0f * amp * cosf(phase);
    imag += 2.0f * amp * sinf(phase);

    float powerRatio = fmaxf(0.001f, real * real + imag * imag);
    return 10.0f * log10f(powerRatio);
}

#define MAX_FACADE_RAYS 16

// Great-circle distance in metres. Mirrors haversine() in src/propagation.js;
// the facade tracer uses it for search-radius and extra-path budgets so the GPU
// keeps parity with traceBuildingFacadeRays.
extern "C" __device__ float haversine_m(float lat1, float lon1, float lat2, float lon2) {
    float deg = 0.017453292519943295f;
    float p1 = lat1 * deg;
    float p2 = lat2 * deg;
    float dphi = (lat2 - lat1) * deg;
    float dlam = (lon2 - lon1) * deg;
    float sdphi = sinf(dphi * 0.5f);
    float sdlam = sinf(dlam * 0.5f);
    float a = sdphi * sdphi + cosf(p1) * cosf(p2) * sdlam * sdlam;
    return 6371000.0f * 2.0f * atan2f(sqrtf(a), sqrtf(fmaxf(0.0f, 1.0f - a)));
}

// Voltage/field coefficient from a positive attenuation in dB (parity with
// _fieldCoeffFromLossDb in src/signalModel.js): 0 dB -> 1.0.
extern "C" __device__ float field_coeff_from_loss_db(float lossDb) {
    if (!(lossDb > 0.0f)) return 1.0f;
    return powf(10.0f, -lossDb / 20.0f);
}

// Add one phasor contribution to a coherent sum (parity with the loop in
// _coherentFieldGainDb): amplitude scales by referencePath/pathM, phase by the
// extra path length relative to the reference.
extern "C" __device__ void coherent_add(
    float* real, float* imag, float pathM, float coeff, float refPath, float lambda
) {
    if (pathM <= 0.0f || coeff == 0.0f) return;
    float amp = coeff * refPath / pathM;
    float phase = -6.283185307179586f * (pathM - refPath) / lambda;
    *real += amp * cosf(phase);
    *imag += amp * sinf(phase);
}

// Foliage + building attenuation (dB) along one straight leg between two
// endpoints, mirroring _legObstacleLossDb. skipBuildingIndex drops the reflecting
// building so its own facade is not double-counted as a blocker.
extern "C" __device__ float facade_leg_obstacle_loss(
    float startLat,
    float startLon,
    float startAbs,
    float endLat,
    float endLon,
    float endAbs,
    int skipBuildingIndex,
    float freqMHz,
    float profileTargetSpacingM,
    int profileMaxSamples,
    const float* elev,
    int elevRes,
    float latMin,
    float latMax,
    float lonMin,
    float lonMax,
    float reEff,
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
    const int* bPolyHoleOffsets
) {
    float mPerLat = 110574.0f;
    float mPerLon = 111320.0f * cosf(startLat * 0.017453292519943295f);
    float dLat = (endLat - startLat) * mPerLat;
    float dLon = (endLon - startLon) * mPerLon;
    float dist = sqrtf(dLat * dLat + dLon * dLon);
    if (!(dist > 1.0f)) return 0.0f;

    int samples = (int)ceilf(dist / fmaxf(1.0f, profileTargetSpacingM)) + 1;
    samples = max(16, min(profileMaxSamples, samples));

    float loss = 0.0f;
    if (useFoliage != 0 && foliageCount > 0) {
        loss += foliage_ray_loss(
            startLat, startLon, endLat, endLon,
            startAbs, endAbs, dist, samples, freqMHz,
            0, foliageLossPerM,
            elev, elevRes, latMin, latMax, lonMin, lonMax,
            fVerts, fOffsets, fBboxes, fCanopy, fFactors, foliageCount,
            fTileOffsets, fTileCounts, fTileIndices, foliageTileN,
            foliageTileLatMin, foliageTileLatSpan, foliageTileLonMin, foliageTileLonSpan,
            fHoleVerts, fHoleRingOffsets, fPolyHoleOffsets, reEff
        );
    }
    if (useBuildings != 0 && buildingCount > 0) {
        loss += building_ray_loss(
            startLat, startLon, endLat, endLon,
            startAbs, endAbs, dist, samples, buildingLossPerM,
            elev, elevRes, latMin, latMax, lonMin, lonMax,
            bVerts, bOffsets, bBboxes, bHeights, buildingCount,
            bTileOffsets, bTileCounts, bTileIndices, buildingTileN,
            buildingTileLatMin, buildingTileLatSpan, buildingTileLonMin, buildingTileLonSpan,
            bHoleVerts, bHoleRingOffsets, bPolyHoleOffsets, reEff, skipBuildingIndex
        );
    }
    return loss;
}

// First-order specular reflections off real building facades, summed coherently
// with the direct and ground-reflected rays. Mirrors the CPU pipeline of
// traceBuildingFacadeRays + _buildingFacadeMultipathGainDb in src/signalModel.js:
// buildings are finite vertical mirror planes, each facade ray is attenuated by
// the obstacle loss along its two legs, and everything is combined as a coherent
// phasor sum. Returns the gain (dB) to add to the free-space rxPower.
extern "C" __device__ float building_facade_multipath_gain_db(
    float txLat,
    float txLon,
    float txAbs,
    float txHeight,
    float rxLat,
    float rxLon,
    float rxAbs,
    float rxHeight,
    float distM,
    float freqMHz,
    float directObstacleLossDb,
    float groundReflectionCoeff,
    float wallReflectionCoeff,
    float profileTargetSpacingM,
    int profileMaxSamples,
    const float* elev,
    int elevRes,
    float latMin,
    float latMax,
    float lonMin,
    float lonMax,
    float reEff,
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
    const int* bPolyHoleOffsets
) {
    float lambda = 299792458.0f / (freqMHz * 1000000.0f);
    float dz = txAbs - rxAbs;
    float refPath = sqrtf(distM * distM + dz * dz);
    float directCoeff = field_coeff_from_loss_db(directObstacleLossDb);

    float real = 0.0f;
    float imag = 0.0f;
    coherent_add(&real, &imag, refPath, directCoeff, refPath, lambda);

    float groundR = fminf(1.0f, fmaxf(0.0f, groundReflectionCoeff));
    if (groundR > 0.0f) {
        float hSum = txHeight + rxHeight;
        float groundPath = sqrtf(distM * distM + hSum * hSum);
        coherent_add(&real, &imag, groundPath, -groundR * directCoeff, refPath, lambda);
    }

    float wallR = fminf(1.0f, fmaxf(0.0f, wallReflectionCoeff));
    if (wallR > 0.0f && buildingCount > 0) {
        float directHoriz = haversine_m(txLat, txLon, rxLat, rxLon);
        if (directHoriz > 0.0f) {
            float searchRadius = fminf(250.0f, fmaxf(50.0f, directHoriz * 0.2f));
            float extraPathLimit = fminf(600.0f, fmaxf(80.0f, directHoriz * 0.35f));
            float lat0 = (txLat + rxLat) * 0.5f;
            float lon0 = (txLon + rxLon) * 0.5f;
            float cosLat = fmaxf(0.05f, fabsf(cosf(lat0 * 0.017453292519943295f)));
            float mPerLat = 111320.0f;
            float mPerLon = 111320.0f * cosLat;
            float txX = (txLon - lon0) * mPerLon;
            float txY = (txLat - lat0) * mPerLat;
            float rxX = (rxLon - lon0) * mPerLon;
            float rxY = (rxLat - lat0) * mPerLat;
            float inflateLat = searchRadius / 111320.0f;
            float inflateLon = searchRadius / (111320.0f * cosLat);
            float qLatMin = fminf(txLat, rxLat) - inflateLat;
            float qLatMax = fmaxf(txLat, rxLat) + inflateLat;
            float qLonMin = fminf(txLon, rxLon) - inflateLon;
            float qLonMax = fmaxf(txLon, rxLon) + inflateLon;

            int candidates[MAX_CANDIDATES];
            int nCand = gather_candidates(
                qLatMin, qLonMin, qLatMax, qLonMax,
                bBboxes, buildingCount,
                bTileOffsets, bTileCounts, bTileIndices,
                buildingTileN,
                buildingTileLatMin, buildingTileLatSpan,
                buildingTileLonMin, buildingTileLonSpan,
                candidates
            );

            float rPath[MAX_FACADE_RAYS];
            float rLat[MAX_FACADE_RAYS];
            float rLon[MAX_FACADE_RAYS];
            float rRefAbs[MAX_FACADE_RAYS];
            int rBidx[MAX_FACADE_RAYS];
            int rCount = 0;

            for (int ci = 0; ci < nCand; ci++) {
                int pi = candidates[ci];
                int start = bOffsets[pi];
                int end = bOffsets[pi + 1];
                int np = end - start;
                if (np < 3) continue;
                float heightM = bHeights[pi];
                if (!(heightM > 0.0f)) continue;

                for (int e = 0; e < np; e++) {
                    int ia = start + e;
                    int ib = start + ((e + 1) % np);
                    float ay = bVerts[ia * 2];
                    float ax = (bVerts[ia * 2 + 1] - lon0) * mPerLon;
                    float by = bVerts[ib * 2];
                    float bx = (bVerts[ib * 2 + 1] - lon0) * mPerLon;
                    float aYloc = (ay - lat0) * mPerLat;
                    float bYloc = (by - lat0) * mPerLat;
                    float wx = bx - ax;
                    float wy = bYloc - aYloc;
                    float wallLen = sqrtf(wx * wx + wy * wy);
                    if (wallLen < 3.0f) continue;

                    float sideTx = wx * (txY - aYloc) - wy * (txX - ax);
                    float sideRx = wx * (rxY - aYloc) - wy * (rxX - ax);
                    if (sideTx * sideRx < 0.0f) continue;

                    float len2 = wx * wx + wy * wy;
                    float tproj = ((rxX - ax) * wx + (rxY - aYloc) * wy) / len2;
                    float projx = ax + wx * tproj;
                    float projy = aYloc + wy * tproj;
                    float imgx = 2.0f * projx - rxX;
                    float imgy = 2.0f * projy - rxY;

                    float rX = imgx - txX;
                    float rY = imgy - txY;
                    float denom = rX * wy - rY * wx;
                    if (fabsf(denom) < 1.0e-9f) continue;
                    float apx = ax - txX;
                    float apy = aYloc - txY;
                    float t = (apx * wy - apy * wx) / denom;
                    float u = (apx * rY - apy * rX) / denom;
                    if (t <= 1.0e-6f || t >= 1.0f - 1.0e-6f || u <= 1.0e-6f || u >= 1.0f - 1.0e-6f) continue;

                    float refx = txX + (imgx - txX) * t;
                    float refy = txY + (imgy - txY) * t;
                    float leg1 = sqrtf((refx - txX) * (refx - txX) + (refy - txY) * (refy - txY));
                    float leg2 = sqrtf((rxX - refx) * (rxX - refx) + (rxY - refy) * (rxY - refy));
                    float horizPath = leg1 + leg2;
                    if (horizPath - directHoriz > extraPathLimit) continue;

                    float tPath = horizPath > 0.0f ? leg1 / horizPath : 0.0f;
                    float refAbs = txAbs + (rxAbs - txAbs) * tPath;
                    float refLat = lat0 + refy / mPerLat;
                    float refLon = lon0 + refx / mPerLon;
                    float refGround = bilinear_elev(refLat, refLon, elev, elevRes, latMin, latMax, lonMin, lonMax);
                    if (refAbs < refGround) continue;
                    if (refAbs > refGround + heightM) continue;

                    float dz1 = refAbs - txAbs;
                    float dz2 = rxAbs - refAbs;
                    float pathM = sqrtf(leg1 * leg1 + dz1 * dz1) + sqrtf(leg2 * leg2 + dz2 * dz2);

                    // Keep the MAX_FACADE_RAYS shortest paths, ascending (parity
                    // with rays.sort(pathM).slice(0, maxRays)).
                    if (rCount < MAX_FACADE_RAYS) {
                        int pos = rCount;
                        while (pos > 0 && rPath[pos - 1] > pathM) {
                            rPath[pos] = rPath[pos - 1];
                            rLat[pos] = rLat[pos - 1];
                            rLon[pos] = rLon[pos - 1];
                            rRefAbs[pos] = rRefAbs[pos - 1];
                            rBidx[pos] = rBidx[pos - 1];
                            pos--;
                        }
                        rPath[pos] = pathM;
                        rLat[pos] = refLat;
                        rLon[pos] = refLon;
                        rRefAbs[pos] = refAbs;
                        rBidx[pos] = pi;
                        rCount++;
                    } else if (pathM < rPath[MAX_FACADE_RAYS - 1]) {
                        int pos = MAX_FACADE_RAYS - 1;
                        while (pos > 0 && rPath[pos - 1] > pathM) {
                            rPath[pos] = rPath[pos - 1];
                            rLat[pos] = rLat[pos - 1];
                            rLon[pos] = rLon[pos - 1];
                            rRefAbs[pos] = rRefAbs[pos - 1];
                            rBidx[pos] = rBidx[pos - 1];
                            pos--;
                        }
                        rPath[pos] = pathM;
                        rLat[pos] = refLat;
                        rLon[pos] = refLon;
                        rRefAbs[pos] = refAbs;
                        rBidx[pos] = pi;
                    }
                }
            }

            for (int i = 0; i < rCount; i++) {
                float legLoss =
                    facade_leg_obstacle_loss(
                        txLat, txLon, txAbs, rLat[i], rLon[i], rRefAbs[i], rBidx[i],
                        freqMHz, profileTargetSpacingM, profileMaxSamples,
                        elev, elevRes, latMin, latMax, lonMin, lonMax, reEff,
                        useFoliage, foliageLossPerM,
                        fVerts, fOffsets, fBboxes, fCanopy, fFactors, foliageCount,
                        fTileOffsets, fTileCounts, fTileIndices, foliageTileN,
                        foliageTileLatMin, foliageTileLatSpan, foliageTileLonMin, foliageTileLonSpan,
                        fHoleVerts, fHoleRingOffsets, fPolyHoleOffsets,
                        useBuildings, buildingLossPerM,
                        bVerts, bOffsets, bBboxes, bHeights, buildingCount,
                        bTileOffsets, bTileCounts, bTileIndices, buildingTileN,
                        buildingTileLatMin, buildingTileLatSpan, buildingTileLonMin, buildingTileLonSpan,
                        bHoleVerts, bHoleRingOffsets, bPolyHoleOffsets
                    )
                    + facade_leg_obstacle_loss(
                        rLat[i], rLon[i], rRefAbs[i], rxLat, rxLon, rxAbs, rBidx[i],
                        freqMHz, profileTargetSpacingM, profileMaxSamples,
                        elev, elevRes, latMin, latMax, lonMin, lonMax, reEff,
                        useFoliage, foliageLossPerM,
                        fVerts, fOffsets, fBboxes, fCanopy, fFactors, foliageCount,
                        fTileOffsets, fTileCounts, fTileIndices, foliageTileN,
                        foliageTileLatMin, foliageTileLatSpan, foliageTileLonMin, foliageTileLonSpan,
                        fHoleVerts, fHoleRingOffsets, fPolyHoleOffsets,
                        useBuildings, buildingLossPerM,
                        bVerts, bOffsets, bBboxes, bHeights, buildingCount,
                        bTileOffsets, bTileCounts, bTileIndices, buildingTileN,
                        buildingTileLatMin, buildingTileLatSpan, buildingTileLonMin, buildingTileLonSpan,
                        bHoleVerts, bHoleRingOffsets, bPolyHoleOffsets
                    );
                coherent_add(&real, &imag, rPath[i], -wallR * field_coeff_from_loss_db(legLoss), refPath, lambda);
            }
        }
    }

    float powerRatio = fmaxf(0.0001f, real * real + imag * imag);
    return 10.0f * log10f(powerRatio);
}

extern "C" __global__
void coverage_kernel(
    const float* elev,
    unsigned char* rgba,
    float* signals,
    float* losOut,
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
    int reflectionModel,
    float reflectionCoeff,
    float sideReflectionCoeff,
    float reflectionCorridorWidthM
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
    // Per-pixel LoS clearance ratio (NaN = no LoS data: beyond radius / LoS off).
    float losVal = nanf("");

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

        // Direct-path clutter loss. In facade mode this is folded into the
        // coherent reflection sum (directObstacleLossHandledByReflection); on all
        // other paths it is subtracted from sig below.
        float directFoliageLoss = (useFoliage != 0 && foliageCount > 0 && dist > 50.0f)
            ? foliage_ray_loss(
                txLat, txLon, ptLat, ptLon, txAbs, rxAbs, dist, samples, freqMHz,
                useWeissberger, foliageLossPerM,
                elev, elevRes, latMin, latMax, lonMin, lonMax,
                fVerts, fOffsets, fBboxes, fCanopy, fFactors, foliageCount,
                fTileOffsets, fTileCounts, fTileIndices, foliageTileN,
                foliageTileLatMin, foliageTileLatSpan, foliageTileLonMin, foliageTileLonSpan,
                fHoleVerts, fHoleRingOffsets, fPolyHoleOffsets, reEff)
            : 0.0f;
        float directBuildingLoss = (useBuildings != 0 && buildingCount > 0 && dist > 50.0f)
            ? building_ray_loss(
                txLat, txLon, ptLat, ptLon, txAbs, rxAbs, dist, samples, buildingLossPerM,
                elev, elevRes, latMin, latMax, lonMin, lonMax,
                bVerts, bOffsets, bBboxes, bHeights, buildingCount,
                bTileOffsets, bTileCounts, bTileIndices, buildingTileN,
                buildingTileLatMin, buildingTileLatSpan, buildingTileLonMin, buildingTileLonSpan,
                bHoleVerts, bHoleRingOffsets, bPolyHoleOffsets, reEff, -1)
            : 0.0f;
        int facadeHandledDirect = 0;

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
            losVal = minFresnelRatio;

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

            // Ground reflection (2-ray) only on clear (geometric-LoS) paths.
            if (useGroundReflection != 0 && maxV < 0.0f) {
                if (reflectionModel == 3) {
                    sig += building_facade_multipath_gain_db(
                        txLat, txLon, txAbs, txHeight,
                        ptLat, ptLon, rxAbs, rxHeight,
                        dist, freqMHz,
                        directFoliageLoss + directBuildingLoss,
                        reflectionCoeff, sideReflectionCoeff,
                        profileTargetSpacingM, profileMaxSamples,
                        elev, elevRes, latMin, latMax, lonMin, lonMax, reEff,
                        useFoliage, foliageLossPerM,
                        fVerts, fOffsets, fBboxes, fCanopy, fFactors, foliageCount,
                        fTileOffsets, fTileCounts, fTileIndices, foliageTileN,
                        foliageTileLatMin, foliageTileLatSpan, foliageTileLonMin, foliageTileLonSpan,
                        fHoleVerts, fHoleRingOffsets, fPolyHoleOffsets,
                        useBuildings, buildingLossPerM,
                        bVerts, bOffsets, bBboxes, bHeights, buildingCount,
                        bTileOffsets, bTileCounts, bTileIndices, buildingTileN,
                        buildingTileLatMin, buildingTileLatSpan, buildingTileLonMin, buildingTileLonSpan,
                        bHoleVerts, bHoleRingOffsets, bPolyHoleOffsets
                    );
                    facadeHandledDirect = 1;
                } else if (reflectionModel == 2) {
                    sig += six_ray_reflection_gain_db(
                        dist,
                        txHeight,
                        rxHeight,
                        freqMHz,
                        reflectionCoeff,
                        sideReflectionCoeff,
                        reflectionCorridorWidthM
                    );
                } else {
                    sig += two_ray_reflection_gain_db(dist, txHeight, rxHeight, freqMHz, reflectionCoeff);
                }
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

        // 10) Clutter attenuation (foliage/buildings/walls). In facade mode the
        // direct-path clutter loss is already folded into the coherent reflection
        // sum above, so it must not be subtracted twice.
        if (facadeHandledDirect == 0) {
            sig -= directFoliageLoss + directBuildingLoss;
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
    signals[pix] = sig;
    losOut[pix] = losVal;
    rgba[base] = r;
    rgba[base + 1] = g;
    rgba[base + 2] = b;
    rgba[base + 3] = a;
}
'''
