#!/usr/bin/env python3
"""
Generate a dense AAL graph (thousands of anatomically placed nodes) by:
1) keeping one core node per AAL region (for seed compatibility),
2) sampling extra nodes from atlas voxels per region,
3) wiring intra-region local links and inter-region bridges from base AAL edges.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Dict, List, Tuple

import nibabel as nib
import numpy as np


def stable_seed(text: str) -> int:
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return int(digest[:16], 16) & 0xFFFFFFFF


def load_label_map(csv_path: Path) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for raw in csv_path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        code, name = line.split(",", 1)
        out[name.strip()] = int(code.strip())
    return out


def allocate_micro_nodes(
    region_names: List[str],
    voxel_counts: Dict[str, int],
    target_micro_total: int,
    min_per_region: int,
) -> Dict[str, int]:
    alloc = {}
    for name in region_names:
        alloc[name] = min(min_per_region, voxel_counts[name])

    remaining = max(0, target_micro_total - sum(alloc.values()))
    if remaining == 0:
        return alloc

    total_vox = float(sum(voxel_counts[n] for n in region_names))
    if total_vox <= 0:
        return alloc

    fractional = []
    for name in region_names:
        capacity = max(0, voxel_counts[name] - alloc[name])
        if capacity <= 0:
            fractional.append((0.0, name))
            continue
        share = remaining * (voxel_counts[name] / total_vox)
        add_int = min(capacity, int(np.floor(share)))
        alloc[name] += add_int
        fractional.append((share - add_int, name))

    remaining = max(0, target_micro_total - sum(alloc.values()))
    if remaining == 0:
        return alloc

    fractional.sort(reverse=True)
    for _, name in fractional:
        if remaining <= 0:
            break
        if alloc[name] >= voxel_counts[name]:
            continue
        alloc[name] += 1
        remaining -= 1

    return alloc


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base-graph",
        default="model/assets/aal_graph.json",
        help="Base 116-node graph JSON",
    )
    parser.add_argument(
        "--atlas",
        default="net/aal/aal.nii.gz",
        help="AAL atlas NIfTI path",
    )
    parser.add_argument(
        "--labels",
        default="net/aal/aal_labels.csv",
        help="AAL labels CSV path",
    )
    parser.add_argument(
        "--out",
        default="model/assets/aal_graph_dense.json",
        help="Output dense graph JSON",
    )
    parser.add_argument(
        "--target-nodes",
        type=int,
        default=3200,
        help="Target total nodes including 116 core nodes",
    )
    parser.add_argument(
        "--min-micro-per-region",
        type=int,
        default=8,
        help="Minimum sampled micro nodes per region",
    )
    parser.add_argument(
        "--knn",
        type=int,
        default=2,
        help="Intra-region nearest neighbors per micro node",
    )
    args = parser.parse_args()

    base_graph_path = Path(args.base_graph)
    atlas_path = Path(args.atlas)
    labels_path = Path(args.labels)
    out_path = Path(args.out)

    base_graph = json.loads(base_graph_path.read_text())
    base_nodes = base_graph["nodes"]
    base_edges = base_graph["edges"]

    label_to_code = load_label_map(labels_path)
    base_names = [n["name"] for n in base_nodes]
    missing = [name for name in base_names if name not in label_to_code]
    if missing:
        raise RuntimeError(f"Missing label codes for: {missing[:8]}")

    img = nib.load(str(atlas_path))
    data = img.get_fdata().astype(np.int32)
    affine = img.affine

    region_voxels: Dict[str, np.ndarray] = {}
    voxel_counts: Dict[str, int] = {}
    for name in base_names:
        code = label_to_code[name]
        vox = np.argwhere(data == code)
        region_voxels[name] = vox
        voxel_counts[name] = int(vox.shape[0])

    core_count = len(base_nodes)
    target_micro = max(0, args.target_nodes - core_count)
    micro_alloc = allocate_micro_nodes(
        region_names=base_names,
        voxel_counts=voxel_counts,
        target_micro_total=target_micro,
        min_per_region=max(0, args.min_micro_per_region),
    )

    nodes: List[dict] = []
    region_info: Dict[str, dict] = {}

    for idx, n in enumerate(base_nodes):
        name = n["name"]
        mcount = micro_alloc[name]
        per_node_vol = float(n["volume_mm3"]) / max(1, mcount + 1)
        core_node = {
            "idx": idx,
            "id": n["id"],
            "name": name,
            "mni_mm": [float(n["mni_mm"][0]), float(n["mni_mm"][1]), float(n["mni_mm"][2])],
            "volume_mm3": per_node_vol,
            "hemisphere": n.get("hemisphere", "U"),
            "kind": "core",
        }
        nodes.append(core_node)
        region_info[name] = {
            "core_idx": idx,
            "micro_indices": [],
            "micro_coords": [],
            "base_volume_mm3": float(n["volume_mm3"]),
            "hemisphere": n.get("hemisphere", "U"),
            "per_node_vol": per_node_vol,
        }

    next_idx = len(nodes)
    for name in base_names:
        vox = region_voxels[name]
        want = micro_alloc[name]
        if want <= 0 or vox.shape[0] == 0:
            continue

        rng = np.random.default_rng(stable_seed(name))
        if want >= vox.shape[0]:
            picked = vox
        else:
            sel = rng.choice(vox.shape[0], size=want, replace=False)
            picked = vox[sel]

        coords_mm = nib.affines.apply_affine(affine, picked.astype(np.float32))
        per_node_vol = region_info[name]["per_node_vol"]

        for j, xyz in enumerate(coords_mm, start=1):
            node = {
                "idx": next_idx,
                "id": f"{name}__{j:03d}",
                "name": f"{name}__{j:03d}",
                "region": name,
                "mni_mm": [float(xyz[0]), float(xyz[1]), float(xyz[2])],
                "volume_mm3": per_node_vol,
                "hemisphere": region_info[name]["hemisphere"],
                "kind": "micro",
            }
            nodes.append(node)
            region_info[name]["micro_indices"].append(next_idx)
            region_info[name]["micro_coords"].append((float(xyz[0]), float(xyz[1]), float(xyz[2])))
            next_idx += 1

    edge_w: Dict[Tuple[int, int], float] = {}

    def add_edge(a: int, b: int, w: float) -> None:
        if a == b:
            return
        s, t = (a, b) if a < b else (b, a)
        w = float(np.clip(w, 0.0, 1.0))
        prev = edge_w.get((s, t))
        if prev is None or w > prev:
            edge_w[(s, t)] = w

    # Intra-region dense links.
    for name in base_names:
        info = region_info[name]
        core_idx = info["core_idx"]
        micro_idx = info["micro_indices"]
        coords = np.array(info["micro_coords"], dtype=np.float32)
        m = len(micro_idx)
        if m == 0:
            continue

        for mi in micro_idx:
            add_edge(core_idx, mi, 0.34)

        if m > 1:
            # Ring for guaranteed local connectivity.
            for i in range(m):
                add_edge(micro_idx[i], micro_idx[(i + 1) % m], 0.21)

            # kNN local links (deterministic brute-force, region-local only).
            k = max(1, min(args.knn, m - 1))
            for i in range(m):
                delta = coords - coords[i]
                dist2 = np.einsum("ij,ij->i", delta, delta)
                order = np.argsort(dist2)
                added = 0
                for j in order:
                    if j == i:
                        continue
                    add_edge(micro_idx[i], micro_idx[int(j)], 0.18)
                    added += 1
                    if added >= k:
                        break

    # Inter-region links from base graph + additional bridge samples.
    for e in base_edges:
        src_name = base_nodes[e["source"]]["name"]
        dst_name = base_nodes[e["target"]]["name"]
        src_info = region_info[src_name]
        dst_info = region_info[dst_name]
        w = float(e.get("weight_norm", 0.0))

        add_edge(src_info["core_idx"], dst_info["core_idx"], w)

        src_micro = src_info["micro_indices"]
        dst_micro = dst_info["micro_indices"]
        if not src_micro or not dst_micro:
            continue

        bridges = max(1, min(8, int(round(1 + (w * 8)))))
        offset_seed = stable_seed(f"{src_name}|{dst_name}") % max(len(src_micro), 1)
        for b in range(bridges):
            ia = src_micro[(offset_seed + (b * len(src_micro) // bridges)) % len(src_micro)]
            ib = dst_micro[((bridges - 1 - b) * len(dst_micro) // bridges) % len(dst_micro)]
            add_edge(ia, ib, max(0.08, w * 0.66))

    edges = []
    for (s, t), w in sorted(edge_w.items()):
        edges.append(
            {
                "source": s,
                "target": t,
                "weight_faces": int(round(w * 1000)),
                "weight_norm": float(round(w, 6)),
            }
        )

    out = {
        "atlas": {
            "name": "AAL",
            "version": "SPM12",
            "space": "MNI",
            "mode": "dense_voxel_sample",
            "source_nifti": str(atlas_path),
            "target_nodes": int(args.target_nodes),
        },
        "nodes": nodes,
        "edges": edges,
    }

    out_path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {out_path}")
    print(f"Nodes: {len(nodes)}")
    print(f"Edges: {len(edges)}")


if __name__ == "__main__":
    main()

