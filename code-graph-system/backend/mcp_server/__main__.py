"""MCP Server entry point: python -m backend.mcp_server"""

import asyncio
from backend.mcp_server.server import main

if __name__ == "__main__":
    asyncio.run(main())
