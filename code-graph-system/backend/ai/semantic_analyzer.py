"""
语义分析器模块。

使用 LLM 对代码进行深度语义理解：
1. 生成函数/类的自然语言摘要
2. 推断代码意图和业务逻辑
3. 识别设计模式
4. 提取关键概念和领域术语
5. 生成语义嵌入向量（用于相似度检索）

结果写入节点的 metadata 和 embedding 字段。
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from backend.ai.llm_client import LLMClient, get_default_client
from backend.graph.schema import AnyNode, ComponentNode, FunctionNode, ModuleNode

logger = logging.getLogger(__name__)


class SemanticAnalyzer:
    """
    代码语义分析器。

    使用 LLM 增强代码节点的语义信息，
    为后续的 GraphRAG 查询提供高质量的上下文。

    示例::

        analyzer = SemanticAnalyzer()
        await analyzer.analyze_node(function_node, source_code)
    """

    def __init__(self, llm_client: Optional[LLMClient] = None) -> None:
        """
        初始化语义分析器。

        Args:
            llm_client: LLM 客户端实例，None 则使用默认客户端
        """
        self.llm = llm_client or get_default_client()

    def analyze_function(
        self,
        node: FunctionNode,
        source_code: str,
    ) -> dict[str, Any]:
        """
        分析函数节点的语义。

        Args:
            node: 函数节点
            source_code: 函数源码

        Returns:
            包含 summary、intent、patterns 等字段的字典
        """
        prompt = f"""分析以下 Python 函数，提取关键信息：

函数名: {node.name}
签名: {node.signature or "N/A"}
源码:
```python
{source_code[:1000]}  # 限制长度
```

请以 JSON 格式返回：
{{
  "summary": "一句话功能摘要",
  "intent": "业务意图或用途",
  "patterns": ["使用的设计模式"],
  "concepts": ["关键领域概念"],
  "complexity_reason": "复杂度原因（如果复杂度>5）"
}}
"""
        try:
            result = self.llm.complete_with_json(
                prompt,
                system="你是代码分析专家，擅长理解代码语义和业务逻辑。",
            )
            return result
        except Exception as e:
            logger.warning(f"函数语义分析失败 {node.name}: {e}")
            return {"summary": "", "intent": "", "patterns": [], "concepts": []}

    def analyze_class(
        self,
        node: ComponentNode,
        source_code: str,
    ) -> dict[str, Any]:
        """
        分析类/组件节点的语义。

        Args:
            node: 组件节点
            source_code: 类源码

        Returns:
            语义分析结果字典
        """
        prompt = f"""分析以下类定义，提取关键信息：

类名: {node.name}
类型: {node.component_type}
基类: {node.base_classes}
方法: {node.methods[:10]}  # 限制数量
源码片段:
```python
{source_code[:1500]}
```

请以 JSON 格式返回：
{{
  "summary": "类的职责和作用",
  "domain": "所属业务领域",
  "patterns": ["设计模式"],
  "responsibilities": ["单一职责列表"],
  "concepts": ["核心概念"]
}}
"""
        try:
            result = self.llm.complete_with_json(prompt)
            return result
        except Exception as e:
            logger.warning(f"类语义分析失败 {node.name}: {e}")
            return {"summary": "", "domain": "", "patterns": [], "responsibilities": [], "concepts": []}

    def analyze_module(
        self,
        node: ModuleNode,
        summary: str,
    ) -> dict[str, Any]:
        """
        分析模块节点的语义。

        Args:
            node: 模块节点
            summary: 模块内容摘要（类名、函数名列表）

        Returns:
            语义分析结果字典
        """
        prompt = f"""分析以下代码模块：

模块名: {node.name}
包路径: {node.package or "N/A"}
导出: {node.exports[:20]}
导入: {node.imports[:20]}

请以 JSON 格式返回：
{{
  "summary": "模块功能摘要",
  "purpose": "模块在系统中的作用",
  "layer": "架构层次（如 controller/service/repository/util）",
  "concepts": ["关键概念"]
}}
"""
        try:
            result = self.llm.complete_with_json(prompt)
            return result
        except Exception as e:
            logger.warning(f"模块语义分析失败 {node.name}: {e}")
            return {"summary": "", "purpose": "", "layer": "", "concepts": []}

    def generate_embedding(self, text: str) -> Optional[list[float]]:
        """
        生成文本的嵌入向量。

        使用 OpenAI text-embedding-3-small 或本地模型。

        Args:
            text: 输入文本

        Returns:
            嵌入向量（维度通常为 1536 或 768），失败返回 None
        """
        try:
            import openai

            api_key = self.llm.api_key if self.llm.provider == "openai" else None
            if not api_key:
                logger.debug("未配置 OpenAI API Key，跳过嵌入生成")
                return None

            client = openai.OpenAI(api_key=api_key)
            response = client.embeddings.create(
                model="text-embedding-3-small",
                input=text[:8000],  # 限制长度
            )
            return response.data[0].embedding
        except Exception as e:
            logger.debug(f"嵌入生成失败: {e}")
            return None

    def enrich_node(
        self,
        node: AnyNode,
        source_code: Optional[str] = None,
    ) -> None:
        """
        就地增强节点的语义信息。

        根据节点类型调用对应的分析方法，
        将结果写入 node.metadata 和 node.embedding。

        Args:
            node: 任意图节点
            source_code: 节点对应的源码（可选）
        """
        semantic_info: dict[str, Any] = {}

        if isinstance(node, FunctionNode) and source_code:
            semantic_info = self.analyze_function(node, source_code)
        elif isinstance(node, ComponentNode) and source_code:
            semantic_info = self.analyze_class(node, source_code)
        elif isinstance(node, ModuleNode):
            summary = f"Exports: {', '.join(node.exports[:10])}"
            semantic_info = self.analyze_module(node, summary)

        # 写入 metadata
        node.metadata.update({
            "semantic_summary": semantic_info.get("summary", ""),
            "semantic_intent": semantic_info.get("intent", ""),
            "semantic_patterns": semantic_info.get("patterns", []),
            "semantic_concepts": semantic_info.get("concepts", []),
        })

        # 生成嵌入向量
        embed_text = f"{node.name} {semantic_info.get('summary', '')} {node.metadata.get('docstring', '')}"
        embedding = self.generate_embedding(embed_text)
        if embedding:
            node.embedding = embedding

        logger.debug(f"语义增强完成: {node.name}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    from backend.graph.schema import FunctionNode

    analyzer = SemanticAnalyzer()
    test_node = FunctionNode(
        name="calculate_total",
        line_start=10,
        line_end=20,
        signature="def calculate_total(items: list[Item]) -> float",
    )
    test_code = """
def calculate_total(items: list[Item]) -> float:
    total = sum(item.price * item.quantity for item in items)
    return total
"""
    result = analyzer.analyze_function(test_node, test_code)
    print("语义分析结果:", result)
