# MCP Server Configuration for Claude Code

## Quick Setup

1. Install dependencies:
```bash
cd code-graph-system
source .venv/bin/activate
pip install -r requirements.txt
```

2. Add to Claude Code MCP settings (`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "code-knowledge-graph": {
      "command": "python",
      "args": ["-m", "backend.mcp_server.server"],
      "cwd": "/absolute/path/to/code-graph-system"
    }
  }
}
```

If using a virtual environment, use the venv python:

```json
{
  "mcpServers": {
    "code-knowledge-graph": {
      "command": "/absolute/path/to/code-graph-system/.venv/bin/python",
      "args": ["-m", "backend.mcp_server.server"],
      "cwd": "/absolute/path/to/code-graph-system"
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KG_STORAGE_DIR` | `./data/graphs` | Graph storage directory |
| `KG_DEFAULT_GRAPH_ID` | (latest graph) | Default graph ID for tools |

## Available Tools

### query_graph
Semantic search over graph nodes using natural language.
```json
{"query": "user authentication", "node_type": "Function", "limit": 20}
```

### add_node
Add a node to the knowledge graph.
```json
{"type": "Function", "name": "login", "properties": {"file_path": "auth.py"}}
```

### add_edge
Add a relationship between two nodes.
```json
{"source_id": "func_login", "target_id": "func_authenticate", "type": "calls"}
```

### get_context
Get the neighborhood around a node (BFS expansion).
```json
{"node_id": "func_login", "depth": 1, "edge_types": ["calls"]}
```

### mark_explored
Mark nodes as explored to avoid redundant analysis.
```json
{"node_ids": ["func_login"], "summary": "Login function analyzed"}
```

## Testing

Run the server directly:
```bash
python -m backend.mcp_server.server
```

Test tools:
```bash
python -c "
import asyncio
from backend.mcp_server.server import GraphTools

async def test():
    tools = GraphTools(storage_dir='./data/graphs')
    result = await tools.get_context(node_id='func_login', graph_id='test_graph')
    print(result)

asyncio.run(test())
"
```
