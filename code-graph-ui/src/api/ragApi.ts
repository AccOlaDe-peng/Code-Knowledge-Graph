import httpClient from './graphApi'
import type { RagQueryRequest, RagQueryResponse } from '../types/api'

// ─── RAG API ──────────────────────────────────────────────────────────────────

export const ragApi = {
  /**
   * POST /query
   * GraphRAG: vector search → graph expand → LLM synthesis.
   * Returns answer text, related nodes/edges, confidence score.
   */
  query(req: RagQueryRequest): Promise<RagQueryResponse> {
    return httpClient.post('/query', {
      graph_id: req.graphId,
      question: req.question,
    })
  },
}
