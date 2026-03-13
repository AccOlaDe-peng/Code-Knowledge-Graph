/**
 * Graph node type
 */
export interface GraphNode {
  id: string;
  type: string;
  name: string;
  properties: Record<string, any>;
}

/**
 * Graph edge type
 */
export interface GraphEdge {
  from: string;
  to: string;
  type: string;
  properties?: Record<string, any>;
}

/**
 * Repository information
 */
export interface RepoInfo {
  name: string;
  path: string;
  language: string[];
  totalFiles: number;
  totalSize: number;
}

/**
 * Graph metadata
 */
export interface GraphMetadata {
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
  nodeTypeDistribution: Record<string, number>;
  edgeTypeDistribution: Record<string, number>;
}

/**
 * Complete graph structure
 */
export interface Graph {
  graph_version: string;
  repo: RepoInfo;
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: GraphMetadata;
}

/**
 * Graph list item
 */
export interface GraphListItem {
  graphId: string;
  repoName: string;
  graphType: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
}

/**
 * Analysis job status
 */
export interface AnalysisJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  result?: {
    graphId: string;
    repoId: string;
    nodeCount: number;
    edgeCount: number;
    fileCount: number;
  };
  error?: string;
  createdAt: string;
}
