"""
AI 分析结果缓存包。

用法::

    from backend.ai.cache import AnalysisCache, CacheEntry

    cache = AnalysisCache()

    # 检查缓存
    graph = cache.get("my-repo", "abc123", "AIArchitectureAnalyzer")
    if graph is None:
        graph = AIArchitectureAnalyzer().analyze(summary)
        cache.put("my-repo", "abc123", "AIArchitectureAnalyzer", graph)
"""

from backend.ai.cache.analysis_cache import AnalysisCache, CacheEntry

__all__ = ["AnalysisCache", "CacheEntry"]
