import { apiClient } from '../client'

// ─── RAG Query Types ──────────────────────────────────────────────────────────

export type RAGQueryRequest = {
  graph_id: string
  question: string
  depth?: number
  limit?: number
}

export type RAGQueryResponse = {
  question: string
  answer: string
  nodes: Array<{ id: string; type: string; label: string }>
  edges: Array<{ source: string; target: string; type: string }>
  sources: string[]
  confidence: number
}

// ─── RAG API Endpoints ────────────────────────────────────────────────────────

export const ragEndpoints = {
  /**
   * POST /query
   * Execute GraphRAG natural language query
   */
  async query(request: RAGQueryRequest): Promise<RAGQueryResponse> {
    return apiClient.post('/query', request)
  },

  /**
   * GET /query/history?graph_id={id}
   * Get query history for a graph
   */
  async getQueryHistory(graphId: string): Promise<RAGQueryResponse[]> {
    return apiClient.get('/query/history', { params: { graph_id: graphId } })
  },
}

export default ragEndpoints
