import math


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
        # Multipolygon holes (inner rings). hole_ring_offsets indexes hole_verts
        # in vertex units; poly_hole_offsets[pi]..[pi+1] is the hole-ring range
        # for polygon pi. Empty here -> every polygon has a zero-length range.
        "hole_verts": [0.0, 0.0],
        "hole_ring_offsets": [0, 0],
        "poly_hole_offsets": [0, 0],
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


def pack_obstacles(payload, with_factors=False):
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

    # Pack multipolygon holes (inner rings) parallel to `polygons`. The renderer
    # sends `holes` as a list aligned with `polygons`, where holes[i] is the list
    # of inner rings for polygon i. Flatten into:
    #   hole_verts        - [lat, lon, ...] for every hole ring, concatenated
    #   hole_ring_offsets - vertex-unit start of each hole ring (len = rings + 1)
    #   poly_hole_offsets - poly_hole_offsets[pi]..[pi+1] = hole-ring index range
    #                       owned by polygon pi (len = count + 1)
    holes_payload = payload.get("holes") or []
    hole_verts = []
    hole_ring_offsets = [0]
    poly_hole_offsets = [0] * (count + 1)
    for i in range(count):
        poly_hole_offsets[i] = len(hole_ring_offsets) - 1
        rings = holes_payload[i] if i < len(holes_payload) else None
        if rings:
            for ring in rings:
                if not ring or len(ring) < 3:
                    continue
                for pt in ring:
                    hole_verts.append(float(pt[0]))
                    hole_verts.append(float(pt[1]))
                hole_ring_offsets.append(len(hole_verts) // 2)
    poly_hole_offsets[count] = len(hole_ring_offsets) - 1

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
        "hole_verts": hole_verts if hole_verts else [0.0, 0.0],
        "hole_ring_offsets": hole_ring_offsets if len(hole_ring_offsets) > 1 else [0, 0],
        "poly_hole_offsets": poly_hole_offsets,
    }
    if with_factors:
        out["factors"] = factors if factors else [1.0]
    return out
