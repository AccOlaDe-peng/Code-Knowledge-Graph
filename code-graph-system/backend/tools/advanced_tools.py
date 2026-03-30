"""高级推理工具实现。

提供 LLM 辅助的分析能力：
- 歧义解决
- 数据流推断
- 业务语义理解
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class AmbiguityInfo:
    """歧义信息。"""
    symbol: str
    candidates: list
    context: dict
    file_path: str
    line_number: int


@dataclass
class DataFlowPath:
    """数据流路径。"""
    source: str
    target: str
    transformations: list
    intermediate_nodes: list


class AdvancedTools:
    """高级推理工具实现。"""

    def __init__(
        self,
        repo_path: Path | str,
        base_tools: Any,
        semantic_tools: Any,
        llm_client: Any = None,
    ):
        self.repo_path = Path(repo_path)
        self.base_tools = base_tools
        self.semantic_tools = semantic_tools
        self.llm_client = llm_client

    # ═══════════════════════════════════════════════════════════════
    # resolve_ambiguity
    # ═══════════════════════════════════════════════════════════════

    def resolve_ambiguity(
        self,
        symbol: str,
        context: dict,
        candidates: list,
    ) -> dict:
        """解决符号歧义。

        Args:
            symbol: 有歧义的符号名
            context: 上下文信息（文件、类、方法等）
            candidates: 候选定义列表

        Returns:
            解决结果，包含：
            - resolved: 是否解决
            - chosen: 选中的候选
            - confidence: 置信度
            - reasoning: 推理过程
        """
        if not candidates:
            return {
                "success": True,
                "resolved": False,
                "reason": "no_candidates",
            }

        if len(candidates) == 1:
            return {
                "success": True,
                "resolved": True,
                "chosen": candidates[0],
                "confidence": 1.0,
                "reasoning": "唯一候选",
            }

        # 基于规则解决
        rule_result = self._resolve_by_rules(symbol, context, candidates)
        if rule_result.get("resolved"):
            return rule_result

        # LLM 辅助解决
        if self.llm_client:
            return self._resolve_by_llm(symbol, context, candidates)

        # 无法解决，返回最可能的候选
        return {
            "success": True,
            "resolved": False,
            "candidates": candidates,
            "reason": "requires_manual_review",
        }

    def _resolve_by_rules(
        self,
        symbol: str,
        context: dict,
        candidates: list,
    ) -> dict:
        """基于规则解决歧义。"""
        # 规则 1: 同一文件优先
        context_file = context.get("file_path")
        if context_file:
            same_file = [c for c in candidates if c.get("file_path") == context_file]
            if len(same_file) == 1:
                return {
                    "success": True,
                    "resolved": True,
                    "chosen": same_file[0],
                    "confidence": 0.95,
                    "reasoning": "同一文件定义",
                }

        # 规则 2: 同包优先
        context_package = context.get("package")
        if context_package:
            same_package = [
                c for c in candidates
                if c.get("package") == context_package
            ]
            if len(same_package) == 1:
                return {
                    "success": True,
                    "resolved": True,
                    "chosen": same_package[0],
                    "confidence": 0.85,
                    "reasoning": "同包定义",
                }

        # 规则 3: 显式导入优先
        imports = context.get("imports", [])
        imported = [
            c for c in candidates
            if any(c.get("full_name", "").startswith(imp) for imp in imports)
        ]
        if len(imported) == 1:
            return {
                "success": True,
                "resolved": True,
                "chosen": imported[0],
                "confidence": 0.90,
                "reasoning": "显式导入",
            }

        # 规则 4: 常用类优先
        common_packages = [
            "java.lang", "java.util", "java.io",
            "org.springframework", "jakarta.persistence",
        ]
        common = [
            c for c in candidates
            if any(c.get("full_name", "").startswith(pkg) for pkg in common_packages)
        ]
        if len(common) == 1:
            return {
                "success": True,
                "resolved": True,
                "chosen": common[0],
                "confidence": 0.80,
                "reasoning": "标准库/常用框架类",
            }

        return {"resolved": False}

    def _resolve_by_llm(
        self,
        symbol: str,
        context: dict,
        candidates: list,
    ) -> dict:
        """使用 LLM 解决歧义。"""
        prompt = f"""分析以下符号引用，判断最可能的定义：

符号: {symbol}

上下文:
- 文件: {context.get('file_path', 'unknown')}
- 类: {context.get('class_name', 'unknown')}
- 方法: {context.get('method_name', 'unknown')}
- 导入: {', '.join(context.get('imports', [])[:5])}

候选定义:
{json.dumps(candidates, indent=2, ensure_ascii=False)}

请返回 JSON 格式:
{{
  "chosen_index": 0,
  "confidence": 0.85,
  "reasoning": "选择理由"
}}
"""

        try:
            response = self.llm_client.chat(prompt)
            result = self._parse_llm_response(response)

            if result and "chosen_index" in result:
                idx = result["chosen_index"]
                if 0 <= idx < len(candidates):
                    return {
                        "success": True,
                        "resolved": True,
                        "chosen": candidates[idx],
                        "confidence": result.get("confidence", 0.75),
                        "reasoning": result.get("reasoning"),
                    }
        except Exception as e:
            logger.warning("LLM 歧义解决失败: %s", e)

        return {
            "success": True,
            "resolved": False,
            "candidates": candidates,
            "reason": "llm_failed",
        }

    # ═══════════════════════════════════════════════════════════════
    # infer_data_flow
    # ═══════════════════════════════════════════════════════════════

    def infer_data_flow(
        self,
        source: str,
        target: str,
        scope: str = "repository",
    ) -> dict:
        """推断数据流路径。

        Args:
            source: 数据源（表名、实体名或方法名）
            target: 数据目标
            scope: 分析范围（repository, module, project）

        Returns:
            数据流路径信息
        """
        # 收集相关代码片段
        snippets = self._collect_flow_snippets(source, target, scope)

        if self.llm_client:
            return self._infer_flow_by_llm(source, target, snippets)

        # 回退到静态分析
        return self._infer_flow_static(source, target, snippets)

    def _collect_flow_snippets(
        self,
        source: str,
        target: str,
        scope: str,
    ) -> list:
        """收集数据流相关代码片段。"""
        snippets = []

        # 搜索源相关代码
        source_results = self.base_tools.search_code(
            pattern=source,
            context_lines=3,
            max_results=20,
        )
        if source_results.get("success"):
            for r in source_results.get("results", [])[:5]:
                snippets.append({
                    "type": "source",
                    "file": r["file_path"],
                    "line": r["line_number"],
                    "content": r["line_content"],
                    "context": r.get("context_before", []) + r.get("context_after", []),
                })

        # 搜索目标相关代码
        target_results = self.base_tools.search_code(
            pattern=target,
            context_lines=3,
            max_results=20,
        )
        if target_results.get("success"):
            for r in target_results.get("results", [])[:5]:
                snippets.append({
                    "type": "target",
                    "file": r["file_path"],
                    "line": r["line_number"],
                    "content": r["line_content"],
                    "context": r.get("context_before", []) + r.get("context_after", []),
                })

        return snippets

    def _infer_flow_by_llm(
        self,
        source: str,
        target: str,
        snippets: list,
    ) -> dict:
        """使用 LLM 推断数据流。"""
        snippets_text = "\n".join([
            f"[{s['type']}] {s['file']}:{s['line']}\n{s['content']}"
            for s in snippets[:10]
        ])

        prompt = f"""分析以下代码片段，推断从 "{source}" 到 "{target}" 的数据流路径：

代码片段:
{snippets_text}

请返回 JSON 格式:
{{
  "paths": [
    {{
      "source": "{source}",
      "target": "{target}",
      "transformations": [
        {{"step": 1, "type": "read", "location": "file:line", "description": "读取数据"}},
        {{"step": 2, "type": "transform", "location": "file:line", "description": "转换数据"}},
        {{"step": 3, "type": "write", "location": "file:line", "description": "写入数据"}}
      ],
      "intermediate_nodes": ["node1", "node2"],
      "confidence": 0.85
    }}
  ],
  "summary": "数据从 X 经过 Y 流向 Z"
}}
"""

        try:
            response = self.llm_client.chat(prompt)
            result = self._parse_llm_response(response)

            if result and "paths" in result:
                return {
                    "success": True,
                    "source": source,
                    "target": target,
                    "paths": result["paths"],
                    "summary": result.get("summary"),
                }
        except Exception as e:
            logger.warning("LLM 数据流推断失败: %s", e)

        return {
            "success": False,
            "reason": "llm_failed",
        }

    def _infer_flow_static(
        self,
        source: str,
        target: str,
        snippets: list,
    ) -> dict:
        """静态推断数据流。"""
        # 简化实现：基于代码片段的启发式分析
        paths = []

        # 查找源和目标之间的中间节点
        source_files = {s["file"] for s in snippets if s["type"] == "source"}
        target_files = {s["file"] for s in snippets if s["type"] == "target"}

        if source_files & target_files:
            # 同文件
            paths.append({
                "source": source,
                "target": target,
                "transformations": [
                    {"step": 1, "type": "direct", "description": "直接引用"},
                ],
                "intermediate_nodes": [],
                "confidence": 0.90,
            })
        else:
            # 需要跨文件追踪
            paths.append({
                "source": source,
                "target": target,
                "transformations": [
                    {"step": 1, "type": "unknown", "description": "需要进一步分析"},
                ],
                "intermediate_nodes": [],
                "confidence": 0.50,
            })

        return {
            "success": True,
            "source": source,
            "target": target,
            "paths": paths,
            "method": "static_heuristic",
        }

    # ═══════════════════════════════════════════════════════════════
    # understand_business_semantic
    # ═══════════════════════════════════════════════════════════════

    def understand_business_semantic(
        self,
        code_element: str,
        element_type: str,
        context: dict,
    ) -> dict:
        """理解代码元素的业务语义。

        Args:
            code_element: 代码元素（类名、方法名等）
            element_type: 元素类型（class, method, field）
            context: 上下文信息

        Returns:
            业务语义理解结果
        """
        if not self.llm_client:
            return {
                "success": False,
                "reason": "llm_required",
            }

        # 收集相关代码
        code_context = self._collect_element_context(code_element, element_type, context)

        prompt = f"""分析以下代码元素的业务语义：

元素: {code_element}
类型: {element_type}

代码上下文:
```
{code_context}
```

请返回 JSON 格式:
{{
  "business_name": "业务名称",
  "description": "业务描述",
  "domain": "所属领域",
  "responsibilities": ["职责1", "职责2"],
  "business_rules": ["业务规则1"],
  "related_entities": ["相关实体1"],
  "importance": "high/medium/low",
  "confidence": 0.85
}}
"""

        try:
            response = self.llm_client.chat(prompt)
            result = self._parse_llm_response(response)

            if result:
                return {
                    "success": True,
                    "element": code_element,
                    "semantic": result,
                }
        except Exception as e:
            logger.warning("业务语义理解失败: %s", e)

        return {
            "success": False,
            "reason": "llm_failed",
        }

    def _collect_element_context(
        self,
        element: str,
        element_type: str,
        context: dict,
    ) -> str:
        """收集元素的代码上下文。"""
        file_path = context.get("file_path")
        if not file_path:
            return ""

        read_result = self.base_tools.read_file(file_path)
        if not read_result.get("success"):
            return ""

        content = read_result["content"]
        lines = content.split("\n")

        if element_type == "class":
            # 查找类定义
            for i, line in enumerate(lines):
                if f"class {element}" in line:
                    start = max(0, i - 5)
                    end = min(len(lines), i + 50)
                    return "\n".join(lines[start:end])

        elif element_type == "method":
            # 查找方法定义
            for i, line in enumerate(lines):
                if element in line and "(" in line:
                    start = max(0, i - 2)
                    end = min(len(lines), i + 30)
                    return "\n".join(lines[start:end])

        elif element_type == "field":
            # 查找字段定义
            for i, line in enumerate(lines):
                if element in line:
                    start = max(0, i - 3)
                    end = min(len(lines), i + 3)
                    return "\n".join(lines[start:end])

        return ""

    # ═══════════════════════════════════════════════════════════════
    # detect_patterns
    # ═══════════════════════════════════════════════════════════════

    def detect_architecture_patterns(
        self,
        path: str,
        patterns: list = None,
    ) -> dict:
        """检测架构模式。

        Args:
            path: 文件或目录路径
            patterns: 要检测的模式列表，默认检测常见模式

        Returns:
            检测到的架构模式列表
        """
        patterns = patterns or [
            "layered", "hexagonal", "cqrs", "event_sourcing",
            "microservice", "ddd", "mvc", "repository",
        ]

        read_result = self.base_tools.read_file(path) if path.endswith((".java", ".py")) else None

        if not read_result or not read_result.get("success"):
            # 目录级别检测
            return self._detect_patterns_by_structure(path, patterns)

        content = read_result["content"]
        detected = []

        # 分层架构
        if "layered" in patterns:
            layers = self._detect_layered_architecture(path, content)
            if layers:
                detected.append({
                    "pattern": "layered",
                    "confidence": 0.85,
                    "evidence": layers,
                })

        # DDD
        if "ddd" in patterns:
            ddd_evidence = self._detect_ddd(content)
            if ddd_evidence:
                detected.append({
                    "pattern": "ddd",
                    "confidence": ddd_evidence["confidence"],
                    "evidence": ddd_evidence,
                })

        # Repository 模式
        if "repository" in patterns:
            repo_evidence = self._detect_repository(content)
            if repo_evidence:
                detected.append({
                    "pattern": "repository",
                    "confidence": 0.90,
                    "evidence": repo_evidence,
                })

        return {
            "success": True,
            "patterns": detected,
            "path": path,
        }

    def _detect_patterns_by_structure(self, path: str, patterns: list) -> dict:
        """基于目录结构检测模式。"""
        dir_result = self.base_tools.list_directory(path, recursive=True)

        if not dir_result.get("success"):
            return {"success": False, "reason": "invalid_path"}

        detected = []
        dirs = [
            e["name"] for e in dir_result.get("entries", [])
            if e["type"] == "directory"
        ]

        # 分层架构
        if "layered" in patterns:
            layer_names = ["controller", "service", "repository", "dao", "entity", "model"]
            found_layers = [d for d in dirs if d.lower() in layer_names]
            if len(found_layers) >= 2:
                detected.append({
                    "pattern": "layered",
                    "confidence": 0.80 + 0.05 * len(found_layers),
                    "evidence": {"layers": found_layers},
                })

        # DDD
        if "ddd" in patterns:
            ddd_names = ["domain", "application", "infrastructure", "interfaces"]
            found_ddd = [d for d in dirs if d.lower() in ddd_names]
            if len(found_ddd) >= 2:
                detected.append({
                    "pattern": "ddd",
                    "confidence": 0.75 + 0.05 * len(found_ddd),
                    "evidence": {"layers": found_ddd},
                })

        return {
            "success": True,
            "patterns": detected,
            "path": path,
        }

    def _detect_layered_architecture(self, path: str, content: str) -> Optional[dict]:
        """检测分层架构。"""
        layers = {}

        # Controller 层
        if "@Controller" in content or "@RestController" in content:
            layers["controller"] = True

        # Service 层
        if "@Service" in content:
            layers["service"] = True

        # Repository/DAO 层
        if "@Repository" in content or "Repository" in content:
            layers["repository"] = True

        # Entity 层
        if "@Entity" in content:
            layers["entity"] = True

        if len(layers) >= 2:
            return {"layers": list(layers.keys())}

        return None

    def _detect_ddd(self, content: str) -> Optional[dict]:
        """检测 DDD 模式。"""
        evidence = {"markers": [], "confidence": 0.0}

        ddd_markers = [
            ("@AggregateRoot", 0.9),
            ("@DomainEvent", 0.85),
            ("@ValueObject", 0.85),
            ("DomainService", 0.80),
            ("ApplicationService", 0.75),
            ("Repository<", 0.70),
            ("Specification", 0.65),
        ]

        for marker, weight in ddd_markers:
            if marker in content:
                evidence["markers"].append(marker)
                evidence["confidence"] = max(evidence["confidence"], weight)

        if evidence["markers"]:
            return evidence

        return None

    def _detect_repository(self, content: str) -> Optional[dict]:
        """检测 Repository 模式。"""
        if "@Repository" in content or "extends Repository" in content or "implements Repository" in content:
            return {"found": True}

        if "JpaRepository" in content or "CrudRepository" in content:
            return {"found": True, "type": "jpa"}

        return None

    # ═══════════════════════════════════════════════════════════════
    # 辅助方法
    # ═══════════════════════════════════════════════════════════════

    def _parse_llm_response(self, response: str) -> Optional[dict]:
        """解析 LLM 响应中的 JSON。"""
        import re

        # 尝试直接解析
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        # 尝试提取 JSON 块
        json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', response)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        # 尝试找到 JSON 对象
        json_match = re.search(r'\{[\s\S]*\}', response)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass

        return None
