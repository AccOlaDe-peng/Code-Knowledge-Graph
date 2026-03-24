"""手动触发 AI 描述生成脚本。"""
import json
import os
import sys
import logging

# 加载 .env（强制覆盖 LLM 相关变量，避免被 shell 环境干扰）
from pathlib import Path
LLM_KEYS = {
    "LLM_PROVIDER", "LLM_MODEL",
    "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL",
    "OPENAI_API_KEY", "OPENAI_BASE_URL",
    "MINIMAX_API_KEY", "MINIMAX_BASE_URL",
}
env_file = Path(__file__).parent / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip()
            # LLM 相关变量强制覆盖；其余变量只补充
            if k in LLM_KEYS:
                os.environ[k] = v
            else:
                os.environ.setdefault(k, v)

# Claude Code 环境会注入 ANTHROPIC_AUTH_TOKEN，Anthropic SDK 会把它作为
# Authorization: Bearer 头发送，与 x-api-key 冲突导致第三方代理返回 401。
# 使用自定义 base_url 时必须清除此变量。
if os.environ.get("ANTHROPIC_BASE_URL") and "anthropic.com" not in os.environ.get("ANTHROPIC_BASE_URL", ""):
    os.environ.pop("ANTHROPIC_AUTH_TOKEN", None)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("run_ai_description")

# 重置 LLM 单例，让新的 env var 生效
import backend.llm.client as _llm_mod
_llm_mod._llm_client_instance = None

logger.info(
    "LLM 配置: provider=%s model=%s base_url=%s",
    os.environ.get("LLM_PROVIDER"),
    os.environ.get("LLM_MODEL"),
    os.environ.get("ANTHROPIC_BASE_URL"),
)

# 加载图谱
GRAPH_PATH = "data/graphs/adms.json"
REPO_ID = "adms"

logger.info("加载图谱: %s", GRAPH_PATH)
with open(GRAPH_PATH) as f:
    graph = json.load(f)

raw_nodes = graph.get("nodes", [])
raw_edges = graph.get("edges", [])
logger.info("节点: %d, 边: %d", len(raw_nodes), len(raw_edges))

# 转换为 GraphNode / GraphEdge 对象
from backend.graph.graph_schema import GraphNode, GraphEdge

nodes = []
for n in raw_nodes:
    try:
        nodes.append(GraphNode(
            id=n["id"],
            type=n.get("type", "Unknown"),
            name=n.get("name", ""),
            properties=n.get("properties", {}),
        ))
    except Exception:
        pass

edges = []
for e in raw_edges:
    try:
        edges.append(GraphEdge(
            from_=e.get("from") or e.get("from_", ""),
            to=e.get("to", ""),
            type=e.get("type", ""),
            properties=e.get("properties", {}),
        ))
    except Exception:
        pass

logger.info("转换完成: %d 节点, %d 边", len(nodes), len(edges))

# 运行 AI 描述生成
from backend.pipeline.stages.ai_description_stage import AIDescriptionStage, AIDescriptionConfig

config = AIDescriptionConfig(
    enabled=True,
    max_nodes_per_domain=30,   # 每个领域最多 30 个节点（控制 token 消耗）
    batch_size=5,
    concurrency=3,
    skip_if_cached=True,       # 已生成的跳过
)

stage = AIDescriptionStage(
    repo_id=REPO_ID,
    config=config,
)

logger.info("开始运行 AI 描述生成阶段...")
result = stage.run(nodes=nodes, edges=edges)

logger.info(
    "完成: 领域生成 %d, 跳过 %d | 节点生成 %d, 跳过 %d | 错误 %d",
    result.domains_generated,
    result.domains_skipped,
    result.nodes_generated,
    result.nodes_skipped,
    len(result.errors),
)

if result.errors:
    logger.warning("错误列表 (前 5 条):")
    for err in result.errors[:5]:
        logger.warning("  %s", err)
