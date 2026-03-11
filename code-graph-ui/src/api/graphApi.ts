import axios, { type AxiosInstance } from 'axios'
import type {
  GraphListResponse,
  GraphDetailResponse,
  CallGraphResponse,
  LineageGraphResponse,
  EventsGraphResponse,
  ServicesGraphResponse,
} from '../types/api'

// ─── HTTP Client ──────────────────────────────────────────────────────────────

const httpClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

httpClient.interceptors.request.use(
  (config) => config,
  (err) => Promise.reject(err),
)

httpClient.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const message: string =
      err.response?.data?.detail ?? err.message ?? 'Request failed'
    return Promise.reject(new Error(message))
  },
)

export default httpClient

// ─── Graph API ────────────────────────────────────────────────────────────────

export const graphApi = {
  /**
   * GET /graph
   * No graphId → returns list of analyzed repos.
   * With graphId → returns full graph (nodes + edges + metrics).
   */
  listGraphs(): Promise<GraphListResponse> {
    return httpClient.get('/graph')
  },

  getGraph(graphId: string): Promise<GraphDetailResponse> {
    return httpClient.get('/graph', { params: { graph_id: graphId } })
  },

  /**
   * GET /callgraph
   * Returns Function/API nodes and their calls edges.
   */
  getCallGraph(graphId: string): Promise<CallGraphResponse> {
    return httpClient.get('/callgraph', { params: { graph_id: graphId } })
  },

  /**
   * GET /lineage
   * Returns nodes connected by depends_on / reads / writes / produces / consumes.
   */
  getLineageGraph(graphId: string): Promise<LineageGraphResponse> {
    return httpClient.get('/lineage', { params: { graph_id: graphId } })
  },

  /**
   * GET /events
   * Returns Event nodes and their publishes / subscribes edges.
   */
  getEventsGraph(graphId: string): Promise<EventsGraphResponse> {
    return httpClient.get('/events', { params: { graph_id: graphId } })
  },

  /**
   * GET /services
   * Returns Service / Cluster / Database nodes.
   */
  getServicesGraph(graphId: string): Promise<ServicesGraphResponse> {
    return httpClient.get('/services', { params: { graph_id: graphId } })
  },
}
