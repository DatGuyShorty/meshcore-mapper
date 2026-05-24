// coverageGpu.wgsl — WebGPU compute shader for RF coverage analysis.
// One invocation per grid pixel. Fully parallel: LOS, diffraction, foliage, buildings.

struct Params {
    gridW: u32,
    gridH: u32,
    elevRes: u32,
    latMin: f32, latMax: f32, lonMin: f32, lonMax: f32,
    outLatMin: f32, outLatMax: f32, outLonMin: f32, outLonMax: f32,
    txLat: f32, txLon: f32, txElev: f32, txHeight: f32,
    txPower: f32, txGain: f32,
    rxHeight: f32, effectiveSens: f32, radiusM: f32,
    useLos: u32, useFresnel: u32,
    useFoliage: u32, foliageLossPerM: f32, foliageCount: u32,
    useBuildings: u32, buildingLossPerM: f32, buildingCount: u32,
    profileTargetSpacingM: f32, profileMinSamples: u32,
    mPerLat: f32, mPerLon: f32,
    reEff: f32,
    lambda: f32,
    fsplBase: f32,
    foliageTileN: u32,
    foliageTileLatMin: f32, foliageTileLatSpan: f32,
    foliageTileLonMin: f32, foliageTileLonSpan: f32,
    buildingTileN: u32,
    buildingTileLatMin: f32, buildingTileLatSpan: f32,
    buildingTileLonMin: f32, buildingTileLonSpan: f32,
};

@group(0) @binding(0) var<storage, read>     p:        Params;
@group(0) @binding(1) var<storage, read>     elevGrid: array<f32>;
@group(0) @binding(2) var<storage, read_write> signalOut: array<f32>;

// foliage: vertices [lat,lon,...], offsets (N+1), bboxes (N×4), canopyH (N), factors (N),
//          tile CSR: first tileN² u32s = offset into indices, next tileN² = count, then indices
@group(1) @binding(0) var<storage, read> fVerts:   array<f32>;
@group(1) @binding(1) var<storage, read> fOffsets: array<u32>;
@group(1) @binding(2) var<storage, read> fBboxes:  array<f32>;
@group(1) @binding(3) var<storage, read> fCanopyH: array<f32>;
@group(1) @binding(4) var<storage, read> fFactors: array<f32>;
@group(1) @binding(5) var<storage, read> fTile:    array<u32>;

// buildings: same layout (no factors, use heights instead)
@group(2) @binding(0) var<storage, read> bVerts:   array<f32>;
@group(2) @binding(1) var<storage, read> bOffsets: array<u32>;
@group(2) @binding(2) var<storage, read> bBboxes:  array<f32>;
@group(2) @binding(3) var<storage, read> bHeights: array<f32>;
@group(2) @binding(4) var<storage, read> bTile:    array<u32>;

// Per-invocation scratch (private memory).
// 256 polygon candidates per profile segment, 48 intersection t-values per polygon.
var<private> candidates: array<u32, 256>;
var<private> tsArr: array<f32, 48>;

// ── Helpers ──────────────────────────────────────────────────────────────────

fn bilinearElev(lat: f32, lon: f32) -> f32 {
    let res  = f32(p.elevRes);
    let lonSpan = max(1.0e-9, p.lonMax - p.lonMin);
    let latSpan = max(1.0e-9, p.latMax - p.latMin);
    let cF   = (lon - p.lonMin) / lonSpan * (res - 1.0);
    let rF   = (p.latMax - lat) / latSpan * (res - 1.0);
    let c0   = clamp(i32(floor(cF)), 0, i32(p.elevRes) - 2);
    let r0   = clamp(i32(floor(rF)), 0, i32(p.elevRes) - 2);
    let cf   = cF - f32(c0);
    let rf   = rF - f32(r0);
    let er   = p.elevRes;
    let v00  = elevGrid[u32(r0) * er + u32(c0)];
    let v01  = elevGrid[u32(r0) * er + u32(c0 + 1)];
    let v10  = elevGrid[u32(r0 + 1) * er + u32(c0)];
    let v11  = elevGrid[u32(r0 + 1) * er + u32(c0 + 1)];
    return v00*(1.0-cf)*(1.0-rf) + v01*cf*(1.0-rf) + v10*(1.0-cf)*rf + v11*cf*rf;
}

fn flatDistM(lat1: f32, lon1: f32, lat2: f32, lon2: f32) -> f32 {
    let dLat = (lat2 - lat1) * p.mPerLat;
    let dLon = (lon2 - lon1) * p.mPerLon;
    return sqrt(dLat*dLat + dLon*dLon);
}

fn profileN(distM: f32) -> u32 {
    let spacing = max(1.0, p.profileTargetSpacingM);
    let n = u32(ceil(distM / spacing)) + 1u;
    return clamp(n, p.profileMinSamples, 512u);
}

// ── LOS / diffraction (streaming — no stored profile) ────────────────────────

fn diffLossDb(txLat: f32, txLon: f32, txAbsH: f32,
              rxLat: f32, rxLon: f32, rxAbsH: f32,
              n: u32, dist: f32) -> f32 {
    var maxV = -1.0e9f;
    let nf = f32(n - 1u);
    for (var i = 1u; i < n - 1u; i++) {
        let frac  = f32(i) / nf;
        let lat   = txLat + (rxLat - txLat) * frac;
        let lon   = txLon + (rxLon - txLon) * frac;
        let elev  = bilinearElev(lat, lon);
        let d1    = frac * dist;
        let d2    = dist - d1;
        let lineH = txAbsH + (rxAbsH - txAbsH) * frac;
        let bulge = d1 * d2 / (2.0 * p.reEff);
        let denom = p.lambda * d1 * d2;
        var v = 0.0f;
        if (denom > 1e-30) {
            v = (elev + bulge - lineH) * sqrt(2.0 * dist / denom);
        }
        maxV = max(maxV, v);
    }
    if (maxV < -0.7) { return 0.0; }
    let loss = 6.9 + 20.0 * log(sqrt((maxV - 0.1)*(maxV - 0.1) + 1.0) + maxV - 0.1) / log(10.0);
    return max(0.0, loss);
}

// ── Polygon helpers ───────────────────────────────────────────────────────────

fn fPolyLatLon(polyIdx: u32, vertIdx: u32) -> vec2<f32> {
    let base = fOffsets[polyIdx] + vertIdx;
    return vec2<f32>(fVerts[base * 2u], fVerts[base * 2u + 1u]);
}
fn fPolyLen(polyIdx: u32) -> u32 {
    return fOffsets[polyIdx + 1u] - fOffsets[polyIdx];
}
fn bPolyLatLon(polyIdx: u32, vertIdx: u32) -> vec2<f32> {
    let base = bOffsets[polyIdx] + vertIdx;
    return vec2<f32>(bVerts[base * 2u], bVerts[base * 2u + 1u]);
}
fn bPolyLen(polyIdx: u32) -> u32 {
    return bOffsets[polyIdx + 1u] - bOffsets[polyIdx];
}

fn fPointInPoly(lat: f32, lon: f32, polyIdx: u32) -> bool {
    let plen = fPolyLen(polyIdx);
    var inside = false;
    var j = plen - 1u;
    for (var i = 0u; i < plen; i++) {
        let pi2 = fPolyLatLon(polyIdx, i);
        let pj  = fPolyLatLon(polyIdx, j);
        let yi  = pi2.x; let xi = pi2.y;
        let yj  = pj.x;  let xj = pj.y;
        if ((yi > lat) != (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }
    return inside;
}

fn bPointInPoly(lat: f32, lon: f32, polyIdx: u32) -> bool {
    let plen = bPolyLen(polyIdx);
    var inside = false;
    var j = plen - 1u;
    for (var i = 0u; i < plen; i++) {
        let pi2 = bPolyLatLon(polyIdx, i);
        let pj  = bPolyLatLon(polyIdx, j);
        let yi = pi2.x; let xi = pi2.y;
        let yj  = pj.x;  let xj = pj.y;
        if ((yi > lat) != (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }
    return inside;
}

// Returns number of intersection t-values (sorted) written into tsArr.
// tsArr is always pre-seeded with [0, 1].
fn fSegIntervals(lat1: f32, lon1: f32, lat2: f32, lon2: f32,
                 polyIdx: u32) -> u32 {
    let plen = fPolyLen(polyIdx);
    let dx = lon2 - lon1;
    let dy = lat2 - lat1;
    let EPS = 1.0e-9f;
    tsArr[0] = 0.0; tsArr[1] = 1.0;
    var nTs = 2u;
    var j = plen - 1u;
    for (var i = 0u; i < plen && nTs < 46u; i++) {
        let p3 = fPolyLatLon(polyIdx, j);
        let p4 = fPolyLatLon(polyIdx, i);
        let sx = p4.y - p3.y;
        let sy = p4.x - p3.x;
        let denom = dx * sy - dy * sx;
        if (abs(denom) >= EPS) {
            let qpx = p3.y - lon1;
            let qpy = p3.x - lat1;
            let t = (qpx * sy - qpy * sx) / denom;
            let u = (qpx * dy - qpy * dx) / denom;
            if (t > EPS && t < 1.0 - EPS && u >= -EPS && u <= 1.0 + EPS) {
                // Insert keeping sorted order (small array, insertion sort)
                var k = nTs;
                loop {
                    if (k == 0u || tsArr[k - 1u] <= t) { break; }
                    tsArr[k] = tsArr[k - 1u];
                    k -= 1u;
                }
                tsArr[k] = t;
                nTs += 1u;
            }
        }
        j = i;
    }
    return nTs;
}

fn bSegIntervals(lat1: f32, lon1: f32, lat2: f32, lon2: f32,
                 polyIdx: u32) -> u32 {
    let plen = bPolyLen(polyIdx);
    let dx = lon2 - lon1;
    let dy = lat2 - lat1;
    let EPS = 1.0e-9f;
    tsArr[0] = 0.0; tsArr[1] = 1.0;
    var nTs = 2u;
    var j = plen - 1u;
    for (var i = 0u; i < plen && nTs < 46u; i++) {
        let p3 = bPolyLatLon(polyIdx, j);
        let p4 = bPolyLatLon(polyIdx, i);
        let sx = p4.y - p3.y;
        let sy = p4.x - p3.x;
        let denom = dx * sy - dy * sx;
        if (abs(denom) >= EPS) {
            let qpx = p3.y - lon1;
            let qpy = p3.x - lat1;
            let t = (qpx * sy - qpy * sx) / denom;
            let u = (qpx * dy - qpy * dx) / denom;
            if (t > EPS && t < 1.0 - EPS && u >= -EPS && u <= 1.0 + EPS) {
                var k = nTs;
                loop {
                    if (k == 0u || tsArr[k - 1u] <= t) { break; }
                    tsArr[k] = tsArr[k - 1u];
                    k -= 1u;
                }
                tsArr[k] = t;
                nTs += 1u;
            }
        }
        j = i;
    }
    return nTs;
}

// Fill candidates[] with foliage polygons whose bbox overlaps [lat1..lat2]×[lon1..lon2].
// Returns candidate count.
fn fCandidates(lat1: f32, lon1: f32, lat2: f32, lon2: f32) -> u32 {
    let latLo = min(lat1, lat2); let latHi = max(lat1, lat2);
    let lonLo = min(lon1, lon2); let lonHi = max(lon1, lon2);
    let TN  = p.foliageTileN;
    let TNf = f32(TN);
    if (TN == 0u || p.foliageTileLatSpan <= 0.0 || p.foliageTileLonSpan <= 0.0) {
        let cnt = min(p.foliageCount, 256u);
        for (var i = 0u; i < cnt; i++) { candidates[i] = i; }
        return cnt;
    }
    let rMin = clamp(u32(floor((latLo - p.foliageTileLatMin) / p.foliageTileLatSpan * TNf)), 0u, TN - 1u);
    let rMax = clamp(u32(floor((latHi - p.foliageTileLatMin) / p.foliageTileLatSpan * TNf)), 0u, TN - 1u);
    let cMin = clamp(u32(floor((lonLo - p.foliageTileLonMin) / p.foliageTileLonSpan * TNf)), 0u, TN - 1u);
    let cMax = clamp(u32(floor((lonHi - p.foliageTileLonMin) / p.foliageTileLonSpan * TNf)), 0u, TN - 1u);
    var nCand = 0u;
    // simple dedup via linear search (small count expected)
    for (var r = rMin; r <= rMax && nCand < 248u; r++) {
        for (var c = cMin; c <= cMax && nCand < 248u; c++) {
            let cell   = r * TN + c;
            let off    = fTile[cell];
            let cnt    = fTile[TN * TN + cell];
            let indOff = TN * TN * 2u;
            for (var k = 0u; k < cnt && nCand < 248u; k++) {
                let pi = fTile[indOff + off + k];
                let bb4 = pi * 4u;
                let bLatMin = fBboxes[bb4];
                let bLatMax = fBboxes[bb4 + 1u];
                let bLonMin = fBboxes[bb4 + 2u];
                let bLonMax = fBboxes[bb4 + 3u];
                if (latHi < bLatMin || latLo > bLatMax || lonHi < bLonMin || lonLo > bLonMax) { continue; }
                // dedup
                var dup = false;
                for (var d = 0u; d < nCand; d++) { if (candidates[d] == pi) { dup = true; break; } }
                if (!dup) { candidates[nCand] = pi; nCand += 1u; }
            }
        }
    }
    return nCand;
}

fn bCandidates(lat1: f32, lon1: f32, lat2: f32, lon2: f32) -> u32 {
    let latLo = min(lat1, lat2); let latHi = max(lat1, lat2);
    let lonLo = min(lon1, lon2); let lonHi = max(lon1, lon2);
    let TN  = p.buildingTileN;
    let TNf = f32(TN);
    if (TN == 0u || p.buildingTileLatSpan <= 0.0 || p.buildingTileLonSpan <= 0.0) {
        let cnt = min(p.buildingCount, 256u);
        for (var i = 0u; i < cnt; i++) { candidates[i] = i; }
        return cnt;
    }
    let rMin = clamp(u32(floor((latLo - p.buildingTileLatMin) / p.buildingTileLatSpan * TNf)), 0u, TN - 1u);
    let rMax = clamp(u32(floor((latHi - p.buildingTileLatMin) / p.buildingTileLatSpan * TNf)), 0u, TN - 1u);
    let cMin = clamp(u32(floor((lonLo - p.buildingTileLonMin) / p.buildingTileLonSpan * TNf)), 0u, TN - 1u);
    let cMax = clamp(u32(floor((lonHi - p.buildingTileLonMin) / p.buildingTileLonSpan * TNf)), 0u, TN - 1u);
    var nCand = 0u;
    for (var r = rMin; r <= rMax && nCand < 248u; r++) {
        for (var c = cMin; c <= cMax && nCand < 248u; c++) {
            let cell   = r * TN + c;
            let off    = bTile[cell];
            let cnt    = bTile[TN * TN + cell];
            let indOff = TN * TN * 2u;
            for (var k = 0u; k < cnt && nCand < 248u; k++) {
                let pi = bTile[indOff + off + k];
                let bb4 = pi * 4u;
                let bLatMin = bBboxes[bb4];
                let bLatMax = bBboxes[bb4 + 1u];
                let bLonMin = bBboxes[bb4 + 2u];
                let bLonMax = bBboxes[bb4 + 3u];
                if (latHi < bLatMin || latLo > bLatMax || lonHi < bLonMin || lonLo > bLonMax) { continue; }
                var dup = false;
                for (var d = 0u; d < nCand; d++) { if (candidates[d] == pi) { dup = true; break; } }
                if (!dup) { candidates[nCand] = pi; nCand += 1u; }
            }
        }
    }
    return nCand;
}

// ── Foliage loss (streaming profile segments) ─────────────────────────────────

fn foliageLoss(txLat: f32, txLon: f32, txAbsH: f32,
               rxLat: f32, rxLon: f32, rxAbsH: f32,
               n: u32, dist: f32) -> f32 {
    if (p.foliageCount == 0u) { return 0.0; }
    let nf     = f32(n - 1u);
    let segLen = dist / nf;
    var loss   = 0.0f;
    for (var si = 0u; si < n - 1u; si++) {
        let f1 = f32(si)       / nf;
        let f2 = f32(si + 1u)  / nf;
        let lat1 = txLat + (rxLat - txLat) * f1;
        let lon1 = txLon + (rxLon - txLon) * f1;
        let lat2 = txLat + (rxLat - txLat) * f2;
        let lon2 = txLon + (rxLon - txLon) * f2;
        let nCand = fCandidates(lat1, lon1, lat2, lon2);
        for (var ci = 0u; ci < nCand; ci++) {
            let pi  = candidates[ci];
            let nTs = fSegIntervals(lat1, lon1, lat2, lon2, pi);
            for (var k = 0u; k + 1u < nTs; k++) {
                let a = tsArr[k];
                let b = tsArr[k + 1u];
                let EPS = 1.0e-6f;
                if (b - a < EPS) { continue; }
                let fmid = f1 + (f2 - f1) * ((a + b) * 0.5);
                let tmid = fmid;
                let lat  = txLat + (rxLat - txLat) * tmid;
                let lon  = txLon + (rxLon - txLon) * tmid;
                if (!fPointInPoly(lat, lon, pi)) { continue; }
                let rayAbsH = txAbsH + (rxAbsH - txAbsH) * tmid;
                let tElev   = bilinearElev(lat, lon);
                let d1 = tmid * dist;
                let d2 = dist - d1;
                let bulge = d1 * d2 / (2.0 * p.reEff);
                let canopyTop = tElev + bulge + fCanopyH[pi];
                if (rayAbsH <= canopyTop) {
                    loss += segLen * (b - a) * p.foliageLossPerM * fFactors[pi];
                }
            }
        }
    }
    return loss;
}

// ── Building loss (streaming) ─────────────────────────────────────────────────

fn buildingLoss(txLat: f32, txLon: f32, txAbsH: f32,
                rxLat: f32, rxLon: f32, rxAbsH: f32,
                n: u32, dist: f32) -> f32 {
    if (p.buildingCount == 0u) { return 0.0; }
    let WALL_DB = 14.0f;
    let nf     = f32(n - 1u);
    let segLen = dist / nf;
    var loss   = 0.0f;
    for (var si = 0u; si < n - 1u; si++) {
        let f1 = f32(si)       / nf;
        let f2 = f32(si + 1u)  / nf;
        let lat1 = txLat + (rxLat - txLat) * f1;
        let lon1 = txLon + (rxLon - txLon) * f1;
        let lat2 = txLat + (rxLat - txLat) * f2;
        let lon2 = txLon + (rxLon - txLon) * f2;
        let nCand = bCandidates(lat1, lon1, lat2, lon2);
        for (var ci = 0u; ci < nCand; ci++) {
            let pi  = candidates[ci];
            let nTs = bSegIntervals(lat1, lon1, lat2, lon2, pi);
            for (var k = 0u; k + 1u < nTs; k++) {
                let a = tsArr[k];
                let b = tsArr[k + 1u];
                let EPS = 1.0e-6f;
                if (b - a < EPS) { continue; }
                let fmid = f1 + (f2 - f1) * ((a + b) * 0.5);
                let tmid = fmid;
                let lat  = txLat + (rxLat - txLat) * tmid;
                let lon  = txLon + (rxLon - txLon) * tmid;
                if (!bPointInPoly(lat, lon, pi)) { continue; }
                let rayAbsH = txAbsH + (rxAbsH - txAbsH) * tmid;
                let tElev   = bilinearElev(lat, lon);
                let d1 = tmid * dist;
                let d2 = dist - d1;
                let bulge = d1 * d2 / (2.0 * p.reEff);
                let roofElev = tElev + bulge + bHeights[pi];
                if (rayAbsH <= roofElev) {
                    loss += segLen * (b - a) * p.buildingLossPerM;
                    if (a > 1.0e-6) { loss += WALL_DB; }
                    if (b < 1.0 - 1.0e-6) { loss += WALL_DB; }
                }
            }
        }
    }
    return loss;
}

// ── Pixel colour ──────────────────────────────────────────────────────────────

fn colorPixel(sigDbm: f32) -> u32 {
    let sens = p.effectiveSens;
    var r: u32; var g: u32; var b: u32; var a: u32;
    if (isNan(sigDbm) || isNan(sens)) {
        r = 70u; g = 0u; b = 0u; a = 70u;
    } else if (sigDbm < sens) {
        r = 70u; g = 0u; b = 0u; a = 70u;
    } else {
        let CAP = sens + 50.0;
        let denom = max(1.0e-6, CAP - sens);
        let t = clamp((sigDbm - sens) / denom, 0.0, 1.0);
        // gradient: [0,220,40,0,120] [0.25,255,160,0,145] [0.5,230,220,0,155] [0.75,80,210,30,165] [1,0,200,90,180]
        var lo = vec4<f32>(220.0, 40.0, 0.0, 120.0);
        var hi = vec4<f32>(255.0, 160.0, 0.0, 145.0);
        var seg_t = t / 0.25;
        if (t > 0.75) {
            lo = vec4<f32>(80.0, 210.0, 30.0, 165.0);
            hi = vec4<f32>(0.0, 200.0, 90.0, 180.0);
            seg_t = (t - 0.75) / 0.25;
        } else if (t > 0.5) {
            lo = vec4<f32>(230.0, 220.0, 0.0, 155.0);
            hi = vec4<f32>(80.0, 210.0, 30.0, 165.0);
            seg_t = (t - 0.5) / 0.25;
        } else if (t > 0.25) {
            lo = vec4<f32>(255.0, 160.0, 0.0, 145.0);
            hi = vec4<f32>(230.0, 220.0, 0.0, 155.0);
            seg_t = (t - 0.25) / 0.25;
        }
        let col = lo + (hi - lo) * seg_t;
        r = u32(round(col.x)); g = u32(round(col.y));
        b = u32(round(col.z)); a = u32(round(col.w));
    }
    return r | (g << 8u) | (b << 16u) | (a << 24u);
}

// ── Main compute kernel ───────────────────────────────────────────────────────

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let col = gid.x;
    let row = gid.y;
    let gw  = p.gridW;
    let gh  = p.gridH;
    if (col >= gw || row >= gh) { return; }

    let pixIdx  = row * gw + col;
    let colFrac = select(f32(col) / f32(gw - 1u), 0.0, gw <= 1u);
    let rowFrac = select(f32(row) / f32(gh - 1u), 0.0, gh <= 1u);
    let ptLat   = p.outLatMax - rowFrac * (p.outLatMax - p.outLatMin);
    let ptLon   = p.outLonMin + colFrac * (p.outLonMax - p.outLonMin);

    let dist = flatDistM(p.txLat, p.txLon, ptLat, ptLon);

    if (dist > p.radiusM) {
        signalOut[pixIdx] = p.effectiveSens - 1.0;
        return;
    }

    let dClamped = max(1.0, dist);
    var rxPower  = p.txPower + p.txGain - (20.0 * log(dClamped) / log(10.0) + p.fsplBase);
    if (isNan(rxPower)) {
        signalOut[pixIdx] = p.effectiveSens - 1.0;
        return;
    }

    let n        = profileN(dist);
    let rxGroundElev = bilinearElev(ptLat, ptLon);
    let txAbsH   = p.txElev   + p.txHeight;
    let rxAbsH   = rxGroundElev + p.rxHeight;

    if ((p.useLos != 0u || p.useFoliage != 0u || p.useBuildings != 0u) && dist > 50.0) {
        if (p.useLos != 0u) {
            let diffLoss = diffLossDb(p.txLat, p.txLon, txAbsH,
                                      ptLat, ptLon, rxAbsH, n, dist);
            rxPower -= diffLoss;
            if (diffLoss > 60.0) {
                rxPower = min(rxPower, p.effectiveSens - 10.0);
            }
        }

        if (p.useFoliage != 0u && p.foliageCount > 0u) {
            rxPower -= foliageLoss(p.txLat, p.txLon, txAbsH,
                                   ptLat, ptLon, rxAbsH, n, dist);
        }

        if (p.useBuildings != 0u && p.buildingCount > 0u) {
            rxPower -= buildingLoss(p.txLat, p.txLon, txAbsH,
                                    ptLat, ptLon, rxAbsH, n, dist);
        }
    }

    signalOut[pixIdx] = rxPower;
}
