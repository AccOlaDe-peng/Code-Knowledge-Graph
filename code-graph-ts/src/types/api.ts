import type { GraphNode, GraphEdge } from './graph.js'

// --- 仓库 API ---

export interface CreateRepoRequest {
  repo_name: string
  repo_path: string
  source_mode?: string
  branch?: string
  language?: string[]
}

export interface SaveRepoRequest {
  repo_id: string
  repo_name: string
  repo_path: string
  branch?: string
  source_mode?: string
  language?: string[]
}

export interface UpdateRepoRequest {
  repo_name?: string
  branch?: string
  language?: string[]
}

export interface RepoListResponse {
  repos: RepoWireFormat[]
}

export interface RepoWireFormat {
  id: string
  name: string
  path?: string
  branch?: string
  languages?: string[]
  language?: string[]
  created_at: string
  updated_at: string
  graph_id?: string
  node_count: number
  edge_count: number
  source_mode: string
  status: string
  task_id?: string
  stage?: string
  step?: number
  total?: number
  message?: string
  error?: string
  git_commit?: string
  latest_analysis?: {
    id: string
    graph_id?: string
    node_count?: number
    edge_count?: number
    status?: string
    stage?: string
    step?: number
    total?: number
    message?: string
    error?: string
    git_commit?: string
    finished_at?: string
  }
}

export interface SaveRepoResponse {
  repo_id: string
  status: string
}

// --- 分析 API ---

export interface AnalyzeRequest {
  repo_path: string
  repo_name?: string
  repo_id?: string
  branch?: string
  languages?: string[]
}

export interface AnalyzeResponse {
  task_id: string
  status: string
}

export interface AnalysisStatusResponse {
  task_id: string
  status: string
  step?: number
  total?: number
  stage?: string
  message?: string
  log?: string
  elapsed_seconds?: number
  graph_id?: string
  node_count?: number
  edge_count?: number
  error?: string
}

export interface CancelAnalysisResponse {
  task_id: string
  status: string
  message: string
}

export interface AnalysisProgressEvent {
  status: string
  step?: number
  total?: number
  stage?: string
  message?: string
  log?: string
  elapsed_seconds?: number
  graph_id?: string
  node_count?: number
  edge_count?: number
  error?: string
}

// --- 图数据 API (wire format: nodes 用 name, edges 用 from/to) ---

export interface RawNode {
  id: string
  type: string
  name?: string
  properties?: Record<string, unknown>
  metrics?: { in_degree?: number; out_degree?: number; pagerank?: number }
}

export interface RawEdge {
  from: string
  to: string
  type: string
  properties?: Record<string, unknown>
}

export interface GraphFrameworkResponse {
  repo_id: string
  node_count: number
  edge_count: number
  nodes: RawNode[]
  edges: RawEdge[]
}

export interface LineageResponse {
  repo_id: string
  module_id?: string
  edge_types: string[]
  direction?: string
  node_count: number
  edge_count: number
  nodes: RawNode[]
  edges: RawEdge[]
}

export interface LineageModulesResponse {
  repo_id: string
  module_count: number
  edge_count: number
  modules: Array<{
    id: string
    name: string
    service_count: number
    controller_count: number
    repository_count: number
    services: Array<{ id: string; name: string }>
    controllers: Array<{ id: string; name: string }>
    repositories: Array<{ id: string; name: string }>
    databases: Array<{ id: string; name: string }>
    cross_module_calls: number
  }>
  edges: Array<{
    from: string
    to: string
    type: string
    service_pairs?: string[][]
    call_count?: number
  }>
}

// --- 预规范化响应 (edges 用 source/target) ---

export interface ServicesGraphResponse {
  graphId: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// --- 血缘影响分析 ---

export interface ImpactRequest {
  repo_id: string
  node_id: string
  change_type: 'modify' | 'delete' | 'rename'
}

export interface TraceRequest {
  repo_id: string
  node_id: string
  trace_type: 'source' | 'transformation' | 'full'
}

// --- 元数据 ---

export interface NodeTypesResponse {
  version: string
  architecture_types: string[]
  structural_edge_types: string[]
  call_edge_types: string[]
}

export interface PipelineStagesResponse {
  stages: Array<{ key: string; label: string; description: string }>
  total: number
}

// --- 错误 ---

export interface ErrorResponse {
  error: string
  message: string
  status: number
}
