#!/usr/bin/env python3
"""Bridge script: runs graphify Python API pipeline and outputs JSON progress to stdout."""

import argparse
import json
import sys
from pathlib import Path


def emit(step, total, stage, message):
    print(json.dumps({"step": step, "total": total, "stage": stage, "message": message}), flush=True)


def main():
    parser = argparse.ArgumentParser(description="Run graphify analysis pipeline")
    parser.add_argument("path", help="Root directory to analyze")
    parser.add_argument("--update", action="store_true", help="Incremental update (only new/changed files)")
    parser.add_argument("--directed", action="store_true", help="Build directed graph")
    args = parser.parse_args()

    root = Path(args.path).resolve()
    if not root.is_dir():
        print(json.dumps({"error": f"Not a directory: {root}"}), file=sys.stderr, flush=True)
        sys.exit(1)

    out_dir = root / "graphify-out"
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        from graphify.detect import detect, detect_incremental, save_manifest
        from graphify.extract import extract
        from graphify.build import build_from_json
        from graphify.cluster import cluster, score_all
        from graphify.export import to_json
    except ImportError:
        print(json.dumps({"error": "graphify not installed. Run: pip install graphifyy"}), file=sys.stderr, flush=True)
        sys.exit(1)

    # Step 1: Detect
    emit(1, 5, "detect", "Scanning files...")
    if args.update and (out_dir / "manifest.json").exists():
        detected = detect_incremental(root)
        code_files = [Path(f) for f in detected.get("new_files", {}).get("code", [])]
        # Include unchanged code for rebuild context
        unchanged = [Path(f) for f in detected.get("unchanged_files", {}).get("code", [])]
        all_code = code_files + unchanged
    else:
        detected = detect(root)
        all_code = [Path(f) for f in detected.get("files", {}).get("code", [])]

    if not all_code:
        emit(5, 5, "report", "No code files found")
        print(json.dumps({"done": True, "node_count": 0, "edge_count": 0}), flush=True)
        return

    # Step 2: Extract (AST)
    emit(2, 5, "extract", f"Extracting AST from {len(all_code)} files...")
    result = extract(all_code)

    # For update: merge with existing graph's semantic nodes
    existing_graph_path = out_dir / "graph.json"
    if args.update and existing_graph_path.exists():
        try:
            import json as _json
            existing = _json.loads(existing_graph_path.read_text(encoding="utf-8"))
            existing_nodes = existing.get("nodes", [])
            existing_edges = existing.get("edges", [])
            # Keep non-AST nodes (those with confidence != "EXTRACTED" or source not in new extraction)
            new_node_ids = {n["id"] for n in result.get("nodes", [])}
            preserved_nodes = [n for n in existing_nodes if n.get("id") not in new_node_ids]
            preserved_edges = [e for e in existing_edges
                              if e.get("source") not in new_node_ids or e.get("target") not in new_node_ids]
            result["nodes"] = result.get("nodes", []) + preserved_nodes
            result["edges"] = result.get("edges", []) + preserved_edges
        except Exception:
            pass  # If merge fails, just use fresh extraction

    # Step 3: Build graph
    emit(3, 5, "build", "Building graph...")
    G = build_from_json(result, directed=args.directed)

    # Step 4: Cluster
    emit(4, 5, "cluster", "Clustering communities...")
    communities = cluster(G)
    cohesion = score_all(G, communities)

    # Step 5: Export
    emit(5, 5, "report", "Exporting graph.json...")
    graph_json_path = str(out_dir / "graph.json")
    to_json(G, communities, graph_json_path)

    # Save manifest for incremental updates
    save_manifest(detected.get("files", detected.get("new_files", {})), str(out_dir / "manifest.json"))

    node_count = G.number_of_nodes()
    edge_count = G.number_of_edges()
    print(json.dumps({"done": True, "node_count": node_count, "edge_count": edge_count}), flush=True)


if __name__ == "__main__":
    main()
