import axios, { type AxiosInstance } from "axios";
import type {
  GraphListResponse,
  GraphDetailResponse,
  ServicesGraphResponse,
  AnalysisStatus,
} from "../types/api";

// ─── HTTP Client ──────────────────────────────────────────────────────────────

const httpClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8000",
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

httpClient.interceptors.request.use(
  (config) => config,
  (err) => Promise.reject(err),
);

httpClient.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const message: string =
      err.response?.data?.detail ?? err.message ?? "Request failed";
    return Promise.reject(new Error(message));
  },
);

export default httpClient;

const GRAPH_LIST_CACHE_WINDOW_MS = 1200;
let graphListInFlight: Promise<GraphListResponse> | null = null;
let graphListCache: { at: number; data: GraphListResponse } | null = null;

// ─── Graph API ────────────────────────────────────────────────────────────────

export const graphApi = {
  /**
   * GET /repos — 替代旧 GET /graph（列表模式）
   */
  async listGraphs(): Promise<GraphListResponse> {
    const now = Date.now();
    if (
      graphListCache &&
      now - graphListCache.at < GRAPH_LIST_CACHE_WINDOW_MS
    ) {
      return graphListCache.data;
    }

    if (graphListInFlight) {
      return graphListInFlight;
    }

    graphListInFlight = (async () => {
      const raw: { repos: Record<string, unknown>[] } =
        await httpClient.get("/repos");
      const data: GraphListResponse = {
        graphs: (raw.repos ?? []).map((g) => ({
          repoId: g.id as string,
          graphId: (g.graph_id ?? g.id) as string,
          repoName: g.name as string,
          language: (g.language ?? []) as string[],
          createdAt: g.created_at as string,
          updatedAt: (g.updated_at ?? g.created_at) as string,
          nodeCount: (g.node_count ?? 0) as number,
          edgeCount: (g.edge_count ?? 0) as number,
          sourceMode: (g.source_mode ?? "local") as "local" | "git" | "zip",
          repoPath: g.path as string | undefined,
          status: (g.status ?? "completed") as AnalysisStatus,
          taskId: g.task_id as string | undefined,
          analysisStage: g.stage as string | undefined,
          analysisStep: g.step as number | undefined,
          analysisTotal: g.total as number | undefined,
          analysisMessage: g.message as string | undefined,
          error: g.error as string | undefined,
        })),
      };
      graphListCache = { at: Date.now(), data };
      return data;
    })();

    try {
      return await graphListInFlight;
    } finally {
      graphListInFlight = null;
    }
  },

  /**
   * GET /graph/framework?node_types=all — 替代旧 GET /graph?graph_id=
   */
  getGraph(repoId: string): Promise<GraphDetailResponse> {
    return httpClient.get("/graph/framework", {
      params: { repo_id: repoId, node_types: "all" },
    });
  },

  /**
   * GET /graph/framework — 架构图视图
   */
  getFramework(
    repoId: string,
    nodeTypes?: string,
  ): Promise<{
    repo_id: string;
    node_count: number;
    edge_count: number;
    nodes: RawNode[];
    edges: RawEdge[];
  }> {
    return httpClient.get("/graph/framework", {
      params: {
        repo_id: repoId,
        ...(nodeTypes ? { node_types: nodeTypes } : {}),
      },
    });
  },

  /**
   * GET /graph/lineage — 血缘视图
   */
  getLineageView(
    repoId: string,
    opts?: {
      edgeTypes?: string;
      nodeId?: string;
      depth?: number;
      direction?: string;
      moduleId?: string;
      includeCalls?: boolean;
    },
  ): Promise<{
    repo_id: string;
    module_id?: string;
    edge_types: string[];
    direction?: string;
    node_count: number;
    edge_count: number;
    nodes: RawNode[];
    edges: RawEdge[];
  }> {
    return httpClient.get("/graph/lineage", {
      params: {
        repo_id: repoId,
        ...(opts
          ? {
              ...(opts.edgeTypes ? { edge_types: opts.edgeTypes } : {}),
              ...(opts.nodeId
                ? { node_id: opts.nodeId, depth: opts.depth, direction: opts.direction }
                : {}),
              ...(opts.moduleId ? { module_id: opts.moduleId } : {}),
              ...(opts.includeCalls !== undefined ? { include_calls: opts.includeCalls } : {}),
            }
          : {}),
      },
    });
  },

  /**
   * GET /graph/lineage/modules — 模块级血缘视图
   */
  getLineageModules(repoId: string): Promise<{
    repo_id: string;
    module_count: number;
    edge_count: number;
    modules: Array<{
      id: string;
      name: string;
      service_count: number;
      controller_count: number;
      repository_count: number;
      services: Array<{ id: string; name: string }>;
      controllers: Array<{ id: string; name: string }>;
      repositories: Array<{ id: string; name: string }>;
      databases: Array<{ id: string; name: string }>;
      cross_module_calls: number;
    }>;
    edges: Array<{
      from: string;
      to: string;
      type: string;
      service_pairs?: Array<[string, string]>;
      call_count?: number;
    }>;
  }> {
    return httpClient.get("/graph/lineage/modules", {
      params: { repo_id: repoId },
    });
  },

  /**
   * POST /lineage/impact — 变更影响评估
   */
  analyzeImpact(data: import("../types/api").ImpactAnalysisRequest): Promise<import("../types/api").ImpactAnalysisResponse> {
    return httpClient.post("/lineage/impact", data);
  },

  /**
   * POST /lineage/trace — 根因追溯
   */
  traceLineage(data: import("../types/api").TraceLineageRequest): Promise<import("../types/api").TraceLineageResponse> {
    return httpClient.post("/lineage/trace", data);
  },

  /**
   * GET /services
   * Returns Service / Cluster / Database nodes.
   */
  getServicesGraph(graphId: string): Promise<ServicesGraphResponse> {
    return httpClient.get("/services", { params: { graph_id: graphId } });
  },

  /**
   * GET /graph/function-call — 函数调用图数据
   */
  getFunctionCallGraph(repoId: string): Promise<import("../pages/FunctionCallGraph/types").FunctionCallGraphResponse> {
    return httpClient.get("/graph/function-call", {
      params: { repo_id: repoId },
    });
  },
};

// ─── Raw node/edge types from new pipeline ────────────────────────────────────

export type RawNode = {
  id: string;
  type: string; // lowercase: function, class, module, file, api, database, table, repository
  name?: string;
  properties?: Record<string, unknown>; // Backend provides rich properties
  metrics?: {
    in_degree?: number;
    out_degree?: number;
    pagerank?: number;
  };
};

export type RawEdge = {
  from: string;
  to: string;
  type: string; // contains, calls, imports, reads, writes
  properties?: Record<string, unknown>;
};

/** Normalize raw node to GraphNode (label = name or id-derived) */
export function rawNodeToGraphNode(
  n: RawNode,
): import("../types/graph").GraphNode {
  const label = n.name || n.id.split(":").pop()?.split(".").pop() || n.id;

  return {
    id: n.id,
    type: n.type,
    label,
    properties: n.properties ?? {},
  };
}

/** Normalize raw edge to GraphEdge (from/to → source/target) */
export function rawEdgeToGraphEdge(
  e: RawEdge,
): import("../types/graph").GraphEdge {
  return { source: e.from, target: e.to, type: e.type, properties: e.properties ?? {} };
}
