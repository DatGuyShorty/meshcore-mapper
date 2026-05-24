/**
 * coverageGpu.js — WebGPU accelerated coverage computation.
 *
 * Serializes foliage/building polygon data into GPU buffers, dispatches a
 * WGSL compute shader, and returns a Uint8ClampedArray RGBA result compatible
 * with the existing _renderCoverageOverlay pipeline.
 *
 * Falls back gracefully: call isGpuAvailable() first.
 */
import { writePixel } from './propagation.js';

const WORKGROUP = 16; // must match @workgroup_size in coverageGpu.wgsl
const RE_EFF    = 6371000 * (4 / 3);
const GPU_SIGNAL_SENTINEL = -9999;

// ── GPU device singleton ───────────────────────────────────────────────────

let _device = null;
let _shaderModule = null;

export async function initGpu() {
  if (_device) return true;
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return false;
    _device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize:               adapter.limits.maxBufferSize,
      },
    });
    _device.lost.then(() => { _device = null; _shaderModule = null; });
    const wgslUrl = new URL('./coverageGpu.wgsl', import.meta.url);
    const wgslSrc = await fetch(wgslUrl).then(r => r.text());
    _shaderModule = _device.createShaderModule({ code: wgslSrc });
    const compilation = await _shaderModule.getCompilationInfo?.();
    const errors = compilation?.messages?.filter(m => m.type === 'error') ?? [];
    if (errors.length) {
      throw new Error(`WGSL compile error: ${errors.map(m => m.message).join('; ')}`);
    }
    return true;
  } catch (e) {
    console.warn('[gpu] init failed:', e.message);
    _device = null;
    return false;
  }
}

export function isGpuAvailable() {
  return !!_device && !!_shaderModule;
}

export function getGpuMaxGridRes() {
  if (!isGpuAvailable()) return 0;
  const limits = _device.limits;
  const byStorageU32 = Math.floor((limits.maxStorageBufferBindingSize || 0) / 4);
  const byBufferU32 = Math.floor((limits.maxBufferSize || 0) / 4);
  const maxU32 = Math.max(0, Math.min(byStorageU32 || 0, byBufferU32 || 0));
  if (!Number.isFinite(maxU32) || maxU32 <= 0) return 0;
  return Math.floor(Math.sqrt(maxU32));
}

// ── Data serialization ─────────────────────────────────────────────────────

/**
 * Serialise polygon data (foliage or buildings) into flat GPU-friendly array buffers.
 * Returns { N, vertices, offsets, bboxes, extraF32, tile, tileN, tileLatMin, tileLonMin, tileLatSpan, tileLonSpan }
 * extraF32: canopyH+factors for foliage, heights for buildings.
 */
function _serializePolygons(data, extraKey1, extraKey2) {
  if (!data || !data.polygons || data.polygons.length === 0) {
    return _emptyPolyData();
  }
  const { polygons, bboxes, tileIndex } = data;
  const extra1 = data[extraKey1] ?? [];
  const extra2 = extraKey2 ? (data[extraKey2] ?? []) : null;
  const N = polygons.length;

  // Count total vertices
  let totalVerts = 0;
  for (let i = 0; i < N; i++) totalVerts += polygons[i].length;

  const vertices = new Float32Array(totalVerts * 2);
  const offsets  = new Uint32Array(N + 1);
  let vi = 0;
  for (let i = 0; i < N; i++) {
    offsets[i] = vi;
    for (const [lat, lon] of polygons[i]) {
      vertices[vi * 2]     = lat;
      vertices[vi * 2 + 1] = lon;
      vi++;
    }
  }
  offsets[N] = vi;

  // Bboxes: [latMin, latMax, lonMin, lonMax] per polygon
  const bboxesF32 = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const bb = bboxes[i];
    bboxesF32[i * 4]     = bb.latMin ?? bb[0];
    bboxesF32[i * 4 + 1] = bb.latMax ?? bb[1];
    bboxesF32[i * 4 + 2] = bb.lonMin ?? bb[2];
    bboxesF32[i * 4 + 3] = bb.lonMax ?? bb[3];
  }

  // Extra F32 arrays (canopyH/factors or heights)
  const ex1 = new Float32Array(N);
  for (let i = 0; i < N; i++) ex1[i] = extra1[i] ?? 5;
  let ex2 = null;
  if (extra2 !== null) {
    ex2 = new Float32Array(N);
    for (let i = 0; i < N; i++) ex2[i] = extra2[i] ?? 1;
  }

  // Tile CSR: layout [offset×(TN²), count×(TN²), indices...]
  let tileN = 0, tileLatMin = 0, tileLonMin = 0, tileLatSpan = 0, tileLonSpan = 0;
  let tileCSR = new Uint32Array(0);

  if (tileIndex && tileIndex.tiles) {
    const tiles = tileIndex.tiles;
    tileN = Math.round(Math.sqrt(tiles.length));
    tileLatMin  = tileIndex.latMin;
    tileLonMin  = tileIndex.lonMin;
    tileLatSpan = tileIndex.latSpan ?? (tileIndex.latMax - tileIndex.latMin);
    tileLonSpan = tileIndex.lonSpan ?? (tileIndex.lonMax - tileIndex.lonMin);

    let totalRefs = 0;
    for (const cell of tiles) totalRefs += (cell.size ?? cell.length);

    const header     = tileN * tileN * 2; // offsets + counts
    tileCSR = new Uint32Array(header + totalRefs);
    let idx = 0;
    for (let i = 0; i < tiles.length; i++) {
      const cell = tiles[i];
      tileCSR[i]                  = idx;          // offset
      tileCSR[tileN * tileN + i]  = cell.size ?? cell.length; // count
      for (const v of cell) { tileCSR[header + idx] = v; idx++; }
    }
  }

  return { N, vertices, offsets, bboxesF32, ex1, ex2, tileCSR, tileN, tileLatMin, tileLonMin, tileLatSpan, tileLonSpan };
}

function _emptyPolyData() {
  return {
    N: 0,
    vertices:  new Float32Array(1),
    offsets:   new Uint32Array(2),
    bboxesF32: new Float32Array(4),
    ex1:       new Float32Array(1),
    ex2:       new Float32Array(1),
    tileCSR:   new Uint32Array(1),
    tileN: 0, tileLatMin: 0, tileLonMin: 0, tileLatSpan: 0, tileLonSpan: 0,
  };
}

// ── GPU buffer helpers ─────────────────────────────────────────────────────

function _uploadF32(data) {
  const buf = _device.createBuffer({
    size: Math.max(4, data.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  _device.queue.writeBuffer(buf, 0, data);
  return buf;
}

function _uploadU32(data) {
  const buf = _device.createBuffer({
    size: Math.max(4, data.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  _device.queue.writeBuffer(buf, 0, data);
  return buf;
}

// ── Params struct packing ──────────────────────────────────────────────────
// Must match the Params struct in coverageGpu.wgsl exactly (field order, alignment).

function _packParams(opts, fData, bData) {
  const {
    gridRes, elevRes, latMin, latMax, lonMin, lonMax,
    txLat, txLon, txElev, txHeight, txPower, txGain,
    rxHeight, effectiveSens, radiusM,
    useLos, useFresnel, useFoliage, foliageLossPerM,
    useBuildings, buildingLossPerM,
    profileTargetSpacingM, profileMinSamples,
    freqMHz,
  } = opts;

  const mPerLat = 110574;
  const mPerLon = 111320 * Math.cos(txLat * Math.PI / 180);
  const lambda  = 299792458 / (freqMHz * 1e6);
  const fsplBase = 20 * Math.log10(freqMHz * 1e6) - 147.55;

  // 34 f32/u32 fields — keep in sync with WGSL struct
  const buf = new ArrayBuffer(34 * 4);
  const u32 = new Uint32Array(buf);
  const f32 = new Float32Array(buf);

  // Field indices — must match struct field declaration order in wgsl
  u32[0]  = gridRes;
  u32[1]  = elevRes;
  f32[2]  = latMin;  f32[3] = latMax;  f32[4] = lonMin;  f32[5] = lonMax;
  f32[6]  = txLat;   f32[7] = txLon;   f32[8] = txElev;  f32[9] = txHeight;
  f32[10] = txPower; f32[11] = txGain;
  f32[12] = rxHeight; f32[13] = effectiveSens; f32[14] = radiusM;
  u32[15] = useLos ? 1 : 0;
  u32[16] = useFresnel ? 1 : 0;
  u32[17] = useFoliage ? 1 : 0;
  f32[18] = foliageLossPerM;
  u32[19] = fData.N;
  u32[20] = useBuildings ? 1 : 0;
  f32[21] = buildingLossPerM;
  u32[22] = bData.N;
  f32[23] = profileTargetSpacingM;
  u32[24] = profileMinSamples;
  f32[25] = mPerLat;
  f32[26] = mPerLon;
  f32[27] = RE_EFF;
  f32[28] = lambda;
  f32[29] = fsplBase;
  u32[30] = fData.tileN;
  f32[31] = fData.tileLatMin; // NOTE: index 31 must match struct after tileN
  // The Params struct has 4 more f32 after foliageTileN, then 5 for buildings.
  // We need 34 + 4 more f32 = 38 total. Let me recalculate…
  // Actual field count: see below. Resize.

  // Rebuild with correct size (count all fields in struct):
  // gridRes(u), elevRes(u), latMin-lonMax(4f), txLat-txGain(6f), rxH,sens,radM(3f),
  // useLos,useFresnel(2u), useFoliage(u),foliLoss(f),foliCount(u),
  // useBuildings(u),bldLoss(f),bldCount(u), profT(f),profMin(u),
  // mPerLat,mPerLon,reEff,lambda,fsplBase(5f),
  // foliageTileN(u), folilatMin,folilatSpan,folilonMin,folilonSpan(4f),
  // buildingTileN(u), bldlatMin,bldlatSpan,bldlonMin,bldlonSpan(4f)
  // Total: 2+4+6+3+2+3+3+1+1+5+5+5 = 40 fields = 160 bytes
  throw new Error('_packParams: use _buildParamsBuffer instead');
}

function _buildParamsBuffer(opts, fData, bData) {
  const {
    gridW, gridH, elevRes,
    latMin, latMax, lonMin, lonMax,
    outLatMin, outLatMax, outLonMin, outLonMax,
    txLat, txLon, txElev, txHeight, txPower, txGain,
    rxHeight, effectiveSens, radiusM,
    useLos, useFresnel, useFoliage, foliageLossPerM,
    useBuildings, buildingLossPerM,
    profileTargetSpacingM, profileMinSamples,
    freqMHz,
  } = opts;

  const mPerLat  = 110574;
  const mPerLon  = 111320 * Math.cos(txLat * Math.PI / 180);
  const lambda   = 299792458 / (freqMHz * 1e6);
  const fsplBase = 20 * Math.log10(freqMHz * 1e6) - 147.55;

  const F = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const U = (v, fallback = 0) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  // Exact field order matching WGSL struct.
  const fields = [
    { t: 'u', v: U(gridW, 1) },
    { t: 'u', v: U(gridH, 1) },
    { t: 'u', v: U(elevRes, 2) },
    { t: 'f', v: F(latMin) },       { t: 'f', v: F(latMax) },
    { t: 'f', v: F(lonMin) },       { t: 'f', v: F(lonMax) },
    { t: 'f', v: F(outLatMin) },    { t: 'f', v: F(outLatMax) },
    { t: 'f', v: F(outLonMin) },    { t: 'f', v: F(outLonMax) },
    { t: 'f', v: F(txLat) },        { t: 'f', v: F(txLon) },
    { t: 'f', v: F(txElev) },       { t: 'f', v: F(txHeight) },
    { t: 'f', v: F(txPower) },      { t: 'f', v: F(txGain) },
    { t: 'f', v: F(rxHeight, 1.5) },     { t: 'f', v: F(effectiveSens, -127) }, { t: 'f', v: F(radiusM, 1000) },
    { t: 'u', v: useLos ? 1 : 0 },
    { t: 'u', v: useFresnel ? 1 : 0 },
    { t: 'u', v: useFoliage ? 1 : 0 },
    { t: 'f', v: F(foliageLossPerM, 0.3) },
    { t: 'u', v: U(fData.N) },
    { t: 'u', v: useBuildings ? 1 : 0 },
    { t: 'f', v: F(buildingLossPerM, 0.5) },
    { t: 'u', v: U(bData.N) },
    { t: 'f', v: F(profileTargetSpacingM, 50) },
    { t: 'u', v: U(profileMinSamples, 16) },
    { t: 'f', v: F(mPerLat, 110574) },
    { t: 'f', v: F(mPerLon, 111320) },
    { t: 'f', v: F(RE_EFF, 8494666.6667) },
    { t: 'f', v: F(lambda, 0.33) },
    { t: 'f', v: F(fsplBase, 0) },
    { t: 'u', v: U(fData.tileN) },
    { t: 'f', v: F(fData.tileLatMin) }, { t: 'f', v: F(fData.tileLatSpan) },
    { t: 'f', v: F(fData.tileLonMin) }, { t: 'f', v: F(fData.tileLonSpan) },
    { t: 'u', v: U(bData.tileN) },
    { t: 'f', v: F(bData.tileLatMin) }, { t: 'f', v: F(bData.tileLatSpan) },
    { t: 'f', v: F(bData.tileLonMin) }, { t: 'f', v: F(bData.tileLonSpan) },
  ];

  // Pad to 256-byte uniform alignment
  const rawBytes = fields.length * 4;
  const aligned  = Math.ceil(rawBytes / 256) * 256;
  const ab  = new ArrayBuffer(aligned);
  const u32 = new Uint32Array(ab);
  const f32 = new Float32Array(ab);
  for (let i = 0; i < fields.length; i++) {
    if (fields[i].t === 'f') f32[i] = fields[i].v;
    else                      u32[i] = fields[i].v;
  }
  return ab;
}

// ── Main GPU dispatch ──────────────────────────────────────────────────────

function _indexToLat(row, gridRes, latMin, latMax) {
  if (gridRes <= 1) return latMax;
  const frac = row / (gridRes - 1);
  return latMax - frac * (latMax - latMin);
}

function _indexToLon(col, gridRes, lonMin, lonMax) {
  if (gridRes <= 1) return lonMin;
  const frac = col / (gridRes - 1);
  return lonMin + frac * (lonMax - lonMin);
}

function _tileEdgePxForDevice() {
  const byBuffer = getGpuMaxGridRes();
  if (!byBuffer) return 0;
  // Keep chunks modest: this avoids oversized readbacks and long single-dispatch
  // GPU work that can trip browser/driver watchdogs on consumer hardware.
  return Math.max(64, Math.min(1024, Math.floor(byBuffer * 0.92)));
}

function _copySignalTileIntoFull(fullSignal, fullRes, tileSignal, rowStart, colStart, tileH, tileW) {
  for (let r = 0; r < tileH; r++) {
    const srcBase = r * tileW;
    const dstBase = (rowStart + r) * fullRes + colStart;
    fullSignal.set(tileSignal.subarray(srcBase, srcBase + tileW), dstBase);
  }
}

function _countNonZeroAlpha(rgba) {
  let count = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] > 0) count++;
  }
  return count;
}

function _countWrittenSignals(signal) {
  let count = 0;
  for (let i = 0; i < signal.length; i++) {
    if (signal[i] !== GPU_SIGNAL_SENTINEL && Number.isFinite(signal[i])) count++;
  }
  return count;
}

function _signalsToRgba(signal, effectiveSens) {
  const rgba = new Uint8ClampedArray(signal.length * 4);
  for (let i = 0; i < signal.length; i++) {
    const sig = signal[i] === GPU_SIGNAL_SENTINEL || !Number.isFinite(signal[i])
      ? effectiveSens - 1
      : signal[i];
    writePixel(rgba, i * 4, sig, effectiveSens);
  }
  return rgba;
}

function _createSharedGpuResources({ elevF32, fData, bData }) {
  const D = _device;
  const elevBuf = _uploadF32(elevF32);

  const fVertsBuf   = _uploadF32(fData.vertices);
  const fOffsBuf    = _uploadU32(fData.offsets);
  const fBbxBuf     = _uploadF32(fData.bboxesF32);
  const fCanopyBuf  = _uploadF32(fData.ex1);
  const fFactorBuf  = _uploadF32(fData.ex2 ?? new Float32Array(1));
  const fTileBuf    = _uploadU32(fData.tileCSR);

  const bVertsBuf   = _uploadF32(bData.vertices);
  const bOffsBuf    = _uploadU32(bData.offsets);
  const bBbxBuf     = _uploadF32(bData.bboxesF32);
  const bHeightBuf  = _uploadF32(bData.ex1);
  const bTileBuf    = _uploadU32(bData.tileCSR);

  const bgl0 = D.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ]});
  const bgl1 = D.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
  ]});
  const bgl2 = D.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
  ]});

  const pipeline = D.createComputePipeline({
    layout: D.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl1, bgl2] }),
    compute: { module: _shaderModule, entryPoint: 'main' },
  });

  const bg1 = D.createBindGroup({ layout: bgl1, entries: [
    { binding: 0, resource: { buffer: fVertsBuf } },
    { binding: 1, resource: { buffer: fOffsBuf } },
    { binding: 2, resource: { buffer: fBbxBuf } },
    { binding: 3, resource: { buffer: fCanopyBuf } },
    { binding: 4, resource: { buffer: fFactorBuf } },
    { binding: 5, resource: { buffer: fTileBuf } },
  ]});
  const bg2 = D.createBindGroup({ layout: bgl2, entries: [
    { binding: 0, resource: { buffer: bVertsBuf } },
    { binding: 1, resource: { buffer: bOffsBuf } },
    { binding: 2, resource: { buffer: bBbxBuf } },
    { binding: 3, resource: { buffer: bHeightBuf } },
    { binding: 4, resource: { buffer: bTileBuf } },
  ]});

  const destroy = () => {
    for (const b of [elevBuf,
                     fVertsBuf, fOffsBuf, fBbxBuf, fCanopyBuf, fFactorBuf, fTileBuf,
                     bVertsBuf, bOffsBuf, bBbxBuf, bHeightBuf, bTileBuf]) {
      b.destroy();
    }
  };

  return { D, pipeline, bgl0, elevBuf, bg1, bg2, destroy };
}

async function _runGpuTileChunk({ shared, paramsAB, tileW, tileH }) {
  const { D, pipeline, bgl0, elevBuf, bg1, bg2 } = shared;
  const paramsBuf = D.createBuffer({ size: paramsAB.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  D.queue.writeBuffer(paramsBuf, 0, paramsAB);

  const signalCount = tileW * tileH;
  const signalBytes = signalCount * 4;
  const signalBuf = D.createBuffer({ size: signalBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const readBuf = D.createBuffer({ size: signalBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const sentinel = new Float32Array(signalCount);
  sentinel.fill(GPU_SIGNAL_SENTINEL);
  D.queue.writeBuffer(signalBuf, 0, sentinel);

  D.pushErrorScope('validation');
  const bg0 = D.createBindGroup({ layout: bgl0, entries: [
    { binding: 0, resource: { buffer: paramsBuf } },
    { binding: 1, resource: { buffer: elevBuf } },
    { binding: 2, resource: { buffer: signalBuf } },
  ]});

  const enc = D.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bg0);
  pass.setBindGroup(1, bg1);
  pass.setBindGroup(2, bg2);
  pass.dispatchWorkgroups(Math.ceil(tileW / WORKGROUP), Math.ceil(tileH / WORKGROUP));
  pass.end();
  enc.copyBufferToBuffer(signalBuf, 0, readBuf, 0, signalBytes);
  D.queue.submit([enc.finish()]);
  const validationError = await D.popErrorScope();
  if (validationError) {
    paramsBuf.destroy();
    signalBuf.destroy();
    readBuf.destroy();
    throw new Error(`WebGPU validation error: ${validationError.message}`);
  }
  await D.queue.onSubmittedWorkDone();
  await readBuf.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();

  paramsBuf.destroy();
  signalBuf.destroy();
  readBuf.destroy();
  return out;
}

/**
 * Run coverage computation on GPU.
 * @param {object} payload - same shape as createCoverageWorkerPoolJob payload
 * @param {object} opts
 * @param {AbortSignal} [opts.signal]
 * @param {function}    [opts.onProgress]
 * @returns {Promise<{ rgba: Uint8ClampedArray, stats: object }>}
 */
export async function runCoverageGpu(payload, { signal = null, onProgress = null } = {}) {
  if (!isGpuAvailable()) throw new Error('GPU not initialised');

  const t0 = performance.now();
  const {
    gridRes, ELEV_RES, gridElevs,
    rep, txElev, latMin, latMax, lonMin, lonMax,
    radiusKm, rxHeight, effectiveSens, useLos, useFresnel,
    useFoliage, foliageLossPerM, foliage,
    useBuildings, buildingLossPerM, buildings,
    profileTargetSpacingM,
  } = payload;

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  onProgress?.(0);

  const tileEdge = _tileEdgePxForDevice();
  if (!tileEdge) throw new Error('GPU tile size could not be determined from device limits.');

  const fData = _serializePolygons(useFoliage ? foliage : null, 'canopyHeights', 'factors');
  const bData = _serializePolygons(useBuildings ? buildings : null, 'heights', null);

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const elevF32 = gridElevs instanceof Float32Array ? gridElevs : new Float32Array(gridElevs);
  const shared = _createSharedGpuResources({ elevF32, fData, bData });
  const signalGrid = new Float32Array(gridRes * gridRes);
  signalGrid.fill(GPU_SIGNAL_SENTINEL);

  try {
    const rows = Math.ceil(gridRes / tileEdge);
    const cols = Math.ceil(gridRes / tileEdge);
    const totalTiles = rows * cols;
    let done = 0;

    for (let tr = 0; tr < rows; tr++) {
      const rowStart = tr * tileEdge;
      const tileH = Math.min(tileEdge, gridRes - rowStart);
      for (let tc = 0; tc < cols; tc++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const colStart = tc * tileEdge;
        const tileW = Math.min(tileEdge, gridRes - colStart);

        const outLatMax = _indexToLat(rowStart, gridRes, latMin, latMax);
        const outLatMin = _indexToLat(rowStart + tileH - 1, gridRes, latMin, latMax);
        const outLonMin = _indexToLon(colStart, gridRes, lonMin, lonMax);
        const outLonMax = _indexToLon(colStart + tileW - 1, gridRes, lonMin, lonMax);

        const paramsAB = _buildParamsBuffer({
          gridW: tileW,
          gridH: tileH,
          elevRes: ELEV_RES,
          latMin, latMax, lonMin, lonMax,
          outLatMin, outLatMax, outLonMin, outLonMax,
          txLat: rep.lat, txLon: rep.lon, txElev, txHeight: rep.height,
          txPower: rep.power, txGain: rep.gain ?? 0,
          rxHeight, effectiveSens, radiusM: radiusKm * 1000,
          useLos, useFresnel, useFoliage, foliageLossPerM,
          useBuildings, buildingLossPerM,
          profileTargetSpacingM,
          profileMinSamples: 16,
          freqMHz: rep.freq,
        }, fData, bData);

        const tileSignal = await _runGpuTileChunk({ shared, paramsAB, tileW, tileH });
        _copySignalTileIntoFull(signalGrid, gridRes, tileSignal, rowStart, colStart, tileH, tileW);

        done++;
        onProgress?.(done / totalTiles);
      }
    }
  } finally {
    shared.destroy();
  }

  onProgress?.(1);

  const writtenSignals = _countWrittenSignals(signalGrid);
  if (writtenSignals === 0) {
    throw new Error('GPU output buffer was not written');
  }

  const rgba = _signalsToRgba(signalGrid, effectiveSens);
  const nonZeroAlpha = _countNonZeroAlpha(rgba);
  if (nonZeroAlpha === 0) {
    throw new Error('GPU output has zero alpha pixels');
  }
  console.info(`[gpu] tiled output ready: ${gridRes}x${gridRes}, nonZeroAlpha=${nonZeroAlpha.toLocaleString()}`);

  return {
    rgba,
    stats: {
      workerCount: 0,
      workerComputeMs: performance.now() - t0,
      insidePoints: gridRes * gridRes,
      totalPoints:  gridRes * gridRes,
      gpu: true,
    },
  };
}
