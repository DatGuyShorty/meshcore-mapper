import json
import math
import time

from .kernel_source import KERNEL
from .obstacle_pack import pack_obstacles
from .optimizer_kernel_source import OPTIMIZER_KERNEL


def _json(obj):
    print(json.dumps(obj), flush=True)


def _progress(stage, pct):
    _json({"type": "progress", "stage": stage, "pct": max(0.0, min(1.0, float(pct)))})


def _as_device_float(cp, np, values):
    return cp.asarray(np.asarray(values, dtype=np.float32))


def _upload_obstacles(cp, np, packed, with_factors=False):
    out = {
        "verts": _as_device_float(cp, np, packed["verts"]),
        "offsets": cp.asarray(np.asarray(packed["offsets"], dtype=np.int32)),
        "bboxes": _as_device_float(cp, np, packed["bboxes"]),
        "heights": _as_device_float(cp, np, packed["heights"]),
        "tile_offsets": cp.asarray(np.asarray(packed["tile_offsets"], dtype=np.int32)),
        "tile_counts": cp.asarray(np.asarray(packed["tile_counts"], dtype=np.int32)),
        "tile_indices": cp.asarray(np.asarray(packed["tile_indices"], dtype=np.int32)),
        "hole_verts": _as_device_float(cp, np, packed["hole_verts"]),
        "hole_ring_offsets": cp.asarray(np.asarray(packed["hole_ring_offsets"], dtype=np.int32)),
        "poly_hole_offsets": cp.asarray(np.asarray(packed["poly_hole_offsets"], dtype=np.int32)),
    }
    if with_factors:
        out["factors"] = _as_device_float(cp, np, packed["factors"])
    return out


def compute_optimizer(params_path):
    try:
        import numpy as np
        import cupy as cp
    except Exception as exc:
        _json({"ok": False, "unsupported": True, "message": f"CuPy unavailable: {exc}"})
        return

    with open(params_path, "r", encoding="utf-8-sig") as fh:
        p = json.load(fh)

    t0 = time.perf_counter()
    eval_res = int(p["evalRes"])
    eval_count = eval_res * eval_res
    candidate_count = int(p["candidateCount"])
    n_repeaters = int(p.get("nRepeaters", 1))
    threshold = float(p["rxSens"]) + float(p.get("fadeMargin", 0.0))

    if candidate_count <= 0 or eval_count <= 0 or n_repeaters <= 0:
        _json({
            "ok": True,
            "results": [],
            "stats": {
                "cuda": True,
                "rounds": 0,
                "candidateCount": max(0, candidate_count),
                "evalCount": max(0, eval_count),
                "workerComputeMs": (time.perf_counter() - t0) * 1000.0,
            },
        })
        return

    eval_elevs = np.fromfile(p["evalElevsPath"], dtype=np.float32)
    candidate_coords = np.fromfile(p["candidateCoordsPath"], dtype=np.float32)
    candidate_elevs = np.fromfile(p["candidateElevsPath"], dtype=np.float32)

    if eval_elevs.size != eval_count:
        _json({"ok": False, "error": "Optimizer elevation grid size mismatch"})
        return
    if candidate_coords.size != candidate_count * 2:
        _json({"ok": False, "error": "Optimizer candidate coordinate size mismatch"})
        return
    if candidate_elevs.size != candidate_count:
        _json({"ok": False, "error": "Optimizer candidate elevation size mismatch"})
        return

    _progress("loading-grid", 0.08)

    foliage = pack_obstacles(p.get("foliage"), with_factors=True)
    buildings = pack_obstacles(p.get("buildings"), with_factors=False)
    _progress("packing-obstacles", 0.16)

    d_elevs = cp.asarray(eval_elevs)
    d_candidate_coords = cp.asarray(candidate_coords)
    d_candidate_elevs = cp.asarray(candidate_elevs)
    d_covered = cp.zeros(eval_count, dtype=cp.uint8)
    d_selected = cp.zeros(candidate_count, dtype=cp.uint8)
    d_signals = cp.empty((candidate_count, eval_count), dtype=cp.float32)

    f_dev = _upload_obstacles(cp, np, foliage, with_factors=True)
    b_dev = _upload_obstacles(cp, np, buildings, with_factors=False)
    _progress("uploading-buffers", 0.28)

    kernel = cp.RawKernel(KERNEL + OPTIMIZER_KERNEL, "optimizer_signal_kernel")
    block = (16, 8)
    grid = (math.ceil(eval_count / block[0]), math.ceil(candidate_count / block[1]))

    tx_params = p["txParams"]
    opts = p["opts"]
    bounds = p["bounds"]
    placed = []
    rounds_run = 0

    for round_idx in range(max(0, n_repeaters)):
        _progress("cuda-scoring", 0.30 + 0.60 * (round_idx / max(1, n_repeaters)))
        kernel(grid, block, (
            d_elevs,
            d_candidate_coords,
            d_candidate_elevs,
            d_covered,
            d_selected,
            d_signals,
            np.int32(candidate_count),
            np.int32(eval_res),
            np.float32(bounds["latMin"]),
            np.float32(bounds["latMax"]),
            np.float32(bounds["lonMin"]),
            np.float32(bounds["lonMax"]),
            np.float32(tx_params["height"]),
            np.float32(tx_params["power"]),
            np.float32(tx_params.get("gain", 0.0)),
            np.float32(tx_params["freq"]),
            np.float32(opts["rxHeight"]),
            np.float32(threshold),
            np.float32(float(opts["radiusKm"]) * 1000.0),
            np.int32(1 if opts.get("useLos") else 0),
            np.int32(1 if opts.get("useFresnel") else 0),
            np.int32(1 if opts.get("useDeygout") or opts.get("diffractionModel") == "deygout" else 0),
            np.float32(opts.get("profileTargetSpacingM", 100)),
            np.int32(opts.get("profileMaxSamples", 256)),
            np.int32(1 if opts.get("useFoliage") else 0),
            np.float32(opts.get("foliageLossPerM", 0.3)),
            f_dev["verts"], f_dev["offsets"], f_dev["bboxes"], f_dev["heights"], f_dev["factors"],
            np.int32(foliage["count"]),
            f_dev["tile_offsets"], f_dev["tile_counts"], f_dev["tile_indices"],
            np.int32(foliage["tile_n"]),
            np.float32(foliage["tile_lat_min"]), np.float32(foliage["tile_lat_span"]),
            np.float32(foliage["tile_lon_min"]), np.float32(foliage["tile_lon_span"]),
            f_dev["hole_verts"], f_dev["hole_ring_offsets"], f_dev["poly_hole_offsets"],
            np.int32(1 if opts.get("useBuildings") else 0),
            np.float32(opts.get("buildingLossPerM", 0.5)),
            b_dev["verts"], b_dev["offsets"], b_dev["bboxes"], b_dev["heights"],
            np.int32(buildings["count"]),
            b_dev["tile_offsets"], b_dev["tile_counts"], b_dev["tile_indices"],
            np.int32(buildings["tile_n"]),
            np.float32(buildings["tile_lat_min"]), np.float32(buildings["tile_lat_span"]),
            np.float32(buildings["tile_lon_min"]), np.float32(buildings["tile_lon_span"]),
            b_dev["hole_verts"], b_dev["hole_ring_offsets"], b_dev["poly_hole_offsets"],
            np.int32(1 if opts.get("useGroundReflection") else 0),
            np.float32(opts.get("reflectionCoeff", 0.7)),
        ))
        cp.cuda.Stream.null.synchronize()

        counts = cp.sum(d_signals >= np.float32(threshold), axis=1)
        counts_np = cp.asnumpy(counts)
        best_idx = int(counts_np.argmax()) if counts_np.size else -1
        best_count = int(counts_np[best_idx]) if best_idx >= 0 else 0
        if best_idx < 0 or best_count <= 0:
            break

        best_signals = d_signals[best_idx]
        d_covered = cp.maximum(d_covered, (best_signals >= np.float32(threshold)).astype(cp.uint8))
        d_selected[best_idx] = np.uint8(1)
        rounds_run += 1

        lat = float(candidate_coords[best_idx * 2])
        lon = float(candidate_coords[best_idx * 2 + 1])
        placed.append({
            "lat": lat,
            "lon": lon,
            "score": float(best_count) / float(eval_count) if eval_count else 0.0,
            "elevM": float(candidate_elevs[best_idx]),
        })

    _progress("downloading-result", 0.95)
    _json({
        "ok": True,
        "results": placed,
        "stats": {
            "cuda": True,
            "rounds": rounds_run,
            "candidateCount": candidate_count,
            "evalCount": eval_count,
            "workerComputeMs": (time.perf_counter() - t0) * 1000.0,
        },
    })
