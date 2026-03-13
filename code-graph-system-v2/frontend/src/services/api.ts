import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface GraphMetadata {
  graphId: string;
  repoName: string;
  graphType: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
}

export interface Graph {
  graph_version: string;
  repo: {
    name: string;
    path: string;
    language: string[];
  };
  nodes: Array<{
    id: string;
    type: string;
    name: string;
    properties: Record<string, any>;
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: string;
    properties: Record<string, any>;
  }>;
  metadata: {
    createdAt: string;
    nodeCount: number;
    edgeCount: number;
  };
}

export const graphApi = {
  // List all graphs
  listGraphs: async (): Promise<GraphMetadata[]> => {
    const response = await apiClient.get('/api/graph');
    return response.data;
  },

  // Get specific graph
  getGraph: async (graphId: string): Promise<Graph> => {
    const response = await apiClient.get(`/api/graph?graphId=${graphId}`);
    return response.data;
  },

  // Get graph by repo and type
  getGraphByRepo: async (repoId: string, graphType: string): Promise<Graph> => {
    const response = await apiClient.get(`/api/graph/${repoId}?graphType=${graphType}`);
    return response.data;
  },

  // Get subgraph
  getSubGraph: async (
    repoId: string,
    nodeIds: string[],
    depth: number = 1,
    graphType: string = 'graph'
  ): Promise<{ nodes: any[]; edges: any[] }> => {
    const response = await apiClient.get(`/api/graph/${repoId}/subgraph`, {
      params: {
        nodeIds: nodeIds.join(','),
        depth,
        graphType,
      },
    });
    return response.data;
  },

  // Analyze repository
  analyzeRepository: async (repoPath: string, repoName?: string, enableAI: boolean = false) => {
    const response = await apiClient.post('/api/analyze', {
      repoPath,
      repoName,
      enableAI,
    });
    return response.data;
  },

  // Get analysis job status
  getJobStatus: async (jobId: string) => {
    const response = await apiClient.get(`/api/analyze/${jobId}`);
    return response.data;
  },

  // Delete graph
  deleteGraph: async (repoId: string, graphType?: string) => {
    const response = await apiClient.delete(`/api/graph/${repoId}`, {
      params: graphType ? { graphType } : {},
    });
    return response.data;
  },
};

export default apiClient;
