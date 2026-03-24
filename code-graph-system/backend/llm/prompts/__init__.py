"""
LLM Prompts 模块。
"""
from backend.llm.prompts.description_prompts import (
    DOMAIN_DESCRIPTION_SYSTEM,
    DOMAIN_DESCRIPTION_USER,
    NODE_DESCRIPTION_SYSTEM,
    NODE_DESCRIPTION_USER,
    BATCH_NODE_DESCRIPTION_SYSTEM,
    BATCH_NODE_DESCRIPTION_USER,
    build_domain_description_prompt,
    build_node_description_prompt,
    build_batch_node_description_prompt,
)

__all__ = [
    "DOMAIN_DESCRIPTION_SYSTEM",
    "DOMAIN_DESCRIPTION_USER",
    "NODE_DESCRIPTION_SYSTEM",
    "NODE_DESCRIPTION_USER",
    "BATCH_NODE_DESCRIPTION_SYSTEM",
    "BATCH_NODE_DESCRIPTION_USER",
    "build_domain_description_prompt",
    "build_node_description_prompt",
    "build_batch_node_description_prompt",
]
