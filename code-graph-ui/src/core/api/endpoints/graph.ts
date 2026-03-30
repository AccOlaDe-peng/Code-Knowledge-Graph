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
  PipelineMode,
} from "../../../types/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// ─── Graph API Endpoints ──────────────────────────────────────────────────────

export const graphEndpoints = {
  /**
   * GET /repos
   * List all repositories (which contain graph data)
   */
  async listGraphs(): Promise<GraphListResponse> {
    const raw: { repos: Record<string, unknown>[] } =
      await apiClient.get("/repos");
    return {
      graphs: (raw.repos ?? []).map((g) => ({
        repoId: g.repo_id as string,
        graphId: g.repo_id as string,
        repoName: g.repo_name as string,
        language: (g.languages ?? g.language ?? []) as string[],
        createdAt: g.created_at as string,
        updatedAt: (g.updated_at ?? g.created_at) as string,
        nodeCount: g.node_count as number,
        edgeCount: g.edge_count as number,
        gitCommit: g.git_commit as string | undefined,
        sourceMode: (g.source_mode ?? "local") as "local" | "git" | "zip",
        repoPath: g.repo_path as string | undefined,
        status:
          (g.status as string | undefined as
            | "saved"
            | "analyzing"
            | "completed"
            | "failed"
            | "canceled"
            | undefined) ?? "completed",
        taskId: g.task_id as string | undefined,
        analysisStage: g.stage as string | undefined,
        analysisStep: g.step as number | undefined,
        analysisTotal: g.total as number | undefined,
        analysisMessage: g.message as string | undefined,
        error: g.error as string | undefined,
        branch: g.branch as string | undefined,
        lastAnalyzedAt: g.updated_at as string | undefined,
      })),
    };
  },

  /**
   * GET /graph/framework?repo_id={id}&node_types=all
   * Get full graph details
   */
  async getGraph(repoId: string): Promise<GraphDetailResponse> {
    return apiClient.get("/graph/framework", { params: { repo_id: repoId, node_types: 'all' } });
  },

  /**
   * GET /graph/call?repo_id={id}
   * Get call graph (Function/API nodes + calls edges)
   */
  async getCallGraph(repoId: string): Promise<CallGraphResponse> {
    return apiClient.get("/graph/call", { params: { repo_id: repoId } });
  },

  /**
   * GET /graph/lineage?repo_id={id}
   * Get data lineage graph
   */
  async getLineageGraph(repoId: string): Promise<LineageGraphResponse> {
    return apiClient.get("/graph/lineage", { params: { repo_id: repoId } });
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
   * POST /repos/save
   * Persist repo config without triggering analysis
   */
  async saveRepo(data: {
    repo_id: string;
    repo_name: string;
    repo_path: string;
    branch?: string;
    source_mode?: string;
    language?: string[];
  }): Promise<{ repo_id: string; status: string }> {
    return apiClient.post("/repos/save", data);
  },

  /**
   * POST /analyze/repository
   * Trigger async repository analysis
   */
  async analyzeRepository(data: {
    repo_path: string;
    repo_name?: string;
    repo_id?: string;
    branch?: string;
    languages?: string[];
    depth?: "quick" | "standard" | "deep";
    pipeline_mode?: PipelineMode;
  }): Promise<AnalyzeAsyncResponse> {
    return apiClient.post("/analyze/repository", {
      ...data,
      pipeline_mode: data.pipeline_mode ?? "static_first",
    });
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

// ─── Repo API (/repos/*) ──────────────────────────────────────────────────────

export type CreateRepoPayload = {
  repo_id?: string;
  repo_name: string;
  repo_path: string;
  source_mode?: "local" | "git" | "zip";
  branch?: string;
  language?: string[];
};

export const repoEndpoints = {
  /**
   * GET /repos
   * List all repositories
   */
  async listRepos(): Promise<{ repos: Record<string, unknown>[] }> {
    return apiClient.get("/repos");
  },

  /**
   * POST /repos
   * Create a new repository
   */
  async createRepo(payload: CreateRepoPayload): Promise<Record<string, unknown>> {
    return apiClient.post("/repos", payload);
  },

  /**
   * PUT /repos/:id
   * Update repository metadata
   */
  async updateRepo(
    repoId: string,
    patch: { repo_name?: string; branch?: string; language?: string[] },
  ): Promise<Record<string, unknown>> {
    return apiClient.put(`/repos/${repoId}`, patch);
  },

  /**
   * DELETE /repos/:id
   * Delete repository and associated data
   */
  async deleteRepo(repoId: string): Promise<void> {
    return apiClient.delete(`/repos/${repoId}`);
  },

  /**
   * GET /repos/:id/analyses
   * List analysis history for a repository
   */
  async listAnalyses(
    repoId: string,
    taskId?: string,
  ): Promise<{ analyses: Record<string, unknown>[] }> {
    const params = taskId ? `?task_id=${taskId}` : "";
    return apiClient.get(`/repos/${repoId}/analyses${params}`);
  },

  /**
   * GET /api/pipeline/stages
   * Get pipeline stage definitions
   */
  async getPipelineStages(): Promise<{ stages: { key: string; label: string; description: string }[]; total: number }> {
    return apiClient.get("/api/pipeline/stages");
  },

  /**
   * GET /graph/architecture/{repo_id}
   * Get layered architecture data
   */
  async getArchitecture(repoId: string): Promise<Record<string, unknown>> {
    return apiClient.get(`/graph/architecture/${repoId}`);
  },
};
