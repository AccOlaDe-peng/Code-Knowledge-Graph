"""
AI 分析器响应验证工具。

对 LLM 返回的 JSON 响应进行结构验证，确保下游代码
（_build_from_llm 方法）拿到的数据符合预期 schema。

用法::

    validator = ResponseValidator()

    result = validator.validate("architecture", raw)
    if not result.valid:
        for err in result.errors:
            logger.warning(err)

    # 或直接使用各 analyze 方法的专用验证器
    result = validator.validate_architecture(raw)
    result = validator.validate_service_detection(raw)
    result = validator.validate_business_flow(raw)
    result = validator.validate_data_lineage(raw)
    result = validator.validate_domain_model(raw)
"""

from __future__ import annotations

import dataclasses
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class ValidationResult:
    """LLM 响应验证结果。

    Attributes:
        valid:    True 当且仅当 errors 为空且结构满足必要约束。
        errors:   阻断性错误（必须修复才能继续处理）。
        warnings: 非阻断性问题（处理可继续，但结果可能不完整）。
        stats:    响应统计摘要（用于日志和 debug）。
    """

    valid: bool
    errors: list[str] = dataclasses.field(default_factory=list)
    warnings: list[str] = dataclasses.field(default_factory=list)
    stats: dict[str, Any] = dataclasses.field(default_factory=dict)

    def __bool__(self) -> bool:
        return self.valid

    def summary(self) -> str:
        parts = [f"valid={self.valid}"]
        if self.errors:
            parts.append(f"errors={len(self.errors)}")
        if self.warnings:
            parts.append(f"warnings={len(self.warnings)}")
        parts.extend(f"{k}={v}" for k, v in self.stats.items())
        return " ".join(parts)


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------


def _check_type(obj: Any, key: str, expected: type, errors: list[str]) -> bool:
    """Check that obj[key] exists and is the expected type."""
    if key not in obj:
        errors.append(f"Missing required key: '{key}'")
        return False
    if not isinstance(obj[key], expected):
        errors.append(
            f"Key '{key}' must be {expected.__name__}, "
            f"got {type(obj[key]).__name__}"
        )
        return False
    return True


def _check_list(
    items: list[Any],
    item_name: str,
    required_keys: list[str],
    warnings: list[str],
    min_count: int = 0,
) -> int:
    """Validate a list of dicts; return count of valid items."""
    if len(items) < min_count:
        warnings.append(
            f"Expected at least {min_count} {item_name}(s), got {len(items)}"
        )

    valid_count = 0
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            warnings.append(f"{item_name}[{i}] is not a dict, skipping")
            continue
        missing = [k for k in required_keys if k not in item]
        if missing:
            warnings.append(
                f"{item_name}[{i}] missing keys: {missing}"
            )
        else:
            valid_count += 1
    return valid_count


def _check_confidence(
    obj: dict[str, Any],
    key: str = "overall_confidence",
    warnings: list[str] = None,
) -> float:
    """Extract and validate a confidence value."""
    warnings = warnings or []
    val = obj.get(key, 0.0)
    try:
        fval = float(val)
    except (TypeError, ValueError):
        warnings.append(f"'{key}' is not a number: {val!r}")
        return 0.0
    if not 0.0 <= fval <= 1.0:
        warnings.append(f"'{key}' out of range [0,1]: {fval}")
        return max(0.0, min(1.0, fval))
    return fval


# ---------------------------------------------------------------------------
# ResponseValidator
# ---------------------------------------------------------------------------


class ResponseValidator:
    """验证 LLM 响应与预期 schema 的符合度。

    每个 validate_* 方法对应一个 AI 分析器，返回 ValidationResult。
    顶层 validate(name, raw) 按模板名称动态分发。
    """

    # Map template name → validator method
    _DISPATCH: dict[str, str] = {
        "architecture":      "validate_architecture",
        "service_detection": "validate_service_detection",
        "business_flow":     "validate_business_flow",
        "data_lineage":      "validate_data_lineage",
        "domain_model":      "validate_domain_model",
    }

    def validate(self, template_name: str, raw: dict[str, Any]) -> ValidationResult:
        """按模板名称分发到对应验证方法。

        Args:
            template_name: 模板名称（如 "architecture"）。
            raw:           LLM 返回的解析后 JSON dict。

        Returns:
            ValidationResult
        """
        method_name = self._DISPATCH.get(template_name)
        if not method_name:
            return ValidationResult(
                valid=False,
                errors=[f"No validator for template '{template_name}'"],
            )
        method: Callable[[dict[str, Any]], ValidationResult] = getattr(
            self, method_name
        )
        return method(raw)

    # ------------------------------------------------------------------
    # Architecture
    # ------------------------------------------------------------------

    def validate_architecture(self, raw: dict[str, Any]) -> ValidationResult:
        """Validate architecture analyzer response."""
        errors: list[str] = []
        warnings: list[str] = []

        if not isinstance(raw, dict):
            return ValidationResult(valid=False, errors=["Response is not a dict"])

        # Required top-level keys
        _check_type(raw, "layers", list, errors)
        _check_type(raw, "assignments", list, errors)

        if errors:
            return ValidationResult(valid=False, errors=errors, warnings=warnings)

        # Validate layers
        layer_names: set[str] = set()
        valid_layers = _check_list(
            raw["layers"],
            "layer",
            required_keys=["name", "layer_index"],
            warnings=warnings,
            min_count=1,
        )
        for lyr in raw["layers"]:
            if isinstance(lyr, dict) and "name" in lyr:
                layer_names.add(str(lyr["name"]))

        # Validate assignments
        valid_assignments = _check_list(
            raw["assignments"],
            "assignment",
            required_keys=["node_name", "layer", "confidence"],
            warnings=warnings,
        )

        # Cross-check assignment layers reference known layers
        unknown_layers = [
            a["layer"]
            for a in raw["assignments"]
            if isinstance(a, dict) and "layer" in a
            and a["layer"] not in layer_names
        ]
        if unknown_layers:
            warnings.append(
                f"Assignments reference unknown layers: {unknown_layers[:5]}"
            )

        confidence = _check_confidence(raw, warnings=warnings)

        return ValidationResult(
            valid=True,
            errors=errors,
            warnings=warnings,
            stats={
                "layers": valid_layers,
                "assignments": valid_assignments,
                "confidence": confidence,
                "pattern": raw.get("pattern", "unknown"),
            },
        )

    # ------------------------------------------------------------------
    # Service detection
    # ------------------------------------------------------------------

    def validate_service_detection(self, raw: dict[str, Any]) -> ValidationResult:
        """Validate service detection response."""
        errors: list[str] = []
        warnings: list[str] = []

        if not isinstance(raw, dict):
            return ValidationResult(valid=False, errors=["Response is not a dict"])

        _check_type(raw, "services", list, errors)
        if errors:
            return ValidationResult(valid=False, errors=errors)

        valid_services = _check_list(
            raw["services"],
            "service",
            required_keys=["name", "responsibility"],
            warnings=warnings,
            min_count=1,
        )

        # Validate dependencies if present
        valid_deps = 0
        if "dependencies" in raw and isinstance(raw["dependencies"], list):
            valid_deps = _check_list(
                raw["dependencies"],
                "dependency",
                required_keys=["from_service", "to_service"],
                warnings=warnings,
            )
        elif "dependencies" in raw:
            warnings.append("'dependencies' is not a list")

        # Check for duplicate service names
        svc_names = [
            s.get("name", "") for s in raw["services"] if isinstance(s, dict)
        ]
        dupes = {n for n in svc_names if svc_names.count(n) > 1}
        if dupes:
            warnings.append(f"Duplicate service names: {dupes}")

        confidence = _check_confidence(raw, warnings=warnings)

        return ValidationResult(
            valid=True,
            errors=errors,
            warnings=warnings,
            stats={
                "services": valid_services,
                "dependencies": valid_deps,
                "confidence": confidence,
            },
        )

    # ------------------------------------------------------------------
    # Business flow
    # ------------------------------------------------------------------

    def validate_business_flow(self, raw: dict[str, Any]) -> ValidationResult:
        """Validate business flow response."""
        errors: list[str] = []
        warnings: list[str] = []

        if not isinstance(raw, dict):
            return ValidationResult(valid=False, errors=["Response is not a dict"])

        _check_type(raw, "flows", list, errors)
        if errors:
            return ValidationResult(valid=False, errors=errors)

        valid_flows = 0
        total_steps = 0

        for i, flow in enumerate(raw["flows"]):
            if not isinstance(flow, dict):
                warnings.append(f"flows[{i}] is not a dict")
                continue
            if "name" not in flow:
                warnings.append(f"flows[{i}] missing 'name'")
                continue
            steps = flow.get("steps", [])
            if not isinstance(steps, list):
                warnings.append(f"flows[{i}]['steps'] is not a list")
                continue
            if len(steps) < 2:
                warnings.append(
                    f"Flow '{flow.get('name')}' has < 2 steps ({len(steps)}), "
                    "will be skipped by analyzer"
                )
                continue
            # Validate individual steps
            _check_list(
                steps,
                f"flows[{i}].step",
                required_keys=["step_index", "function_name"],
                warnings=warnings,
            )
            valid_flows += 1
            total_steps += len(steps)

        if valid_flows == 0:
            warnings.append("No valid flows with >= 2 steps found")

        confidence = _check_confidence(raw, warnings=warnings)

        return ValidationResult(
            valid=True,
            errors=errors,
            warnings=warnings,
            stats={
                "flows": valid_flows,
                "total_steps": total_steps,
                "confidence": confidence,
            },
        )

    # ------------------------------------------------------------------
    # Data lineage
    # ------------------------------------------------------------------

    def validate_data_lineage(self, raw: dict[str, Any]) -> ValidationResult:
        """Validate data lineage response."""
        errors: list[str] = []
        warnings: list[str] = []

        if not isinstance(raw, dict):
            return ValidationResult(valid=False, errors=["Response is not a dict"])

        _check_type(raw, "lineage", list, errors)
        if errors:
            return ValidationResult(valid=False, errors=errors)

        valid_lineage = _check_list(
            raw["lineage"],
            "lineage entry",
            required_keys=["function_name", "confidence"],
            warnings=warnings,
        )

        # Validate that each entry has at least one reads/writes/transforms
        empty_entries = sum(
            1 for e in raw["lineage"]
            if isinstance(e, dict)
            and not e.get("reads") and not e.get("writes") and not e.get("transforms")
        )
        if empty_entries:
            warnings.append(
                f"{empty_entries} lineage entries have no reads/writes/transforms"
            )

        # Validate data_flows if present
        valid_flows = 0
        if "data_flows" in raw and isinstance(raw["data_flows"], list):
            valid_flows = _check_list(
                raw["data_flows"],
                "data_flow",
                required_keys=["source", "target", "flow_type"],
                warnings=warnings,
            )
            # Check flow_type values
            valid_flow_types = {"read", "write", "transform", "produce", "consume"}
            bad_types = [
                f.get("flow_type")
                for f in raw["data_flows"]
                if isinstance(f, dict) and f.get("flow_type") not in valid_flow_types
            ]
            if bad_types:
                warnings.append(
                    f"Unknown flow_type values: {bad_types[:5]} "
                    f"(valid: {sorted(valid_flow_types)})"
                )

        confidence = _check_confidence(raw, warnings=warnings)

        return ValidationResult(
            valid=True,
            errors=errors,
            warnings=warnings,
            stats={
                "lineage_entries": valid_lineage,
                "data_flows": valid_flows,
                "confidence": confidence,
            },
        )

    # ------------------------------------------------------------------
    # Domain model
    # ------------------------------------------------------------------

    def validate_domain_model(self, raw: dict[str, Any]) -> ValidationResult:
        """Validate domain model response."""
        errors: list[str] = []
        warnings: list[str] = []

        if not isinstance(raw, dict):
            return ValidationResult(valid=False, errors=["Response is not a dict"])

        _check_type(raw, "entities", list, errors)
        if errors:
            return ValidationResult(valid=False, errors=errors)

        valid_entities = _check_list(
            raw["entities"],
            "entity",
            required_keys=["name", "entity_type"],
            warnings=warnings,
            min_count=1,
        )

        # Validate entity_type values
        valid_entity_types = {
            "aggregate_root", "entity", "value_object",
            "domain_service", "domain_event",
        }
        bad_types = [
            e.get("entity_type")
            for e in raw["entities"]
            if isinstance(e, dict) and e.get("entity_type") not in valid_entity_types
        ]
        if bad_types:
            warnings.append(
                f"Unknown entity_type values: {bad_types[:5]} "
                f"(valid: {sorted(valid_entity_types)})"
            )

        # Validate bounded_contexts if present
        valid_contexts = 0
        context_names: set[str] = set()
        if "bounded_contexts" in raw and isinstance(raw["bounded_contexts"], list):
            valid_contexts = _check_list(
                raw["bounded_contexts"],
                "bounded_context",
                required_keys=["name"],
                warnings=warnings,
            )
            for ctx in raw["bounded_contexts"]:
                if isinstance(ctx, dict) and "name" in ctx:
                    context_names.add(str(ctx["name"]))

        # Cross-check entity bounded_contexts
        if context_names:
            orphaned = [
                e.get("name")
                for e in raw["entities"]
                if isinstance(e, dict)
                and e.get("bounded_context") not in context_names
                and e.get("bounded_context")
            ]
            if orphaned:
                warnings.append(
                    f"Entities reference unknown bounded_context: {orphaned[:5]}"
                )

        # Validate relationships if present
        valid_rels = 0
        if "relationships" in raw and isinstance(raw["relationships"], list):
            valid_rels = _check_list(
                raw["relationships"],
                "relationship",
                required_keys=["from_entity", "to_entity", "relation_type"],
                warnings=warnings,
            )

        confidence = _check_confidence(raw, warnings=warnings)

        return ValidationResult(
            valid=True,
            errors=errors,
            warnings=warnings,
            stats={
                "entities": valid_entities,
                "bounded_contexts": valid_contexts,
                "relationships": valid_rels,
                "confidence": confidence,
            },
        )
