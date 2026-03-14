import type { Graph, GraphMetrics, GraphNode, GraphEdge } from "./graph";

// ─── Repo / Graph Metadata ────────────────────────────────────────────────────

export type RepoInfo = {
  repoId: string;
  graphId: string;
  repoName: string;
  language: string[];
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
  gitCommit?: string;
  // 重新分析所需的信息
  repoPath?: string; // 原始路径或 Git URL
  branch?: string; // Git 分支
  sourceMode?: "local" | "git" | "zip"; // 源模式
  status?: "saved" | "analyzing" | "completed" | "failed" | "canceled";
  taskId?: string;
  analysisStep?: number;
  analysisTotal?: number;
  analysisStage?: string;
  analysisMessage?: string;
  analysisElapsedSeconds?: number;
  error?: string;
  lastAnalyzedAt?: string;
};

// ─── GET /graph ───────────────────────────────────────────────────────────────

/** No graph_id → list of repos */
export type GraphListResponse = {
  graphs: RepoInfo[];
};

/** With graph_id → full graph + metadata */
export type GraphDetailResponse = Graph & {
  graphId: string;
  repoName: string;
  metrics: GraphMetrics;
};

// ─── Graph View Responses (all extend Graph) ──────────────────────────────────

/** GET /callgraph — Function/API nodes + calls edges */
export type CallGraphResponse = Graph & { graphId: string };

/** GET /lineage — depends_on / reads / writes / produces / consumes */
export type LineageGraphResponse = Graph & { graphId: string };

/** GET /events — publishes / subscribes / produces / consumes */
export type EventsGraphResponse = Graph & { graphId: string };

/** GET /services — Service / Cluster / Database nodes */
export type ServicesGraphResponse = Graph & { graphId: string };

// ─── POST /analyze/repository ─────────────────────────────────────────────────

export type AnalyzeRepoRequest = {
  repoPath: string;
  repoName?: string;
  branch?: string;
  languages?: string[];
};

export type AnalyzeRepoResponse = {
  graphId: string;
  repoName: string;
  nodeCount: number;
  edgeCount: number;
  duration: number;
  stepStats: Record<string, number>;
};

// ─── Async Analysis (SSE) ─────────────────────────────────────────────────────

export type AnalyzeAsyncResponse = {
  task_id: string;
  status: string;
};

export type AnalysisProgressEvent = {
  status: "pending" | "running" | "completed" | "failed" | "error" | "canceled";
  step?: number;
  total?: number;
  stage?: string;
  message?: string;
  log?: string;
  elapsed_seconds?: number;
  graph_id?: string;
  node_count?: number;
  edge_count?: number;
  error?: string;
};

export type AnalysisStatusResponse = {
  task_id: string;
  status: string;
  step?: number;
  total?: number;
  stage?: string;
  message?: string;
  log?: string;
  elapsed_seconds?: number;
  graph_id?: string;
  node_count?: number;
  edge_count?: number;
  error?: string;
};

export type AnalyzeCancelResponse = {
  task_id: string;
  status: string;
  message: string;
};

// ─── POST /query ──────────────────────────────────────────────────────────────

export type RagQueryRequest = {
  graphId: string;
  question: string;
};

export type RagQueryResponse = {
  question: string;
  answer: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  sources: string[];
  confidence: number;
};

// ─── Error ────────────────────────────────────────────────────────────────────

export type ApiError = {
  detail: string;
  status?: number;
};
