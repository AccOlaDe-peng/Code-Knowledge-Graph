"""
AI 分析器 Prompt 管理模块。

Prompt 模板优先从 prompts/ 目录下的 .txt 文件加载，
文件不存在时自动退回到内置（硬编码）模板。

文件格式（prompts/<name>.txt）：

    [version]
    1.0.0

    [system]
    You are a ...

    [user]
    Repository: {repo_name}
    ...

规则：
    - [system] 节原样存储，不进行变量替换
    - [user] 节支持 {variable} 占位符，渲染时用关键字参数填充
    - 未提供的变量填充空字符串，而非抛出 KeyError

用法::

    loader = PromptLoader()
    system, user = loader.render("architecture", repo_name="my-app", ...)

    # 查看可用模板
    loader.available()        # ["architecture", "business_flow", ...]
    loader.version("data_lineage")   # "1.0.0"

    # 动态重载（修改 .txt 后生效）
    loader.reload("architecture")
"""

from __future__ import annotations

import dataclasses
import logging
import re
from pathlib import Path
from string import Formatter
from typing import Any

logger = logging.getLogger(__name__)

# Directory that holds all .txt template files
_PROMPTS_DIR: Path = Path(__file__).parent / "prompts"


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class PromptTemplate:
    """单个分析器的 prompt 模板。"""

    name: str
    version: str          # e.g. "1.0.0"
    system: str           # 系统 prompt（不含变量，原样使用）
    user_template: str    # 用户 prompt 模板（含 {placeholder}）

    def variables(self) -> list[str]:
        """返回 user_template 中所有占位符名称。"""
        return [
            fname
            for _, fname, _, _ in Formatter().parse(self.user_template)
            if fname is not None
        ]

    def render(self, **kwargs: Any) -> tuple[str, str]:
        """渲染模板，返回 (system, user) 元组。

        未提供的变量填充空字符串，而非抛出 KeyError。
        """
        safe_kwargs = {v: kwargs.get(v, "") for v in self.variables()}
        return self.system, self.user_template.format(**safe_kwargs)


# ---------------------------------------------------------------------------
# .txt file parser
# ---------------------------------------------------------------------------


def _parse_prompt_file(path: Path) -> PromptTemplate:
    """从 .txt 文件解析 PromptTemplate。

    文件格式：
        [version]
        1.0.0

        [system]
        <system text, may span multiple lines>

        [user]
        <user template text with {variables}>

    Raises:
        ValueError: 文件缺少必要节（version / system / user）。
        FileNotFoundError: 文件不存在。
    """
    text = path.read_text(encoding="utf-8")
    name = path.stem  # filename without extension

    sections: dict[str, str] = {}
    # Split on section headers like "[section]"
    pattern = re.compile(r"^\[(\w+)\]\s*$", re.MULTILINE)
    parts = pattern.split(text)

    # parts layout: [preamble, key1, content1, key2, content2, ...]
    # preamble (index 0) is ignored; then alternating keys and contents
    it = iter(parts[1:])  # skip preamble
    for key, content in zip(it, it):
        sections[key.strip().lower()] = content.strip()

    missing = [s for s in ("version", "system", "user") if s not in sections]
    if missing:
        raise ValueError(
            f"Prompt file '{path}' is missing sections: {missing}"
        )

    return PromptTemplate(
        name=name,
        version=sections["version"],
        system=sections["system"],
        user_template=sections["user"],
    )


# ---------------------------------------------------------------------------
# Built-in fallback templates
# ---------------------------------------------------------------------------

_BUILTIN_TEMPLATES: dict[str, PromptTemplate] = {}


def _register_builtin(tpl: PromptTemplate) -> PromptTemplate:
    _BUILTIN_TEMPLATES[tpl.name] = tpl
    return tpl


_ARCHITECTURE_BUILTIN = _register_builtin(PromptTemplate(
    name="architecture",
    version="1.0.0",
    system=(
        "You are a senior software architect. Analyze the provided repository summary "
        "and identify the architecture pattern and layers.\n\n"
        "Output ONLY valid JSON matching this exact schema — no prose, no markdown fences:\n"
        '{\n'
        '  "pattern": "<mvc|layered|hexagonal|clean|unknown>",\n'
        '  "layers": [\n'
        '    {\n'
        '      "name": "<PascalCase layer name>",\n'
        '      "description": "<one sentence>",\n'
        '      "layer_index": <int, 0=outermost>,\n'
        '      "responsibilities": ["<resp1>", "<resp2>"]\n'
        '    }\n'
        '  ],\n'
        '  "assignments": [\n'
        '    {\n'
        '      "node_name": "<exact name from summary>",\n'
        '      "layer": "<layer name from layers above>",\n'
        '      "confidence": <0.0-1.0>\n'
        '    }\n'
        '  ],\n'
        '  "overall_confidence": <0.0-1.0>\n'
        '}\n'
        "Rules:\n"
        "- layer_index 0 is the outermost layer (e.g. HTTP controllers)\n"
        "- Only assign nodes that clearly belong to a layer (confidence >= 0.6)\n"
        "- Use exact node_name values from the summary"
    ),
    user_template=(
        "Repository: {repo_name}\n"
        "Languages: {languages}\n\n"
        "## Modules\n{modules}\n\n"
        "## API Endpoints\n{apis}\n\n"
        "## Key Classes/Services\n{services}\n\n"
        "## Key Functions (top by importance)\n{functions}\n\n"
        "Identify the architecture pattern and assign each significant node to a layer."
    ),
))

_SERVICE_DETECTION_BUILTIN = _register_builtin(PromptTemplate(
    name="service_detection",
    version="1.0.0",
    system=(
        "You are a microservices architect. Analyze the repository summary and identify "
        "service boundaries, responsibilities, and inter-service dependencies.\n\n"
        "Output ONLY valid JSON matching this exact schema:\n"
        '{\n'
        '  "services": [\n'
        '    {\n'
        '      "name": "<ServiceName>",\n'
        '      "modules": ["<module1>"],\n'
        '      "responsibility": "<one sentence>",\n'
        '      "communication": ["<HTTP|gRPC|Kafka|...>"],\n'
        '      "tech_stack": ["<framework>"],\n'
        '      "confidence": <0.0-1.0>\n'
        '    }\n'
        '  ],\n'
        '  "dependencies": [\n'
        '    {\n'
        '      "from_service": "<ServiceName>",\n'
        '      "to_service": "<ServiceName>",\n'
        '      "protocol": "<HTTP|gRPC|Kafka|...>",\n'
        '      "direction": "<sync|async>",\n'
        '      "confidence": <0.0-1.0>\n'
        '    }\n'
        '  ],\n'
        '  "overall_confidence": <0.0-1.0>\n'
        '}\n'
        "Rules:\n"
        "- Only infer services from clear evidence (module boundaries, Docker configs)\n"
        "- If the repo is a monolith, return one service covering all modules\n"
        "- Do not invent service names — derive them from the codebase evidence"
    ),
    user_template=(
        "Repository: {repo_name}\n"
        "Languages: {languages}\n\n"
        "## Modules & Files\n{modules}\n\n"
        "## Existing Services (from infra analysis)\n{existing_services}\n\n"
        "## API Endpoints\n{apis}\n\n"
        "## Infrastructure\n{infra}\n\n"
        "## Event Flows\n{events}\n\n"
        "## Module Dependencies\n{dependencies}\n\n"
        "Identify microservice or module boundaries and their dependencies."
    ),
))

_BUSINESS_FLOW_BUILTIN = _register_builtin(PromptTemplate(
    name="business_flow",
    version="1.0.0",
    system=(
        "You are a domain expert in business process analysis. Analyze the repository "
        "and identify end-to-end business flows (use cases / user journeys).\n\n"
        "Output ONLY valid JSON matching this exact schema:\n"
        '{\n'
        '  "flows": [\n'
        '    {\n'
        '      "name": "<FlowName in PascalCase>",\n'
        '      "trigger": "<API endpoint or event that starts this flow>",\n'
        '      "description": "<one sentence>",\n'
        '      "domain": "<business domain>",\n'
        '      "steps": [\n'
        '        {\n'
        '          "step_index": <int starting at 1>,\n'
        '          "function_name": "<exact function name from summary>",\n'
        '          "description": "<what this step does>",\n'
        '          "is_critical": <true|false>\n'
        '        }\n'
        '      ],\n'
        '      "produces_events": ["<EventName>"],\n'
        '      "confidence": <0.0-1.0>\n'
        '    }\n'
        '  ],\n'
        '  "overall_confidence": <0.0-1.0>\n'
        '}\n'
        "Rules:\n"
        "- A flow must have at least 2 steps\n"
        "- Only use function names that appear in the summary\n"
        "- Focus on user-facing business processes, not technical utilities"
    ),
    user_template=(
        "Repository: {repo_name}\n"
        "Languages: {languages}\n\n"
        "## API Endpoints\n{apis}\n\n"
        "## Key Functions (ranked by importance)\n{functions}\n\n"
        "## Call Graph Sample\n{call_graph}\n\n"
        "## Events\n{events}\n\n"
        "## Services\n{services}\n\n"
        "Identify the main business flows and trace their execution paths."
    ),
))

_DATA_LINEAGE_BUILTIN = _register_builtin(PromptTemplate(
    name="data_lineage",
    version="1.0.0",
    system=(
        "You are a data engineering expert. Analyze the repository and identify "
        "data lineage — which functions read, write, or transform which data stores.\n\n"
        "Output ONLY valid JSON matching this exact schema:\n"
        '{\n'
        '  "lineage": [\n'
        '    {\n'
        '      "function_name": "<exact function name from summary>",\n'
        '      "reads": ["<table/collection/topic name>"],\n'
        '      "writes": ["<table/collection/topic name>"],\n'
        '      "transforms": [\n'
        '        {\n'
        '          "from_entity": "<source data entity>",\n'
        '          "to_entity": "<target data entity>",\n'
        '          "description": "<transformation description>",\n'
        '          "confidence": <0.0-1.0>\n'
        '        }\n'
        '      ],\n'
        '      "confidence": <0.0-1.0>\n'
        '    }\n'
        '  ],\n'
        '  "data_flows": [\n'
        '    {\n'
        '      "source": "<function or entity name>",\n'
        '      "target": "<function or entity name>",\n'
        '      "flow_type": "<read|write|transform|produce|consume>",\n'
        '      "data_entity": "<table/topic/object name>",\n'
        '      "confidence": <0.0-1.0>\n'
        '    }\n'
        '  ],\n'
        '  "overall_confidence": <0.0-1.0>\n'
        '}\n'
        "Rules:\n"
        "- Only include lineage that can be inferred from provided names and context\n"
        "- save/create/insert → likely writes; get/find/load → likely reads\n"
        "- Use exact function names from the summary"
    ),
    user_template=(
        "Repository: {repo_name}\n"
        "Languages: {languages}\n\n"
        "## Key Functions\n{functions}\n\n"
        "## Databases & Tables\n{databases}\n\n"
        "## Events & Topics\n{events}\n\n"
        "## Call Graph Sample\n{call_graph}\n\n"
        "## Services\n{services}\n\n"
        "Trace data lineage: which functions read/write/transform which data stores."
    ),
))

_DOMAIN_MODEL_BUILTIN = _register_builtin(PromptTemplate(
    name="domain_model",
    version="1.0.0",
    system=(
        "You are a domain-driven design expert. Analyze the repository and identify "
        "domain entities, aggregates, value objects, and their relationships.\n\n"
        "Output ONLY valid JSON matching this exact schema:\n"
        '{\n'
        '  "bounded_contexts": [\n'
        '    {\n'
        '      "name": "<ContextName>",\n'
        '      "description": "<one sentence>",\n'
        '      "confidence": <0.0-1.0>\n'
        '    }\n'
        '  ],\n'
        '  "entities": [\n'
        '    {\n'
        '      "name": "<EntityName>",\n'
        '      "entity_type": "<aggregate_root|entity|value_object|domain_service|domain_event>",\n'
        '      "bounded_context": "<ContextName from above>",\n'
        '      "attributes": ["<attr1>", "<attr2>"],\n'
        '      "description": "<one sentence>",\n'
        '      "source_class": "<exact class name from summary, if applicable>",\n'
        '      "confidence": <0.0-1.0>\n'
        '    }\n'
        '  ],\n'
        '  "relationships": [\n'
        '    {\n'
        '      "from_entity": "<EntityName>",\n'
        '      "to_entity": "<EntityName>",\n'
        '      "relation_type": "<contains|references|inherits|implements|associated_with>",\n'
        '      "multiplicity": "<one_to_one|one_to_many|many_to_many>",\n'
        '      "description": "<brief description>",\n'
        '      "confidence": <0.0-1.0>\n'
        '    }\n'
        '  ],\n'
        '  "overall_confidence": <0.0-1.0>\n'
        '}\n'
        "Rules:\n"
        "- Aggregate roots own a cluster of related domain objects\n"
        "- Value objects are immutable and identified by value (e.g. Money, Address)\n"
        "- Domain services contain logic not belonging to a single entity\n"
        "- Only include entities with clear business meaning, not technical classes\n"
        "- Use source_class when you can map a domain entity to a class in the summary"
    ),
    user_template=(
        "Repository: {repo_name}\n"
        "Languages: {languages}\n\n"
        "## Modules\n{modules}\n\n"
        "## Key Classes and Functions\n{classes_and_functions}\n\n"
        "## API Endpoints (for context)\n{apis}\n\n"
        "## Database Schema (tables/collections)\n{databases}\n\n"
        "## Events\n{events}\n\n"
        "Identify the domain model: bounded contexts, entities, aggregates, "
        "value objects, and the relationships between them."
    ),
))


# ---------------------------------------------------------------------------
# PromptLoader
# ---------------------------------------------------------------------------


class PromptLoader:
    """集中管理所有 AI 分析器的 prompt 模板。

    加载优先级：
        1. prompts/<name>.txt  （磁盘文件，可热更新）
        2. 内置硬编码模板       （保底，始终可用）

    用法::

        loader = PromptLoader()

        # 渲染为 (system, user) 元组
        system, user = loader.render("architecture", repo_name="my-app", ...)

        # 查看模板信息
        loader.available()           # all registered names
        loader.version("data_lineage")  # "1.0.0"
        loader.source("architecture")   # "file" | "builtin"

        # 动态重载（修改 .txt 后生效，无需重启）
        loader.reload("architecture")
        loader.reload_all()
    """

    def __init__(self, prompts_dir: Path | None = None) -> None:
        self._dir: Path = prompts_dir or _PROMPTS_DIR
        # Cache: name → (PromptTemplate, source)
        self._cache: dict[str, tuple[PromptTemplate, str]] = {}
        self._load_all()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get(self, name: str) -> PromptTemplate:
        """按名称获取 PromptTemplate。

        Raises:
            KeyError: 名称不存在且无内置模板。
        """
        if name not in self._cache:
            self._try_load(name)
        if name not in self._cache:
            available = sorted(self._cache.keys())
            raise KeyError(
                f"Prompt template '{name}' not found. "
                f"Available: {available}"
            )
        return self._cache[name][0]

    def render(self, name: str, **kwargs: Any) -> tuple[str, str]:
        """渲染指定模板，返回 (system, user) 元组。

        Args:
            name:     模板名称（architecture / service_detection /
                      business_flow / data_lineage / domain_model）。
            **kwargs: 模板变量，未提供的变量填充空字符串。

        Returns:
            (system_prompt, user_prompt)
        """
        return self.get(name).render(**kwargs)

    def version(self, name: str) -> str:
        """返回模板版本号（用于缓存 key 计算）。"""
        return self.get(name).version

    def source(self, name: str) -> str:
        """返回模板来源：'file' 或 'builtin'。"""
        if name not in self._cache:
            self._try_load(name)
        entry = self._cache.get(name)
        return entry[1] if entry else "unknown"

    def available(self) -> list[str]:
        """返回所有已注册模板名称。"""
        return sorted(self._cache.keys())

    def reload(self, name: str) -> bool:
        """重新从磁盘加载指定模板（修改 .txt 后调用）。

        Returns:
            True 若成功从文件重载，False 若文件不存在（保持现有模板）。
        """
        path = self._dir / f"{name}.txt"
        if path.exists():
            try:
                tpl = _parse_prompt_file(path)
                self._cache[name] = (tpl, "file")
                logger.info("PromptLoader: reloaded '%s' from %s", name, path)
                return True
            except Exception as exc:
                logger.warning("PromptLoader: failed to reload '%s': %s", name, exc)
        return False

    def reload_all(self) -> None:
        """重新扫描 prompts/ 目录并重载所有 .txt 文件。"""
        self._load_all()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _load_all(self) -> None:
        """初始化：先注册内置模板，再用磁盘文件覆盖。"""
        # 1. Seed from built-ins
        for name, tpl in _BUILTIN_TEMPLATES.items():
            self._cache[name] = (tpl, "builtin")

        # 2. Override / extend with .txt files
        if self._dir.is_dir():
            for txt_path in sorted(self._dir.glob("*.txt")):
                try:
                    tpl = _parse_prompt_file(txt_path)
                    self._cache[tpl.name] = (tpl, "file")
                    logger.debug(
                        "PromptLoader: loaded '%s' v%s from %s",
                        tpl.name, tpl.version, txt_path,
                    )
                except Exception as exc:
                    logger.warning(
                        "PromptLoader: skipping '%s': %s", txt_path.name, exc
                    )
        else:
            logger.debug(
                "PromptLoader: prompts directory not found (%s), using built-ins only",
                self._dir,
            )

    def _try_load(self, name: str) -> None:
        """Try to load a single template by name from disk or builtin."""
        path = self._dir / f"{name}.txt"
        if path.exists():
            try:
                tpl = _parse_prompt_file(path)
                self._cache[name] = (tpl, "file")
                return
            except Exception as exc:
                logger.warning("PromptLoader: cannot load '%s.txt': %s", name, exc)
        if name in _BUILTIN_TEMPLATES:
            self._cache[name] = (_BUILTIN_TEMPLATES[name], "builtin")
