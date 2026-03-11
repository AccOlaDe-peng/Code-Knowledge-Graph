import type { GraphData, GraphMetrics } from './graph';

// 仓库信息
export interface RepoInfo {
  graphId: string;
  repoName: string;
  language: string[];
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
  gitCommit?: string;
}

// 图谱列表响应
export interface GraphListResponse {
  graphs: RepoInfo[];
}

// 图谱详情响应
export interface GraphDetailResponse extends GraphData {
  graphId: string;
  repoName: string;
  metrics: GraphMetrics;
}

// 分析仓库请求
export interface AnalyzeRepoRequest {
  repoPath: string;
  repoName?: string;
  languages?: string[];
  enableAi?: boolean;
  enableRag?: boolean;
}

// 分析仓库响应
export interface AnalyzeRepoResponse {
  graphId: string;
  repoName: string;
  nodeCount: number;
  edgeCount: number;
  duration: number;
  stepStats: Record<string, number>;
}

// RAG 查询请求
export interface RagQueryRequest {
  graphId: string;
  question: string;
}

// RAG 查询响应
export interface RagQueryResponse {
  question: string;
  answer: string;
  nodes: import('./graph').GraphNode[];
  edges: import('./graph').GraphEdge[];
  sources: string[];
  confidence: number;
}

// 调用图响应
export interface CallGraphResponse extends GraphData {
  graphId: string;
}

// 血缘图响应
export interface LineageGraphResponse extends GraphData {
  graphId: string;
}

// 服务图响应
export interface ServicesGraphResponse extends GraphData {
  graphId: string;
}

// API 通用错误
export interface ApiError {
  detail: string;
  status?: number;
}
