#!/usr/bin/env python
"""升级现有 call-graph.json：添加度数 + meta + 生成核心子图。"""
from __future__ import annotations

import copy
import json
import sys
from collections import deque
from pathlib import Path

# 添加项目根目录到 path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.config import DEFAULT_FOCUS_DEPTH, LARGE_GRAPH_THRESHOLD


def upgrade_call_graph(repo_dir: Path) -> None:
    """升级单个仓库的 call-graph.json。"""
    call_graph_path = repo_dir / "call-graph.json"
    if not call_graph_path.exists():
        print(f"  跳过: {repo_dir.name} (无 call-graph.json)")
        return

    with open(call_graph_path, encoding="utf-8") as f:
        data = json.load(f)

    nodes = data.get("nodes", [])
    edges = data.get("edges", [])

    if not edges:
        print(f"  跳过: {repo_dir.name} (无 calls 边)")
        return

    # 检查是否已升级
    if "meta" in data and data["meta"].get("entry_node_id"):
        print(f"  已升级: {repo_dir.name}")
        return

    print(f"  升级: {repo_dir.name} ({len(nodes)} nodes, {len(edges)} edges)")

    # 1. 计算度数
    degrees: dict[str, dict[str, int]] = {}
    for e in edges:
        src, tgt = e.get("from"), e.get("to")
        if src:
            degrees.setdefault(src, {"in": 0, "out": 0})["out"] += 1
        if tgt:
            degrees.setdefault(tgt, {"in": 0, "out": 0})["in"] += 1

    # 2. 找最高度数节点
    entry_node_id = None
    max_total = -1
    for nid, deg in degrees.items():
        total = deg["in"] + deg["out"]
        if total > max_total:
            max_total = total
            entry_node_id = nid

    print(f"    入口节点: {entry_node_id} (度数: {degrees.get(entry_node_id)})")

    # 3. 更新节点度数
    for node in nodes:
        nid = node.get("id")
        if nid in degrees:
            node.setdefault("properties", {})["degrees"] = degrees[nid]

    # 4. 更新 call-graph.json
    data["meta"] = {
        "entry_node_id": entry_node_id,
        "node_count": len(nodes),
        "edge_count": len(edges),
    }

    # 原子写入
    tmp = call_graph_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(call_graph_path)
    print(f"    已更新: {call_graph_path.name}")

    # 5. 大图谱：生成核心子图
    if len(nodes) > LARGE_GRAPH_THRESHOLD and entry_node_id:
        node_map = {n.get("id"): n for n in nodes if n.get("id")}

        # BFS
        visited: set[str] = set()
        edge_set: list[dict] = []
        queue: deque[tuple[str, int]] = deque([(entry_node_id, 0)])

        while queue:
            current_id, current_depth = queue.popleft()
            if current_id in visited:
                continue
            visited.add(current_id)

            if current_depth < DEFAULT_FOCUS_DEPTH:
                for e in edges:
                    neighbor = None
                    if e.get("from") == current_id:
                        neighbor = e.get("to")
                    elif e.get("to") == current_id:
                        neighbor = e.get("from")
                    if neighbor and neighbor not in visited:
                        edge_set.append(e)
                        queue.append((neighbor, current_depth + 1))
                    elif neighbor and e not in edge_set:
                        edge_set.append(e)

        # 构建节点
        core_nodes = []
        for nid in visited:
            if nid in node_map:
                node_copy = copy.deepcopy(node_map[nid])
                core_nodes.append(node_copy)

        core_data = {
            "meta": {
                "auto_focus": True,
                "focus_node_id": entry_node_id,
                "focus_depth": DEFAULT_FOCUS_DEPTH,
                "total_nodes": len(nodes),
                "total_edges": len(edges),
            },
            "nodes": core_nodes,
            "edges": edge_set,
        }

        core_path = repo_dir / "call-graph-core.json"
        tmp = core_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(core_data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(core_path)
        print(f"    已生成: {core_path.name} ({len(core_nodes)} nodes, {len(edge_set)} edges)")


def main():
    storage_root = Path(__file__).resolve().parent.parent / "graph-storage"
    if not storage_root.exists():
        print(f"存储目录不存在: {storage_root}")
        sys.exit(1)

    print(f"存储目录: {storage_root}")
    print()

    for repo_dir in sorted(storage_root.iterdir()):
        if repo_dir.is_dir():
            upgrade_call_graph(repo_dir)

    print()
    print("完成!")


if __name__ == "__main__":
    main()
