"""
MCP Server for Code-Knowledge-Graph.

Exposes graph operations as MCP tools for agent integration.
Tools:
    - query_graph:    Semantic search over graph nodes
    - add_node:       Add a node to the graph
    - add_edge:       Add an edge to the graph
    - get_context:    Get node neighborhood (BFS expansion)
    - mark_explored:  Mark nodes as explored

Usage:
    python -m backend.mcp_server.server

Claude Code MCP config (~/.claude/claude_desktop_config.json):
    {
        "mcpServers": {
            "code-knowledge-graph": {
                "command": "python",
                "args": ["-m", "backend.mcp_server.server"],
                "cwd": "/path/to/code-graph-system"
            }
        }
    }
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Optional

# Ensure backend is importable when running as module
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

from backend.graph.graph_repository import GraphRepository
from backend.graph.graph_schema import GraphNode, GraphEdge, NodeType, EdgeType
from backend.rag.graph_rag_engine import GraphRAGEngine

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_STORAGE_DIR = os.getenv("KG_STORAGE_DIR", "./data/graphs")
DEFAULT_GRAPH_ID = os.getenv("KG_DEFAULT_GRAPH_ID", "")


def get_default_graph_id(repo: GraphRepository) -> str:
    """Get the default graph ID (latest graph or configured default)."""
    if DEFAULT_GRAPH_ID:
        return DEFAULT_GRAPH_ID

    graphs = repo.list_graphs()
    if not graphs:
        raise ValueError("No graphs found. Run analysis first.")

    # Return the most recently created graph
    graphs.sort(key=lambda g: g.get("created_at", ""), reverse=True)
    return graphs[0]["graph_id"]


# ---------------------------------------------------------------------------
# Tool Definitions
# ---------------------------------------------------------------------------

TOOLS = [
    Tool(
        name="query_graph",
        description="""Semantic search over graph nodes using natural language query.

Returns matching nodes with their metadata. Useful for finding functions, classes,
modules, services, or other code entities by their purpose or behavior.

Example queries:
    - "user authentication"
    - "database connection pool"
    - "event handler for order creation"
""",
        inputSchema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural language search query"
                },
                "graph_id": {
                    "type": "string",
                    "description": "Graph ID (optional, uses latest if not specified)"
                },
                "node_type": {
                    "type": "string",
                    "description": "Filter by node type (Function, Class, Module, Service, etc.)"
                },
                "limit": {
                    "type": "integer",
                    "description": "Max results (default: 20)",
                    "default": 20
                }
            },
            "required": ["query"]
        }
    ),
    Tool(
        name="add_node",
        description="""Add a node to the knowledge graph.

Creates a new node representing a code entity (function, class, module, etc.)
or updates an existing node with the same ID.

Node types: Repository, Module, File, Class, Function, Component, Service, API,
DataObject, Table, Event, Topic, Pipeline, Cluster, Database, Layer, Flow,
BusinessFlow, Domain, BoundedContext, DomainEntity
""",
        inputSchema={
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "description": "Node type (e.g., Function, Class, Module, Service)"
                },
                "name": {
                    "type": "string",
                    "description": "Node name (e.g., function name, class name)"
                },
                "node_id": {
                    "type": "string",
                    "description": "Unique node ID (optional, auto-generated if not provided)"
                },
                "graph_id": {
                    "type": "string",
                    "description": "Graph ID (optional, uses latest if not specified)"
                },
                "properties": {
                    "type": "object",
                    "description": "Additional node properties (file_path, line_number, description, etc.)"
                }
            },
            "required": ["type", "name"]
        }
    ),
    Tool(
        name="add_edge",
        description="""Add an edge (relationship) between two nodes.

Creates a relationship from source to target node. Both nodes must exist.

Edge types: contains, imports, defines, calls, depends_on, implements,
reads, writes, produces, consumes, publishes, subscribes, deployed_on,
uses, routes_to, triggers, belongs_to, flow_step, transforms, part_of
""",
        inputSchema={
            "type": "object",
            "properties": {
                "source_id": {
                    "type": "string",
                    "description": "Source node ID"
                },
                "target_id": {
                    "type": "string",
                    "description": "Target node ID"
                },
                "type": {
                    "type": "string",
                    "description": "Edge type (e.g., calls, contains, imports, implements)"
                },
                "graph_id": {
                    "type": "string",
                    "description": "Graph ID (optional, uses latest if not specified)"
                },
                "properties": {
                    "type": "object",
                    "description": "Additional edge properties"
                }
            },
            "required": ["source_id", "target_id", "type"]
        }
    ),
    Tool(
        name="get_context",
        description="""Get the neighborhood context around a node.

Returns the subgraph around the specified node using BFS expansion.
Useful for understanding what a function/class depends on and what depends on it.

Example: get_context for a Function node returns:
- The function itself
- Functions it calls
- Functions that call it
- Classes/modules it belongs to
""",
        inputSchema={
            "type": "object",
            "properties": {
                "node_id": {
                    "type": "string",
                    "description": "Node ID to get context for"
                },
                "graph_id": {
                    "type": "string",
                    "description": "Graph ID (optional, uses latest if not specified)"
                },
                "depth": {
                    "type": "integer",
                    "description": "BFS depth (default: 1)",
                    "default": 1
                },
                "edge_types": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Filter edge types (e.g., ['calls', 'imports'])"
                }
            },
            "required": ["node_id"]
        }
    ),
    Tool(
        name="mark_explored",
        description="""Mark nodes as explored to avoid redundant analysis.

Use this after analyzing nodes to prevent re-processing.
Adds 'explored' flag and optional summary to node properties.
""",
        inputSchema={
            "type": "object",
            "properties": {
                "node_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Node IDs to mark as explored"
                },
                "graph_id": {
                    "type": "string",
                    "description": "Graph ID (optional, uses latest if not specified)"
                },
                "summary": {
                    "type": "string",
                    "description": "Optional summary of analysis"
                }
            },
            "required": ["node_ids"]
        }
    ),
]


# ---------------------------------------------------------------------------
# Tool Handlers
# ---------------------------------------------------------------------------

class GraphTools:
    """Stateful container for graph operations."""

    def __init__(self, storage_dir: str = DEFAULT_STORAGE_DIR):
        self.repo = GraphRepository(storage_dir=storage_dir)
        self._rag_engine: Optional[GraphRAGEngine] = None

    @property
    def rag_engine(self) -> GraphRAGEngine:
        """Lazy-initialize RAG engine."""
        if self._rag_engine is None:
            self._rag_engine = GraphRAGEngine(storage_dir=self.repo.storage_dir)
        return self._rag_engine

    def resolve_graph_id(self, graph_id: Optional[str]) -> str:
        """Resolve graph_id or use default."""
        if graph_id:
            return graph_id
        return get_default_graph_id(self.repo)

    async def query_graph(
        self,
        query: str,
        graph_id: Optional[str] = None,
        node_type: Optional[str] = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Semantic search over graph nodes."""
        gid = self.resolve_graph_id(graph_id)

        node_types = [node_type] if node_type else None

        results = self.rag_engine.vector_search(
            graph_id=gid,
            query=query,
            limit=limit,
            node_types=node_types,
        )

        nodes = []
        for r in results:
            node_data = {
                "id": r.get("id"),
                "type": r.get("metadata", {}).get("node_type"),
                "name": r.get("metadata", {}).get("name"),
                "distance": r.get("distance"),
                "document": r.get("document"),
            }
            nodes.append(node_data)

        return {
            "nodes": nodes,
            "total": len(nodes),
            "graph_id": gid,
        }

    async def add_node(
        self,
        type: str,
        name: str,
        node_id: Optional[str] = None,
        graph_id: Optional[str] = None,
        properties: Optional[dict] = None,
    ) -> dict[str, Any]:
        """Add a node to the graph."""
        from uuid import uuid4

        gid = self.resolve_graph_id(graph_id)

        if node_id is None:
            node_id = f"{type.lower()}_{name}_{uuid4().hex[:8]}"

        node = GraphNode(
            id=node_id,
            type=type,
            name=name,
            properties=properties or {},
        )

        result = self.repo.add_single_node(gid, node)
        result["graph_id"] = gid
        return result

    async def add_edge(
        self,
        source_id: str,
        target_id: str,
        type: str,
        graph_id: Optional[str] = None,
        properties: Optional[dict] = None,
    ) -> dict[str, Any]:
        """Add an edge to the graph."""
        gid = self.resolve_graph_id(graph_id)

        edge = GraphEdge(
            from_=source_id,
            to=target_id,
            type=type,
            properties=properties or {},
        )

        result = self.repo.add_single_edge(gid, edge)
        result["graph_id"] = gid
        return result

    async def get_context(
        self,
        node_id: str,
        graph_id: Optional[str] = None,
        depth: int = 1,
        edge_types: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """Get node neighborhood."""
        gid = self.resolve_graph_id(graph_id)

        result = self.repo.query_neighbors(
            graph_id=gid,
            node_id=node_id,
            depth=depth,
            edge_types=edge_types,
        )
        result["graph_id"] = gid
        result["center_node"] = node_id
        return result

    async def mark_explored(
        self,
        node_ids: list[str],
        graph_id: Optional[str] = None,
        summary: str = "",
    ) -> dict[str, Any]:
        """Mark nodes as explored."""
        gid = self.resolve_graph_id(graph_id)

        result = self.repo.mark_explored(
            graph_id=gid,
            node_ids=node_ids,
            summary=summary,
        )
        result["graph_id"] = gid
        return result


# ---------------------------------------------------------------------------
# MCP Server Setup
# ---------------------------------------------------------------------------

async def create_server() -> Server:
    """Create and configure the MCP server."""
    server = Server("code-knowledge-graph")
    tools = GraphTools()

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return TOOLS

    @server.call_tool()
    async def call_tool(name: str, arguments: dict) -> list[TextContent]:
        try:
            if name == "query_graph":
                result = await tools.query_graph(
                    query=arguments["query"],
                    graph_id=arguments.get("graph_id"),
                    node_type=arguments.get("node_type"),
                    limit=arguments.get("limit", 20),
                )
            elif name == "add_node":
                result = await tools.add_node(
                    type=arguments["type"],
                    name=arguments["name"],
                    node_id=arguments.get("node_id"),
                    graph_id=arguments.get("graph_id"),
                    properties=arguments.get("properties"),
                )
            elif name == "add_edge":
                result = await tools.add_edge(
                    source_id=arguments["source_id"],
                    target_id=arguments["target_id"],
                    type=arguments["type"],
                    graph_id=arguments.get("graph_id"),
                    properties=arguments.get("properties"),
                )
            elif name == "get_context":
                result = await tools.get_context(
                    node_id=arguments["node_id"],
                    graph_id=arguments.get("graph_id"),
                    depth=arguments.get("depth", 1),
                    edge_types=arguments.get("edge_types"),
                )
            elif name == "mark_explored":
                result = await tools.mark_explored(
                    node_ids=arguments["node_ids"],
                    graph_id=arguments.get("graph_id"),
                    summary=arguments.get("summary", ""),
                )
            else:
                result = {"error": f"Unknown tool: {name}"}

            return [TextContent(
                type="text",
                text=json.dumps(result, ensure_ascii=False, indent=2)
            )]

        except FileNotFoundError as e:
            return [TextContent(
                type="text",
                text=json.dumps({"error": str(e)}, ensure_ascii=False)
            )]
        except ValueError as e:
            return [TextContent(
                type="text",
                text=json.dumps({"error": str(e)}, ensure_ascii=False)
            )]
        except Exception as e:
            logger.exception("Tool execution failed")
            return [TextContent(
                type="text",
                text=json.dumps({"error": f"Internal error: {e}"}, ensure_ascii=False)
            )]

    return server


async def main():
    """Main entry point for MCP server."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        stream=sys.stderr,
    )

    server = await create_server()

    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )


if __name__ == "__main__":
    asyncio.run(main())
