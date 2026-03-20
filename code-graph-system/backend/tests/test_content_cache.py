"""ContentCache 单元测试。"""
from __future__ import annotations

import threading

from backend.cache.content_cache import ContentCache


class TestContentCacheBasic:
    def test_get_returns_none_for_missing_key(self):
        cache = ContentCache(max_bytes=1024)
        assert cache.get("nonexistent") is None

    def test_put_and_get(self):
        cache = ContentCache(max_bytes=1024)
        cache.put("a.py", "content a")
        assert cache.get("a.py") == "content a"

    def test_lru_eviction_when_full(self):
        # 每个条目按 UTF-8 字节计，"x" × 100 = 100 bytes
        cache = ContentCache(max_bytes=150)
        cache.put("a.py", "x" * 100)   # 100 bytes，放入
        cache.put("b.py", "y" * 100)   # 再加 100 bytes → 超限，淘汰 a
        assert cache.get("a.py") is None
        assert cache.get("b.py") is not None

    def test_access_refreshes_lru_order(self):
        # 容量足够放下 a + b，再访问 a，再添加一个小文件
        # 最终淘汰的应该是 b（最久未访问）
        cache = ContentCache(max_bytes=250)
        cache.put("a.py", "x" * 100)   # 100 bytes
        cache.put("b.py", "y" * 100)   # 100 bytes，总计 200
        cache.get("a.py")              # 访问 a，刷新 LRU 顺序：b 在前，a 在后
        cache.put("c.py", "z" * 100)   # 100 bytes，总计 300 > 250，淘汰 b（最久未访问）
        assert cache.get("a.py") is not None  # a 应该还在
        assert cache.get("b.py") is None       # b 应该被淘汰
        assert cache.get("c.py") is not None   # c 应该存在

    def test_thread_safe_concurrent_put(self):
        cache = ContentCache(max_bytes=10 * 1024 * 1024)
        errors = []

        def worker(i):
            try:
                cache.put(f"file_{i}.py", f"content {i}" * 10)
                _ = cache.get(f"file_{i}.py")
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors, f"线程安全测试失败: {errors}"

    def test_size_property(self):
        cache = ContentCache(max_bytes=1024)
        assert cache.size == 0
        cache.put("a.py", "hello")
        assert cache.size == 1
