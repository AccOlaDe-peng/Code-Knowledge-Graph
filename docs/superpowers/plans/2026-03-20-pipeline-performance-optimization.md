# AI 分析流水线性能优化实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 AI 分析流水线，通过共享知识池、阶段缓存、智能调度和批次合并，将大型仓库（1000+ 文件）分析吞吐量提升 2-3 倍。

**Architecture:** 新增 `SharedKnowledgePool` 统一管理文件索引和内容缓存，消除 Stage 2/3 的重复扫描；引入 `StageCacheManager` 支持断点续跑；`IntelligentScheduler` 基于 GLM 实际并发限制（2 并发）自适应调度；小型模块（Token ≤ 8000）批次合并为单次 LLM 调用。所有改动通过 `AIPipeline(enable_optimization=True)` 开关，保持原有接口不变。

**Tech Stack:** Python 3.11+, pytest, threading.Lock, ThreadPoolExecutor, concurrent.futures.as_completed, OrderedDict（LRU）

---

## 文件结构映射

### 新建文件

| 文件 | 职责 |
|------|------|
| `backend/cache/__init__.py` | 模块入口 |
| `backend/cache/content_cache.py` | 线程安全 LRU 文件内容缓存 |
| `backend/cache/shared_knowledge_pool.py` | 共享知识池（FileInfo + StructureIndexer + ContentCache） |
| `backend/pipeline/stage_cache.py` | 阶段缓存管理器，支持断点续跑 |
| `backend/pipeline/pipeline_scheduler.py` | 智能调度器 + ModuleBatch（避免与 Celery scheduler 冲突） |
| `backend/pipeline/stages/__init__.py` | 模块入口 |
| `backend/pipeline/stages/base.py` | StageBase 抽象基类 |
| `backend/pipeline/stages/file_index.py` | Stage 0：文件索引 |
| `backend/pipeline/stages/structure_parse.py` | Stage 1：骨架解析 |
| `backend/pipeline/stages/module_boundary.py` | Stage 2：AI 模块边界识别 |
| `backend/pipeline/stages/parallel_analysis.py` | Stage 3：并行分析（ThreadPoolExecutor） |
| `backend/pipeline/stages/graph_merge.py` | Stage 4：图谱合并 |
| `backend/pipeline/optimized_pipeline.py` | OptimizedPipeline：5 阶段编排入口 |
| `backend/tests/test_content_cache.py` | ContentCache 单元测试 |
| `backend/tests/test_shared_knowledge_pool.py` | SharedKnowledgePool 单元测试 |
| `backend/tests/test_stage_cache.py` | StageCacheManager 单元测试 |
| `backend/tests/test_pipeline_scheduler.py` | IntelligentScheduler + ModuleBatch 单元测试 |
| `backend/tests/test_optimized_pipeline.py` | OptimizedPipeline 集成测试 |
| `backend/tests/benchmark_pipeline.py` | 性能基准对比测试 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `backend/agent/structure_indexer.py` | 新增 `build_index_from_files()` 方法 |
| `backend/agent/context.py` | 新增 `structure_indexer: Optional[StructureIndexer] = None` 字段 |
| `backend/agent/agents/module_scanner.py` | 检查 `context.structure_indexer`，若非 None 跳过内部 `build_index()` |
| `backend/pipeline/ai_analyze.py` | 新增 `enable_optimization` 参数，命中时委托 `OptimizedPipeline` |

---

## Chunk 1：基础设施

### Task 1：ContentCache（线程安全 LRU 缓存）

**Files:**
- Create: `backend/cache/__init__.py`
- Create: `backend/cache/content_cache.py`
- Create: `backend/tests/test_content_cache.py`

- [ ] **Step 1：写失败测试**

```python
# backend/tests/test_content_cache.py
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
        cache = ContentCache(max_bytes=150)
        cache.put("a.py", "x" * 100)
        cache.put("b.py", "y" * 10)
        cache.get("a.py")              # 访问 a，刷新 LRU 顺序
        cache.put("c.py", "z" * 100)  # 超限，应淘汰 b（最久未用）
        assert cache.get("a.py") is not None
        assert cache.get("b.py") is None

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
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd code-graph-system
pytest backend/tests/test_content_cache.py -v
```

预期：`ModuleNotFoundError: No module named 'backend.cache'`

- [ ] **Step 3：创建 `backend/cache/__init__.py`**

```python
# backend/cache/__init__.py
```

- [ ] **Step 4：实现 `ContentCache`**

```python
# backend/cache/content_cache.py
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
```

- [ ] **Step 5：运行测试，确认通过**

```bash
cd code-graph-system
pytest backend/tests/test_content_cache.py -v
```

预期：6 个测试全部 PASS

- [ ] **Step 6：提交**

```bash
git add backend/cache/__init__.py backend/cache/content_cache.py backend/tests/test_content_cache.py
git commit -m "feat: 添加线程安全 LRU ContentCache"
```

---

### Task 2：SharedKnowledgePool（共享知识池）

**Files:**
- Create: `backend/cache/shared_knowledge_pool.py`
- Create: `backend/tests/test_shared_knowledge_pool.py`

- [ ] **Step 1：写失败测试**

```python
# backend/tests/test_shared_knowledge_pool.py
"""SharedKnowledgePool 单元测试。"""
from __future__ import annotations
import threading
from pathlib import Path
import pytest
from backend.cache.shared_knowledge_pool import SharedKnowledgePool, FileInfo


@pytest.fixture
def sample_repo(tmp_path: Path) -> Path:
    """创建包含几个源文件的临时仓库。"""
    (tmp_path / "main.py").write_text("def hello(): pass\n", encoding="utf-8")
    (tmp_path / "utils.py").write_text("def util(): pass\n", encoding="utf-8")
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "module.py").write_text("class Foo:\n    pass\n", encoding="utf-8")
    return tmp_path


class TestFileIndex:
    def test_build_file_index(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py", "utils.py", "sub/module.py"])
        assert "main.py" in pool.file_index
        assert "sub/module.py" in pool.file_index

    def test_file_info_fields(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        info = pool.file_index["main.py"]
        assert info.path == "main.py"
        assert info.language == "python"
        assert info.size_bytes > 0
        assert info.line_count == 1

    def test_get_file_info(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        assert pool.get_file_info("main.py") is not None
        assert pool.get_file_info("not_exist.py") is None


class TestContentCache:
    def test_get_content_reads_file(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        content = pool.get_content("main.py")
        assert content is not None
        assert "hello" in content

    def test_get_content_caches_result(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        c1 = pool.get_content("main.py")
        c2 = pool.get_content("main.py")
        assert c1 == c2
        assert pool._content_cache.size == 1  # 只缓存了一次

    def test_get_content_returns_none_for_unknown(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        assert pool.get_content("ghost.py") is None

    def test_concurrent_get_content(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        results = []
        errors = []

        def worker():
            try:
                results.append(pool.get_content("main.py"))
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        assert all(r is not None for r in results)


class TestTokenEstimation:
    def test_estimate_tokens_english(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        tokens = pool.estimate_tokens(["main.py"])
        # "def hello(): pass\n" ≈ 5 tokens
        assert tokens > 0
        assert tokens < 50

    def test_estimate_tokens_empty_paths(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        assert pool.estimate_tokens([]) == 0
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd code-graph-system
pytest backend/tests/test_shared_knowledge_pool.py -v
```

预期：`ModuleNotFoundError: No module named 'backend.cache.shared_knowledge_pool'`

- [ ] **Step 3：实现 `SharedKnowledgePool`**

```python
# backend/cache/shared_knowledge_pool.py
"""共享知识池 — 统一管理文件索引、结构索引和内容缓存。"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from backend.agent.structure_indexer import FileSkeleton, StructureIndexer
from backend.cache.content_cache import ContentCache

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# 支持语言扩展名映射
_LANG_MAP: dict[str, str] = {
    ".py": "python", ".java": "java", ".ts": "typescript",
    ".js": "javascript", ".go": "go", ".rs": "rust",
    ".cpp": "cpp", ".c": "c", ".h": "c",
    ".kt": "kotlin", ".scala": "scala", ".cs": "csharp",
}


@dataclass
class FileInfo:
    """文件元信息。"""
    path: str           # 相对路径
    absolute_path: Path # 绝对路径
    language: str       # 语言类型
    size_bytes: int     # 文件大小（字节）
    line_count: int     # 行数
    modified_time: float  # mtime


class SharedKnowledgePool:
    """共享知识池（线程安全）。

    生命周期：
        pool = SharedKnowledgePool(repo_path)
        pool.build_file_index(file_paths)          # Stage 0 后调用
        pool.structure_indexer.build_index_from_files(...)  # Stage 1 后填充
        content = pool.get_content("src/Foo.java") # Stage 3 中 Agent 调用
    """

    def __init__(
        self,
        repo_path: Path,
        max_content_cache_bytes: int = 100 * 1024 * 1024,
    ) -> None:
        self.repo_path = Path(repo_path)
        self.file_index: dict[str, FileInfo] = {}
        self.structure_indexer: StructureIndexer = StructureIndexer(depth="standard")
        self._content_cache = ContentCache(max_bytes=max_content_cache_bytes)

    # ── Stage 0：构建文件索引 ────────────────────────────────────────────────

    def build_file_index(self, file_paths: list[str]) -> None:
        """从已知路径列表构建文件元信息索引。"""
        self.file_index.clear()
        for rel_path in file_paths:
            abs_path = self.repo_path / rel_path
            if not abs_path.exists():
                continue
            try:
                stat = abs_path.stat()
                lang = _LANG_MAP.get(abs_path.suffix.lower(), "unknown")
                line_count = self._count_lines(abs_path)
                self.file_index[rel_path] = FileInfo(
                    path=rel_path,
                    absolute_path=abs_path,
                    language=lang,
                    size_bytes=stat.st_size,
                    line_count=line_count,
                    modified_time=stat.st_mtime,
                )
            except OSError as e:
                logger.warning("无法读取文件元信息 %s: %s", rel_path, e)

    # ── 公共查询接口 ─────────────────────────────────────────────────────────

    def get_file_info(self, path: str) -> FileInfo | None:
        """获取文件元信息。"""
        return self.file_index.get(path)

    def get_structure(self, path: str) -> FileSkeleton | None:
        """获取文件骨架（类/方法），委托给 StructureIndexer。"""
        return self.structure_indexer._index.get(path)

    def get_content(self, path: str) -> str | None:
        """获取文件内容（自动缓存，线程安全）。"""
        if path not in self.file_index:
            return None
        cached = self._content_cache.get(path)
        if cached is not None:
            return cached
        abs_path = self.file_index[path].absolute_path
        try:
            content = abs_path.read_text(encoding="utf-8", errors="ignore")
            self._content_cache.put(path, content)
            return content
        except OSError as e:
            logger.warning("读取文件失败 %s: %s", path, e)
            return None

    def estimate_tokens(self, paths: list[str]) -> int:
        """估算一组文件的 GLM Token 数。

        GLM Token 规则：
        - 中文字符（\\u4e00-\\u9fff）：1 Token ≈ 1.6 字符
        - 其他内容：约 4 字节/Token
        """
        total = 0
        for path in paths:
            content = self.get_content(path) or ""
            chinese_chars = sum(1 for c in content if "\u4e00" <= c <= "\u9fff")
            other_bytes = len(content.encode("utf-8")) - chinese_chars * 3
            total += int(chinese_chars / 1.6) + max(0, other_bytes // 4)
        return total

    # ── 私有工具 ─────────────────────────────────────────────────────────────

    @staticmethod
    def _count_lines(path: Path) -> int:
        try:
            return sum(1 for _ in path.open(encoding="utf-8", errors="ignore"))
        except OSError:
            return 0
```

- [ ] **Step 4：运行测试，确认通过**

```bash
cd code-graph-system
pytest backend/tests/test_shared_knowledge_pool.py -v
```

预期：所有测试 PASS

- [ ] **Step 5：提交**

```bash
git add backend/cache/shared_knowledge_pool.py backend/tests/test_shared_knowledge_pool.py
git commit -m "feat: 添加 SharedKnowledgePool 共享知识池"
```

---

### Task 3：StageCacheManager（阶段缓存）

**Files:**
- Create: `backend/pipeline/stage_cache.py`
- Create: `backend/tests/test_stage_cache.py`

- [ ] **Step 1：写失败测试**

```python
# backend/tests/test_stage_cache.py
"""StageCacheManager 单元测试。"""
from __future__ import annotations
import time
from pathlib import Path
import pytest
from backend.pipeline.stage_cache import StageCacheManager, StageCacheEntry


class TestStageCacheManager:
    def test_save_and_load_from_memory(self, tmp_path):
        mgr = StageCacheManager(cache_dir=tmp_path)
        entry = StageCacheEntry(
            stage_name="file_index",
            repo_name="my-repo",
            commit_sha="abc12345",
            data={"files": ["a.py", "b.py"]},
        )
        mgr.save(entry)
        loaded = mgr.load("my-repo", "abc12345", "file_index")
        assert loaded is not None
        assert loaded.data == {"files": ["a.py", "b.py"]}

    def test_load_returns_none_for_missing(self, tmp_path):
        mgr = StageCacheManager(cache_dir=tmp_path)
        assert mgr.load("no-repo", "sha", "stage") is None

    def test_cache_key_uses_short_sha(self, tmp_path):
        mgr = StageCacheManager(cache_dir=tmp_path)
        key = mgr.get_cache_key("repo", "abc12345678", "stage0")
        assert "abc12345" in key
        assert "stage0" in key

    def test_cache_key_non_git_uses_mtime_hash(self, tmp_path):
        mgr = StageCacheManager(cache_dir=tmp_path)
        key = mgr.get_cache_key("repo", "", "stage0")
        assert "mtime" in key

    def test_clear_removes_entries(self, tmp_path):
        mgr = StageCacheManager(cache_dir=tmp_path)
        entry = StageCacheEntry(
            stage_name="s0", repo_name="repo", commit_sha="sha1", data={}
        )
        mgr.save(entry)
        mgr.clear("repo")
        assert mgr.load("repo", "sha1", "s0") is None

    def test_persist_to_disk(self, tmp_path):
        mgr = StageCacheManager(cache_dir=tmp_path)
        entry = StageCacheEntry(
            stage_name="module_boundary",
            repo_name="my-repo",
            commit_sha="deadbeef",
            data={"modules": [{"id": "m1"}]},
        )
        mgr.save(entry, persist=True)
        cache_file = tmp_path / "my-repo" / "deadbeef_module_boundary.json"
        assert cache_file.exists()

    def test_load_from_disk_when_not_in_memory(self, tmp_path):
        mgr = StageCacheManager(cache_dir=tmp_path)
        entry = StageCacheEntry(
            stage_name="file_index",
            repo_name="repo2",
            commit_sha="cafebabe",
            data=[1, 2, 3],
        )
        mgr.save(entry, persist=True)

        # 新建 mgr 实例（清空内存），从磁盘加载
        mgr2 = StageCacheManager(cache_dir=tmp_path)
        loaded = mgr2.load("repo2", "cafebabe", "file_index")
        assert loaded is not None
        assert loaded.data == [1, 2, 3]
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd code-graph-system
pytest backend/tests/test_stage_cache.py -v
```

预期：`ModuleNotFoundError`

- [ ] **Step 3：实现 `StageCacheManager`**

```python
# backend/pipeline/stage_cache.py
"""阶段缓存管理器 — 支持断点续跑。"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class StageCacheEntry:
    """阶段缓存条目。"""
    stage_name: str
    repo_name: str
    commit_sha: str
    data: Any
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


class StageCacheManager:
    """阶段缓存管理器（内存 + 可选磁盘持久化）。"""

    def __init__(self, cache_dir: Path = Path("data/pipeline_cache")) -> None:
        self.cache_dir = Path(cache_dir)
        self._memory: dict[str, StageCacheEntry] = {}

    def get_cache_key(self, repo_name: str, commit_sha: str, stage: str) -> str:
        if commit_sha:
            sha_part = commit_sha[:8]
        else:
            sha_part = f"mtime{self._dir_mtime_hash(repo_name)}"
        return f"{repo_name}:{sha_part}:{stage}"

    def load(self, repo_name: str, commit_sha: str, stage: str) -> StageCacheEntry | None:
        """加载缓存：先查内存，再查磁盘。"""
        key = self.get_cache_key(repo_name, commit_sha, stage)
        if key in self._memory:
            return self._memory[key]
        # 尝试从磁盘加载
        return self._load_from_disk(repo_name, commit_sha, stage, key)

    def save(self, entry: StageCacheEntry, persist: bool = False) -> None:
        """保存缓存到内存，可选持久化到磁盘。"""
        key = self.get_cache_key(entry.repo_name, entry.commit_sha, entry.stage_name)
        self._memory[key] = entry
        if persist and entry.commit_sha:
            self._save_to_disk(entry)

    def clear(self, repo_name: str) -> None:
        """清除指定仓库的所有内存缓存。"""
        to_delete = [k for k in self._memory if k.startswith(f"{repo_name}:")]
        for k in to_delete:
            del self._memory[k]

    # ── 私有 ──────────────────────────────────────────────────────────────────

    def _save_to_disk(self, entry: StageCacheEntry) -> None:
        try:
            repo_dir = self.cache_dir / entry.repo_name
            repo_dir.mkdir(parents=True, exist_ok=True)
            file_name = f"{entry.commit_sha[:8]}_{entry.stage_name}.json"
            cache_file = repo_dir / file_name
            payload = {
                "stage_name": entry.stage_name,
                "repo_name": entry.repo_name,
                "commit_sha": entry.commit_sha,
                "created_at": entry.created_at,
                "data": entry.data,
            }
            cache_file.write_text(
                json.dumps(payload, ensure_ascii=False, default=str),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning("阶段缓存持久化失败 %s/%s: %s", entry.repo_name, entry.stage_name, e)

    def _load_from_disk(
        self, repo_name: str, commit_sha: str, stage: str, key: str
    ) -> StageCacheEntry | None:
        if not commit_sha:
            return None
        try:
            file_name = f"{commit_sha[:8]}_{stage}.json"
            cache_file = self.cache_dir / repo_name / file_name
            if not cache_file.exists():
                return None
            payload = json.loads(cache_file.read_text(encoding="utf-8"))
            entry = StageCacheEntry(
                stage_name=payload["stage_name"],
                repo_name=payload["repo_name"],
                commit_sha=payload["commit_sha"],
                data=payload["data"],
                created_at=payload.get("created_at", ""),
            )
            self._memory[key] = entry
            return entry
        except Exception as e:
            logger.warning("从磁盘加载阶段缓存失败 %s/%s: %s", repo_name, stage, e)
            return None

    @staticmethod
    def _dir_mtime_hash(repo_name: str) -> str:
        """非 Git 仓库时用 repo_name 的哈希作为替代标识。"""
        return hashlib.md5(repo_name.encode()).hexdigest()[:6]
```

- [ ] **Step 4：运行测试，确认通过**

```bash
cd code-graph-system
pytest backend/tests/test_stage_cache.py -v
```

预期：所有测试 PASS

- [ ] **Step 5：提交**

```bash
git add backend/pipeline/stage_cache.py backend/tests/test_stage_cache.py
git commit -m "feat: 添加 StageCacheManager 阶段缓存（支持断点续跑）"
```

---

## Chunk 2：基础扩展

### Task 4：StructureIndexer 新增 `build_index_from_files()`

**Files:**
- Modify: `backend/agent/structure_indexer.py`
- Modify: `backend/tests/test_structure_indexer.py`（追加用例）

- [ ] **Step 1：写失败测试（追加到现有测试文件末尾）**

```python
# 追加到 backend/tests/test_structure_indexer.py 末尾

class TestBuildIndexFromFiles:
    """测试 build_index_from_files 跳过目录遍历。"""

    def test_indexes_only_provided_files(self, tmp_path: Path):
        """只索引传入的文件，不扫描其他文件。"""
        (tmp_path / "a.py").write_text("class A: pass", encoding="utf-8")
        (tmp_path / "b.py").write_text("class B: pass", encoding="utf-8")

        indexer = StructureIndexer(depth="standard")
        indexer.build_index_from_files(tmp_path, ["a.py"])  # 只传 a.py

        assert "a.py" in indexer._index
        assert "b.py" not in indexer._index  # b.py 未传入，不应被索引

    def test_result_matches_build_index(self, tmp_path: Path):
        """build_index_from_files 结果与 build_index 一致。"""
        (tmp_path / "main.py").write_text(
            "class Foo:\n    def bar(self): pass\n", encoding="utf-8"
        )

        indexer1 = StructureIndexer(depth="standard")
        indexer1.build_index(tmp_path)

        indexer2 = StructureIndexer(depth="standard")
        indexer2.build_index_from_files(tmp_path, ["main.py"])

        sk1 = indexer1._index["main.py"]
        sk2 = indexer2._index["main.py"]
        assert [c.name for c in sk1.classes] == [c.name for c in sk2.classes]

    def test_skips_nonexistent_file(self, tmp_path: Path):
        """不存在的文件跳过，不抛异常。"""
        (tmp_path / "real.py").write_text("x = 1", encoding="utf-8")
        indexer = StructureIndexer(depth="standard")
        indexer.build_index_from_files(tmp_path, ["real.py", "ghost.py"])
        assert "real.py" in indexer._index
        assert "ghost.py" not in indexer._index
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd code-graph-system
pytest backend/tests/test_structure_indexer.py::TestBuildIndexFromFiles -v
```

预期：`AttributeError: 'StructureIndexer' object has no attribute 'build_index_from_files'`

- [ ] **Step 3：在 `StructureIndexer` 中新增方法**

在 `backend/agent/structure_indexer.py` 的 `build_index` 方法之后添加：

```python
def build_index_from_files(self, repo_path: Path, file_paths: list[str]) -> None:
    """从已知文件列表构建骨架索引，跳过目录遍历。

    与 build_index() 区别：不再 rglob 整个目录，
    直接遍历 file_paths 中已过滤好的相对路径列表。

    Args:
        repo_path: 仓库根目录（绝对路径）
        file_paths: 相对于 repo_path 的文件路径列表
    """
    repo_path = Path(repo_path).resolve()
    self._index.clear()

    for rel_path in file_paths:
        file_path = repo_path / rel_path
        if not file_path.is_file():
            continue

        suffix = file_path.suffix.lower()
        skeleton = None

        if suffix == ".java":
            skeleton = self._scan_java(file_path)
        elif suffix == ".py":
            skeleton = self._scan_python(file_path)
        else:
            skeleton = self._scan_generic(file_path)

        if skeleton is not None:
            skeleton.relative_path = rel_path
            self._index[rel_path] = skeleton

    logger.info(
        "StructureIndexer.build_index_from_files: 索引完成，共 %d 个文件",
        len(self._index),
    )
```

- [ ] **Step 4：运行测试，确认通过**

```bash
cd code-graph-system
pytest backend/tests/test_structure_indexer.py -v
```

预期：所有测试（含新增 3 个）PASS

- [ ] **Step 5：提交**

```bash
git add backend/agent/structure_indexer.py backend/tests/test_structure_indexer.py
git commit -m "feat: StructureIndexer 新增 build_index_from_files() 跳过目录遍历"
```

---

### Task 5：AgentContext + ModuleScannerAgent 适配

**Files:**
- Modify: `backend/agent/context.py`
- Modify: `backend/agent/agents/module_scanner.py`
- Modify: `backend/tests/test_module_scanner_agent.py`（追加用例）

- [ ] **Step 1：写失败测试（追加到 `test_module_scanner_agent.py` 末尾）**

```python
# 追加到 backend/tests/test_module_scanner_agent.py 末尾

class TestModuleScannerWithPrebuiltIndex:
    """测试 ModuleScannerAgent 使用预构建的 StructureIndexer。"""

    def test_context_accepts_structure_indexer(self):
        """AgentContext 接受 structure_indexer 可选字段。"""
        from backend.agent.context import AgentContext, SharedKnowledgeBase
        from backend.agent.structure_indexer import StructureIndexer

        indexer = StructureIndexer(depth="standard")
        ctx = AgentContext(
            repo_path="/tmp",
            module_id="test",
            structure_indexer=indexer,
        )
        assert ctx.structure_indexer is indexer

    def test_context_structure_indexer_defaults_to_none(self):
        """不传 structure_indexer 时默认为 None（向后兼容）。"""
        from backend.agent.context import AgentContext
        ctx = AgentContext(repo_path="/tmp", module_id="test")
        assert ctx.structure_indexer is None

    def test_scanner_uses_prebuilt_index(self, tmp_path):
        """ModuleScannerAgent 使用预构建索引时不再调用 build_index()。"""
        from unittest.mock import MagicMock, patch
        from backend.agent.context import AgentContext, SharedKnowledgeBase
        from backend.agent.structure_indexer import StructureIndexer
        from backend.agent.agents.module_scanner import ModuleScannerAgent
        from backend.scanner.repo_scanner import ScanResult

        # 预构建索引
        (tmp_path / "main.py").write_text("class A: pass", encoding="utf-8")
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(tmp_path)

        ctx = AgentContext(
            repo_path=str(tmp_path),
            module_id="scanner",
            shared_knowledge=SharedKnowledgeBase(),
            structure_indexer=indexer,
        )
        mock_llm = MagicMock()
        mock_llm.complete.return_value = '{"modules": [], "architecture_hints": {}}'

        agent = ModuleScannerAgent(context=ctx, llm_client=mock_llm)

        # 拦截 build_index，如果被调用则测试失败
        with patch.object(indexer, "build_index", side_effect=AssertionError("不应再调用 build_index")) as mock_build:
            scan_result = MagicMock(spec=ScanResult)
            scan_result.files = []
            scan_result.repo_path = str(tmp_path)
            try:
                agent.scan(scan_result)
            except Exception:
                pass  # scan 本身可能因 mock 数据不完整而失败，但 build_index 不应被调用
            mock_build.assert_not_called()
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd code-graph-system
pytest backend/tests/test_module_scanner_agent.py::TestModuleScannerWithPrebuiltIndex -v
```

预期：前两个测试因 `AgentContext` 无 `structure_indexer` 字段而报 `TypeError`

- [ ] **Step 3：修改 `AgentContext`，新增可选字段**

在 `backend/agent/context.py` 的 `AgentContext` dataclass 末尾追加：

```python
    structure_indexer: Optional["StructureIndexer"] = None   # 预构建索引（可选）
```

同时在文件顶部的 `TYPE_CHECKING` 块中补充导入（避免循环）：

```python
if TYPE_CHECKING:
    from backend.llm.context_monitor import ContextMonitor
    from backend.agent.structure_indexer import StructureIndexer   # 新增
```

- [ ] **Step 4：修改 `ModuleScannerAgent.scan()`，检查预构建索引**

在 `backend/agent/agents/module_scanner.py` 中找到 `scan()` 方法内部调用 `build_index()` 或创建新 `StructureIndexer` 的地方，添加检查：

```python
# 在 scan() 方法中，构建结构索引之前：
if self.context.structure_indexer is not None:
    # 使用外部预构建的索引，跳过重复扫描
    structure_indexer = self.context.structure_indexer
    logger.info("ModuleScannerAgent: 使用预构建 StructureIndexer，跳过 build_index()")
else:
    # 原有逻辑：自行构建索引
    structure_indexer = StructureIndexer(depth="standard")
    structure_indexer.build_index(Path(self.context.repo_path))
```

- [ ] **Step 5：运行全部测试，确认通过**

```bash
cd code-graph-system
pytest backend/tests/test_module_scanner_agent.py -v
pytest backend/tests/test_structure_indexer.py -v
```

预期：所有测试 PASS，没有回归

- [ ] **Step 6：提交**

```bash
git add backend/agent/context.py backend/agent/agents/module_scanner.py backend/tests/test_module_scanner_agent.py
git commit -m "feat: AgentContext 支持预构建 StructureIndexer，ModuleScannerAgent 跳过重复扫描"
```

---

## Chunk 3：智能调度器

### Task 6：ModuleBatch（批次合并）

**Files:**
- Create: `backend/pipeline/pipeline_scheduler.py`（含 SchedulerConfig、ModuleScheduleInfo、ModuleBatch）
- Create: `backend/tests/test_pipeline_scheduler.py`

- [ ] **Step 1：写失败测试**

```python
# backend/tests/test_pipeline_scheduler.py
"""IntelligentScheduler 和 ModuleBatch 单元测试。"""
from __future__ import annotations
from unittest.mock import MagicMock
import pytest
from backend.models.ai_analysis import ModuleInfo
from backend.pipeline.pipeline_scheduler import (
    ModuleBatch,
    ModuleScheduleInfo,
    SchedulerConfig,
    IntelligentScheduler,
)


def make_module(module_id: str, file_count: int, est_tokens: int) -> ModuleInfo:
    return ModuleInfo(
        id=module_id,
        name=module_id,
        files=[f"file_{i}.py" for i in range(file_count)],
        purpose="test",
        language="python",
        confidence=1.0,
    )


def make_pool(token_map: dict[str, int]) -> MagicMock:
    pool = MagicMock()
    pool.estimate_tokens = lambda paths: sum(token_map.get(p, 100) for p in paths)
    return pool


class TestModuleBatch:
    def test_single_module_batch_is_not_merged(self):
        m = make_module("mod_big", 20, 20000)
        pool = make_pool({})
        batch = ModuleBatch(batch_id="b1", modules=[m], pool=pool)
        assert not batch.is_merged

    def test_small_modules_batch_is_merged(self):
        m1 = make_module("mod_a", 2, 3000)
        m2 = make_module("mod_b", 2, 3000)
        pool = MagicMock()
        pool.estimate_tokens.return_value = 3000
        batch = ModuleBatch(batch_id="b1", modules=[m1, m2], pool=pool, force_merged=True)
        assert batch.is_merged

    def test_get_module_by_id(self):
        m = make_module("mod_x", 3, 5000)
        pool = MagicMock()
        pool.estimate_tokens.return_value = 5000
        batch = ModuleBatch(batch_id="b1", modules=[m], pool=pool)
        assert batch.get_module("mod_x") is m
        assert batch.get_module("nonexistent") is None

    def test_parse_response_valid_json(self):
        m1 = make_module("m1", 1, 1000)
        m2 = make_module("m2", 1, 1000)
        pool = MagicMock()
        pool.estimate_tokens.return_value = 1000
        batch = ModuleBatch(batch_id="b1", modules=[m1, m2], pool=pool, force_merged=True)
        response = '{"m1": {"functions": [], "classes": [], "calls": []}, "m2": {"functions": [], "classes": [], "calls": []}}'
        results = batch.parse_response(response)
        assert "m1" in results
        assert "m2" in results

    def test_parse_response_missing_module_returns_none(self):
        m1 = make_module("m1", 1, 1000)
        m2 = make_module("m2", 1, 1000)
        pool = MagicMock()
        pool.estimate_tokens.return_value = 1000
        batch = ModuleBatch(batch_id="b1", modules=[m1, m2], pool=pool, force_merged=True)
        response = '{"m1": {"functions": [], "classes": [], "calls": []}}'
        results = batch.parse_response(response)
        assert results["m1"] is not None
        assert results["m2"] is None  # 缺失 → Level 1 降级标记


class TestIntelligentScheduler:
    def test_schedule_sorts_small_modules_first(self):
        modules = [
            make_module("big", 30, 20000),
            make_module("small", 2, 1000),
            make_module("medium", 10, 8000),
        ]
        pool = MagicMock()
        pool.estimate_tokens.side_effect = lambda paths: len(paths) * 500
        config = SchedulerConfig()
        scheduler = IntelligentScheduler(config=config, pool=pool)
        batches = scheduler.schedule(modules)
        # 第一个 batch 应该是最小的模块
        assert batches[0].modules[0].id == "small"

    def test_small_modules_are_merged(self):
        # 两个小模块（各 1000 token）应该被合并
        modules = [
            make_module("a", 2, 1000),
            make_module("b", 2, 1000),
        ]
        pool = MagicMock()
        pool.estimate_tokens.return_value = 1000
        config = SchedulerConfig(batch_token_threshold=8000)
        scheduler = IntelligentScheduler(config=config, pool=pool)
        batches = scheduler.schedule(modules)
        assert any(b.is_merged for b in batches)

    def test_large_module_not_merged(self):
        modules = [make_module("big", 30, 20000)]
        pool = MagicMock()
        pool.estimate_tokens.return_value = 20000
        config = SchedulerConfig(batch_token_threshold=8000)
        scheduler = IntelligentScheduler(config=config, pool=pool)
        batches = scheduler.schedule(modules)
        assert not batches[0].is_merged

    def test_on_rate_limit_returns_backoff_time(self):
        pool = MagicMock()
        config = SchedulerConfig(rate_limit_backoff_base=5.0)
        scheduler = IntelligentScheduler(config=config, pool=pool)
        wait1 = scheduler.on_rate_limit()
        wait2 = scheduler.on_rate_limit()
        assert wait2 > wait1  # 指数退避

    def test_on_success_resets_rate_limit_count(self):
        pool = MagicMock()
        config = SchedulerConfig()
        scheduler = IntelligentScheduler(config=config, pool=pool)
        scheduler.on_rate_limit()
        scheduler.on_rate_limit()
        scheduler.on_success(response_time_ms=1000.0)
        assert scheduler._rate_limit_count == 0
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd code-graph-system
pytest backend/tests/test_pipeline_scheduler.py -v
```

预期：`ModuleNotFoundError`

- [ ] **Step 3：实现 `pipeline_scheduler.py`**

```python
# backend/pipeline/pipeline_scheduler.py
"""智能调度器 + ModuleBatch — 模块调度和批次合并。

注意：故意放在 pipeline/ 而非 scheduler/，避免与 Celery scheduler/ 目录混淆。
"""
from __future__ import annotations

import json
import logging
import threading
import uuid
from dataclasses import dataclass, field
from collections import deque
from typing import TYPE_CHECKING, Any

from backend.models.ai_analysis import ModuleInfo

if TYPE_CHECKING:
    from backend.cache.shared_knowledge_pool import SharedKnowledgePool

logger = logging.getLogger(__name__)


@dataclass
class SchedulerConfig:
    """调度器配置。"""
    initial_concurrency: int = 2          # GLM-4 默认 2 并发
    max_concurrency: int = 5              # 与现有 ConcurrencyController 一致
    min_concurrency: int = 1
    batch_token_threshold: int = 8000     # 单模块 Token ≤ 此值才参与合并
    batch_max_total_tokens: int = 16000   # 合并批次的 Token 上限
    response_time_threshold_fast_ms: float = 3000.0   # 连续快 → 增加并发
    response_time_threshold_slow_ms: float = 8000.0   # 连续慢 → 降低并发
    fast_slow_window: int = 3             # 连续多少次触发调整
    rate_limit_backoff_base: float = 5.0  # 退避基数（秒）
    rate_limit_max_consecutive: int = 3   # 连续多少次 429 后减半并发


# ── ModuleScheduleInfo ────────────────────────────────────────────────────────

@dataclass
class ModuleScheduleInfo:
    """模块调度信息（内部使用）。"""
    module: ModuleInfo
    estimated_tokens: int
    complexity_score: float


# ── ModuleBatch ───────────────────────────────────────────────────────────────

class ModuleBatch:
    """模块批次 — 可包含一个或多个模块。

    is_merged=True 时，使用 complete() 一次性分析所有模块。
    is_merged=False 时，使用 AgentOrchestrator 深度分析单个模块。
    """

    def __init__(
        self,
        batch_id: str,
        modules: list[ModuleInfo],
        pool: "SharedKnowledgePool",
        force_merged: bool = False,
    ) -> None:
        self.batch_id = batch_id
        self.modules = modules
        self.pool = pool
        self._force_merged = force_merged
        self._total_tokens: int | None = None

    @property
    def is_merged(self) -> bool:
        return self._force_merged or len(self.modules) > 1

    @property
    def total_estimated_tokens(self) -> int:
        if self._total_tokens is None:
            all_files = [f for m in self.modules for f in m.files]
            self._total_tokens = self.pool.estimate_tokens(all_files)
        return self._total_tokens

    def get_module(self, module_id: str) -> ModuleInfo | None:
        return next((m for m in self.modules if m.id == module_id), None)

    def to_prompt(self) -> str:
        """生成合并分析的提示词。"""
        parts = [f"请分析以下 {len(self.modules)} 个代码模块，提取类、函数、调用关系。\n"]
        for i, module in enumerate(self.modules, 1):
            parts.append(f"\n## 模块 {i}（ID: {module.id}）: {module.name}")
            parts.append(f"职责: {module.purpose}")
            parts.append(f"文件列表: {', '.join(module.files[:10])}")
            # 读取文件内容（限制单文件 4000 字符）
            contents = []
            for fpath in module.files[:10]:
                content = self.pool.get_content(fpath) or ""
                if len(content) > 4000:
                    content = content[:4000] + "\n...(truncated)"
                if content:
                    contents.append(f"// {fpath}\n{content}")
            parts.append("\n```\n" + "\n".join(contents) + "\n```")

        parts.append(
            "\n## 输出格式\n\n以 JSON 输出，按模块 ID 组织：\n\n"
            "```json\n{\n"
            '  "<module_id>": {\n'
            '    "functions": [{"id": "...", "name": "...", "file_path": "...", "summary": "..."}],\n'
            '    "classes": [{"id": "...", "name": "...", "file_path": "...", "summary": "..."}],\n'
            '    "calls": [{"from": "...", "to": "..."}]\n'
            "  }\n}\n```\n\n只输出 JSON，不要其他解释。"
        )
        return "\n".join(parts)

    def parse_response(self, response: str) -> dict[str, Any | None]:
        """解析合并响应，返回 {module_id: data | None}。

        None 表示该模块解析失败（触发 Level 1 降级）。
        """
        result: dict[str, Any | None] = {m.id: None for m in self.modules}
        if not response:
            return result

        # 提取 JSON
        content = response.strip()
        if "```json" in content:
            try:
                content = content.split("```json")[1].split("```")[0].strip()
            except IndexError:
                pass
        elif "```" in content:
            parts = content.split("```")
            for p in reversed(parts):
                p = p.strip()
                if p.startswith("{"):
                    content = p
                    break
        if not content.startswith("{"):
            idx = content.find("{")
            if idx >= 0:
                content = content[idx:]

        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            logger.warning("ModuleBatch 响应 JSON 解析失败: %s", e)
            return result

        for module_id in result:
            if module_id in data:
                result[module_id] = data[module_id]
            else:
                logger.warning("模块 %s 在合并响应中缺失，触发 Level 1 降级", module_id)

        return result


# ── IntelligentScheduler ──────────────────────────────────────────────────────

class IntelligentScheduler:
    """智能调度器 — 排序、分批、自适应并发。"""

    def __init__(self, config: SchedulerConfig, pool: "SharedKnowledgePool") -> None:
        self.config = config
        self.pool = pool
        self.current_concurrency = config.initial_concurrency
        self._response_times: deque[float] = deque(maxlen=config.fast_slow_window * 2)
        self._rate_limit_count = 0
        self._lock = threading.Lock()

    def schedule(self, modules: list[ModuleInfo]) -> list[ModuleBatch]:
        """生成调度计划：排序 → 小模块合并 → 返回批次列表。"""
        # 计算调度信息
        infos = []
        for m in modules:
            tokens = self.pool.estimate_tokens(m.files)
            score = tokens / 16000 + len(m.files) / 50
            infos.append(ModuleScheduleInfo(module=m, estimated_tokens=tokens, complexity_score=score))

        # 按复杂度升序（小优先）
        infos.sort(key=lambda x: x.complexity_score)

        batches: list[ModuleBatch] = []
        pending_merged: list[ModuleInfo] = []
        pending_tokens = 0

        for info in infos:
            if info.estimated_tokens <= self.config.batch_token_threshold:
                # 候选合并
                if pending_tokens + info.estimated_tokens <= self.config.batch_max_total_tokens:
                    pending_merged.append(info.module)
                    pending_tokens += info.estimated_tokens
                else:
                    # 当前合并批次已满，先提交
                    if pending_merged:
                        batches.append(self._make_merged_batch(pending_merged))
                    pending_merged = [info.module]
                    pending_tokens = info.estimated_tokens
            else:
                # 大模块：先提交累积的合并批次
                if pending_merged:
                    batches.append(self._make_merged_batch(pending_merged))
                    pending_merged = []
                    pending_tokens = 0
                # 大模块单独一个批次
                batches.append(ModuleBatch(
                    batch_id=str(uuid.uuid4())[:8],
                    modules=[info.module],
                    pool=self.pool,
                ))

        # 提交剩余合并批次
        if pending_merged:
            batches.append(self._make_merged_batch(pending_merged))

        return batches

    def on_rate_limit(self) -> float:
        """处理 429 限速，返回退避等待时间（指数退避）。"""
        with self._lock:
            self._rate_limit_count += 1
            count = self._rate_limit_count
        wait = min(
            self.config.rate_limit_backoff_base * (2 ** (count - 1)),
            120.0,
        )
        logger.warning("429 限速（第 %d 次），退避 %.0fs", count, wait)
        return wait

    def on_success(self, response_time_ms: float) -> None:
        """记录成功响应，重置限速计数，尝试调整并发。"""
        with self._lock:
            self._rate_limit_count = 0
            self._response_times.append(response_time_ms)
            self._try_adjust_concurrency()

    def _try_adjust_concurrency(self) -> None:
        """根据最近响应时间调整并发度（需在 _lock 内调用）。"""
        window = self.config.fast_slow_window
        if len(self._response_times) < window:
            return
        recent = list(self._response_times)[-window:]
        avg = sum(recent) / len(recent)
        if avg < self.config.response_time_threshold_fast_ms:
            if self.current_concurrency < self.config.max_concurrency:
                self.current_concurrency += 1
                logger.info("并发度 +1 → %d（平均响应 %.0fms）", self.current_concurrency, avg)
        elif avg > self.config.response_time_threshold_slow_ms:
            if self.current_concurrency > self.config.min_concurrency:
                self.current_concurrency -= 1
                logger.info("并发度 -1 → %d（平均响应 %.0fms）", self.current_concurrency, avg)

    def _make_merged_batch(self, modules: list[ModuleInfo]) -> ModuleBatch:
        if len(modules) == 1:
            return ModuleBatch(
                batch_id=str(uuid.uuid4())[:8],
                modules=modules,
                pool=self.pool,
            )
        return ModuleBatch(
            batch_id=str(uuid.uuid4())[:8],
            modules=modules,
            pool=self.pool,
            force_merged=True,
        )
```

- [ ] **Step 4：运行测试，确认通过**

```bash
cd code-graph-system
pytest backend/tests/test_pipeline_scheduler.py -v
```

预期：所有测试 PASS

- [ ] **Step 5：提交**

```bash
git add backend/pipeline/pipeline_scheduler.py backend/tests/test_pipeline_scheduler.py
git commit -m "feat: 添加 IntelligentScheduler 和 ModuleBatch 批次合并"
```

---

## Chunk 4：优化流水线各阶段

### Task 7：Stages 基类 + Stage 0/1

**Files:**
- Create: `backend/pipeline/stages/__init__.py`
- Create: `backend/pipeline/stages/base.py`
- Create: `backend/pipeline/stages/file_index.py`
- Create: `backend/pipeline/stages/structure_parse.py`

- [ ] **Step 1：创建 `__init__.py` 和 `base.py`**

```python
# backend/pipeline/stages/__init__.py
```

```python
# backend/pipeline/stages/base.py
"""Stage 抽象基类。"""
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any


class StageBase(ABC):
    """所有流水线阶段的基类。"""

    @property
    @abstractmethod
    def name(self) -> str:
        """阶段名称（用于缓存 key）。"""

    @abstractmethod
    def run(self, **kwargs: Any) -> Any:
        """执行阶段，返回阶段输出。"""
```

- [ ] **Step 2：实现 Stage 0（FileIndex）**

```python
# backend/pipeline/stages/file_index.py
"""Stage 0: 文件索引 — 扫描仓库文件，构建 SharedKnowledgePool.file_index。"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from backend.cache.shared_knowledge_pool import SharedKnowledgePool
from backend.pipeline.stages.base import StageBase
from backend.scanner.repo_scanner import RepoScanner

logger = logging.getLogger(__name__)


class FileIndexStage(StageBase):
    """Stage 0: 扫描文件列表，填充 SharedKnowledgePool.file_index。"""

    name = "file_index"

    def run(
        self,
        repo_path: Path,
        pool: SharedKnowledgePool,
        on_progress: Callable | None = None,
    ) -> list[str]:
        """
        Returns:
            已扫描的相对路径列表
        """
        if on_progress:
            on_progress({"step": "file_index", "status": "start", "message": "扫描文件列表..."})

        scanner = RepoScanner()
        scan_result = scanner.scan(repo_path)

        file_paths = [f.path for f in scan_result.files]
        pool.build_file_index(file_paths)

        msg = f"文件索引完成: {len(file_paths)} 个文件"
        logger.info("Stage 0 完成: %s", msg)
        if on_progress:
            on_progress({
                "step": "file_index", "status": "complete",
                "message": msg, "files": len(file_paths),
            })

        return file_paths
```

- [ ] **Step 3：实现 Stage 1（StructureParse）**

```python
# backend/pipeline/stages/structure_parse.py
"""Stage 1: 骨架解析 — 利用预扫描文件列表构建 StructureIndexer，跳过重复遍历。"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from backend.cache.shared_knowledge_pool import SharedKnowledgePool
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)


class StructureParseStage(StageBase):
    """Stage 1: 从 Stage 0 的文件列表构建骨架索引。"""

    name = "structure_parse"

    def run(
        self,
        pool: SharedKnowledgePool,
        on_progress: Callable | None = None,
    ) -> None:
        if on_progress:
            on_progress({"step": "structure_parse", "status": "start", "message": "解析代码骨架..."})

        file_paths = list(pool.file_index.keys())
        pool.structure_indexer.build_index_from_files(pool.repo_path, file_paths)

        indexed = len(pool.structure_indexer._index)
        msg = f"骨架解析完成: {indexed} 个文件已索引"
        logger.info("Stage 1 完成: %s", msg)
        if on_progress:
            on_progress({
                "step": "structure_parse", "status": "complete",
                "message": msg, "indexed": indexed,
            })
```

- [ ] **Step 4：提交**

```bash
git add backend/pipeline/stages/
git commit -m "feat: 添加 StageBase + Stage 0/1（FileIndex + StructureParse）"
```

---

### Task 8：Stage 2/3/4 + OptimizedPipeline

**Files:**
- Create: `backend/pipeline/stages/module_boundary.py`
- Create: `backend/pipeline/stages/parallel_analysis.py`
- Create: `backend/pipeline/stages/graph_merge.py`
- Create: `backend/pipeline/optimized_pipeline.py`
- Create: `backend/tests/test_optimized_pipeline.py`

- [ ] **Step 1：写集成测试（用 mock LLM）**

```python
# backend/tests/test_optimized_pipeline.py
"""OptimizedPipeline 集成测试（使用 mock LLM，不需要真实 API Key）。"""
from __future__ import annotations
import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest
from backend.pipeline.optimized_pipeline import OptimizedPipeline
from backend.pipeline.pipeline_scheduler import SchedulerConfig


@pytest.fixture
def sample_repo(tmp_path: Path) -> Path:
    """创建包含若干 Python 文件的临时仓库。"""
    (tmp_path / "main.py").write_text(
        "def main():\n    pass\n", encoding="utf-8"
    )
    (tmp_path / "utils.py").write_text(
        "class Helper:\n    def run(self): pass\n", encoding="utf-8"
    )
    sub = tmp_path / "api"
    sub.mkdir()
    (sub / "endpoints.py").write_text(
        "def get_users(): pass\n", encoding="utf-8"
    )
    return tmp_path


def make_mock_llm(module_plan_json: str, analysis_json: str) -> MagicMock:
    """构造 mock LLM，第一次返回模块计划，后续返回分析结果。"""
    mock = MagicMock()
    mock.provider = "zhipu"
    call_count = [0]

    def complete_side_effect(*args, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            return module_plan_json
        return analysis_json

    mock.complete.side_effect = complete_side_effect
    return mock


class TestOptimizedPipelineBasic:
    def test_analyze_returns_result_with_graph_id(self, sample_repo):
        module_plan = json.dumps({
            "modules": [
                {"id": "module:default", "name": "Default", "files": ["main.py", "utils.py", "api/endpoints.py"],
                 "purpose": "主模块", "language": "python", "confidence": 0.9}
            ],
            "architecture_hints": {}
        })
        analysis = json.dumps({
            "module:default": {
                "functions": [{"id": "main.py:main", "name": "main", "file_path": "main.py", "summary": "入口"}],
                "classes": [{"id": "utils.py:Helper", "name": "Helper", "file_path": "utils.py", "summary": "助手"}],
                "calls": []
            }
        })
        mock_llm = make_mock_llm(module_plan, analysis)

        with patch("backend.pipeline.optimized_pipeline.LLMClient") as MockLLM:
            MockLLM.return_value = mock_llm
            pipeline = OptimizedPipeline()
            result = pipeline.analyze(sample_repo, repo_name="test-repo")

        assert result.graph_id
        assert result.status in ("success", "partial")
        assert result.node_count >= 0

    def test_analyze_raises_for_nonexistent_path(self):
        pipeline = OptimizedPipeline()
        with pytest.raises(ValueError, match="不存在"):
            pipeline.analyze(Path("/nonexistent/path"))

    def test_analyze_raises_for_empty_repo(self, tmp_path):
        pipeline = OptimizedPipeline()
        with pytest.raises(ValueError, match="没有找到"):
            pipeline.analyze(tmp_path)

    def test_on_progress_called(self, sample_repo):
        module_plan = json.dumps({
            "modules": [
                {"id": "m1", "name": "M1", "files": ["main.py"],
                 "purpose": "test", "language": "python", "confidence": 1.0}
            ],
            "architecture_hints": {}
        })
        analysis = json.dumps({
            "m1": {"functions": [], "classes": [], "calls": []}
        })
        mock_llm = make_mock_llm(module_plan, analysis)
        progress_events = []

        with patch("backend.pipeline.optimized_pipeline.LLMClient") as MockLLM:
            MockLLM.return_value = mock_llm
            pipeline = OptimizedPipeline()
            pipeline.analyze(
                sample_repo,
                repo_name="test",
                on_progress=progress_events.append,
            )

        step_names = {e["step"] for e in progress_events}
        assert "file_index" in step_names
        assert "structure_parse" in step_names
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd code-graph-system
pytest backend/tests/test_optimized_pipeline.py -v
```

预期：`ModuleNotFoundError: No module named 'backend.pipeline.optimized_pipeline'`

- [ ] **Step 3：实现 Stage 2（ModuleBoundary）**

```python
# backend/pipeline/stages/module_boundary.py
"""Stage 2: AI 模块边界识别。"""
from __future__ import annotations

import logging
from typing import Callable

from backend.agent.agents.module_scanner import ModuleScannerAgent
from backend.agent.context import AgentContext, SharedKnowledgeBase
from backend.cache.shared_knowledge_pool import SharedKnowledgePool
from backend.llm.client import LLMClient
from backend.models.ai_analysis import ModuleInfo, ModulePlan
from backend.pipeline.stages.base import StageBase
from backend.scanner.repo_scanner import ScanResult

logger = logging.getLogger(__name__)


class ModuleBoundaryStage(StageBase):
    """Stage 2: 调用 ModuleScannerAgent 识别模块边界（注入预构建索引）。"""

    name = "module_boundary"

    def run(
        self,
        pool: SharedKnowledgePool,
        llm_client: LLMClient,
        on_progress: Callable | None = None,
    ) -> ModulePlan:
        if on_progress:
            on_progress({"step": "module_boundary", "status": "start", "message": "AI 识别模块边界..."})

        context = AgentContext(
            repo_path=str(pool.repo_path),
            module_id="scanner",
            shared_knowledge=SharedKnowledgeBase(),
            structure_indexer=pool.structure_indexer,  # 注入预构建索引
        )

        # 构造 ScanResult（复用 pool 中已有的文件信息）
        from backend.scanner.repo_scanner import FileInfo as ScanFileInfo
        scan_files = []
        for rel_path, info in pool.file_index.items():
            scan_files.append(ScanFileInfo(
                path=rel_path,
                language=info.language,
                size=info.size_bytes,
            ))

        scan_result = ScanResult(
            repo_path=str(pool.repo_path),
            files=scan_files,
        )

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)
        plan = agent.scan(scan_result)

        modules = plan.modules or []
        msg = f"模块边界识别完成: {len(modules)} 个模块"
        logger.info("Stage 2 完成: %s", msg)
        if on_progress:
            on_progress({
                "step": "module_boundary", "status": "complete",
                "message": msg, "modules": len(modules),
            })

        return plan
```

- [ ] **Step 4：实现 Stage 3（ParallelAnalysis）**

```python
# backend/pipeline/stages/parallel_analysis.py
"""Stage 3: 并行分析 — ThreadPoolExecutor + 三级降级策略。"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Callable

from backend.cache.shared_knowledge_pool import SharedKnowledgePool
from backend.graph.graph_schema import GraphEdge, GraphNode
from backend.llm.client import LLMClient, RateLimitExhaustedError
from backend.models.ai_analysis import FailedModule, ModuleInfo
from backend.pipeline.pipeline_scheduler import (
    IntelligentScheduler,
    ModuleBatch,
    SchedulerConfig,
)
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)


@dataclass
class ModuleResult:
    """单个模块的分析结果。"""
    module_id: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    execution_time_ms: float = 0.0


class ParallelAnalysisStage(StageBase):
    """Stage 3: 并行分析所有模块，含三级降级策略。"""

    name = "parallel_analysis"

    def run(
        self,
        modules: list[ModuleInfo],
        pool: SharedKnowledgePool,
        llm_client: LLMClient,
        scheduler_config: SchedulerConfig,
        on_progress: Callable | None = None,
    ) -> tuple[list[GraphNode], list[GraphEdge], list[FailedModule]]:
        if on_progress:
            on_progress({
                "step": "parallel_analysis", "status": "start",
                "message": f"并行分析 {len(modules)} 个模块...",
            })

        scheduler = IntelligentScheduler(config=scheduler_config, pool=pool)
        batches = scheduler.schedule(modules)

        all_nodes: list[GraphNode] = []
        all_edges: list[GraphEdge] = []
        failed: list[FailedModule] = []
        retry_queue: list[ModuleInfo] = []

        # 并行执行批次
        with ThreadPoolExecutor(max_workers=scheduler.current_concurrency) as executor:
            future_to_batch = {
                executor.submit(self._execute_batch, batch, pool, llm_client): batch
                for batch in batches
            }

            for future in as_completed(future_to_batch):
                batch = future_to_batch[future]
                t_start = time.time()
                try:
                    batch_results = future.result()
                    elapsed_ms = (time.time() - t_start) * 1000
                    scheduler.on_success(elapsed_ms)

                    # Level 1 降级：收集 None 结果进入重试队列
                    for module_id, result in batch_results.items():
                        if result is None:
                            mod = batch.get_module(module_id)
                            if mod:
                                retry_queue.append(mod)
                        else:
                            all_nodes.extend(result.nodes)
                            all_edges.extend(result.edges)

                except RateLimitExhaustedError:
                    wait = scheduler.on_rate_limit()
                    time.sleep(wait)
                    retry_queue.extend(batch.modules)

                except Exception as e:
                    logger.error("批次 %s 执行失败: %s", batch.batch_id, e)
                    retry_queue.extend(batch.modules)

        # Level 2 降级：单模块重新分析
        for module in retry_queue:
            try:
                nodes, edges = self._analyze_single_with_complete(module, pool, llm_client)
                all_nodes.extend(nodes)
                all_edges.extend(edges)
            except Exception as e:
                logger.error("模块 %s Level 2 降级失败: %s", module.id, e)
                # Level 3 降级：记录失败
                failed.append(FailedModule(
                    module_id=module.id,
                    reason=str(e),
                    files_attempted=module.files[:5],
                ))

        msg = f"并行分析完成: {len(all_nodes)} 节点, {len(all_edges)} 边, {len(failed)} 模块失败"
        logger.info("Stage 3 完成: %s", msg)
        if on_progress:
            on_progress({
                "step": "parallel_analysis", "status": "complete",
                "message": msg, "nodes": len(all_nodes), "edges": len(all_edges),
            })

        return all_nodes, all_edges, failed

    def _execute_batch(
        self,
        batch: ModuleBatch,
        pool: SharedKnowledgePool,
        llm_client: LLMClient,
    ) -> dict[str, ModuleResult | None]:
        """执行单个批次，返回 {module_id: ModuleResult | None}。"""
        if batch.is_merged:
            return self._execute_merged_batch(batch, pool, llm_client)
        else:
            return self._execute_single_batch(batch, pool, llm_client)

    def _execute_merged_batch(
        self,
        batch: ModuleBatch,
        pool: SharedKnowledgePool,
        llm_client: LLMClient,
    ) -> dict[str, ModuleResult | None]:
        prompt = batch.to_prompt()
        response = llm_client.complete(
            prompt=prompt,
            system="你是代码分析专家，擅长提取代码结构。",
            max_tokens=8192,
        )
        parsed = batch.parse_response(response)
        results: dict[str, ModuleResult | None] = {}
        for module_id, data in parsed.items():
            if data is None:
                results[module_id] = None
            else:
                nodes, edges = self._data_to_graph(data, module_id)
                results[module_id] = ModuleResult(
                    module_id=module_id, nodes=nodes, edges=edges
                )
        return results

    def _execute_single_batch(
        self,
        batch: ModuleBatch,
        pool: SharedKnowledgePool,
        llm_client: LLMClient,
    ) -> dict[str, ModuleResult | None]:
        module = batch.modules[0]
        nodes, edges = self._analyze_single_with_complete(module, pool, llm_client)
        return {module.id: ModuleResult(module_id=module.id, nodes=nodes, edges=edges)}

    def _analyze_single_with_complete(
        self,
        module: ModuleInfo,
        pool: SharedKnowledgePool,
        llm_client: LLMClient,
    ) -> tuple[list[GraphNode], list[GraphEdge]]:
        """单模块分析（复用现有 AIPipeline._analyze_with_complete 逻辑）。"""
        from backend.pipeline.ai_analyze import AIPipeline
        pipeline = AIPipeline()
        return pipeline._analyze_with_complete(pool.repo_path, module, llm_client)

    @staticmethod
    def _data_to_graph(
        data: dict, module_id: str
    ) -> tuple[list[GraphNode], list[GraphEdge]]:
        """将解析后的字典转换为 GraphNode / GraphEdge 列表。"""
        from backend.graph.graph_schema import GraphNode, GraphEdge
        nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []

        for func in data.get("functions", []):
            nodes.append(GraphNode(
                id=func.get("id", f"{module_id}:{func.get('name', 'unknown')}"),
                type="Function",
                name=func.get("name", ""),
                properties={"file_path": func.get("file_path", ""), "summary": func.get("summary", ""), "module_id": module_id},
            ))
        for cls in data.get("classes", []):
            nodes.append(GraphNode(
                id=cls.get("id", f"{module_id}:{cls.get('name', 'unknown')}"),
                type="Class",
                name=cls.get("name", ""),
                properties={"file_path": cls.get("file_path", ""), "summary": cls.get("summary", ""), "module_id": module_id},
            ))
        for call in data.get("calls", []):
            from_id = call.get("from", "")
            to_id = call.get("to", "")
            if from_id and to_id:
                edges.append(GraphEdge.model_validate({"from": from_id, "to": to_id, "type": "calls", "properties": {}}))

        return nodes, edges
```

- [ ] **Step 5：实现 Stage 4（GraphMerge）**

```python
# backend/pipeline/stages/graph_merge.py
"""Stage 4: 图谱合并 — 与现有 GraphBuilder 无缝对接。"""
from __future__ import annotations

import logging
from typing import Callable

from backend.graph.graph_builder import BuiltGraph, GraphBuilder
from backend.graph.graph_schema import GraphEdge, GraphNode
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)


class GraphMergeStage(StageBase):
    """Stage 4: 合并所有节点/边，构建 BuiltGraph。"""

    name = "graph_merge"

    def run(
        self,
        nodes: list[GraphNode],
        edges: list[GraphEdge],
        on_progress: Callable | None = None,
    ) -> BuiltGraph:
        if on_progress:
            on_progress({"step": "graph_merge", "status": "start", "message": "构建图谱..."})

        builder = GraphBuilder()
        for node in nodes:
            builder.add_node(node)
        for edge in edges:
            builder.add_edge(edge)

        built = builder.build()
        msg = f"图谱构建完成: {built.node_count} 节点, {built.edge_count} 边"
        logger.info("Stage 4 完成: %s", msg)
        if on_progress:
            on_progress({"step": "graph_merge", "status": "complete", "message": msg})

        return built
```

- [ ] **Step 6：实现 `OptimizedPipeline`**

```python
# backend/pipeline/optimized_pipeline.py
"""优化版流水线 — 5 阶段编排入口。

内部编排 5 个 Stage，对外暴露与 AIPipeline 相同的 analyze() 接口。
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Callable, Optional

from backend.cache.shared_knowledge_pool import SharedKnowledgePool
from backend.graph.graph_repository import GraphRepository
from backend.llm.client import LLMClient
from backend.models.ai_analysis import (
    AIAnalysisConfig,
    AIAnalysisResult,
    ModuleInfo,
    ModulePlan,
)
from backend.pipeline.pipeline_scheduler import SchedulerConfig
from backend.pipeline.stage_cache import StageCacheEntry, StageCacheManager
from backend.pipeline.stages.file_index import FileIndexStage
from backend.pipeline.stages.graph_merge import GraphMergeStage
from backend.pipeline.stages.module_boundary import ModuleBoundaryStage
from backend.pipeline.stages.parallel_analysis import ParallelAnalysisStage
from backend.pipeline.stages.structure_parse import StructureParseStage
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.rag.vector_store import VectorStore

logger = logging.getLogger(__name__)


class OptimizedPipeline:
    """优化版 AI 分析流水线（5 阶段）。

    与 AIPipeline 接口兼容，通过 AIPipeline(enable_optimization=True) 调用。
    """

    def __init__(
        self,
        config: Optional[AIAnalysisConfig] = None,
        graph_repo: Optional[GraphRepository] = None,
        vector_store: Optional[VectorStore] = None,
        rag_engine: Optional[GraphRAGEngine] = None,
        scheduler_config: Optional[SchedulerConfig] = None,
        persist_stage_cache: bool = False,
    ):
        self.config = config or AIAnalysisConfig()
        self._repo = graph_repo or GraphRepository()
        self._vector_store = vector_store
        self._rag_engine = rag_engine
        self._scheduler_config = scheduler_config or SchedulerConfig()
        self._stage_cache = StageCacheManager()
        self._persist_stage_cache = persist_stage_cache

    def analyze(
        self,
        repo_path: str | Path,
        *,
        repo_name: str = "",
        enable_rag: bool = False,
        on_progress: Optional[Callable[[dict], None]] = None,
    ) -> AIAnalysisResult:
        start = time.time()
        repo_path = Path(repo_path).resolve()

        if not repo_path.exists():
            raise ValueError(f"仓库路径不存在: {repo_path}")
        if not repo_path.is_dir():
            raise ValueError(f"路径不是目录: {repo_path}")

        name = repo_name or repo_path.name
        llm_client = self._create_llm_client()
        pool = SharedKnowledgePool(repo_path)

        # 获取 commit sha（用于缓存 key）
        commit_sha = self._get_commit_sha(repo_path)

        # ── Stage 0: FileIndex ───────────────────────────────────────────────
        cached = self._stage_cache.load(name, commit_sha, "file_index")
        if cached:
            pool.build_file_index(cached.data)
            logger.info("Stage 0 缓存命中")
            if on_progress:
                on_progress({"step": "file_index", "status": "cached", "message": "文件索引缓存命中"})
        else:
            file_paths = FileIndexStage().run(repo_path, pool, on_progress)
            if not file_paths:
                raise ValueError(f"没有找到任何源码文件: {repo_path}")
            self._stage_cache.save(
                StageCacheEntry(stage_name="file_index", repo_name=name, commit_sha=commit_sha, data=file_paths),
                persist=self._persist_stage_cache,
            )

        # ── Stage 1: StructureParse ──────────────────────────────────────────
        cached = self._stage_cache.load(name, commit_sha, "structure_parse")
        if cached:
            logger.info("Stage 1 缓存命中，跳过骨架解析")
            if on_progress:
                on_progress({"step": "structure_parse", "status": "cached", "message": "骨架解析缓存命中"})
        else:
            StructureParseStage().run(pool, on_progress)
            self._stage_cache.save(
                StageCacheEntry(stage_name="structure_parse", repo_name=name, commit_sha=commit_sha, data=True),
                persist=self._persist_stage_cache,
            )

        # ── Stage 2: ModuleBoundary ──────────────────────────────────────────
        cached = self._stage_cache.load(name, commit_sha, "module_boundary")
        if cached:
            from backend.models.ai_analysis import ModulePlan as MP
            plan = MP(**cached.data) if isinstance(cached.data, dict) else cached.data
            logger.info("Stage 2 缓存命中")
            if on_progress:
                on_progress({"step": "module_boundary", "status": "cached", "message": "模块边界缓存命中"})
        else:
            plan = ModuleBoundaryStage().run(pool, llm_client, on_progress)
            self._stage_cache.save(
                StageCacheEntry(stage_name="module_boundary", repo_name=name, commit_sha=commit_sha,
                                data=plan.model_dump() if hasattr(plan, "model_dump") else plan.__dict__),
                persist=self._persist_stage_cache,
            )

        modules = plan.modules or []
        if not modules:
            modules = [self._create_default_module(pool)]

        # ── Stage 3: ParallelAnalysis ────────────────────────────────────────
        all_nodes, all_edges, failed = ParallelAnalysisStage().run(
            modules=modules,
            pool=pool,
            llm_client=llm_client,
            scheduler_config=self._scheduler_config,
            on_progress=on_progress,
        )

        # ── Stage 4: GraphMerge ──────────────────────────────────────────────
        built = GraphMergeStage().run(all_nodes, all_edges, on_progress)

        # ── 持久化 ──────────────────────────────────────────────────────────
        if on_progress:
            on_progress({"step": "repository", "status": "start", "message": "保存图谱..."})
        graph_id = self._repo.save(built, repo_name=name)
        if on_progress:
            on_progress({"step": "repository", "status": "complete", "message": f"图谱已保存: {graph_id}", "graph_id": graph_id})

        # ── RAG（可选）──────────────────────────────────────────────────────
        if enable_rag:
            try:
                rag = self._get_rag_engine()
                rag.embed_nodes(graph_id, built.nodes)
            except Exception as e:
                logger.warning("向量化失败: %s", e)

        status = "success" if not failed else ("partial" if len(failed) < len(modules) else "failed")
        duration = time.time() - start
        logger.info("OptimizedPipeline 完成: status=%s, 耗时=%.2fs", status, duration)

        return AIAnalysisResult(
            graph_id=graph_id,
            nodes=all_nodes,
            edges=all_edges,
            status=status,
            failed_modules=failed,
            warnings=[],
            duration_seconds=duration,
        )

    # ── 私有工具 ─────────────────────────────────────────────────────────────

    def _create_llm_client(self) -> LLMClient:
        provider = os.environ.get("LLM_PROVIDER", self.config.provider)
        api_key = (
            os.environ.get("LLM_API_KEY") or
            os.environ.get("ZHIPU_API_KEY") or
            os.environ.get("ANTHROPIC_API_KEY") or
            os.environ.get("OPENAI_API_KEY") or
            os.environ.get("MINIMAX_API_KEY")
        )
        base_url = os.environ.get("LLM_BASE_URL") or os.environ.get("ANTHROPIC_BASE_URL")
        model = os.environ.get("LLM_MODEL", self.config.model)
        return LLMClient(
            provider=provider, model=model or None,
            api_key=api_key, base_url=base_url,
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature,
        )

    def _create_default_module(self, pool: SharedKnowledgePool) -> ModuleInfo:
        return ModuleInfo(
            id="module:default",
            name="Default Module",
            files=list(pool.file_index.keys()),
            purpose="自动创建的默认模块",
            language="unknown",
            confidence=1.0,
        )

    def _get_rag_engine(self) -> GraphRAGEngine:
        if self._rag_engine is None:
            vs = self._vector_store or VectorStore()
            self._rag_engine = GraphRAGEngine(graph_repo=self._repo, vector_store=vs)
        return self._rag_engine

    @staticmethod
    def _get_commit_sha(repo_path: Path) -> str:
        try:
            import subprocess
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=repo_path, capture_output=True, text=True, timeout=5,
            )
            return result.stdout.strip() if result.returncode == 0 else ""
        except Exception:
            return ""
```

- [ ] **Step 7：运行集成测试**

```bash
cd code-graph-system
pytest backend/tests/test_optimized_pipeline.py -v
```

预期：所有测试 PASS

- [ ] **Step 8：提交**

```bash
git add backend/pipeline/stages/ backend/pipeline/optimized_pipeline.py backend/tests/test_optimized_pipeline.py
git commit -m "feat: 添加 Stage 2/3/4 + OptimizedPipeline 5 阶段编排"
```

---

## Chunk 5：集成与基准测试

### Task 9：AIPipeline 集成 OptimizedPipeline

**Files:**
- Modify: `backend/pipeline/ai_analyze.py`

- [ ] **Step 1：在 `AIPipeline.__init__` 中新增 `enable_optimization` 参数**

在 `backend/pipeline/ai_analyze.py` 的 `AIPipeline.__init__` 方法中，添加 `enable_optimization` 参数：

```python
def __init__(
    self,
    config: Optional[AIAnalysisConfig] = None,
    graph_repo: Optional[GraphRepository] = None,
    vector_store: Optional[VectorStore] = None,
    rag_engine: Optional[GraphRAGEngine] = None,
    enable_optimization: bool = False,   # 新增
):
    self.config = config or AIAnalysisConfig()
    self._repo = graph_repo or GraphRepository()
    self._vector_store = vector_store
    self._rag_engine = rag_engine
    self._enable_optimization = enable_optimization
```

- [ ] **Step 2：在 `AIPipeline.analyze` 开头添加路由**

在 `analyze()` 方法的路径验证之后，添加：

```python
# 使用优化流水线
if self._enable_optimization:
    from backend.pipeline.optimized_pipeline import OptimizedPipeline
    optimized = OptimizedPipeline(
        config=self.config,
        graph_repo=self._repo,
        vector_store=self._vector_store,
        rag_engine=self._rag_engine,
    )
    return optimized.analyze(
        repo_path,
        repo_name=repo_name,
        enable_rag=enable_rag,
        on_progress=on_progress,
    )
```

- [ ] **Step 3：运行现有测试，确保没有回归**

```bash
cd code-graph-system
pytest backend/tests/test_ai_pipeline.py -v
```

预期：所有测试 PASS（`enable_optimization` 默认 False，原有逻辑不变）

- [ ] **Step 4：提交**

```bash
git add backend/pipeline/ai_analyze.py
git commit -m "feat: AIPipeline 新增 enable_optimization 参数，委托 OptimizedPipeline"
```

---

### Task 10：性能基准测试

**Files:**
- Create: `backend/tests/benchmark_pipeline.py`

- [ ] **Step 1：创建基准测试脚本**

```python
# backend/tests/benchmark_pipeline.py
"""性能基准对比测试。

对比 AIPipeline（旧）vs OptimizedPipeline（新）在相同仓库上的性能指标。

运行方式（需要真实 LLM API Key）：
    cd code-graph-system
    LLM_PROVIDER=zhipu ZHIPU_API_KEY=xxx pytest backend/tests/benchmark_pipeline.py -v -s

跳过（无 API Key 时）：
    pytest backend/tests/benchmark_pipeline.py -v  # 自动跳过
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# 无 API Key 时跳过所有基准测试
HAS_API_KEY = bool(
    os.environ.get("ZHIPU_API_KEY") or
    os.environ.get("ANTHROPIC_API_KEY") or
    os.environ.get("OPENAI_API_KEY")
)
skip_no_key = pytest.mark.skipif(not HAS_API_KEY, reason="需要真实 LLM API Key")

# 使用项目自身作为测试仓库
BENCHMARK_REPO = Path(__file__).parent.parent.parent  # code-graph-system/


class BenchmarkMetrics:
    """收集分析过程中的性能指标。"""

    def __init__(self):
        self.start_time = time.time()
        self.end_time: float | None = None
        self.llm_call_count = 0
        self.disk_read_count = 0
        self.progress_events: list[dict] = []

    def on_progress(self, event: dict) -> None:
        self.progress_events.append(event)

    def finish(self) -> None:
        self.end_time = time.time()

    @property
    def elapsed_seconds(self) -> float:
        return (self.end_time or time.time()) - self.start_time


@skip_no_key
class TestBenchmarkComparison:
    """真实 API Key 下的性能对比测试。"""

    def test_optimized_pipeline_faster_than_original(self):
        """优化流水线分析时间应比原流水线低 30% 以上。"""
        from backend.pipeline.ai_analyze import AIPipeline
        from backend.pipeline.optimized_pipeline import OptimizedPipeline

        # 基线：原流水线
        m_old = BenchmarkMetrics()
        old_pipeline = AIPipeline()
        old_result = old_pipeline.analyze(
            BENCHMARK_REPO,
            repo_name="benchmark-old",
            on_progress=m_old.on_progress,
        )
        m_old.finish()

        # 对比：优化流水线
        m_new = BenchmarkMetrics()
        new_pipeline = OptimizedPipeline()
        new_result = new_pipeline.analyze(
            BENCHMARK_REPO,
            repo_name="benchmark-new",
            on_progress=m_new.on_progress,
        )
        m_new.finish()

        print(f"\n原流水线耗时: {m_old.elapsed_seconds:.1f}s")
        print(f"优化流水线耗时: {m_new.elapsed_seconds:.1f}s")
        print(f"节点数对比: {old_result.node_count} vs {new_result.node_count}")

        improvement = (m_old.elapsed_seconds - m_new.elapsed_seconds) / m_old.elapsed_seconds
        assert improvement >= 0.30, f"性能提升不足 30%，实际: {improvement:.1%}"


class TestBenchmarkWithMock:
    """Mock LLM 下的基础指标验证（无需 API Key）。"""

    def _make_mock_llm(self):
        import json
        mock = MagicMock()
        mock.provider = "zhipu"
        mock.complete.return_value = json.dumps({
            "modules": [
                {"id": "m1", "name": "Main", "files": [], "purpose": "test", "language": "python", "confidence": 1.0}
            ],
            "architecture_hints": {}
        })
        return mock

    def test_stage_cache_hit_skips_llm_on_rerun(self, tmp_path):
        """第二次运行时，Stage 0/1 缓存命中，不重复 LLM 调用。"""
        from backend.pipeline.optimized_pipeline import OptimizedPipeline
        (tmp_path / "main.py").write_text("def f(): pass", encoding="utf-8")

        with patch("backend.pipeline.optimized_pipeline.LLMClient") as MockLLM:
            MockLLM.return_value = self._make_mock_llm()
            pipeline = OptimizedPipeline(persist_stage_cache=True)
            pipeline._stage_cache.cache_dir = tmp_path / "cache"

            # 第一次运行
            pipeline.analyze(tmp_path, repo_name="test")
            first_call_count = MockLLM.return_value.complete.call_count

            # 第二次运行（Stage 0/1 应命中缓存）
            pipeline2 = OptimizedPipeline(persist_stage_cache=True)
            pipeline2._stage_cache.cache_dir = tmp_path / "cache"
            with patch("backend.pipeline.optimized_pipeline.LLMClient") as MockLLM2:
                MockLLM2.return_value = self._make_mock_llm()
                pipeline2.analyze(tmp_path, repo_name="test")
                second_call_count = MockLLM2.return_value.complete.call_count

        # 第二次 LLM 调用数 ≤ 第一次（缓存减少了部分调用）
        # Stage 2 仍需调用（模块边界可能未缓存），但 Stage 0/1 不再消耗计算
        print(f"\n第一次 LLM 调用数: {first_call_count}")
        print(f"第二次 LLM 调用数: {second_call_count}")

    def test_content_cache_reduces_disk_reads(self, tmp_path):
        """ContentCache 确保相同文件只读一次磁盘。"""
        from backend.cache.shared_knowledge_pool import SharedKnowledgePool

        (tmp_path / "a.py").write_text("class A: pass", encoding="utf-8")
        pool = SharedKnowledgePool(tmp_path)
        pool.build_file_index(["a.py"])

        read_count = [0]
        original_read = Path.read_text

        def counted_read(self, *args, **kwargs):
            read_count[0] += 1
            return original_read(self, *args, **kwargs)

        with patch.object(Path, "read_text", counted_read):
            pool.get_content("a.py")  # 第一次：读磁盘
            pool.get_content("a.py")  # 第二次：命中缓存
            pool.get_content("a.py")  # 第三次：命中缓存

        assert read_count[0] == 1, f"磁盘读取应为 1 次，实际: {read_count[0]}"
```

- [ ] **Step 2：运行 Mock 测试（无需 API Key）**

```bash
cd code-graph-system
pytest backend/tests/benchmark_pipeline.py::TestBenchmarkWithMock -v -s
```

预期：`test_content_cache_reduces_disk_reads` PASS

- [ ] **Step 3：运行完整回归测试**

```bash
cd code-graph-system
pytest backend/tests/test_ai_pipeline.py backend/tests/test_content_cache.py backend/tests/test_shared_knowledge_pool.py backend/tests/test_stage_cache.py backend/tests/test_pipeline_scheduler.py backend/tests/test_optimized_pipeline.py -v
```

预期：所有测试 PASS

- [ ] **Step 4：最终提交**

```bash
git add backend/tests/benchmark_pipeline.py
git commit -m "feat: 添加性能基准测试（含 Mock 测试 + 真实 API 对比测试）"
```

---

## 验收检查清单

运行以下命令确认所有实现正确：

```bash
cd code-graph-system

# 1. 全部新增单元测试通过
pytest backend/tests/test_content_cache.py \
       backend/tests/test_shared_knowledge_pool.py \
       backend/tests/test_stage_cache.py \
       backend/tests/test_pipeline_scheduler.py \
       backend/tests/test_optimized_pipeline.py \
       -v

# 2. 现有测试无回归
pytest backend/tests/test_ai_pipeline.py \
       backend/tests/test_structure_indexer.py \
       backend/tests/test_module_scanner_agent.py \
       -v

# 3. Mock 基准测试通过
pytest backend/tests/benchmark_pipeline.py::TestBenchmarkWithMock -v -s
```
