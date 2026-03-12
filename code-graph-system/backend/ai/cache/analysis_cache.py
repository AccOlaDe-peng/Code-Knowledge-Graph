"""
AI 分析结果缓存。

缓存策略：
    以 (repo_name, commit_sha) 为缓存键。只要 Git commit SHA 未变化，
    直接返回上次分析结果，跳过 LLM 调用。

目录结构：
    data/ai_analysis/
        {repo_name}/
            AIArchitectureAnalyzer.json
            AIServiceDetector.json
            AIBusinessFlowAnalyzer.json
            AIDataLineageAnalyzer.json
            AIDomainModelAnalyzer.json

每个 JSON 文件格式：
    {
      "cache_meta": {
        "graph_id":      "...",
        "repo_name":     "...",
        "commit_sha":    "abc123...",
        "analyzer_name": "AIArchitectureAnalyzer",
        "cached_at":     "2024-01-01T12:00:00",
        "confidence":    0.8,
        "node_count":    5,
        "edge_count":    3
      },
      "nodes":    [ {GraphNode dict, by_alias=True}, ... ],
      "edges":    [ {GraphEdge dict, by_alias=True}, ... ],
      "metadata": { ... }
    }

注意：
    - commit_sha 为空字符串时（非 Git 仓库），跳过缓存（get 返回 None，
      put 不写入），以避免对无版本信息的仓库误命中。
    - 缓存目录不存在时自动创建；写入失败时只记录警告，不中断流水线。

用法::

    cache = AnalysisCache()                      # 默认 data/ai_analysis/
    cache = AnalysisCache(Path("/tmp/ai_cache")) # 自定义目录

    # 读取
    graph = cache.get("my-repo", "abc123", "AIArchitectureAnalyzer")
    if graph is None:                            # 缓存未命中
        graph = analyzer.analyze(summary)
        cache.put("my-repo", "abc123", "AIArchitectureAnalyzer", graph)

    # 枚举
    for entry in cache.list_entries("my-repo"):
        print(entry.analyzer_name, entry.cached_at, entry.commit_sha[:8])

    # 失效
    cache.invalidate("my-repo")                  # 清除整个仓库的缓存
    cache.invalidate_analyzer("my-repo", "AIServiceDetector")
"""

from __future__ import annotations

import dataclasses
import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Default cache root (relative to the project; overridable via constructor)
_DEFAULT_CACHE_DIR = Path("data/ai_analysis")


# ---------------------------------------------------------------------------
# CacheEntry
# ---------------------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class CacheEntry:
    """单条缓存记录的元数据摘要（不含 nodes/edges 内容）。

    Attributes:
        repo_name:     仓库名称。
        graph_id:      关联的图谱 ID（可为空字符串，表示尚未保存图谱）。
        commit_sha:    缓存时的 Git commit SHA。
        analyzer_name: 产生此缓存的分析器类名。
        cached_at:     缓存写入时间（ISO-8601 字符串）。
        confidence:    分析结果的整体置信度。
        node_count:    缓存中的节点数。
        edge_count:    缓存中的边数。
        cache_file:    缓存文件绝对路径。
    """

    repo_name:     str
    graph_id:      str
    commit_sha:    str
    analyzer_name: str
    cached_at:     str
    confidence:    float
    node_count:    int
    edge_count:    int
    cache_file:    Path

    @property
    def is_stale(self, current_sha: str = "") -> bool:
        """True 若 current_sha 提供且与缓存 SHA 不同。"""
        return bool(current_sha) and self.commit_sha != current_sha


# ---------------------------------------------------------------------------
# AnalysisCache
# ---------------------------------------------------------------------------


class AnalysisCache:
    """AI 分析结果的磁盘缓存。

    线程安全说明：当前实现为单进程单线程设计；若需多进程并发写入，
    调用方需额外加锁。

    Args:
        cache_dir: 缓存根目录。None 时使用 ``data/ai_analysis/``。
    """

    def __init__(self, cache_dir: Optional[Path] = None) -> None:
        self._root: Path = (cache_dir or _DEFAULT_CACHE_DIR).resolve()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get(
        self,
        repo_name: str,
        commit_sha: str,
        analyzer_name: str,
    ) -> Any:  # returns AIAnalysisGraph | None (avoid circular import)
        """读取缓存的 AIAnalysisGraph。

        Args:
            repo_name:     仓库名称（用于定位缓存目录）。
            commit_sha:    当前 Git commit SHA。
            analyzer_name: 分析器类名（如 "AIArchitectureAnalyzer"）。

        Returns:
            AIAnalysisGraph 若缓存命中且 commit SHA 匹配；否则返回 None。
        """
        if not commit_sha:
            return None

        cache_file = self._cache_path(repo_name, analyzer_name)
        if not cache_file.exists():
            return None

        try:
            data = json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Cache: failed to read %s: %s", cache_file, exc)
            return None

        meta = data.get("cache_meta", {})
        cached_sha = meta.get("commit_sha", "")
        if cached_sha != commit_sha:
            logger.debug(
                "Cache: stale for %s/%s (cached=%s, current=%s)",
                repo_name, analyzer_name, cached_sha[:8], commit_sha[:8],
            )
            return None

        try:
            return _deserialize_graph(data, analyzer_name)
        except Exception as exc:
            logger.warning(
                "Cache: failed to deserialize %s/%s: %s",
                repo_name, analyzer_name, exc,
            )
            return None

    def put(
        self,
        repo_name: str,
        commit_sha: str,
        analyzer_name: str,
        graph: Any,  # AIAnalysisGraph
        graph_id: str = "",
    ) -> None:
        """将 AIAnalysisGraph 写入缓存。

        Args:
            repo_name:     仓库名称。
            commit_sha:    当前 Git commit SHA。
            analyzer_name: 分析器类名。
            graph:         AIAnalysisGraph 实例。
            graph_id:      关联的图谱 ID（可选，步骤 15 后才可用）。

        Note:
            commit_sha 为空时静默跳过（不写缓存）。
            写入失败时只记录 warning，不抛异常。
        """
        if not commit_sha:
            return

        cache_file = self._cache_path(repo_name, analyzer_name)
        try:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            data = _serialize_graph(graph, repo_name, commit_sha, analyzer_name, graph_id)
            cache_file.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            logger.debug(
                "Cache: wrote %s/%s  nodes=%d edges=%d sha=%s",
                repo_name, analyzer_name,
                len(graph.nodes), len(graph.edges),
                commit_sha[:8],
            )
        except Exception as exc:
            logger.warning(
                "Cache: failed to write %s/%s: %s",
                repo_name, analyzer_name, exc,
            )

    def update_graph_id(
        self,
        repo_name: str,
        commit_sha: str,
        graph_id: str,
    ) -> None:
        """事后将 graph_id 回填到所有缓存文件。

        在 GraphRepository.save() 完成（步骤 15）后调用，
        将实际 graph_id 写入之前存储的缓存元数据中。
        """
        repo_dir = self._repo_dir(repo_name)
        if not repo_dir.is_dir():
            return
        for cache_file in repo_dir.glob("*.json"):
            try:
                data = json.loads(cache_file.read_text(encoding="utf-8"))
                meta = data.get("cache_meta", {})
                if meta.get("commit_sha") == commit_sha:
                    meta["graph_id"] = graph_id
                    data["cache_meta"] = meta
                    cache_file.write_text(
                        json.dumps(data, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
            except Exception as exc:
                logger.warning("Cache: update_graph_id failed for %s: %s", cache_file, exc)

    def is_valid(
        self,
        repo_name: str,
        commit_sha: str,
        analyzer_name: str,
    ) -> bool:
        """True 若指定分析器的缓存存在且 commit SHA 匹配。"""
        if not commit_sha:
            return False
        cache_file = self._cache_path(repo_name, analyzer_name)
        if not cache_file.exists():
            return False
        try:
            data = json.loads(cache_file.read_text(encoding="utf-8"))
            return data.get("cache_meta", {}).get("commit_sha") == commit_sha
        except Exception:
            return False

    def invalidate(self, repo_name: str) -> None:
        """删除指定仓库的全部缓存文件。"""
        repo_dir = self._repo_dir(repo_name)
        if repo_dir.is_dir():
            shutil.rmtree(repo_dir, ignore_errors=True)
            logger.info("Cache: invalidated all entries for '%s'", repo_name)

    def invalidate_analyzer(self, repo_name: str, analyzer_name: str) -> None:
        """删除指定仓库中单个分析器的缓存文件。"""
        cache_file = self._cache_path(repo_name, analyzer_name)
        if cache_file.exists():
            cache_file.unlink()
            logger.info("Cache: invalidated %s/%s", repo_name, analyzer_name)

    def list_entries(self, repo_name: str) -> list[CacheEntry]:
        """列出指定仓库所有缓存条目的元数据。"""
        repo_dir = self._repo_dir(repo_name)
        if not repo_dir.is_dir():
            return []

        entries: list[CacheEntry] = []
        for cache_file in sorted(repo_dir.glob("*.json")):
            try:
                data = json.loads(cache_file.read_text(encoding="utf-8"))
                meta = data.get("cache_meta", {})
                entries.append(CacheEntry(
                    repo_name=meta.get("repo_name", repo_name),
                    graph_id=meta.get("graph_id", ""),
                    commit_sha=meta.get("commit_sha", ""),
                    analyzer_name=meta.get("analyzer_name", cache_file.stem),
                    cached_at=meta.get("cached_at", ""),
                    confidence=float(meta.get("confidence", 0.0)),
                    node_count=int(meta.get("node_count", 0)),
                    edge_count=int(meta.get("edge_count", 0)),
                    cache_file=cache_file,
                ))
            except Exception as exc:
                logger.warning("Cache: cannot read entry %s: %s", cache_file, exc)
        return entries

    def stats(self, repo_name: str) -> dict[str, Any]:
        """Return a summary dict for logging/debugging."""
        entries = self.list_entries(repo_name)
        return {
            "repo_name":   repo_name,
            "entry_count": len(entries),
            "analyzers":   [e.analyzer_name for e in entries],
            "shas":        list({e.commit_sha[:8] for e in entries}),
            "cache_dir":   str(self._repo_dir(repo_name)),
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _repo_dir(self, repo_name: str) -> Path:
        """Return the cache directory for a given repo (not created yet)."""
        return self._root / _safe_dir_name(repo_name)

    def _cache_path(self, repo_name: str, analyzer_name: str) -> Path:
        """Return the path to a specific analyzer's cache file."""
        return self._repo_dir(repo_name) / f"{analyzer_name}.json"


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------


def _safe_dir_name(name: str) -> str:
    """Sanitise a repo name for use as a filesystem directory."""
    import re
    return re.sub(r"[^\w\-.]", "_", name).strip("_") or "unnamed"


def _serialize_graph(
    graph: Any,   # AIAnalysisGraph
    repo_name: str,
    commit_sha: str,
    analyzer_name: str,
    graph_id: str,
) -> dict[str, Any]:
    """Serialise an AIAnalysisGraph to a JSON-compatible dict."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    # GraphEdge uses `from_` internally but serialises as `"from"` via alias
    nodes_data = [n.model_dump() for n in graph.nodes]
    edges_data = [e.model_dump(by_alias=True) for e in graph.edges]

    return {
        "cache_meta": {
            "graph_id":      graph_id,
            "repo_name":     repo_name,
            "commit_sha":    commit_sha,
            "analyzer_name": analyzer_name,
            "cached_at":     now,
            "confidence":    graph.confidence,
            "node_count":    len(graph.nodes),
            "edge_count":    len(graph.edges),
        },
        "nodes":    nodes_data,
        "edges":    edges_data,
        "metadata": graph.metadata,
    }


def _deserialize_graph(data: dict[str, Any], analyzer_name: str) -> Any:
    """Deserialise a JSON dict back to AIAnalysisGraph.

    Imported lazily to avoid circular imports at module load time.
    """
    # Lazy imports to break potential circular dependency chains
    from backend.analyzer.ai.ai_analyzer_base import AIAnalysisGraph
    from backend.graph.graph_schema import GraphEdge, GraphNode

    meta = data.get("cache_meta", {})
    nodes = [GraphNode.model_validate(n) for n in data.get("nodes", [])]
    # GraphEdge uses alias="from" so model_validate works with the "from" key
    edges = [GraphEdge.model_validate(e) for e in data.get("edges", [])]

    return AIAnalysisGraph(
        nodes=nodes,
        edges=edges,
        confidence=float(meta.get("confidence", 0.0)),
        analyzer_name=analyzer_name,
        metadata={
            **data.get("metadata", {}),
            "from_cache": True,
            "cached_at":  meta.get("cached_at", ""),
            "commit_sha": meta.get("commit_sha", ""),
        },
    )
