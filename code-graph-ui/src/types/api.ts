import type { Graph, GraphMetrics, GraphNode, GraphEdge } from "./graph";

// ─── Repo / Graph Metadata ────────────────────────────────────────────────────

/** 分析深度预设 */
export type AnalysisDepth = "quick" | "standard" | "deep";

/** 分析状态 */
export type AnalysisStatus =
  | "saved"
  | "pending"
  | "analyzing"
  | "completed"
  | "completed_partial"
  | "failed"
  | "canceled";

/** 仓库配置（对应后端 Repo 表）*/
export type Repo = {
  repoId: string;
  repoName: string;
  repoPath?: string;
  branch?: string;
  sourceMode?: "local" | "git" | "zip";
  language: string[];
  createdAt: string;
  updatedAt?: string;
};

/** 分析摘要（最近一次分析 + 实时状态）*/
export type LatestAnalysis = {
  taskId?: string;
  status: AnalysisStatus;
  graphId?: string;
  nodeCount: number;
  edgeCount: number;
  depth?: AnalysisDepth;
  analysisStage?: string;
  analysisStep?: number;
  analysisTotal?: number;
  analysisMessage?: string;
  lastAnalyzedAt?: string;
  error?: string;
};

/** 页面展示用（保留 RepoInfo 名称减少改动范围）*/
export type RepoInfo = Repo & {
  graphId: string; // 保留兼容旧代码
  nodeCount: number; // 保留兼容旧代码
  edgeCount: number; // 保留兼容旧代码
  status?: AnalysisStatus;
  taskId?: string;
  analysisStep?: number;
  analysisTotal?: number;
  analysisStage?: string;
  analysisMessage?: string;
  analysisElapsedSeconds?: number;
  error?: string;
  lastAnalyzedAt?: string;
  depth?: AnalysisDepth;
  gitCommit?: string;
  latestAnalysis?: LatestAnalysis;
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
  depth?: AnalysisDepth; // 分析深度：quick | standard | deep
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
  status: "pending" | "running" | "completed" | "completed_partial" | "failed" | "error" | "canceled";
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

// ─── Lineage Impact & Trace APIs ─────────────────────────────────────────────

export type ImpactAnalysisRequest = {
  repo_id: string;
  node_id: string;
  change_type: "modify" | "delete" | "rename";
};

export type ImpactAnalysisResponse = {
  repo_id: string;
  changed_node_id: string;
  change_type: string;
  risk_level: "low" | "medium" | "high";
  impact_summary: {
    total_affected: number;
    services: number;
    api_endpoints: number;
    databases: number;
    topics: number;
    change_type: string;
  };
  affected_nodes: GraphNode[];
  affected_edges: GraphEdge[];
  affected_apis: Array<{ id: string; name: string; path: string }>;
  affected_databases: Array<{ id: string; name: string }>;
  recommendations: string[];
};

export type TraceLineageRequest = {
  repo_id: string;
  node_id: string;
  trace_type: "source" | "transformation" | "full";
};

export type TraceLineageResponse = {
  repo_id: string;
  target_node_id: string;
  trace_type: string;
  source_nodes?: Array<{ id: string; name: string; type: string }>;
  transformation_chain?: Array<{
    id: string;
    name: string;
    type: string;
    depth: number;
  }>;
  upstream_nodes?: GraphNode[];
  upstream_edges?: GraphEdge[];
  confidence: number;
};
