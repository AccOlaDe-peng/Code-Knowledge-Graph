"""JPA/Hibernate 专用工具实现。"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class EntityInfo:
    """实体信息。"""
    name: str
    table_name: str
    fields: list
    relations: list
    indexes: list
    file_path: str
    line_number: int


@dataclass
class RelationInfo:
    """关系信息。"""
    type: str  # OneToOne, OneToMany, ManyToOne, ManyToMany
    field_name: str
    target_entity: str
    join_column: Optional[str]
    join_table: Optional[str]
    mapped_by: Optional[str]
    cascade: list
    fetch: str


@dataclass
class QueryInfo:
    """查询信息。"""
    name: str
    query: str
    is_native: bool
    method_name: str
    file_path: str
    line_number: int


class JPATools:
    """JPA/Hibernate 专用工具实现。"""

    def __init__(self, repo_path: Path | str, base_tools: Any, semantic_tools: Any):
        self.repo_path = Path(repo_path)
        self.base_tools = base_tools
        self.semantic_tools = semantic_tools

    # ═══════════════════════════════════════════════════════════════
    # extract_entities
    # ═══════════════════════════════════════════════════════════════

    def extract_entities(self, path: str) -> dict:
        """提取 JPA 实体定义。"""
        read_result = self.base_tools.read_file(path)
        if not read_result.get("success"):
            return read_result

        content = read_result["content"]
        lines = content.split("\n")

        entities = []

        # 查找 @Entity 注解的类
        for i, line in enumerate(lines, start=1):
            if "@Entity" in line:
                entity = self._parse_entity(lines, i - 1, path)
                if entity:
                    entities.append(entity)

        return {
            "success": True,
            "entities": entities,
            "count": len(entities),
        }

    def _parse_entity(self, lines: list, line_idx: int, path: str) -> Optional[dict]:
        """解析实体类。"""
        # 查找类名
        class_name = None
        class_line = None
        for i in range(line_idx, min(line_idx + 10, len(lines))):
            match = re.search(r'(?:public\s+)?class\s+(\w+)', lines[i])
            if match:
                class_name = match.group(1)
                class_line = i
                break

        if not class_name:
            return None

        # 提取 @Table 注解
        table_name = self._infer_table_name(class_name)
        for i in range(max(0, line_idx - 5), class_line + 1):
            match = re.search(r'@Table\s*\([^)]*name\s*=\s*"([^"]+)"', lines[i])
            if match:
                table_name = match.group(1)

        # 提取字段
        class_end = self._find_class_end(lines, class_line)
        fields = []
        relations = []

        for i in range(class_line, class_end):
            line = lines[i]

            # ID 字段
            if "@Id" in line:
                field = self._parse_id_field(lines, i)
                if field:
                    fields.append(field)

            # 嵌入 ID
            if "@EmbeddedId" in line:
                field = self._parse_embedded_id(lines, i)
                if field:
                    fields.append(field)

            # 关系字段
            relation = self._parse_relation_field(lines, i)
            if relation:
                relations.append(relation)

            # 普通字段
            if "@Column" in line:
                field = self._parse_column_field(lines, i)
                if field:
                    fields.append(field)

        # 提取索引
        indexes = self._extract_indexes(lines, line_idx, class_line)

        return {
            "name": class_name,
            "table_name": table_name,
            "fields": fields,
            "relations": relations,
            "indexes": indexes,
            "file_path": path,
            "line_number": line_idx + 1,
        }

    def _infer_table_name(self, class_name: str) -> str:
        """推断表名（驼峰转下划线）。"""
        # UserOrder -> user_order
        s1 = re.sub(r'(.)([A-Z][a-z]+)', r'\1_\2', class_name)
        return re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s1).lower()

    def _parse_id_field(self, lines: list, line_idx: int) -> Optional[dict]:
        """解析 ID 字段。"""
        # 查找字段定义
        for i in range(line_idx, min(line_idx + 5, len(lines))):
            line = lines[i]

            match = re.search(
                r'(?:private|protected|public)?\s+'
                r'(\w+(?:<[^>]+>)?)\s+'
                r'(\w+)\s*[;=]',
                line
            )
            if match:
                field_type = match.group(1)
                field_name = match.group(2)

                # 检查生成策略
                generation_type = None
                for j in range(max(0, line_idx - 2), i):
                    gen_match = re.search(r'@GeneratedValue\s*\([^)]*strategy\s*=\s*GenerationType\.(\w+)', lines[j])
                    if gen_match:
                        generation_type = gen_match.group(1)

                return {
                    "name": field_name,
                    "type": field_type,
                    "column": self._infer_column_name(field_name),
                    "is_id": True,
                    "is_nullable": False,
                    "generation_type": generation_type,
                }

        return None

    def _parse_embedded_id(self, lines: list, line_idx: int) -> Optional[dict]:
        """解析嵌入 ID。"""
        for i in range(line_idx, min(line_idx + 5, len(lines))):
            match = re.search(
                r'(?:private|protected|public)?\s+'
                r'(\w+)\s+'
                r'(\w+)\s*[;=]',
                lines[i]
            )
            if match:
                return {
                    "name": match.group(2),
                    "type": match.group(1),
                    "is_id": True,
                    "is_embedded": True,
                }
        return None

    def _parse_column_field(self, lines: list, line_idx: int) -> Optional[dict]:
        """解析普通字段。"""
        line = lines[line_idx]

        # 提取 @Column 属性
        column_name = None
        is_nullable = True
        is_unique = False
        length = None
        precision = None
        scale = None

        # name
        match = re.search(r'name\s*=\s*"([^"]+)"', line)
        if match:
            column_name = match.group(1)

        # nullable
        match = re.search(r'nullable\s*=\s*(true|false)', line)
        if match:
            is_nullable = match.group(1) == "true"

        # unique
        match = re.search(r'unique\s*=\s*(true|false)', line)
        if match:
            is_unique = match.group(1) == "true"

        # length
        match = re.search(r'length\s*=\s*(\d+)', line)
        if match:
            length = int(match.group(1))

        # precision
        match = re.search(r'precision\s*=\s*(\d+)', line)
        if match:
            precision = int(match.group(1))

        # scale
        match = re.search(r'scale\s*=\s*(\d+)', line)
        if match:
            scale = int(match.group(1))

        # 查找字段定义
        for i in range(line_idx, min(line_idx + 5, len(lines))):
            match = re.search(
                r'(?:private|protected|public)?\s+'
                r'(?:static\s+)?'
                r'(\w+(?:<[^>]+>)?(?:\[\])?)\s+'
                r'(\w+)\s*[;=]',
                lines[i]
            )
            if match:
                field_type = match.group(1)
                field_name = match.group(2)

                if not column_name:
                    column_name = self._infer_column_name(field_name)

                return {
                    "name": field_name,
                    "type": field_type,
                    "column": column_name,
                    "is_nullable": is_nullable,
                    "is_unique": is_unique,
                    "length": length,
                    "precision": precision,
                    "scale": scale,
                }

        return None

    def _parse_relation_field(self, lines: list, line_idx: int) -> Optional[dict]:
        """解析关系字段。"""
        line = lines[line_idx]

        relation_types = [
            "OneToOne", "OneToMany", "ManyToOne", "ManyToMany"
        ]

        relation_type = None
        for rt in relation_types:
            if f"@{rt}" in line:
                relation_type = rt
                break

        if not relation_type:
            return None

        # 提取关系属性
        target_entity = None
        join_column = None
        join_table = None
        mapped_by = None
        cascade = []
        fetch = "LAZY" if relation_type in ("OneToMany", "ManyToMany") else "EAGER"

        # targetEntity
        match = re.search(r'targetEntity\s*=\s*(\w+)\.class', line)
        if match:
            target_entity = match.group(1)

        # joinColumn
        match = re.search(r'@JoinColumn\s*\([^)]*name\s*=\s*"([^"]+)"', line)
        if match:
            join_column = match.group(1)

        # joinTable
        match = re.search(r'@JoinTable\s*\([^)]*name\s*=\s*"([^"]+)"', line)
        if match:
            join_table = match.group(1)

        # mappedBy
        match = re.search(r'mappedBy\s*=\s*"([^"]+)"', line)
        if match:
            mapped_by = match.group(1)

        # cascade
        match = re.search(r'cascade\s*=\s*(?:CascadeType\.)?(\w+)', line)
        if match:
            cascade = [match.group(1)]
        match = re.search(r'cascade\s*=\s*\{([^}]+)\}', line)
        if match:
            cascade = re.findall(r'CascadeType\.(\w+)', match.group(1))

        # fetch
        match = re.search(r'fetch\s*=\s*FetchMode\.(\w+)', line)
        if match:
            fetch = match.group(1)

        # 查找字段定义
        for i in range(line_idx, min(line_idx + 5, len(lines))):
            match = re.search(
                r'(?:private|protected|public)?\s+'
                r'(\w+(?:<[^>]+>)?)\s+'
                r'(\w+)\s*[;=]',
                lines[i]
            )
            if match:
                field_type = match.group(1)
                field_name = match.group(2)

                # 从泛型提取目标实体
                if not target_entity:
                    generic_match = re.search(r'<(\w+)>', field_type)
                    if generic_match:
                        target_entity = generic_match.group(1)

                return {
                    "type": relation_type,
                    "field_name": field_name,
                    "target_entity": target_entity or field_type,
                    "join_column": join_column,
                    "join_table": join_table,
                    "mapped_by": mapped_by,
                    "cascade": cascade,
                    "fetch": fetch,
                }

        return None

    def _extract_indexes(self, lines: list, start_idx: int, class_idx: int) -> list:
        """提取索引定义。"""
        indexes = []

        for i in range(start_idx, class_idx + 1):
            line = lines[i]

            # @Table(indexes = {@Index(...), ...})
            for match in re.finditer(r'@Index\s*\([^)]*name\s*=\s*"([^"]+)"[^)]*columnList\s*=\s*"([^"]+)"', line):
                indexes.append({
                    "name": match.group(1),
                    "columns": match.group(2).split(","),
                })

        return indexes

    def _find_class_end(self, lines: list, start_idx: int) -> int:
        """找到类的结束位置。"""
        depth = 0
        for i in range(start_idx, len(lines)):
            depth += lines[i].count("{") - lines[i].count("}")
            if depth == 0 and "{" in "".join(lines[start_idx:i + 1]):
                return i
        return len(lines)

    def _infer_column_name(self, field_name: str) -> str:
        """推断列名（驼峰转下划线）。"""
        s1 = re.sub(r'(.)([A-Z][a-z]+)', r'\1_\2', field_name)
        return re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s1).lower()

    # ═══════════════════════════════════════════════════════════════
    # extract_repository_queries
    # ═══════════════════════════════════════════════════════════════

    def extract_repository_queries(self, path: str) -> dict:
        """提取 Repository 查询定义。"""
        read_result = self.base_tools.read_file(path)
        if not read_result.get("success"):
            return read_result

        content = read_result["content"]
        lines = content.split("\n")

        queries = []

        # 1. @Query 注解
        for i, line in enumerate(lines, start=1):
            if "@Query" in line:
                query = self._parse_query_annotation(lines, i - 1, path)
                if query:
                    queries.append(query)

        # 2. 方法名查询（findBy...）
        for i, line in enumerate(lines):
            match = re.search(r'(\w+)\s+findBy(\w+)\s*\(', line)
            if match:
                return_type = match.group(1)
                method_suffix = match.group(2)

                queries.append({
                    "name": f"findBy{method_suffix}",
                    "query": self._derive_find_query(method_suffix),
                    "is_native": False,
                    "is_derived": True,
                    "return_type": return_type,
                    "file_path": path,
                    "line_number": i + 1,
                })

        return {
            "success": True,
            "queries": queries,
            "count": len(queries),
        }

    def _parse_query_annotation(self, lines: list, line_idx: int, path: str) -> Optional[dict]:
        """解析 @Query 注解。"""
        line = lines[line_idx]

        # 提取查询语句
        query = None
        is_native = False

        # value = "..."
        match = re.search(r'value\s*=\s*"([^"]+)"', line)
        if match:
            query = match.group(1)

        # nativeQuery = true
        if "nativeQuery = true" in line:
            is_native = True

        # 直接字符串 @Query("...")
        if not query:
            match = re.search(r'@Query\s*\(\s*"([^"]+)"\s*\)', line)
            if match:
                query = match.group(1)

        # 查找方法名
        method_name = None
        for i in range(line_idx, min(line_idx + 5, len(lines))):
            match = re.search(r'(\w+)\s*\([^)]*\)', lines[i])
            if match and match.group(1) not in ("if", "for", "while", "Query"):
                method_name = match.group(1)
                break

        if query:
            return {
                "name": method_name,
                "query": query,
                "is_native": is_native,
                "is_derived": False,
                "file_path": path,
                "line_number": line_idx + 1,
            }

        return None

    def _derive_find_query(self, method_suffix: str) -> str:
        """从方法名推导查询条件。"""
        # findByUserNameAndStatus -> WHERE user_name = ? AND status = ?
        conditions = []

        # 分割条件
        parts = re.split(r'(And|Or)', method_suffix)

        for part in parts:
            if part in ("And", "Or"):
                continue

            # 处理条件关键字
            if part.startswith("By"):
                part = part[2:]

            # 提取字段名
            field = self._infer_column_name(part)
            conditions.append(f"{field} = ?")

        return "WHERE " + " AND ".join(conditions)

    # ═══════════════════════════════════════════════════════════════
    # infer_entity_relations
    # ═══════════════════════════════════════════════════════════════

    def infer_entity_relations(self, path: str) -> dict:
        """推断实体间的关系。"""
        entities_result = self.extract_entities(path)
        if not entities_result.get("success"):
            return entities_result

        relations = []
        entities = entities_result["entities"]

        entity_map = {e["name"]: e for e in entities}

        for entity in entities:
            entity_name = entity["name"]

            for rel in entity.get("relations", []):
                target_entity = rel.get("target_entity")
                rel_type = rel.get("type")

                # 构建关系描述
                relation = {
                    "source_entity": entity_name,
                    "target_entity": target_entity,
                    "relation_type": rel_type,
                    "source_field": rel.get("field_name"),
                    "join_column": rel.get("join_column"),
                    "join_table": rel.get("join_table"),
                    "mapped_by": rel.get("mapped_by"),
                }

                # 推断逆向关系
                inverse_rel = self._find_inverse_relation(
                    entity_name, target_entity, rel_type, entity_map
                )
                if inverse_rel:
                    relation["inverse_field"] = inverse_rel

                relations.append(relation)

        return {
            "success": True,
            "relations": relations,
            "count": len(relations),
        }

    def _find_inverse_relation(
        self,
        source_entity: str,
        target_entity: str,
        rel_type: str,
        entity_map: dict,
    ) -> Optional[str]:
        """查找逆向关系。"""
        if target_entity not in entity_map:
            return None

        target = entity_map[target_entity]

        # 逆向关系类型
        inverse_map = {
            "OneToOne": "OneToOne",
            "OneToMany": "ManyToOne",
            "ManyToOne": "OneToMany",
            "ManyToMany": "ManyToMany",
        }
        inverse_type = inverse_map.get(rel_type)

        for rel in target.get("relations", []):
            if rel.get("type") == inverse_type:
                if rel.get("target_entity") == source_entity:
                    return rel.get("field_name")

        return None

    # ═══════════════════════════════════════════════════════════════
    # detect_n_plus_one
    # ═══════════════════════════════════════════════════════════════

    def detect_n_plus_one(self, path: str) -> dict:
        """检测潜在的 N+1 查询问题。"""
        read_result = self.base_tools.read_file(path)
        if not read_result.get("success"):
            return read_result

        content = read_result["content"]
        lines = content.split("\n")

        issues = []

        for i, line in enumerate(lines, start=1):
            # 懒加载的关系字段在循环中使用
            if "@ManyToOne" in line or "@OneToOne" in line:
                # 检查是否有 fetch = LAZY
                is_lazy = "fetch = FetchType.LAZY" in line or "FetchMode.LAZY" in line
                is_eager = "fetch = FetchType.EAGER" in line or "FetchMode.EAGER" in line

                # 默认 ManyToOne 和 OneToOne 是 EAGER
                if not is_lazy and (is_eager or "@ManyToOne" in line or "@OneToOne" in line):
                    # 查找字段名
                    field_name = None
                    for j in range(i, min(i + 5, len(lines))):
                        match = re.search(r'(\w+)\s*[;=]', lines[j])
                        if match:
                            field_name = match.group(1)
                            break

                    issues.append({
                        "type": "eager_fetch",
                        "severity": "medium",
                        "message": f"字段 '{field_name}' 使用急加载，可能导致 N+1 问题",
                        "suggestion": "考虑添加 fetch = FetchType.LAZY 或使用 JOIN FETCH",
                        "line_number": i,
                    })

        return {
            "success": True,
            "issues": issues,
            "count": len(issues),
        }
