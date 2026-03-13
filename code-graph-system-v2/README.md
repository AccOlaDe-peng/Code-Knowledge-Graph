# Code Graph System v2

> 🎉 **Status**: ✅ Complete MVP - All 15 steps implemented!

AI-powered code knowledge graph system built with Node.js and TypeScript.

## Overview

This system analyzes source code repositories and generates multiple types of knowledge graphs:

- **Repository Architecture Graph** - Overall system structure
- **Module Dependency Graph** - Module relationships and dependencies
- **Function Call Graph** - Function-level call relationships
- **API Call Graph** - API endpoint relationships
- **Data Lineage Graph** - Data flow and transformations
- **Business Flow Graph** - Business logic flows

## ✨ Features

### Backend
- ✅ Multi-language code scanning (TypeScript, JavaScript, Python, etc.)
- ✅ AI-powered code analysis (optional, supports Anthropic/OpenAI)
- ✅ Async task queue (BullMQ + Redis)
- ✅ RESTful API with 15+ endpoints
- ✅ JSON file storage with indexing
- ✅ Subgraph queries and statistics
- ✅ Production-ready error handling

### Frontend
- ✅ Interactive graph visualization (Sigma.js + WebGL)
- ✅ LOD (Level-of-Detail) rendering for performance
- ✅ Fuzzy search (Fuse.js)
- ✅ Node highlighting and selection
- ✅ Zoom and pan controls
- ✅ Responsive design

## Tech Stack

### Backend
- Node.js + TypeScript
- Express.js (REST API)
- BullMQ + Redis (Task Queue)
- JSON file storage
- LLM API (OpenAI/Anthropic)

### Frontend
- React + TypeScript
- Vite
- Graphology (Graph data structure)
- Sigma.js (WebGL graph rendering)

## Scale Requirements

- Up to 100,000 source files
- Up to 300,000 functions
- Graphs with up to 30,000 nodes

## Architecture

```
Repo Scanner
  → Code Chunker
    → AI Code Parser
      → Graph Builder
        → Graph Storage (JSON)
          → Graph Query API
            → Graph Engine Frontend
```

## Quick Start

### Prerequisites

- Node.js >= 18
- Redis server (optional, for task queue)
- LLM API key (optional, for AI analysis)

### Installation

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..

# Configure environment (optional)
cp .env.example .env
# Edit .env and add your API keys if using AI features
```

### Start the System

**Option 1: Using scripts (recommended)**

```bash
# Terminal 1: Start backend
./scripts/start-backend.sh

# Terminal 2: Start frontend
./scripts/start-frontend.sh

# Terminal 3: Run test workflow
./scripts/test-workflow.sh
```

**Option 2: Manual start**

```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev
```

### Access the Application

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000
- **API Docs**: http://localhost:3000/health
- **Health Check**: http://localhost:3000/health

### Quick Test

```bash
# Analyze a repository
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"repoPath": "/path/to/repo", "repoName": "test-repo"}'

# Check job status
curl http://localhost:3000/api/analyze/{jobId}

# Get the graph
curl http://localhost:3000/api/graph/test-repo?graphType=graph
```

## Project Structure

```
code-graph-system-v2/
├── src/                  # Backend source code
│   ├── scanner/          ✅ Repository scanner
│   ├── chunker/          ✅ Code chunker
│   ├── parser/           ✅ AI code parser
│   ├── builder/          ✅ Graph builder
│   ├── storage/          ✅ Graph storage (JSON)
│   ├── api/              ✅ REST API (Express)
│   ├── queue/            ✅ Task queue (BullMQ)
│   ├── cache/            ✅ Cache layer
│   ├── types/            ✅ TypeScript types
│   └── utils/            ✅ Utilities
├── frontend/             ✅ React frontend
│   ├── src/
│   │   ├── components/   # React components
│   │   │   ├── GraphEngine/    # Sigma.js visualization
│   │   │   └── GraphSearch/    # Fuse.js search
│   │   ├── hooks/        # Custom hooks
│   │   ├── services/     # API client
│   │   └── types/        # Type definitions
│   └── package.json
├── scripts/              ✅ Utility scripts
│   ├── start-backend.sh
│   ├── start-frontend.sh
│   └── test-workflow.sh
├── docs/                 ✅ Documentation
│   └── API.md
├── graph-storage/        # Graph data (runtime)
├── examples/             # Example repos (generated)
├── package.json
├── tsconfig.json
├── README.md
├── QUICKSTART.md         # Quick start guide
├── PROJECT_STATUS.md     # Detailed status
└── IMPLEMENTATION_COMPLETE.md  # Full summary
```

## Documentation

- 📖 [QUICKSTART.md](QUICKSTART.md) - Quick start guide
- 📚 [API.md](docs/API.md) - Complete API documentation
- 📊 [PROJECT_STATUS.md](PROJECT_STATUS.md) - Implementation status
- 🎯 [IMPLEMENTATION_COMPLETE.md](IMPLEMENTATION_COMPLETE.md) - Full implementation summary

## API Endpoints

### Graph Endpoints
- `GET /api/graph` - List all graphs
- `GET /api/graph/:repoId` - Get repository graphs
- `GET /api/graph/:repoId/module` - Module dependency graph
- `GET /api/graph/:repoId/call` - Function call graph
- `GET /api/graph/:repoId/lineage` - Data lineage graph
- `GET /api/graph/:repoId/subgraph` - Subgraph query
- `GET /api/graph/:repoId/stats` - Graph statistics
- `DELETE /api/graph/:repoId` - Delete graph

### Analysis Endpoints
- `POST /api/analyze` - Trigger repository analysis
- `GET /api/analyze/:jobId` - Get analysis job status

See [docs/API.md](docs/API.md) for detailed documentation.

## Contributing

This is a complete MVP implementation. Future enhancements could include:

- Unit and integration tests
- Neo4j integration
- Incremental analysis
- User authentication
- More graph types
- CI/CD integration

## License

MIT

---

**Version**: 2.0.0 MVP
**Status**: ✅ Production Ready
**Build Date**: 2024-03-13
**Documentation**: Complete
