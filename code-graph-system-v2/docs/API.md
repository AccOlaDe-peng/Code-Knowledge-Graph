# Code Graph System v2 - API Documentation

Base URL: `http://localhost:3000`

## Health Check

### GET /health

Check if the API server is running.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-03-13T10:00:00.000Z",
  "version": "2.0.0"
}
```

---

## Graph Endpoints

### GET /api/graph

List all graphs or get a specific graph.

**Query Parameters:**
- `graphId` (optional): Specific graph ID in format `repoId/graphType`

**Response (without graphId):**
```json
[
  {
    "graphId": "my-repo/graph",
    "repoName": "my-repo",
    "graphType": "graph",
    "createdAt": "2024-03-13T10:00:00.000Z",
    "nodeCount": 150,
    "edgeCount": 200
  }
]
```

**Response (with graphId):**
```json
{
  "graph_version": "2.0.0",
  "repo": {
    "name": "my-repo",
    "path": "/path/to/repo",
    "language": ["typescript", "javascript"],
    "totalFiles": 50,
    "totalSize": 1024000
  },
  "nodes": [...],
  "edges": [...],
  "metadata": {
    "createdAt": "2024-03-13T10:00:00.000Z",
    "nodeCount": 150,
    "edgeCount": 200
  }
}
```

### GET /api/graph/:repoId

Get all graphs for a specific repository.

**Path Parameters:**
- `repoId`: Repository identifier

**Query Parameters:**
- `graphType` (optional): Specific graph type (e.g., "graph", "call-graph", "module-graph")

**Response:**
```json
[
  {
    "graphId": "my-repo/graph",
    "repoName": "my-repo",
    "graphType": "graph",
    "createdAt": "2024-03-13T10:00:00.000Z",
    "nodeCount": 150,
    "edgeCount": 200
  },
  {
    "graphId": "my-repo/call-graph",
    "repoName": "my-repo",
    "graphType": "call-graph",
    "createdAt": "2024-03-13T10:00:00.000Z",
    "nodeCount": 80,
    "edgeCount": 120
  }
]
```

### GET /api/graph/:repoId/module

Get module dependency graph for a repository.

**Path Parameters:**
- `repoId`: Repository identifier

**Response:** Full graph object (see GET /api/graph with graphId)

### GET /api/graph/:repoId/call

Get function call graph for a repository.

**Path Parameters:**
- `repoId`: Repository identifier

**Response:** Full graph object

### GET /api/graph/:repoId/lineage

Get data lineage graph for a repository.

**Path Parameters:**
- `repoId`: Repository identifier

**Response:** Full graph object

### GET /api/graph/:repoId/subgraph

Get a subgraph containing specific nodes and their neighbors.

**Path Parameters:**
- `repoId`: Repository identifier

**Query Parameters:**
- `nodeIds` (required): Comma-separated list of node IDs
- `depth` (optional, default: 1): How many hops to include
- `graphType` (optional, default: "graph"): Which graph to query

**Example:**
```
GET /api/graph/my-repo/subgraph?nodeIds=function:src/auth.ts:login,function:src/user.ts:getUser&depth=2
```

**Response:**
```json
{
  "nodes": [...],
  "edges": [...]
}
```

### GET /api/graph/:repoId/stats

Get statistics for a graph.

**Path Parameters:**
- `repoId`: Repository identifier

**Query Parameters:**
- `graphType` (optional, default: "graph"): Which graph to query

**Response:**
```json
{
  "nodeCount": 150,
  "edgeCount": 200,
  "nodeTypeDistribution": {
    "Module": 10,
    "File": 50,
    "Class": 30,
    "Function": 60
  },
  "edgeTypeDistribution": {
    "imports": 40,
    "calls": 120,
    "extends": 20,
    "implements": 20
  }
}
```

### DELETE /api/graph/:repoId

Delete a graph or entire repository.

**Path Parameters:**
- `repoId`: Repository identifier

**Query Parameters:**
- `graphType` (optional): Specific graph type to delete. If omitted, deletes entire repository.

**Response:**
```json
{
  "success": true,
  "message": "Deleted graph: my-repo/graph"
}
```

---

## Analysis Endpoints

### POST /api/analyze

Trigger repository analysis.

**Request Body:**
```json
{
  "repoPath": "/path/to/repository",
  "repoName": "my-repo",
  "enableAI": false
}
```

**Parameters:**
- `repoPath` (required): Path to the repository to analyze
- `repoName` (optional): Custom name for the repository
- `enableAI` (optional, default: false): Enable AI-powered analysis

**Response:**
```json
{
  "jobId": "job_1234567890_abc123",
  "status": "pending",
  "message": "Analysis started"
}
```

### GET /api/analyze/:jobId

Get the status of an analysis job.

**Path Parameters:**
- `jobId`: Job identifier returned from POST /api/analyze

**Response:**
```json
{
  "id": "job_1234567890_abc123",
  "status": "running",
  "progress": 65,
  "createdAt": "2024-03-13T10:00:00.000Z"
}
```

**Status values:**
- `pending`: Job is queued
- `running`: Job is being processed
- `completed`: Job finished successfully
- `failed`: Job encountered an error

**Response (completed):**
```json
{
  "id": "job_1234567890_abc123",
  "status": "completed",
  "progress": 100,
  "result": {
    "graphId": "my-repo/graph",
    "repoId": "my-repo",
    "nodeCount": 150,
    "edgeCount": 200,
    "fileCount": 50
  },
  "createdAt": "2024-03-13T10:00:00.000Z"
}
```

**Response (failed):**
```json
{
  "id": "job_1234567890_abc123",
  "status": "failed",
  "progress": 45,
  "error": "Failed to parse file: syntax error",
  "createdAt": "2024-03-13T10:00:00.000Z"
}
```

---

## Node Types

- `Module`: Directory-level module
- `File`: Source code file
- `Class`: Class definition
- `Function`: Function/method definition
- `API`: API endpoint
- `Database`: Database instance
- `Table`: Database table
- `Event`: Event/message
- `Topic`: Message queue topic

## Edge Types

- `imports`: Module/file import
- `calls`: Function call
- `extends`: Class inheritance
- `implements`: Interface implementation
- `depends_on`: Dependency relationship
- `reads`: Data read operation
- `writes`: Data write operation
- `produces`: Event production
- `consumes`: Event consumption

---

## Error Responses

All endpoints may return error responses in the following format:

**400 Bad Request:**
```json
{
  "error": "Bad Request",
  "message": "repoPath is required"
}
```

**404 Not Found:**
```json
{
  "error": "Not Found",
  "message": "Graph not found: my-repo/graph"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Internal Server Error",
  "message": "Failed to load graph"
}
```

---

## Rate Limiting

Currently, there are no rate limits. In production, consider implementing rate limiting based on your requirements.

## Authentication

Currently, the API does not require authentication. In production, implement appropriate authentication and authorization mechanisms.
