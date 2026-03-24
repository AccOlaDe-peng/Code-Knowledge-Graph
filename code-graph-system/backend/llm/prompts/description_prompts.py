"""
AI 描述生成 Prompt 模板。

用于生成领域描述和节点描述的 Prompt。
"""
from __future__ import annotations


# ─── 领域描述 Prompt ───────────────────────────────────────────────────────────

DOMAIN_DESCRIPTION_SYSTEM = """你是一个专业的代码分析专家。你的任务是分析代码仓库中的业务领域，生成简洁准确的功能描述。

要求：
1. 功能摘要控制在 100-200 字，描述该领域的主要功能和业务价值
2. 核心服务列表列出 3-5 个最重要的服务名称
3. 数据流向模式用简洁的语言描述数据在该领域内的流动方式
4. 使用中文回复

输出格式必须是有效的 JSON：
{
  "summary": "功能摘要文本",
  "core_services": ["服务1", "服务2"],
  "data_flow_pattern": "数据流向描述"
}"""

DOMAIN_DESCRIPTION_USER = """请分析以下业务领域的代码结构，生成功能描述。

领域名称: {domain_name}
领域关键字: {domain_key}

节点列表（共 {node_count} 个）:
{node_list}

调用关系:
{call_relations}

请输出 JSON 格式的描述。"""


# ─── 节点描述 Prompt ───────────────────────────────────────────────────────────

NODE_DESCRIPTION_SYSTEM = """你是一个专业的代码分析专家。你的任务是分析代码节点的功能，生成简洁准确的描述。

要求：
1. 功能描述控制在 50-100 字，说明该节点的作用
2. 如果代码片段中有重要的行（如方法签名、return 语句），标记出行号
3. 使用中文回复

输出格式必须是有效的 JSON：
{
  "description": "功能描述文本",
  "highlight_lines": [行号1, 行号2]
}"""

NODE_DESCRIPTION_USER = """请分析以下代码节点的功能。

节点类型: {node_type}
节点名称: {node_name}
文件路径: {file_path}

代码:
```
{code_content}
```

请输出 JSON 格式的描述。"""


# ─── 批量节点描述 Prompt ─────────────────────────────────────────────────────

BATCH_NODE_DESCRIPTION_SYSTEM = """你是一个专业的代码分析专家。你的任务是批量分析多个代码节点的功能。

要求：
1. 为每个节点生成 50-100 字的功能描述
2. 标记重要行号（方法签名、return 语句等）
3. 使用中文回复

输出格式必须是有效的 JSON 数组：
[
  {
    "node_id": "节点ID",
    "description": "功能描述文本",
    "highlight_lines": [行号1, 行号2]
  }
]"""

BATCH_NODE_DESCRIPTION_USER = """请批量分析以下代码节点的功能。

节点列表:
{node_list}

请输出 JSON 数组格式的描述。"""


# ─── Prompt 构建函数 ───────────────────────────────────────────────────────────

def build_domain_description_prompt(
    domain_name: str,
    domain_key: str,
    nodes: list[dict],
    edges: list[dict],
) -> tuple[str, str]:
    """
    构建领域描述 Prompt。

    Returns:
        (system_prompt, user_prompt)
    """
    # 构建节点列表
    node_lines = []
    for i, node in enumerate(nodes[:30]):  # 最多 30 个节点
        node_type = node.get("type", "Unknown")
        node_name = node.get("name", node.get("id", "").split(":")[-1])
        node_lines.append(f"{i+1}. [{node_type}] {node_name}")

    if len(nodes) > 30:
        node_lines.append(f"... 还有 {len(nodes) - 30} 个节点")

    node_list_str = "\n".join(node_lines)

    # 构建调用关系
    call_lines = []
    for edge in edges[:20]:  # 最多 20 条边
        from_name = edge.get("from", "").split(":")[-1]
        to_name = edge.get("to", "").split(":")[-1]
        edge_type = edge.get("type", "calls")
        call_lines.append(f"{from_name} --[{edge_type}]--> {to_name}")

    if len(edges) > 20:
        call_lines.append(f"... 还有 {len(edges) - 20} 条调用关系")

    call_relations_str = "\n".join(call_lines)

    user_prompt = DOMAIN_DESCRIPTION_USER.format(
        domain_name=domain_name,
        domain_key=domain_key,
        node_count=len(nodes),
        node_list=node_list_str,
        call_relations=call_relations_str,
    )

    return DOMAIN_DESCRIPTION_SYSTEM, user_prompt


def build_node_description_prompt(
    node_id: str,
    node_type: str,
    node_name: str,
    file_path: str,
    code_content: str,
) -> tuple[str, str]:
    """
    构建节点描述 Prompt。

    Returns:
        (system_prompt, user_prompt)
    """
    user_prompt = NODE_DESCRIPTION_USER.format(
        node_type=node_type,
        node_name=node_name,
        file_path=file_path,
        code_content=code_content,
    )

    return NODE_DESCRIPTION_SYSTEM, user_prompt


def build_batch_node_description_prompt(
    nodes: list[dict],
) -> tuple[str, str]:
    """
    构建批量节点描述 Prompt。

    Args:
        nodes: 节点列表，每个节点包含 id, type, name, file, code

    Returns:
        (system_prompt, user_prompt)
    """
    node_lines = []
    for i, node in enumerate(nodes[:10]):  # 最多 10 个节点
        node_id = node.get("id", "")
        node_type = node.get("type", "Unknown")
        node_name = node.get("name", node_id.split(":")[-1])
        code = node.get("code", "")[:500]  # 代码最多 500 字符

        node_lines.append(f"""
节点 {i+1}:
ID: {node_id}
类型: {node_type}
名称: {node_name}
代码:
```
{code}
```
""")

    node_list_str = "\n".join(node_lines)

    user_prompt = BATCH_NODE_DESCRIPTION_USER.format(
        node_list=node_list_str,
    )

    return BATCH_NODE_DESCRIPTION_SYSTEM, user_prompt
