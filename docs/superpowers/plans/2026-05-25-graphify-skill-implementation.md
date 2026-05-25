# Graphify Skill + API Bridge 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自动化代码仓库分析流程——前端点击"开始分析"触发 Claude Code skill，生成架构图/调用图/血缘图 JSON 文件并放入 `data/graphs/`。

**Architecture:** 新建 `/graphify` skill 替换现有通用 graphify，针对 Java/Spring 项目优化。后端新增 `POST /analyze/graphify` 端点 spawn Claude Code CLI 子进程，复用现有 SSE 进度通道。前端 AnalysisConfirmDialog 增加 `graphify` 模式选项。

**Tech Stack:** Python 3.12 / FastAPI / Pydantic (后端)，React 19 / TypeScript / Ant Design (前端)，Claude Code CLI / Skill MD (skill)

---

## File Structure

### 新增文件
| 文件 | 职责 |
|------|------|
| `~/.claude/skills/graphify/SKILL.md` | 替换现有 graphify skill，针对 Java/Spring 分析 |
| `code-graph-system/backend/services/graphify_runner.py` | Claude Code CLI 子进程管理，进度解析 |
| `code-graph-system/backend/api/routers/graphify.py` | `POST /analyze/graphify` 端点 |
| `code-graph-system/backend/tests/test_graphify_runner.py` | graphify_runner 单元测试 |
| `code-graph-system/backend/tests/test_graphify_api.py` | graphify API 集成测试 |

### 修改文件
| 文件 | 改动 |
|------|------|
| `code-graph-system/backend/api/server.py` | 注册 graphify router |
| `code-graph-ui/src/types/api.ts` | 扩展 `PipelineMode` 类型 |
| `code-graph-ui/src/core/api/endpoints/graph.ts` | 新增 `analyzeGraphify` 方法 |
| `code-graph-ui/src/pages/Repository/components/AnalysisConfirmDialog.tsx` | 增加 graphify 模式选项 |
| `code-graph-ui/src/pages/Repository/index.tsx` | `startAnalysis` 支持 graphify 模式 |

---

### Task 1: GraphifyRunner 服务（子进程管理）

**Files:**
- Create: `code-graph-system/backend/services/graphify_runner.py`
- Test: `code-graph-system/backend/tests/test_graphify_runner.py`

- [ ] **Step 1: Write the failing test for GraphifyRunner**

```python
# code-graph-system/backend/tests/test_graphify_runner.py
import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from backend.services.graphify_runner import GraphifyRunner, GraphifyResult


class TestGraphifyRunner:
    def test_init_with_defaults(self):
        runner = GraphifyRunner()
        assert runner.claude_bin == "claude"
        assert runner.timeout == 1800

    def test_init_with_custom_values(self):
        runner = GraphifyRunner(claude_bin="/usr/local/bin/claude", timeout=600)
        assert runner.claude_bin == "/usr/local/bin/claude"
        assert runner.timeout == 600

    def test_build_command(self):
        runner = GraphifyRunner()
        cmd = runner._build_command("/path/to/repo", repo_name="my-project")
        assert cmd[0] == "claude"
        assert "-p" in cmd
        assert "/graphify /path/to/repo --name my-project" in " ".join(cmd)

    def test_build_command_without_name(self):
        runner = GraphifyRunner()
        cmd = runner._build_command("/path/to/repo", repo_name="")
        assert "--name" not in " ".join(cmd)

    @patch("backend.services.graphify_runner.subprocess.run")
    def test_run_success(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout='{"status": "completed", "files_written": 4}',
            stderr="",
        )
        runner = GraphifyRunner()
        result = runner.run("/path/to/repo", repo_name="my-project")
        assert isinstance(result, GraphifyResult)
        assert result.success is True
        assert result.files_written == 4

    @patch("backend.services.graphify_runner.subprocess.run")
    def test_run_cli_not_found(self, mock_run):
        mock_run.side_effect = FileNotFoundError("claude not found")
        runner = GraphifyRunner()
        result = runner.run("/path/to/repo", repo_name="my-project")
        assert result.success is False
        assert "not found" in result.error

    @patch("backend.services.graphify_runner.subprocess.run")
    def test_run_timeout(self, mock_run):
        import subprocess
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="claude", timeout=1800)
        runner = GraphifyRunner(timeout=1800)
        result = runner.run("/path/to/repo", repo_name="my-project")
        assert result.success is False
        assert "timeout" in result.error.lower()

    @patch("backend.services.graphify_runner.subprocess.run")
    def test_run_failure(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=1,
            stdout="",
            stderr="Error: skill not found",
        )
        runner = GraphifyRunner()
        result = runner.run("/path/to/repo", repo_name="my-project")
        assert result.success is False
        assert "skill not found" in result.error

    def test_validate_output_all_files_exist(self, tmp_path):
        runner = GraphifyRunner()
        name = "test-project"
        for suffix in ["", "-architecture", "-function-call-graph", "-lineage"]:
            (tmp_path / f"{name}{suffix}.json").write_text('{"test": true}')
        result = runner.validate_output(str(tmp_path), name)
        assert result.all_exist is True
        assert result.missing == []

    def test_validate_output_missing_files(self, tmp_path):
        runner = GraphifyRunner()
        name = "test-project"
        (tmp_path / f"{name}.json").write_text('{"test": true}')
        result = runner.validate_output(str(tmp_path), name)
        assert result.all_exist is False
        assert len(result.missing) == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code-graph-system && source venv/bin/activate && pytest backend/tests/test_graphify_runner.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.services.graphify_runner'`

- [ ] **Step 3: Write minimal implementation**

```python
# code-graph-system/backend/services/graphify_runner.py
"""GraphifyRunner — 管理 Claude Code CLI 子进程执行 /graphify skill。"""
from __future__ import annotations

import json
import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_GRAPH_DIR = Path(__file__).parent.parent.parent / "data" / "graphs"


@dataclass
class GraphifyResult:
    """GraphifyRunner.run() 的输出。"""
    success: bool
    files_written: int = 0
    error: str = ""
    output: str = ""
    missing: list[str] = field(default_factory=list)


@dataclass
class ValidationResult:
    """validate_output() 的输出。"""
    all_exist: bool
    missing: list[str]


class GraphifyRunner:
    """管理 Claude Code CLI 子进程，执行 /graphify skill 分析代码仓库。"""

    def __init__(
        self,
        claude_bin: str = "claude",
        timeout: int = 1800,
        graph_dir: str | Path | None = None,
    ) -> None:
        self.claude_bin = claude_bin
        self.timeout = timeout
        self._graph_dir = Path(graph_dir) if graph_dir else _GRAPH_DIR

    def _build_command(self, repo_path: str, repo_name: str = "") -> list[str]:
        """构建 Claude Code CLI 命令。"""
        prompt = f"/graphify {repo_path}"
        if repo_name:
            prompt += f" --name {repo_name}"
        return [self.claude_bin, "-p", prompt, "--output-format", "json"]

    def run(self, repo_path: str, repo_name: str = "") -> GraphifyResult:
        """执行 /graphify skill，返回结果。"""
        cmd = self._build_command(repo_path, repo_name)
        logger.info("GraphifyRunner: %s", " ".join(cmd))

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout,
            )
        except FileNotFoundError:
            return GraphifyResult(
                success=False,
                error=f"Claude Code CLI not found: {self.claude_bin}. Install from https://docs.anthropic.com/en/docs/claude-code",
            )
        except subprocess.TimeoutExpired:
            return GraphifyResult(
                success=False,
                error=f"Timeout after {self.timeout}s",
            )

        if proc.returncode != 0:
            return GraphifyResult(
                success=False,
                error=proc.stderr.strip() or f"Exit code {proc.returncode}",
                output=proc.stdout,
            )

        try:
            data = json.loads(proc.stdout)
            files_written = data.get("files_written", 0)
        except json.JSONDecodeError:
            files_written = 0

        return GraphifyResult(
            success=True,
            files_written=files_written,
            output=proc.stdout,
        )

    def validate_output(self, graph_dir: str | None = None, repo_name: str = "") -> ValidationResult:
        """验证 graphify 输出的 4 个 JSON 文件是否存在。"""
        base = Path(graph_dir) if graph_dir else self._graph_dir
        required = [
            f"{repo_name}.json",
            f"{repo_name}-architecture.json",
            f"{repo_name}-function-call-graph.json",
            f"{repo_name}-lineage.json",
        ]
        missing = [f for f in required if not (base / f).exists()]
        return ValidationResult(
            all_exist=len(missing) == 0,
            missing=missing,
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd code-graph-system && source venv/bin/activate && pytest backend/tests/test_graphify_runner.py -v`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
cd code-graph-system
git add backend/services/graphify_runner.py backend/tests/test_graphify_runner.py
git commit -m "feat: add GraphifyRunner service for Claude Code CLI subprocess management"
```

---

### Task 2: Graphify API 端点

**Files:**
- Create: `code-graph-system/backend/api/routers/graphify.py`
- Create: `code-graph-system/backend/tests/test_graphify_api.py`
- Modify: `code-graph-system/backend/api/server.py`

- [ ] **Step 1: Write the failing test for graphify API**

```python
# code-graph-system/backend/tests/test_graphify_api.py
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from backend.api.server import app


@pytest.fixture
def client():
    return TestClient(app)


class TestGraphifyAPI:
    def test_post_graphify_returns_task_id(self, client):
        with patch("backend.services.graphify_runner.GraphifyRunner.run") as mock_run:
            mock_run.return_value = MagicMock(success=True, files_written=4, error="", output="{}")
            resp = client.post("/analyze/graphify", json={
                "repo_path": "/tmp/test-repo",
                "repo_name": "test-project",
                "repo_id": "repo-123",
            })
        assert resp.status_code == 200
        data = resp.json()
        assert "task_id" in data
        assert data["status"] == "pending"

    def test_post_graphify_missing_repo_path(self, client):
        resp = client.post("/analyze/graphify", json={
            "repo_name": "test",
        })
        assert resp.status_code == 422

    def test_post_graphify_cli_not_found(self, client):
        with patch("backend.services.graphify_runner.GraphifyRunner.run") as mock_run:
            mock_run.return_value = MagicMock(
                success=False, error="Claude Code CLI not found", files_written=0, output="",
            )
            resp = client.post("/analyze/graphify", json={
                "repo_path": "/tmp/test-repo",
                "repo_name": "test-project",
            })
        # Even if CLI not found, we return task_id (async validation happens later)
        assert resp.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code-graph-system && source venv/bin/activate && pytest backend/tests/test_graphify_api.py -v`
Expected: FAIL — 404 (router not registered)

- [ ] **Step 3: Write the graphify API router**

```python
# code-graph-system/backend/api/routers/graphify.py
"""Graphify 分析 API：POST /analyze/graphify"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services.graphify_runner import GraphifyRunner

logger = logging.getLogger(__name__)
router = APIRouter()


class GraphifyRequest(BaseModel):
    """POST /analyze/graphify 请求体。"""
    repo_path: str = Field(description="仓库根目录（本地绝对路径）")
    repo_name: str = Field(default="", description="图谱名称")
    repo_id: Optional[str] = Field(default=None, description="前端 repo_store 中的仓库 ID")


class GraphifyAsyncResponse(BaseModel):
    """POST /analyze/graphify 异步响应。"""
    task_id: str
    status: str = "pending"


@router.post("/analyze/graphify", response_model=GraphifyAsyncResponse, tags=["分析"])
def analyze_graphify(req: GraphifyRequest):
    """
    提交 Graphify 分析任务（异步）。通过 Claude Code CLI 执行 /graphify skill。

    返回 task_id，通过 GET /analyze/stream/{task_id} 订阅实时进度。
    """
    task_id = str(uuid.uuid4())

    logger.info(
        "POST /analyze/graphify  path=%s  name=%s  task_id=%s",
        req.repo_path, req.repo_name, task_id,
    )

    # 注册分析状态
    from backend.store.repo_status_store import get_repo_status_store
    status_store = get_repo_status_store()
    legacy_repo_id = req.repo_name or req.repo_path.rstrip("/").split("/")[-1]
    status_store.set_analyzing(
        legacy_repo_id,
        task_id=task_id,
        repo_name=req.repo_name or legacy_repo_id,
        repo_path=req.repo_path,
    )

    # 在后台线程执行（不阻塞请求）
    import threading

    def _run_graphify():
        try:
            runner = GraphifyRunner()
            result = runner.run(req.repo_path, repo_name=req.repo_name)

            if result.success:
                validation = runner.validate_output(repo_name=req.repo_name or legacy_repo_id)
                if validation.all_exist:
                    status_store.set_completed(
                        legacy_repo_id,
                        graph_id=req.repo_name or legacy_repo_id,
                    )
                    logger.info("Graphify 完成: %s", legacy_repo_id)
                else:
                    status_store.set_failed(
                        legacy_repo_id,
                        error=f"部分文件未生成: {', '.join(validation.missing)}",
                    )
                    logger.warning("Graphify 部分完成: %s missing %s", legacy_repo_id, validation.missing)
            else:
                status_store.set_failed(legacy_repo_id, error=result.error)
                logger.error("Graphify 失败: %s — %s", legacy_repo_id, result.error)
        except Exception as exc:
            status_store.set_failed(legacy_repo_id, error=str(exc))
            logger.exception("Graphify 异常: %s", legacy_repo_id)

    thread = threading.Thread(target=_run_graphify, daemon=True)
    thread.start()

    return GraphifyAsyncResponse(task_id=task_id, status="pending")
```

- [ ] **Step 4: Register the router in server.py**

In `code-graph-system/backend/api/server.py`, add after line 120:

```python
from backend.api.routers import graphify as graphify_router

app.include_router(graphify_router.router)
```

具体改动：在 `from backend.api.routers import data_lineage as data_lineage_router` 之后添加 import，在 `app.include_router(data_lineage_router.router)` 之后添加 `app.include_router(graphify_router.router)`。

- [ ] **Step 5: Run test to verify it passes**

Run: `cd code-graph-system && source venv/bin/activate && pytest backend/tests/test_graphify_api.py -v`
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
cd code-graph-system
git add backend/api/routers/graphify.py backend/tests/test_graphify_api.py backend/api/server.py
git commit -m "feat: add POST /analyze/graphify API endpoint for Claude Code skill integration"
```

---

### Task 3: Graphify Skill（替换现有 skill）

**Files:**
- Modify: `~/.claude/skills/graphify/SKILL.md`（完整替换）

- [ ] **Step 1: Read existing adms JSON files for schema reference**

Read these files to extract exact field structures that the skill must produce:
- `code-graph-system/data/graphs/adms-architecture.json`
- `code-graph-system/data/graphs/adms-function-call-graph.json`
- `code-graph-system/data/graphs/adms-lineage.json`
- `code-graph-system/data/graphs/adms.json`

- [ ] **Step 2: Write the new SKILL.md**

```markdown
---
name: graphify
description: Analyze Java/Spring code repositories → knowledge graph JSON files (architecture, call graph, lineage) → write to code-graph-system/data/graphs/
trigger: /graphify
---

# /graphify

Analyze a Java/Spring code repository and generate structured knowledge graph JSON files for the Code Knowledge Graph system.

## Usage

```
/graphify /path/to/repo                    # Analyze repository
/graphify /path/to/repo --name my-project  # Specify project name
```

If no path given, ask the user for one.

## Output

Four JSON files written to `code-graph-system/data/graphs/`:

1. `{name}.json` — Complete graph (nodes + edges + meta)
2. `{name}-architecture.json` — Layered architecture view
3. `{name}-function-call-graph.json` — Function call graph
4. `{name}-lineage.json` — Data lineage view

Also updates `code-graph-system/data/graphs/index.json` and `code-graph-system/data/repos/` status.

## What You Must Do When Invoked

### Step 1 — Detect project structure (no LLM, fast)

Read these files from the target repo:
- `pom.xml` or `build.gradle` — project name, Spring Boot version, dependencies
- `application.yml` / `application.properties` — datasource, MQ, cache config
- Directory structure — identify Maven modules or Gradle subprojects

Determine:
- Project name (from `<artifactId>` or `rootProject.name`; override with `--name` if given)
- Tech stack (Spring Boot version, ORM, database, cache, MQ, job scheduler)
- Module list and their paths
- Layer conventions (controller/service/repository packages)

Print summary:
```
Project: {name}
Modules: {N} (module-a, module-b, ...)
Tech: Spring Boot 3.1 + JPA + PostgreSQL + Redis + RocketMQ
Layers: controller → service → repository
```

### Step 2 — Three parallel Agent analyses

Dispatch 3 Agent subagents in the SAME message using `subagent_type="general-purpose"`:

**Agent 1: Architecture Analysis**

Prompt for Agent 1:
```
You are analyzing a Java/Spring project to produce an architecture JSON.

Project: {name}
Base path: {repo_path}
Modules: {module list}
Tech stack: {tech stack info}

Read the Controller, Service, Repository, and Config source files. Produce a JSON object matching this exact schema:

{
  "name": "{name}",
  "fullName": "Human-readable full name",
  "description": "One-sentence project description",
  "version": "1.0.0",
  "techStack": {
    "framework": "Spring Boot X.X",
    "orm": "...",
    "database": "...",
    "cache": "...",
    "mq": "...",
    "job": "..."
  },
  "layers": [
    {
      "id": "presentation",
      "name": "表现层",
      "alias": "Presentation Layer",
      "description": "...",
      "source": "relative/path/to/controller/",
      "technology": "Spring WebFlux / Spring MVC",
      "nodes": [
        {
          "id": "xxx-controller",
          "name": "XxxController",
          "displayName": "Xxx API",
          "source": "controller/xxx/",
          "description": "...",
          "functions": ["create xxx", "query xxx"],
          "endpoints": ["/api/xxx"]
        }
      ]
    }
  ],
  "dataFlow": {
    "description": "Overall data flow description",
    "flows": [
      {
        "from": "presentation",
        "to": "business",
        "description": "...",
        "via": ["Service calls"]
      }
    ]
  },
  "moduleDependencies": {
    "modules": [
      {
        "id": "module-a",
        "name": "Module A",
        "dependsOn": ["module-b"],
        "description": "..."
      }
    ]
  }
}

Standard layer IDs: presentation, business, data, infrastructure, common.
Each layer's nodes array contains one entry per major Controller/Service/Repository class.
Write the JSON to {output_path}/{name}-architecture.json
```

**Agent 2: Call Graph Analysis**

Prompt for Agent 2:
```
You are analyzing a Java/Spring project to produce a function call graph JSON.

Project: {name}
Base path: {repo_path}
Modules: {module list}

Read Java source files. For each module, list key functions (public methods on Service/Controller/Repository classes) and their call relationships. Produce a JSON matching this schema:

{
  "projectName": "{name}",
  "version": "1.0.0",
  "generatedAt": "{ISO8601}",
  "totalModules": 0,
  "totalFunctions": 0,
  "totalCallChains": 0,
  "excludedModules": ["test", "config"],
  "modules": [
    {
      "id": "module-id",
      "name": "Module Name",
      "description": "...",
      "path": "src/main/java/com/...",
      "functions": [
        {
          "id": "func-id",
          "name": "methodName",
          "className": "ClassName",
          "signature": "ReturnType methodName(ParamType param)",
          "calls": ["other-func-id"],
          "calledBy": ["caller-func-id"],
          "type": "public"
        }
      ]
    }
  ],
  "crossModuleCalls": [
    { "from": "module-a", "to": "module-b", "count": 5 }
  ]
}

Focus on Service → Service and Controller → Service calls.
Write the JSON to {output_path}/{name}-function-call-graph.json
```

**Agent 3: Data Lineage Analysis**

Prompt for Agent 3:
```
You are analyzing a Java/Spring project to produce a data lineage JSON.

Project: {name}
Base path: {repo_path}
Modules: {module list}

Read Entity classes, Repository interfaces, Service classes, and MQ/SQL config. Trace how data flows: Entity → Repository → Service → Controller, and across modules. Produce a JSON matching this schema:

{
  "meta": {
    "projectName": "{name}",
    "version": "1.0.0",
    "generatedAt": "{ISO8601}"
  },
  "businessGlossary": [
    { "term": "业务术语", "definition": "定义", "domain": "领域" }
  ],
  "businessRules": [
    { "id": "rule-1", "name": "规则名", "description": "...", "enforcedBy": ["ClassName"] }
  ],
  "modules": [
    {
      "id": "module-id",
      "name": "Module Name",
      "description": "...",
      "entities": ["entity-id"],
      "services": ["service-id"],
      "repositories": ["repo-id"]
    }
  ],
  "dataLineage": [
    {
      "id": "lineage-1",
      "source": { "entity": "EntityA", "module": "module-a" },
      "target": { "entity": "EntityB", "module": "module-b" },
      "type": "flow_to",
      "description": "...",
      "fields": [
        { "fromEntity": "EntityA", "fromField": "field1", "toEntity": "EntityB", "toField": "field2" }
      ]
    }
  ],
  "dataRelations": [],
  "keyDataFlows": [],
  "moduleDependencies": [],
  "flowEngine": {}
}

Lineage types: flow_to, reads, writes, produces, consumes.
Write the JSON to {output_path}/{name}-lineage.json
```

**IMPORTANT:** In all 3 agent prompts, replace `{name}`, `{repo_path}`, `{module list}`, `{tech stack info}`, `{output_path}`, and `{ISO8601}` with actual values. The `{output_path}` is the absolute path to `code-graph-system/data/graphs/`.

### Step 3 — Merge into complete graph

After all 3 agents complete, read the 3 JSON files and merge into `{name}.json`:

```python
import json
from pathlib import Path

graphs_dir = Path("{output_path}")
name = "{name}"

arch = json.loads((graphs_dir / f"{name}-architecture.json").read_text())
call = json.loads((graphs_dir / f"{name}-function-call-graph.json").read_text())
lin = json.loads((graphs_dir / f"{name}-lineage.json").read_text())

# Convert architecture layers → nodes + edges
nodes = []
edges = []
for layer in arch.get("layers", []):
    for node in layer.get("nodes", []):
        nodes.append({
            "id": node["id"],
            "type": "Component",
            "name": node["name"],
            "properties": {
                "layer": layer["id"],
                "displayName": node.get("displayName", ""),
                "description": node.get("description", ""),
                "endpoints": node.get("endpoints", []),
                "functions": node.get("functions", []),
                "source": node.get("source", ""),
            }
        })

# Convert call graph modules → nodes + edges
for module in call.get("modules", []):
    nodes.append({
        "id": module["id"],
        "type": "Module",
        "name": module["name"],
        "properties": {
            "description": module.get("description", ""),
            "path": module.get("path", ""),
        }
    })
    for func in module.get("functions", []):
        nodes.append({
            "id": func["id"],
            "type": "Function",
            "name": func["name"],
            "properties": {
                "className": func.get("className", ""),
                "signature": func.get("signature", ""),
                "type": func.get("type", "public"),
                "module": module["id"],
            }
        })
        for target in func.get("calls", []):
            edges.append({"from": func["id"], "to": target, "type": "calls"})

# Convert lineage → nodes + edges
for module in lin.get("modules", []):
    for eid in module.get("entities", []):
        nodes.append({"id": eid, "type": "DataObject", "name": eid, "properties": {"module": module["id"]}})
    for ll in lin.get("dataLineage", []):
        edges.append({
            "from": ll["source"]["entity"],
            "to": ll["target"]["entity"],
            "type": ll["type"],
            "properties": {"description": ll.get("description", "")},
        })

# Write complete graph
from datetime import datetime, timezone
graph = {
    "meta": {
        "graph_id": name,
        "repo_name": name,
        "pipeline": "graphify",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "node_count": len(nodes),
        "edge_count": len(edges),
    },
    "nodes": nodes,
    "edges": edges,
}
(graphs_dir / f"{name}.json").write_text(json.dumps(graph, ensure_ascii=False, indent=2))
print(f"Complete graph: {len(nodes)} nodes, {len(edges)} edges → {name}.json")
```

### Step 4 — Update index and repo status

Update `code-graph-system/data/graphs/index.json`:

```python
import json
from pathlib import Path

graphs_dir = Path("{output_path}")
index_path = graphs_dir / "index.json"
name = "{name}"

index = {}
if index_path.exists():
    index = json.loads(index_path.read_text())

index[name] = {
    "graph_id": name,
    "repo_name": name,
    "node_count": NODE_COUNT,
    "edge_count": EDGE_COUNT,
    "created_at": CREATED_AT,
}
index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2))
```

Update repo status store (Python):

```bash
cd code-graph-system && source venv/bin/activate && python -c "
from backend.store.repo_status_store import get_repo_status_store
store = get_repo_status_store()
store.set_completed('NAME', graph_id='NAME')
print('Repo status updated')
"
```

Replace NAME with the actual repo name.

### Step 5 — Report results

Print summary:
```
Graphify complete! 4 files written to code-graph-system/data/graphs/:
  {name}.json                    — {N} nodes, {M} edges
  {name}-architecture.json       — {L} layers, {K} nodes
  {name}-function-call-graph.json — {P} modules, {F} functions
  {name}-lineage.json            — {D} data lineage entries
```
```

- [ ] **Step 3: Write the SKILL.md file**

Write the full content above to `~/.claude/skills/graphify/SKILL.md`, replacing the existing file.

- [ ] **Step 4: Verify skill is loadable**

Run: `cat ~/.claude/skills/graphify/SKILL.md | head -5`
Expected: Shows the new frontmatter with `name: graphify`

- [ ] **Step 5: Commit**

```bash
cd /Users/wayne/Documents/code/code-knowledge-graph
git add -A ~/.claude/skills/graphify/SKILL.md 2>/dev/null || true
# The skill file is outside the repo, so no git commit needed for it
# But document the change in the project
echo "Skill file updated at ~/.claude/skills/graphify/SKILL.md"
```

---

### Task 4: 前端 — 扩展 PipelineMode 类型

**Files:**
- Modify: `code-graph-ui/src/types/api.ts`

- [ ] **Step 1: Update PipelineMode type**

In `code-graph-ui/src/types/api.ts`, change line 9:

From:
```typescript
export type PipelineMode = "static_first" | "ai_first";
```

To:
```typescript
export type PipelineMode = "static_first" | "ai_first" | "graphify";
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd code-graph-ui && npx tsc --noEmit 2>&1 | head -20`
Expected: May show errors in AnalysisConfirmDialog (next task fixes them)

- [ ] **Step 3: Commit**

```bash
git add code-graph-ui/src/types/api.ts
git commit -m "feat: add graphify to PipelineMode type"
```

---

### Task 5: 前端 — API 端点 + 分析对话框 + 启动逻辑

**Files:**
- Modify: `code-graph-ui/src/core/api/endpoints/graph.ts`
- Modify: `code-graph-ui/src/pages/Repository/components/AnalysisConfirmDialog.tsx`
- Modify: `code-graph-ui/src/pages/Repository/index.tsx`

- [ ] **Step 1: Add graphify API endpoint**

In `code-graph-ui/src/core/api/endpoints/graph.ts`, find the `analyzeRepository` method and add after it:

```typescript
/**
 * POST /analyze/graphify
 * Submit graphify analysis via Claude Code skill
 */
async analyzeGraphify(params: {
  repo_path: string;
  repo_name?: string;
  repo_id?: string;
}): Promise<{ task_id: string; status: string }> {
  return apiClient.post("/analyze/graphify", {
    repo_path: params.repo_path,
    repo_name: params.repo_name ?? "",
    repo_id: params.repo_id,
  });
},
```

- [ ] **Step 2: Update AnalysisConfirmDialog — add graphify option**

In `code-graph-ui/src/pages/Repository/components/AnalysisConfirmDialog.tsx`, modify the `PIPELINE_MODE_OPTIONS` array (line 59). Add a new entry at the beginning:

```typescript
const PIPELINE_MODE_OPTIONS: Array<{
  value: PipelineMode;
  label: string;
  icon: React.ReactNode;
  description: string;
  tag?: string;
}> = [
  {
    value: "graphify",
    label: "Claude Code 智能分析",
    icon: <RobotOutlined />,
    description: "深度理解，生成架构图+调用图+血缘图",
    tag: "推荐",
  },
  {
    value: "static_first",
    label: "静态分析 + AI 增强",
    icon: <ToolOutlined />,
    description: "高效率，成本低",
  },
  {
    value: "ai_first",
    label: "纯 AI 分析",
    icon: <RobotOutlined />,
    description: "需要模型支持 function calling",
  },
];
```

Remove the `tag: "推荐"` from the `static_first` entry (it previously had it).

- [ ] **Step 3: Update startAnalysis in Repository/index.tsx**

In `code-graph-ui/src/pages/Repository/index.tsx`, modify the `startAnalysis` callback (around line 125). Change the default mode from `"static_first"` to `"graphify"` and add the graphify API branch:

From:
```typescript
async (repo: RepoInfo, depth: AnalysisDepth = "standard", mode: PipelineMode = "static_first") => {
```

To:
```typescript
async (repo: RepoInfo, depth: AnalysisDepth = "standard", mode: PipelineMode = "graphify") => {
```

And in the try block, add a branch before the existing `graphEndpoints.analyzeRepository` call:

```typescript
try {
  let response: { task_id: string };
  if (mode === "graphify") {
    response = await graphEndpoints.analyzeGraphify({
      repo_path: repo.repoPath,
      repo_name: repo.repoName,
      repo_id: repo.repoId,
    });
  } else {
    response = await graphEndpoints.analyzeRepository({
      repo_path: repo.repoPath,
      repo_name: repo.repoName,
      repo_id: repo.repoId,
      branch: repo.branch,
      languages: repo.language.length > 0 ? repo.language : undefined,
      depth,
      pipeline_mode: mode,
    });
  }
```

The rest of the try block stays the same (uses `response.task_id`).

Also update the default `pipelineMode` state. Find where `pipelineMode` state is initialized and change it from `"static_first"` to `"graphify"`.

- [ ] **Step 4: Run build to verify**

Run: `cd code-graph-ui && npm run build 2>&1 | tail -10`
Expected: Build succeeds with no errors

- [ ] **Step 5: Commit**

```bash
git add code-graph-ui/src/core/api/endpoints/graph.ts \
        code-graph-ui/src/pages/Repository/components/AnalysisConfirmDialog.tsx \
        code-graph-ui/src/pages/Repository/index.tsx
git commit -m "feat: add graphify analysis mode to frontend UI and API"
```

---

### Task 6: 端到端验证

**Files:** None (manual testing)

- [ ] **Step 1: Start backend server**

```bash
cd code-graph-system && source venv/bin/activate
python -m uvicorn backend.api.server:app --host 0.0.0.0 --port 8000 --reload
```

- [ ] **Step 2: Verify the new endpoint appears in docs**

Open http://localhost:8000/docs and confirm `POST /analyze/graphify` is listed.

- [ ] **Step 3: Start frontend dev server**

```bash
cd code-graph-ui && npm run dev
```

- [ ] **Step 4: Verify AnalysisConfirmDialog shows graphify option**

Open http://localhost:5173, go to Repository page, click "开始分析" on any repo. Confirm "Claude Code 智能分析" option appears and is selected by default.

- [ ] **Step 5: Verify API call works**

In browser DevTools Network tab, click "开始分析" with graphify mode. Confirm `POST /analyze/graphify` is called and returns `{task_id, status: "pending"}`.

- [ ] **Step 6: Commit any fixes if needed**

If any issues found during testing, fix and commit.

---

## Self-Review

**1. Spec coverage:**
- ✅ `/graphify` skill with 3-phase execution (spec: Skill Design)
- ✅ `POST /analyze/graphify` API (spec: API 桥接设计)
- ✅ SSE progress via existing channel (spec: SSE 进度复用)
- ✅ Frontend mode selection (spec: 前端改动)
- ✅ File output to `data/graphs/` (spec: 阶段 3)
- ✅ Error handling for CLI not found / timeout / partial (spec: 错误处理)
- ⚠️ SSE progress from background thread not yet pushing to Redis Pub/Sub — the current implementation updates repo_status_store directly. The SSE `GET /analyze/stream/{task_id}` reads from Celery AsyncResult + Redis. For graphify tasks, we need to either: (a) publish progress events to Redis, or (b) create a polling endpoint. This is a gap — adding as a note below.

**2. Placeholder scan:** No TBD/TODO found. All code blocks contain complete implementations.

**3. Type consistency:** `PipelineMode` type extended consistently across `api.ts`, `AnalysisConfirmDialog.tsx`, and `index.tsx`. `GraphifyRequest`/`GraphifyAsyncResponse` match between router and tests. `GraphifyRunner.run()` return type `GraphifyResult` matches test assertions.

**Gap note on SSE progress:** The current graphify API returns a task_id and runs in a background thread, but it doesn't publish progress events to Redis Pub/Sub. The existing `GET /analyze/stream/{task_id}` SSE endpoint reads from Redis. For the MVP, the frontend will see "pending" until the background thread completes and updates `repo_status_store`, at which point the repo list refresh will show the completed status. Full SSE progress can be added in a follow-up task by publishing events to Redis from the background thread.
