import api from './graphApi';
import type { RagQueryRequest, RagQueryResponse } from '../types/api';

export const ragApi = {
  // GraphRAG 自然语言查询
  query(request: RagQueryRequest): Promise<RagQueryResponse> {
    return api.post('/query', {
      graph_id: request.graphId,
      question: request.question,
    });
  },
};
