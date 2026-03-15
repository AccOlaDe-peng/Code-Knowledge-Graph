"""模块扫描 Agent - AI 驱动的模块边界识别。

该 Agent 分析目录结构，使用 LLM 识别模块边界，生成模块划分计划。
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from typing import TYPE_CHECKING

from backend.agent.base import BaseAgent
from backend.agent.context import AgentContext
from backend.llm.client import LLMClient
from backend.models.ai_analysis import ModuleInfo, ModulePlan
from backend.models.agent_output import AgentOutput

if TYPE_CHECKING:
    from backend.scanner.repo_scanner import FileInfo, ScanResult

logger = logging.getLogger(__name__)


class ModuleScannerAgent(BaseAgent):
    """模块扫描 Agent - AI 驱动的模块边界识别。

    职责：
    - 分析仓库目录结构
    - 使用 LLM 识别模块边界
    - 生成 ModulePlan 包含模块划分和架构提示

    该 Agent 不使用 tool_call_loop，而是直接使用 complete 方法，
    因为模块扫描只需要分析目录结构，不需要读取文件内容。

    对于大型仓库，会分批分析文件，然后合并结果。
    """

    agent_type = "module_scanner"

    # 每批最大文件数量，避免 Prompt 过长导致 LLM 返回空响应
    BATCH_SIZE = 200

    def __init__(self, context: AgentContext, llm_client: LLMClient):
        """初始化 ModuleScannerAgent。

        Args:
            context: Agent 执行上下文
            llm_client: LLM 客户端
        """
        super().__init__(
            agent_type=self.agent_type,
            context=context,
            llm_client=llm_client,
        )

    def get_system_prompt(self) -> str:
        """返回 Agent 的系统提示词。"""
        return """你是一个代码仓库模块分析专家。你的任务是分析项目的目录结构，识别模块边界。

你需要：
1. 分析目录结构，识别功能模块
2. 为每个模块确定包含的文件
3. 推断每个模块的职责和目的
4. 识别整体架构模式（如分层架构、微服务、单体应用等）

输出格式要求（JSON）：
{
  "modules": [
    {
      "id": "module:模块名",
      "name": "模块显示名",
      "files": ["相对路径/文件1.py", "相对路径/文件2.py"],
      "purpose": "该模块的职责描述",
      "language": "主要编程语言",
      "confidence": 0.9
    }
  ],
  "architecture_hints": {
    "pattern": "layered|microservice|monolith|modular",
    "description": "架构模式描述",
    "layers": ["presentation", "business", "data"],
    "entry_points": ["main.py", "app.py"]
  },
  "confidence": 0.85
}

规则：
- 模块 ID 格式必须为 "module:xxx"
- 每个文件只能属于一个模块
- confidence 范围 0.0-1.0，表示识别置信度
- 只输出 JSON，不要其他解释"""

    def run(self) -> AgentOutput:
        """执行 Agent 分析（基类抽象方法，模块扫描使用 scan 方法）。"""
        return self.create_output(
            status="success",
            execution_time_ms=0,
            meta={"note": "Use scan() method for ModuleScannerAgent"},
        )

    def scan(self, scan_result: ScanResult) -> ModulePlan:
        """执行模块扫描（支持分批分析大型仓库）。

        对于文件数量超过 BATCH_SIZE 的仓库，会按目录分批分析，
        然后合并所有批次的模块结果。

        Args:
            scan_result: RepoScanner 的扫描结果

        Returns:
            ModulePlan: 模块划分计划，失败时返回空 ModulePlan
        """
        # 空文件列表直接返回空 plan
        if not scan_result.files:
            return ModulePlan(modules=[], architecture_hints={}, confidence=1.0)

        try:
            files = scan_result.files
            total_files = len(files)

            # 如果文件数量超过阈值，分批分析
            if total_files > self.BATCH_SIZE:
                logger.info(
                    f"文件数量 {total_files} 超过阈值 {self.BATCH_SIZE}，启用分批分析"
                )
                return self._scan_in_batches(files, list(scan_result.language_stats.keys()))

            # 小型仓库直接分析
            return self._scan_single_batch(files, list(scan_result.language_stats.keys()))

        except Exception as e:
            logger.error(f"ModuleScannerAgent 扫描失败: {e}")
            return ModulePlan(modules=[], architecture_hints={}, confidence=0.0)

    def _scan_single_batch(
        self, files: list[FileInfo], languages: list[str]
    ) -> ModulePlan:
        """分析单个批次的文件。

        Args:
            files: 文件信息列表
            languages: 语言列表

        Returns:
            ModulePlan: 模块划分计划
        """
        # 1. 构建文件树描述
        file_tree = self._build_file_tree(files)

        # 2. 构建提示词
        prompt = self._build_prompt(file_tree, languages)

        # 3. 调用 LLM
        response = self.llm_client.complete(
            prompt=prompt,
            system=self.get_system_prompt(),
        )

        # 4. 解析响应
        return self._parse_response(response)

    def _scan_in_batches(
        self, files: list[FileInfo], languages: list[str]
    ) -> ModulePlan:
        """分批分析大型仓库。

        按目录分组文件，每批最多 BATCH_SIZE 个文件，分别调用 LLM 分析，
        然后合并所有批次的模块结果。

        Args:
            files: 文件信息列表
            languages: 语言列表

        Returns:
            ModulePlan: 合并后的模块划分计划
        """
        # 按目录分组文件
        dir_groups: dict[str, list[FileInfo]] = defaultdict(list)
        for f in files:
            parts = f.path.split("/")
            if len(parts) == 1:
                dir_groups["__root__"].append(f)
            else:
                # 使用顶级目录作为分组键
                top_dir = parts[0]
                dir_groups[top_dir].append(f)

        all_modules: list[ModuleInfo] = []
        all_architecture_hints: dict = {}
        confidences: list[float] = []
        processed_files: set[str] = set()

        # 按批次处理
        batch_files: list[FileInfo] = []
        batch_index = 0

        for dir_name, dir_files in sorted(dir_groups.items()):
            # 如果当前批次加上这个目录的文件不超过限制，则添加到当前批次
            if len(batch_files) + len(dir_files) <= self.BATCH_SIZE:
                batch_files.extend(dir_files)
            else:
                # 先处理当前批次（如果有的话）
                if batch_files:
                    batch_index += 1
                    logger.info(
                        f"正在分析第 {batch_index} 批次，共 {len(batch_files)} 个文件..."
                    )
                    plan = self._scan_single_batch(batch_files, languages)
                    self._merge_plan_results(
                        plan, all_modules, all_architecture_hints, confidences, processed_files
                    )

                # 如果单个目录的文件就超过了限制，采样该目录
                if len(dir_files) > self.BATCH_SIZE:
                    batch_index += 1
                    logger.info(
                        f"目录 {dir_name} 文件过多 ({len(dir_files)})，采样分析前 {self.BATCH_SIZE} 个文件"
                    )
                    sampled_files = dir_files[: self.BATCH_SIZE]
                    plan = self._scan_single_batch(sampled_files, languages)
                    self._merge_plan_results(
                        plan, all_modules, all_architecture_hints, confidences, processed_files
                    )
                    batch_files = []
                else:
                    batch_files = list(dir_files)

        # 处理最后一批
        if batch_files:
            batch_index += 1
            logger.info(
                f"正在分析第 {batch_index} 批次，共 {len(batch_files)} 个文件..."
            )
            plan = self._scan_single_batch(batch_files, languages)
            self._merge_plan_results(
                plan, all_modules, all_architecture_hints, confidences, processed_files
            )

        # 为未分配的文件创建默认模块
        unassigned_files = [f.path for f in files if f.path not in processed_files]
        if unassigned_files:
            all_modules.append(
                ModuleInfo(
                    id="module:unassigned",
                    name="Other Files",
                    files=unassigned_files,
                    purpose="未分配到具体模块的文件",
                    language=languages[0] if languages else "unknown",
                    confidence=0.5,
                )
            )

        # 计算平均置信度
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.5

        logger.info(
            f"分批分析完成: {batch_index} 批次, {len(all_modules)} 个模块, "
            f"{len(processed_files)}/{len(files)} 文件已分配"
        )

        return ModulePlan(
            modules=all_modules,
            architecture_hints=all_architecture_hints,
            confidence=avg_confidence,
        )

    def _merge_plan_results(
        self,
        plan: ModulePlan,
        all_modules: list[ModuleInfo],
        all_architecture_hints: dict,
        confidences: list[float],
        processed_files: set[str],
    ) -> None:
        """合并单个批次的计划结果到总结果中。

        Args:
            plan: 单个批次的模块计划
            all_modules: 累计的模块列表
            all_architecture_hints: 累计的架构提示
            confidences: 累计的置信度列表
            processed_files: 已处理的文件集合
        """
        for module in plan.modules:
            # 检查是否已存在同名模块
            existing = next(
                (m for m in all_modules if m.id == module.id or m.name == module.name),
                None,
            )
            if existing:
                # 合并文件列表
                existing_files = set(existing.files)
                new_files = [f for f in module.files if f not in existing_files]
                existing.files.extend(new_files)
                processed_files.update(new_files)
            else:
                all_modules.append(module)
                processed_files.update(module.files)

        # 合并架构提示
        if plan.architecture_hints:
            all_architecture_hints.update(plan.architecture_hints)

        confidences.append(plan.confidence)

    def _build_file_tree(self, files: list[FileInfo]) -> str:
        """将文件列表转换为树形结构字符串。

        Args:
            files: 文件信息列表

        Returns:
            树形结构描述字符串
        """
        if not files:
            return ""

        # 按目录分组
        tree: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for f in files:
            parts = f.path.split("/")
            if len(parts) == 1:
                # 根目录文件
                tree[""].append((f.path, f.language))
            else:
                # 获取目录路径
                dir_path = "/".join(parts[:-1])
                tree[dir_path].append((parts[-1], f.language))

        # 构建树形字符串
        lines = []
        sorted_dirs = sorted(tree.keys())

        for dir_path in sorted_dirs:
            if dir_path:
                lines.append(f"{dir_path}/")

            files_in_dir = sorted(tree[dir_path], key=lambda x: x[0])
            for filename, language in files_in_dir:
                indent = "  " if dir_path else ""
                lines.append(f"{indent}{filename} ({language})")

        return "\n".join(lines)

    def _build_prompt(self, file_tree: str, languages: list[str]) -> str:
        """构建 LLM 提示词。

        Args:
            file_tree: 文件树字符串
            languages: 语言列表

        Returns:
            完整的提示词
        """
        languages_str = ", ".join(languages) if languages else "Unknown"

        return f"""请分析以下代码仓库的目录结构，识别模块边界：

仓库路径: {self.context.repo_path}
主要语言: {languages_str}

目录结构:
{file_tree}

请识别：
1. 项目包含哪些功能模块
2. 每个模块包含哪些文件
3. 每个模块的职责
4. 整体架构模式

请直接输出 JSON 格式的分析结果。"""

    def _parse_response(self, response: str) -> ModulePlan:
        """解析 LLM 响应为 ModulePlan。

        支持解析：
        - 纯 JSON 字符串
        - 包含在 ```json ... ``` 代码块中的 JSON
        - 包含在 ``` ... ``` 代码块中的 JSON

        Args:
            response: LLM 返回的原始响应

        Returns:
            ModulePlan 对象，解析失败返回空 plan
        """
        if not response:
            return ModulePlan(modules=[], architecture_hints={}, confidence=0.0)

        content = response.strip()

        # 尝试从代码块中提取 JSON
        if "```json" in content:
            try:
                content = content.split("```json")[1].split("```")[0]
            except IndexError:
                pass
        elif "```" in content:
            try:
                parts = content.split("```")
                if len(parts) >= 2:
                    content = parts[1]
                    # 移除可能的语言标识符
                    if content.startswith("json\n"):
                        content = content[5:]
            except IndexError:
                pass

        content = content.strip()

        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            logger.warning(f"解析 LLM 响应失败: {e}")
            return ModulePlan(modules=[], architecture_hints={}, confidence=0.0)

        # 解析模块
        modules = []
        for mod_data in data.get("modules", []):
            try:
                module = ModuleInfo(
                    id=mod_data.get("id", ""),
                    name=mod_data.get("name", ""),
                    files=mod_data.get("files", []),
                    purpose=mod_data.get("purpose", ""),
                    language=mod_data.get("language", ""),
                    confidence=mod_data.get("confidence", 1.0),
                )
                modules.append(module)
            except Exception as e:
                logger.warning(f"解析模块数据失败: {e}")
                continue

        # 提取架构提示
        architecture_hints = data.get("architecture_hints", {})
        overall_confidence = data.get("confidence", 1.0)

        return ModulePlan(
            modules=modules,
            architecture_hints=architecture_hints,
            confidence=overall_confidence,
        )
