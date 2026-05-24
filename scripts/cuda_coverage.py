import argparse
import json
import math
import time


KERNEL = r'''
extern "C" __device__ int point_in_poly(const float* verts, const int* offsets, int polyIdx, float lat, float lon) {
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

extern "C" __device__ float foliage_local_loss(
    float ptLat, float ptLon,
    float foliageLossPerM,
    const float* fVerts, const int* fOffsets, const float* fBboxes,
    const float* fCanopy, const float* fFactors,
    int foliageCount,
    const int* fTileOffsets, const int* fTileCounts, const int* fTileIndices,
    int foliageTileN,
    float foliageTileLatMin, float foliageTileLatSpan,
    float foliageTileLonMin, float foliageTileLonSpan
) {
    if (foliageCount <= 0) return 0.0f;

    int off = 0;
    int cnt = foliageCount;
    if (foliageTileN > 0) {
        float rf = (ptLat - foliageTileLatMin) / fmaxf(1.0e-9f, foliageTileLatSpan) * (float)foliageTileN;
        float cf = (ptLon - foliageTileLonMin) / fmaxf(1.0e-9f, foliageTileLonSpan) * (float)foliageTileN;
        int r = min(foliageTileN - 1, max(0, (int)floorf(rf)));
        int c = min(foliageTileN - 1, max(0, (int)floorf(cf)));
        int cell = r * foliageTileN + c;
        off = fTileOffsets[cell];
        cnt = fTileCounts[cell];
    }

    float loss = 0.0f;
    for (int k = 0; k < cnt; k++) {
        int pi = (foliageTileN > 0) ? fTileIndices[off + k] : (off + k);
        if (pi < 0 || pi >= foliageCount) continue;

        int bb = pi * 4;
        float latMin = fBboxes[bb];
        float latMax = fBboxes[bb + 1];
        float lonMin = fBboxes[bb + 2];
        float lonMax = fBboxes[bb + 3];
        if (ptLat < latMin || ptLat > latMax || ptLon < lonMin || ptLon > lonMax) continue;

        if (!point_in_poly(fVerts, fOffsets, pi, ptLat, ptLon)) continue;

        float canopy = fmaxf(0.0f, fCanopy[pi]);
        float factor = fmaxf(0.1f, fFactors[pi]);
        loss += foliageLossPerM * canopy * factor;
    }
    return loss;
}

extern "C" __device__ float building_local_loss(
    float ptLat, float ptLon,
    float buildingLossPerM,
    const float* bVerts, const int* bOffsets, const float* bBboxes,
    const float* bHeights,
    int buildingCount,
    const int* bTileOffsets, const int* bTileCounts, const int* bTileIndices,
    int buildingTileN,
    float buildingTileLatMin, float buildingTileLatSpan,
    float buildingTileLonMin, float buildingTileLonSpan
) {
    if (buildingCount <= 0) return 0.0f;

    int off = 0;
    int cnt = buildingCount;
    if (buildingTileN > 0) {
        float rf = (ptLat - buildingTileLatMin) / fmaxf(1.0e-9f, buildingTileLatSpan) * (float)buildingTileN;
        float cf = (ptLon - buildingTileLonMin) / fmaxf(1.0e-9f, buildingTileLonSpan) * (float)buildingTileN;
        int r = min(buildingTileN - 1, max(0, (int)floorf(rf)));
        int c = min(buildingTileN - 1, max(0, (int)floorf(cf)));
        int cell = r * buildingTileN + c;
        off = bTileOffsets[cell];
        cnt = bTileCounts[cell];
    }

    float loss = 0.0f;
    for (int k = 0; k < cnt; k++) {
        int pi = (buildingTileN > 0) ? bTileIndices[off + k] : (off + k);
        if (pi < 0 || pi >= buildingCount) continue;

        int bb = pi * 4;
        float latMin = bBboxes[bb];
        float latMax = bBboxes[bb + 1];
        float lonMin = bBboxes[bb + 2];
        float lonMax = bBboxes[bb + 3];
        if (ptLat < latMin || ptLat > latMax || ptLon < lonMin || ptLon > lonMax) continue;

        if (!point_in_poly(bVerts, bOffsets, pi, ptLat, ptLon)) continue;

        float h = fmaxf(0.0f, bHeights[pi]);
        loss += buildingLossPerM * h + 14.0f;
    }
    return loss;
}

extern "C" __global__
void coverage_kernel(
    const float* elev, unsigned char* rgba,
    int gridRes, int elevRes,
    float latMin, float latMax, float lonMin, float lonMax,
    float txLat, float txLon, float txElev, float txHeight,
    float txPower, float txGain, float freqMHz,
    float rxHeight, float effectiveSens, float radiusM,
    int useLos, float profileTargetSpacingM, int profileMaxSamples,
    int useFoliage, float foliageLossPerM,
    const float* fVerts, const int* fOffsets, const float* fBboxes,
    const float* fCanopy, const float* fFactors,
    int foliageCount,
    const int* fTileOffsets, const int* fTileCounts, const int* fTileIndices,
    int foliageTileN,
    float foliageTileLatMin, float foliageTileLatSpan, float foliageTileLonMin, float foliageTileLonSpan,
    int useBuildings, float buildingLossPerM,
    const float* bVerts, const int* bOffsets, const float* bBboxes,
    const float* bHeights,
    int buildingCount,
    const int* bTileOffsets, const int* bTileCounts, const int* bTileIndices,
    int buildingTileN,
    float buildingTileLatMin, float buildingTileLatSpan, float buildingTileLonMin, float buildingTileLonSpan
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
        float fsplBase = 20.0f * log10f(freqMHz * 1000000.0f) - 147.55f;
        sig = txPower + txGain - (20.0f * log10f(fmaxf(1.0f, dist)) + fsplBase);
        if (useLos != 0 && dist > 50.0f) {
            int samples = (int)ceilf(dist / fmaxf(1.0f, profileTargetSpacingM)) + 1;
            samples = max(16, min(profileMaxSamples, samples));
            float cF = (ptLon - lonMin) / fmaxf(1.0e-9f, lonMax - lonMin) * (float)(elevRes - 1);
            float rF = (latMax - ptLat) / fmaxf(1.0e-9f, latMax - latMin) * (float)(elevRes - 1);
            int c0 = min(elevRes - 2, max(0, (int)floorf(cF)));
            int r0 = min(elevRes - 2, max(0, (int)floorf(rF)));
            float tc = cF - (float)c0;
            float tr = rF - (float)r0;
            float e00 = elev[r0 * elevRes + c0];
            float e10 = elev[r0 * elevRes + c0 + 1];
            float e01 = elev[(r0 + 1) * elevRes + c0];
            float e11 = elev[(r0 + 1) * elevRes + c0 + 1];
            float rxGround = e00*(1.0f-tc)*(1.0f-tr) + e10*tc*(1.0f-tr) + e01*(1.0f-tc)*tr + e11*tc*tr;

            float txAbs = txElev + txHeight;
            float rxAbs = rxGround + rxHeight;
            float lambda = 299792458.0f / (freqMHz * 1000000.0f);
            float reEff = 6371000.0f * 1.3333333333333333f;
            float maxV = -1.0e9f;
            for (int i = 1; i < samples - 1; i++) {
                float frac = (float)i / (float)(samples - 1);
                float lat = txLat + (ptLat - txLat) * frac;
                float lon = txLon + (ptLon - txLon) * frac;
                cF = (lon - lonMin) / fmaxf(1.0e-9f, lonMax - lonMin) * (float)(elevRes - 1);
                rF = (latMax - lat) / fmaxf(1.0e-9f, latMax - latMin) * (float)(elevRes - 1);
                c0 = min(elevRes - 2, max(0, (int)floorf(cF)));
                r0 = min(elevRes - 2, max(0, (int)floorf(rF)));
                tc = cF - (float)c0;
                tr = rF - (float)r0;
                e00 = elev[r0 * elevRes + c0];
                e10 = elev[r0 * elevRes + c0 + 1];
                e01 = elev[(r0 + 1) * elevRes + c0];
                e11 = elev[(r0 + 1) * elevRes + c0 + 1];
                float terrain = e00*(1.0f-tc)*(1.0f-tr) + e10*tc*(1.0f-tr) + e01*(1.0f-tc)*tr + e11*tc*tr;
                float d1 = frac * dist;
                float d2 = dist - d1;
                float lineH = txAbs + (rxAbs - txAbs) * frac;
                float bulge = d1 * d2 / (2.0f * reEff);
                float denom = lambda * d1 * d2;
                if (denom > 1.0e-30f) {
                    float v = (terrain + bulge - lineH) * sqrtf(2.0f * dist / denom);
                    maxV = fmaxf(maxV, v);
                }
            }
            if (maxV >= -0.7f) {
                float loss = 6.9f + 20.0f * log10f(sqrtf((maxV - 0.1f) * (maxV - 0.1f) + 1.0f) + maxV - 0.1f);
                loss = fmaxf(0.0f, loss);
                sig -= loss;
                if (loss > 60.0f) sig = fminf(sig, effectiveSens - 10.0f);
            }
        }

        if (useFoliage != 0 && foliageCount > 0) {
            sig -= foliage_local_loss(
                ptLat, ptLon,
                foliageLossPerM,
                fVerts, fOffsets, fBboxes,
                fCanopy, fFactors,
                foliageCount,
                fTileOffsets, fTileCounts, fTileIndices,
                foliageTileN,
                foliageTileLatMin, foliageTileLatSpan,
                foliageTileLonMin, foliageTileLonSpan
            );
        }

        if (useBuildings != 0 && buildingCount > 0) {
            sig -= building_local_loss(
                ptLat, ptLon,
                buildingLossPerM,
                bVerts, bOffsets, bBboxes,
                bHeights,
                buildingCount,
                bTileOffsets, bTileCounts, bTileIndices,
                buildingTileN,
                buildingTileLatMin, buildingTileLatSpan,
                buildingTileLonMin, buildingTileLonSpan
            );
        }
    }

    unsigned char r, g, b, a;
    if (isnan(sig) || sig < effectiveSens) {
        r = 70; g = 0; b = 0; a = 70;
    } else {
        float t = fminf(1.0f, fmaxf(0.0f, (sig - effectiveSens) / 50.0f));
        float r0, g0, b0, a0, r1, g1, b1, a1, u;
        if (t > 0.75f) {
            r0 = 80; g0 = 210; b0 = 30; a0 = 165; r1 = 0; g1 = 200; b1 = 90; a1 = 180; u = (t - 0.75f) / 0.25f;
        } else if (t > 0.5f) {
            r0 = 230; g0 = 220; b0 = 0; a0 = 155; r1 = 80; g1 = 210; b1 = 30; a1 = 165; u = (t - 0.5f) / 0.25f;
        } else if (t > 0.25f) {
            r0 = 255; g0 = 160; b0 = 0; a0 = 145; r1 = 230; g1 = 220; b1 = 0; a1 = 155; u = (t - 0.25f) / 0.25f;
        } else {
            r0 = 220; g0 = 40; b0 = 0; a0 = 120; r1 = 255; g1 = 160; b1 = 0; a1 = 145; u = t / 0.25f;
        }
        r = (unsigned char)roundf(r0 + (r1 - r0) * u);
        g = (unsigned char)roundf(g0 + (g1 - g0) * u);
        b = (unsigned char)roundf(b0 + (b1 - b0) * u);
        a = (unsigned char)roundf(a0 + (a1 - a0) * u);
    }
    int base = pix * 4;
    rgba[base] = r; rgba[base + 1] = g; rgba[base + 2] = b; rgba[base + 3] = a;
}
'''


def _json(obj):
    print(json.dumps(obj), flush=True)


def _empty_obstacles(with_factors=False):
    out = {
        "verts": [0.0, 0.0],
        "offsets": [0, 0],
        "bboxes": [0.0, 0.0, 0.0, 0.0],
        "heights": [0.0],
        "tile_offsets": [0],
        "tile_counts": [0],
        "tile_indices": [0],
        "tile_n": 0,
        "tile_lat_min": 0.0,
        "tile_lat_span": 1.0,
        "tile_lon_min": 0.0,
        "tile_lon_span": 1.0,
        "count": 0,
    }
    if with_factors:
        out["factors"] = [1.0]
    return out


def _bbox_from_poly(poly):
    if not poly:
        return [0.0, 0.0, 0.0, 0.0]
    lats = [float(p[0]) for p in poly]
    lons = [float(p[1]) for p in poly]
    return [min(lats), max(lats), min(lons), max(lons)]


def _pack_obstacles(payload, with_factors=False):
    if not payload:
        return _empty_obstacles(with_factors)

    polygons = payload.get("polygons") or []
    count = len(polygons)
    if count == 0:
        return _empty_obstacles(with_factors)

    offsets = [0] * (count + 1)
    verts = []
    for i, poly in enumerate(polygons):
        offsets[i] = len(verts) // 2
        for pt in poly:
            verts.append(float(pt[0]))
            verts.append(float(pt[1]))
    offsets[count] = len(verts) // 2

    bboxes_payload = payload.get("bboxes") or []
    bboxes = []
    for i in range(count):
        if i < len(bboxes_payload) and len(bboxes_payload[i]) >= 4:
            bb = bboxes_payload[i]
            bboxes.extend([float(bb[0]), float(bb[1]), float(bb[2]), float(bb[3])])
        else:
            bboxes.extend(_bbox_from_poly(polygons[i]))

    if with_factors:
        heights = [float(v) for v in (payload.get("canopyHeights") or [])]
        factors = [float(v) for v in (payload.get("factors") or [])]
        if len(heights) < count:
            heights.extend([10.0] * (count - len(heights)))
        if len(factors) < count:
            factors.extend([1.0] * (count - len(factors)))
    else:
        heights = [float(v) for v in (payload.get("heights") or [])]
        if len(heights) < count:
            heights.extend([5.0] * (count - len(heights)))
        factors = None

    tile_index = payload.get("tileIndex") or {}
    tiles = tile_index.get("tiles") or []
    tile_count = len(tiles)
    tile_n = int(round(math.sqrt(tile_count))) if tile_count > 0 else 0

    tile_offsets = []
    tile_counts = []
    tile_indices = []

    if tile_n > 0 and tile_n * tile_n == tile_count:
        for cell in tiles:
            vals = []
            for idx in (cell or []):
                try:
                    pi = int(idx)
                except Exception:
                    continue
                if 0 <= pi < count:
                    vals.append(pi)
            tile_offsets.append(len(tile_indices))
            tile_counts.append(len(vals))
            tile_indices.extend(vals)

        tile_lat_min = float(tile_index.get("latMin") or min(bboxes[0::4]))
        tile_lon_min = float(tile_index.get("lonMin") or min(bboxes[2::4]))
        tile_lat_span = float(tile_index.get("latSpan") or (max(bboxes[1::4]) - min(bboxes[0::4]) or 1.0))
        tile_lon_span = float(tile_index.get("lonSpan") or (max(bboxes[3::4]) - min(bboxes[2::4]) or 1.0))
    else:
        tile_n = 1
        tile_offsets = [0]
        tile_counts = [count]
        tile_indices = list(range(count))
        tile_lat_min = float(min(bboxes[0::4]))
        tile_lon_min = float(min(bboxes[2::4]))
        tile_lat_span = float(max(bboxes[1::4]) - min(bboxes[0::4]) or 1.0)
        tile_lon_span = float(max(bboxes[3::4]) - min(bboxes[2::4]) or 1.0)

    out = {
        "verts": verts if verts else [0.0, 0.0],
        "offsets": offsets,
        "bboxes": bboxes if bboxes else [0.0, 0.0, 0.0, 0.0],
        "heights": heights if heights else [0.0],
        "tile_offsets": tile_offsets if tile_offsets else [0],
        "tile_counts": tile_counts if tile_counts else [0],
        "tile_indices": tile_indices if tile_indices else [0],
        "tile_n": tile_n,
        "tile_lat_min": tile_lat_min,
        "tile_lat_span": tile_lat_span,
        "tile_lon_min": tile_lon_min,
        "tile_lon_span": tile_lon_span,
        "count": count,
    }
    if with_factors:
        out["factors"] = factors if factors else [1.0]
    return out


def probe():
    try:
        import cupy as cp
        device = cp.cuda.Device()
        props = cp.cuda.runtime.getDeviceProperties(device.id)
        name = props.get("name", b"CUDA device")
        if isinstance(name, bytes):
            name = name.decode(errors="replace")
        _json({"available": True, "device": name, "backend": "cupy"})
    except Exception as exc:
        _json({"available": False, "reason": str(exc)})


def compute(params_path):
    try:
        import numpy as np
        import cupy as cp
    except Exception as exc:
        _json({"ok": False, "unsupported": True, "message": f"CuPy unavailable: {exc}"})
        return

    # Accept both UTF-8 and UTF-8-with-BOM parameter files.
    with open(params_path, "r", encoding="utf-8-sig") as fh:
        p = json.load(fh)

    t0 = time.perf_counter()
    elev = np.fromfile(p["gridPath"], dtype=np.float32)
    if elev.size != int(p["ELEV_RES"]) * int(p["ELEV_RES"]):
        _json({"ok": False, "error": "Elevation grid size mismatch"})
        return

    foliage = _pack_obstacles(p.get("foliage"), with_factors=True)
    buildings = _pack_obstacles(p.get("buildings"), with_factors=False)

    grid_res = int(p["gridRes"])
    elev_res = int(p["ELEV_RES"])
    rep = p["rep"]
    d_elev = cp.asarray(elev)
    d_rgba = cp.empty(grid_res * grid_res * 4, dtype=cp.uint8)

    d_f_verts = cp.asarray(np.asarray(foliage["verts"], dtype=np.float32))
    d_f_offsets = cp.asarray(np.asarray(foliage["offsets"], dtype=np.int32))
    d_f_bboxes = cp.asarray(np.asarray(foliage["bboxes"], dtype=np.float32))
    d_f_heights = cp.asarray(np.asarray(foliage["heights"], dtype=np.float32))
    d_f_factors = cp.asarray(np.asarray(foliage["factors"], dtype=np.float32))
    d_f_tile_offsets = cp.asarray(np.asarray(foliage["tile_offsets"], dtype=np.int32))
    d_f_tile_counts = cp.asarray(np.asarray(foliage["tile_counts"], dtype=np.int32))
    d_f_tile_indices = cp.asarray(np.asarray(foliage["tile_indices"], dtype=np.int32))

    d_b_verts = cp.asarray(np.asarray(buildings["verts"], dtype=np.float32))
    d_b_offsets = cp.asarray(np.asarray(buildings["offsets"], dtype=np.int32))
    d_b_bboxes = cp.asarray(np.asarray(buildings["bboxes"], dtype=np.float32))
    d_b_heights = cp.asarray(np.asarray(buildings["heights"], dtype=np.float32))
    d_b_tile_offsets = cp.asarray(np.asarray(buildings["tile_offsets"], dtype=np.int32))
    d_b_tile_counts = cp.asarray(np.asarray(buildings["tile_counts"], dtype=np.int32))
    d_b_tile_indices = cp.asarray(np.asarray(buildings["tile_indices"], dtype=np.int32))

    kernel = cp.RawKernel(KERNEL, "coverage_kernel")
    block = (16, 16)
    grid = (math.ceil(grid_res / block[0]), math.ceil(grid_res / block[1]))
    kernel(grid, block, (
        d_elev, d_rgba,
        np.int32(grid_res), np.int32(elev_res),
        np.float32(p["latMin"]), np.float32(p["latMax"]), np.float32(p["lonMin"]), np.float32(p["lonMax"]),
        np.float32(rep["lat"]), np.float32(rep["lon"]), np.float32(p["txElev"]), np.float32(rep["height"]),
        np.float32(rep["power"]), np.float32(rep.get("gain", 0)), np.float32(rep["freq"]),
        np.float32(p["rxHeight"]), np.float32(p["effectiveSens"]), np.float32(float(p["radiusKm"]) * 1000.0),
        np.int32(1 if p.get("useLos") else 0),
        np.float32(p.get("profileTargetSpacingM", 50)),
        np.int32(p.get("profileMaxSamples", 512)),
        np.int32(1 if p.get("useFoliage") else 0),
        np.float32(p.get("foliageLossPerM", 0.3)),
        d_f_verts, d_f_offsets, d_f_bboxes, d_f_heights, d_f_factors,
        np.int32(foliage["count"]),
        d_f_tile_offsets, d_f_tile_counts, d_f_tile_indices,
        np.int32(foliage["tile_n"]),
        np.float32(foliage["tile_lat_min"]), np.float32(foliage["tile_lat_span"]),
        np.float32(foliage["tile_lon_min"]), np.float32(foliage["tile_lon_span"]),
        np.int32(1 if p.get("useBuildings") else 0),
        np.float32(p.get("buildingLossPerM", 0.5)),
        d_b_verts, d_b_offsets, d_b_bboxes, d_b_heights,
        np.int32(buildings["count"]),
        d_b_tile_offsets, d_b_tile_counts, d_b_tile_indices,
        np.int32(buildings["tile_n"]),
        np.float32(buildings["tile_lat_min"]), np.float32(buildings["tile_lat_span"]),
        np.float32(buildings["tile_lon_min"]), np.float32(buildings["tile_lon_span"]),
    ))
    cp.cuda.Stream.null.synchronize()
    cp.asnumpy(d_rgba).tofile(p["outPath"])
    _json({
        "ok": True,
        "stats": {
            "workerCount": 0,
            "workerComputeMs": (time.perf_counter() - t0) * 1000.0,
            "insidePoints": grid_res * grid_res,
            "totalPoints": grid_res * grid_res,
            "cuda": True,
            "obstacles": bool(p.get("useFoliage") or p.get("useBuildings")),
        },
    })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--compute")
    args = parser.parse_args()
    if args.probe:
        probe()
    elif args.compute:
        compute(args.compute)
    else:
        parser.error("expected --probe or --compute")


if __name__ == "__main__":
    main()