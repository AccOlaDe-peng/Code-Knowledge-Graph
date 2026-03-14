import { apiClient } from "../client";
import type {
  GraphListResponse,
  GraphDetailResponse,
  CallGraphResponse,
  LineageGraphResponse,
  EventsGraphResponse,
  ServicesGraphResponse,
  AnalyzeAsyncResponse,
  AnalysisStatusResponse,
  AnalyzeCancelResponse,
} from "../../../types/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// ─── Graph API Endpoints ──────────────────────────────────────────────────────

export const graphEndpoints = {
  /**
   * GET /graph
   * List all analyzed graphs
   */
  async listGraphs(): Promise<GraphListResponse> {
    const raw: { graphs: Record<string, unknown>[] } =
      await apiClient.get("/graph");
    return {
      graphs: (raw.graphs ?? []).map((g) => ({
        repoId: g.graph_id as string,
        graphId: g.graph_id as string,
        repoName: g.repo_name as string,
        language: (g.languages ?? g.language ?? []) as string[],
        createdAt: g.created_at as string,
        nodeCount: g.node_count as number,
        edgeCount: g.edge_count as number,
        gitCommit: g.git_commit as string | undefined,
        status: "completed",
      })),
    };
  },

  /**
   * GET /graph?graph_id={id}
   * Get full graph details
   */
  async getGraph(graphId: string): Promise<GraphDetailResponse> {
    return apiClient.get("/graph", { params: { graph_id: graphId } });
  },

  /**
   * GET /callgraph?graph_id={id}
   * Get call graph (Function/API nodes + calls edges)
   */
  async getCallGraph(graphId: string): Promise<CallGraphResponse> {
    return apiClient.get("/callgraph", { params: { graph_id: graphId } });
  },

  /**
   * GET /lineage?graph_id={id}
   * Get data lineage graph
   */
  async getLineageGraph(graphId: string): Promise<LineageGraphResponse> {
    return apiClient.get("/lineage", { params: { graph_id: graphId } });
  },

  /**
   * GET /events?graph_id={id}
   * Get event flow graph
   */
  async getEventsGraph(graphId: string): Promise<EventsGraphResponse> {
    return apiClient.get("/events", { params: { graph_id: graphId } });
  },

  /**
   * GET /services?graph_id={id}
   * Get services graph
   */
  async getServicesGraph(graphId: string): Promise<ServicesGraphResponse> {
    return apiClient.get("/services", { params: { graph_id: graphId } });
  },

  /**
   * POST /analyze/repository
   * Trigger async repository analysis
   */
  async analyzeRepository(data: {
    repo_path: string;
    repo_name?: string;
    languages?: string[];
  }): Promise<AnalyzeAsyncResponse> {
    return apiClient.post("/analyze/repository", data);
  },

  /**
   * GET /analyze/status/{task_id}
   * Get current analysis task status
   */
  async getAnalysisStatus(taskId: string): Promise<AnalysisStatusResponse> {
    return apiClient.get(`/analyze/status/${taskId}`);
  },

  /**
   * POST /analyze/cancel/{task_id}
   * Cancel analysis task
   */
  async cancelAnalysis(taskId: string): Promise<AnalyzeCancelResponse> {
    return apiClient.post(`/analyze/cancel/${taskId}`);
  },

  /**
   * GET /analyze/stream/{task_id}
   * Stream analysis progress via SSE
   */
  streamAnalysisProgress(taskId: string): EventSource {
    return new EventSource(`${API_BASE_URL}/analyze/stream/${taskId}`);
  },
};

export default graphEndpoints;
