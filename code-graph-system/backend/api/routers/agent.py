"""Agent Explorer API 路由。"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.agent_explorer.graph_explorer import (
    AgentEvent,
    AgentState,
    ExplorerMode,
    GraphExplorer,
)
from backend.agent_explorer.orchestrator import AgentOrchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agent", tags=["agent"])

# 活跃 agent 实例
_agents: dict[str, GraphExplorer] = {}

# 活跃 orchestrator 实例
_orchestrators: dict[str, AgentOrchestrator] = {}


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------

class StartRequest(BaseModel):
    graph_id: str = Field(description="图谱 ID")
    mode: str = Field(default="autonomous", description="探索模式: autonomous | guided")
    target: Optional[str] = Field(default=None, description="引导模式的目标描述")
    model: str = Field(default="claude-sonnet-4-6", description="LLM 模型")
    max_iterations: int = Field(default=50, description="最大迭代次数")


class GuideRequest(BaseModel):
    message: str = Field(description="引导消息")


class AgentResponse(BaseModel):
    agent_id: str
    graph_id: str
    state: str
    mode: str = ""
    target: Optional[str] = None
    iteration: int = 0
    discoveries_count: int = 0
    current_focus: Optional[str] = None
    recent_discoveries: list = []


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/start", response_model=AgentResponse)
async def start_agent(req: StartRequest):
    """启动 Agent 探索任务。"""
    mode = ExplorerMode.GUIDED if req.mode == "guided" else ExplorerMode.AUTONOMOUS

    explorer = GraphExplorer(
        graph_id=req.graph_id,
        model=req.model,
        max_iterations=req.max_iterations,
        on_event=_make_event_logger(req.graph_id),
    )

    _agents[explorer.agent_id] = explorer

    # 在后台启动 agent 循环
    asyncio.create_task(explorer.start(mode=mode, target=req.target))

    return AgentResponse(
        agent_id=explorer.agent_id,
        graph_id=req.graph_id,
        state=explorer.state.value,
        mode=req.mode,
        target=req.target,
    )


@router.get("/status/{agent_id}", response_model=AgentResponse)
async def get_status(agent_id: str):
    """查询 Agent 状态。"""
    explorer = _agents.get(agent_id)
    if not explorer:
        raise HTTPException(status_code=404, detail=f"Agent not found: {agent_id}")

    status = explorer.get_status()
    return AgentResponse(
        agent_id=status["agent_id"],
        graph_id=status["graph_id"],
        state=status["state"],
        iteration=status["iteration"],
        discoveries_count=status["discoveries_count"],
        current_focus=status["current_focus"],
        recent_discoveries=status["recent_discoveries"],
    )


@router.post("/guide/{agent_id}")
async def guide_agent(agent_id: str, req: GuideRequest):
    """用户引导干预。"""
    explorer = _agents.get(agent_id)
    if not explorer:
        raise HTTPException(status_code=404, detail=f"Agent not found: {agent_id}")

    await explorer.guide(req.message)
    return {"status": "guide_sent", "message": req.message}


@router.post("/stop/{agent_id}")
async def stop_agent(agent_id: str):
    """停止 Agent。"""
    explorer = _agents.get(agent_id)
    if not explorer:
        raise HTTPException(status_code=404, detail=f"Agent not found: {agent_id}")

    result = await explorer.stop()
    return result


@router.get("/stream/{agent_id}")
async def stream_events(agent_id: str):
    """SSE 实时事件流。"""
    from fastapi.responses import StreamingResponse

    explorer = _agents.get(agent_id)
    if not explorer:
        raise HTTPException(status_code=404, detail=f"Agent not found: {agent_id}")

    queue: asyncio.Queue = asyncio.Queue()

    def on_event(event: AgentEvent):
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            pass

    explorer._on_event = on_event

    async def event_generator():
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30.0)
                yield f"data: {event.to_json()}\n\n"
                if event.type in ("completed", "error", "stopping"):
                    break
            except asyncio.TimeoutError:
                yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_event_logger(graph_id: str):
    """创建事件日志回调。"""
    def on_event(event: AgentEvent):
        logger.info(
            "Agent event [%s] graph=%s: %s",
            event.type, graph_id,
            json.dumps(event.data, ensure_ascii=False)[:200],
        )
    return on_event


# ---------------------------------------------------------------------------
# Orchestrator Endpoints (Multi-Agent)
# ---------------------------------------------------------------------------

class OrchestratorStartRequest(BaseModel):
    graph_id: str = Field(description="图谱 ID")
    targets: list[str] = Field(description="探索目标列表，每个目标分配给一个子 Agent")
    max_sub_agents: int = Field(default=3, description="最大并发子 Agent 数量")
    model: str = Field(default="claude-sonnet-4-6", description="LLM 模型")
    max_iterations_per_agent: int = Field(default=30, description="每个子 Agent 最大迭代次数")


class OrchestratorResponse(BaseModel):
    orchestrator_id: str
    graph_id: str
    state: str
    total_discoveries: int = 0
    tasks: list = []
    completed_tasks: list = []


class CheckpointResponse(BaseModel):
    orchestrator_id: str
    checkpoint_path: str = ""
    pending_tasks: int = 0
    completed_tasks: int = 0


@router.post("/orchestrate/start", response_model=OrchestratorResponse)
async def start_orchestrator(req: OrchestratorStartRequest):
    """启动多 Agent 并行探索。"""
    orch = AgentOrchestrator(
        graph_id=req.graph_id,
        max_sub_agents=req.max_sub_agents,
        model=req.model,
        max_iterations_per_agent=req.max_iterations_per_agent,
        on_event=_make_event_logger(req.graph_id),
    )

    _orchestrators[orch.orchestrator_id] = orch

    # 在后台启动编排
    asyncio.create_task(orch.start(targets=req.targets))

    status = orch.get_status()
    return OrchestratorResponse(
        orchestrator_id=status["orchestrator_id"],
        graph_id=status["graph_id"],
        state=status["state"],
        total_discoveries=status["total_discoveries"],
        tasks=status["tasks"],
        completed_tasks=status["completed_tasks"],
    )


@router.get("/orchestrate/status/{orchestrator_id}", response_model=OrchestratorResponse)
async def get_orchestrator_status(orchestrator_id: str):
    """查询编排器状态。"""
    orch = _orchestrators.get(orchestrator_id)
    if not orch:
        raise HTTPException(status_code=404, detail=f"Orchestrator not found: {orchestrator_id}")

    status = orch.get_status()
    return OrchestratorResponse(
        orchestrator_id=status["orchestrator_id"],
        graph_id=status["graph_id"],
        state=status["state"],
        total_discoveries=status["total_discoveries"],
        tasks=status["tasks"],
        completed_tasks=status["completed_tasks"],
    )


@router.post("/orchestrate/stop/{orchestrator_id}")
async def stop_orchestrator(orchestrator_id: str):
    """停止编排器及所有子 Agent。"""
    orch = _orchestrators.get(orchestrator_id)
    if not orch:
        raise HTTPException(status_code=404, detail=f"Orchestrator not found: {orchestrator_id}")

    result = await orch.stop()
    return result


@router.post("/orchestrate/freeze/{orchestrator_id}", response_model=CheckpointResponse)
async def freeze_orchestrator(orchestrator_id: str):
    """冻结编排器状态（保存检查点）。"""
    orch = _orchestrators.get(orchestrator_id)
    if not orch:
        raise HTTPException(status_code=404, detail=f"Orchestrator not found: {orchestrator_id}")

    result = await orch.freeze()
    return CheckpointResponse(
        orchestrator_id=result.get("orchestrator_id", ""),
        checkpoint_path=result.get("checkpoint_path", ""),
        pending_tasks=result.get("pending_tasks", 0),
        completed_tasks=result.get("completed_tasks", 0),
    )


@router.post("/orchestrate/thaw/{orchestrator_id}")
async def thaw_orchestrator(orchestrator_id: str):
    """从检查点恢复并继续探索。"""
    orch = _orchestrators.get(orchestrator_id)
    if not orch:
        # 尝试加载检查点
        orch = AgentOrchestrator(graph_id="", storage_dir="./data/graphs")
        result = await orch.thaw(checkpoint_id=orchestrator_id)
        _orchestrators[orch.orchestrator_id] = orch
        return result

    result = await orch.thaw()
    return result


@router.get("/orchestrate/checkpoints")
async def list_checkpoints():
    """列出所有检查点。"""
    orch = AgentOrchestrator(graph_id="", storage_dir="./data/graphs")
    return orch.list_checkpoints()
