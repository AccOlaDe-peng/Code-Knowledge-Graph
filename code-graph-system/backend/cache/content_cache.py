"""线程安全 LRU 文件内容缓存。"""
from __future__ import annotations

import threading
from collections import OrderedDict


class ContentCache:
    """线程安全的 LRU 文件内容缓存。

    以 UTF-8 字节数计算容量，超限时淘汰最久未访问的条目。
    """

    def __init__(self, max_bytes: int = 100 * 1024 * 1024) -> None:
        self._max_bytes = max_bytes
        self._current_bytes = 0
        self._cache: OrderedDict[str, str] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, path: str) -> str | None:
        """获取缓存内容，命中时刷新 LRU 顺序。"""
        with self._lock:
            if path not in self._cache:
                return None
            self._cache.move_to_end(path)
            return self._cache[path]

    def put(self, path: str, content: str) -> None:
        """写入缓存，必要时淘汰旧条目。"""
        content_bytes = len(content.encode("utf-8"))
        with self._lock:
            if path in self._cache:
                self._current_bytes -= len(self._cache[path].encode("utf-8"))
                del self._cache[path]
            # 淘汰直到有足够空间
            while self._current_bytes + content_bytes > self._max_bytes and self._cache:
                _, evicted = self._cache.popitem(last=False)
                self._current_bytes -= len(evicted.encode("utf-8"))
            self._cache[path] = content
            self._cache.move_to_end(path)
            self._current_bytes += content_bytes

    @property
    def size(self) -> int:
        """返回缓存条目数。"""
        with self._lock:
            return len(self._cache)

    @property
    def current_bytes(self) -> int:
        """返回当前缓存字节数。"""
        with self._lock:
            return self._current_bytes
