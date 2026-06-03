import argparse
import json
import math
import time

from .kernel_source import KERNEL
from .obstacle_pack import pack_obstacles
from .optimizer import compute_optimizer


def _json(obj):
    print(json.dumps(obj), flush=True)


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
    t_stage = t0
    elev = np.fromfile(p["gridPath"], dtype=np.float32)
    if elev.size != int(p["ELEV_RES"]) * int(p["ELEV_RES"]):
        _json({"ok": False, "error": "Elevation grid size mismatch"})
        return
    _json({"type": "progress", "stage": "loading-grid", "pct": 0.12})

    foliage = pack_obstacles(p.get("foliage"), with_factors=True)
    buildings = pack_obstacles(p.get("buildings"), with_factors=False)
    t_pack = time.perf_counter()
    _json({"type": "progress", "stage": "packing-obstacles", "pct": 0.24})

    grid_res = int(p["gridRes"])
    elev_res = int(p["ELEV_RES"])
    rep = p["rep"]
    d_elev = cp.asarray(elev)
    d_rgba = cp.empty(grid_res * grid_res * 4, dtype=cp.uint8)
    d_signal = cp.empty(grid_res * grid_res, dtype=cp.float32)
    d_los = cp.empty(grid_res * grid_res, dtype=cp.float32)

    d_f_verts = cp.asarray(np.asarray(foliage["verts"], dtype=np.float32))
    d_f_offsets = cp.asarray(np.asarray(foliage["offsets"], dtype=np.int32))
    d_f_bboxes = cp.asarray(np.asarray(foliage["bboxes"], dtype=np.float32))
    d_f_heights = cp.asarray(np.asarray(foliage["heights"], dtype=np.float32))
    d_f_factors = cp.asarray(np.asarray(foliage["factors"], dtype=np.float32))
    d_f_tile_offsets = cp.asarray(np.asarray(foliage["tile_offsets"], dtype=np.int32))
    d_f_tile_counts = cp.asarray(np.asarray(foliage["tile_counts"], dtype=np.int32))
    d_f_tile_indices = cp.asarray(np.asarray(foliage["tile_indices"], dtype=np.int32))
    d_f_hole_verts = cp.asarray(np.asarray(foliage["hole_verts"], dtype=np.float32))
    d_f_hole_ring_offsets = cp.asarray(np.asarray(foliage["hole_ring_offsets"], dtype=np.int32))
    d_f_poly_hole_offsets = cp.asarray(np.asarray(foliage["poly_hole_offsets"], dtype=np.int32))

    d_b_verts = cp.asarray(np.asarray(buildings["verts"], dtype=np.float32))
    d_b_offsets = cp.asarray(np.asarray(buildings["offsets"], dtype=np.int32))
    d_b_bboxes = cp.asarray(np.asarray(buildings["bboxes"], dtype=np.float32))
    d_b_heights = cp.asarray(np.asarray(buildings["heights"], dtype=np.float32))
    d_b_tile_offsets = cp.asarray(np.asarray(buildings["tile_offsets"], dtype=np.int32))
    d_b_tile_counts = cp.asarray(np.asarray(buildings["tile_counts"], dtype=np.int32))
    d_b_tile_indices = cp.asarray(np.asarray(buildings["tile_indices"], dtype=np.int32))
    d_b_hole_verts = cp.asarray(np.asarray(buildings["hole_verts"], dtype=np.float32))
    d_b_hole_ring_offsets = cp.asarray(np.asarray(buildings["hole_ring_offsets"], dtype=np.int32))
    d_b_poly_hole_offsets = cp.asarray(np.asarray(buildings["poly_hole_offsets"], dtype=np.int32))
    t_upload = time.perf_counter()
    _json({"type": "progress", "stage": "uploading-buffers", "pct": 0.48})

    kernel = cp.RawKernel(KERNEL, "coverage_kernel")
    block = (16, 16)
    grid = (math.ceil(grid_res / block[0]), math.ceil(grid_res / block[1]))
    _json({"type": "progress", "stage": "cuda-kernel", "pct": 0.72})
    kernel(grid, block, (
        d_elev, d_rgba, d_signal, d_los,
        np.int32(grid_res), np.int32(elev_res),
        np.float32(p["latMin"]), np.float32(p["latMax"]), np.float32(p["lonMin"]), np.float32(p["lonMax"]),
        np.float32(rep["lat"]), np.float32(rep["lon"]), np.float32(p["txElev"]), np.float32(rep["height"]),
        np.float32(rep["power"]), np.float32(rep.get("gain", 0)), np.float32(rep["freq"]),
        np.float32(p["rxHeight"]), np.float32(p["effectiveSens"]), np.float32(float(p["radiusKm"]) * 1000.0),
        np.int32(1 if p.get("useLos") else 0),
        np.int32(1 if p.get("useFresnel") else 0),
        np.int32(1 if p.get("useDeygout") else 0),
        np.int32(1 if p.get("useLangleyRice") else 0),
        np.int32(1 if p.get("useLogNormalFading") else 0),
        np.float32(p.get("fadingSigmaDb", 0.0)),
        np.uint32(p.get("fadingSeed", 1337)),
        np.float32(p.get("kFactor", 4.0 / 3.0)),
        np.int32(1 if p.get("useAtmosphericRefraction", True) else 0),
        np.float32(p.get("refractivityGradientNPerKm", -39.0)),
        np.float32(p.get("surfaceRefractivityN", 301.0)),
        np.int32(1 if p.get("useDeltaBullington") else 0),
        np.int32(1 if p.get("useMultipathModel") else 0),
        np.float32(p.get("ricianKDb", 6.0)),
        np.float32(p.get("profileTargetSpacingM", 50)),
        np.int32(p.get("profileMaxSamples", 512)),
        np.int32(1 if p.get("useFoliage") else 0),
        np.int32(1 if p.get("useWeissberger") else 0),
        np.float32(p.get("foliageLossPerM", 0.3)),
        d_f_verts, d_f_offsets, d_f_bboxes, d_f_heights, d_f_factors,
        np.int32(foliage["count"]),
        d_f_tile_offsets, d_f_tile_counts, d_f_tile_indices,
        np.int32(foliage["tile_n"]),
        np.float32(foliage["tile_lat_min"]), np.float32(foliage["tile_lat_span"]),
        np.float32(foliage["tile_lon_min"]), np.float32(foliage["tile_lon_span"]),
        d_f_hole_verts, d_f_hole_ring_offsets, d_f_poly_hole_offsets,
        np.int32(1 if p.get("useBuildings") else 0),
        np.float32(p.get("buildingLossPerM", 0.5)),
        d_b_verts, d_b_offsets, d_b_bboxes, d_b_heights,
        np.int32(buildings["count"]),
        d_b_tile_offsets, d_b_tile_counts, d_b_tile_indices,
        np.int32(buildings["tile_n"]),
        np.float32(buildings["tile_lat_min"]), np.float32(buildings["tile_lat_span"]),
        np.float32(buildings["tile_lon_min"]), np.float32(buildings["tile_lon_span"]),
        d_b_hole_verts, d_b_hole_ring_offsets, d_b_poly_hole_offsets,
        np.int32(1 if p.get("useGroundReflection") else 0),
        np.float32(p.get("reflectionCoeff", 0.7)),
    ))
    cp.cuda.Stream.null.synchronize()
    t_kernel = time.perf_counter()
    _json({"type": "progress", "stage": "downloading-result", "pct": 0.9})
    cp.asnumpy(d_rgba).tofile(p["outPath"])
    cp.asnumpy(d_signal).tofile(p["signalPath"])
    if p.get("losPath"):
        cp.asnumpy(d_los).tofile(p["losPath"])
    t_download = time.perf_counter()
    _json({
        "ok": True,
        "stats": {
            "workerCount": 0,
            "workerComputeMs": (time.perf_counter() - t0) * 1000.0,
            "insidePoints": grid_res * grid_res,
            "totalPoints": grid_res * grid_res,
            "cuda": True,
            "obstacles": bool(p.get("useFoliage") or p.get("useBuildings")),
            "cudaStages": {
                "packingMs": (t_pack - t_stage) * 1000.0,
                "uploadMs": (t_upload - t_pack) * 1000.0,
                "kernelMs": (t_kernel - t_upload) * 1000.0,
                "downloadMs": (t_download - t_kernel) * 1000.0,
            },
        },
    })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--compute")
    parser.add_argument("--optimize")
    args = parser.parse_args()
    if args.probe:
        probe()
    elif args.compute:
        compute(args.compute)
    elif args.optimize:
        compute_optimizer(args.optimize)
    else:
        parser.error("expected --probe, --compute, or --optimize")


if __name__ == "__main__":
    main()
