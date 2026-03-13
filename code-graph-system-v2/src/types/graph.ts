// Graph Schema - Type definitions for the knowledge graph

// Node Types (using const object instead of enum for TypeScript compatibility)
export const NodeType = {
  Module: 'Module',
  File: 'File',
  Class: 'Class',
  Function: 'Function',
  API: 'API',
  Database: 'Database',
  Table: 'Table',
  Event: 'Event',
  Topic: 'Topic',
  Service: 'Service',
  Component: 'Component',
} as const;

export type NodeType = typeof NodeType[keyof typeof NodeType];

// Edge Types
export const EdgeType = {
  imports: 'imports',
  calls: 'calls',
  extends: 'extends',
  implements: 'implements',
  depends_on: 'depends_on',
  reads: 'reads',
  writes: 'writes',
  produces: 'produces',
  consumes: 'consumes',
  contains: 'contains',
} as const;

export type EdgeType = typeof EdgeType[keyof typeof EdgeType];

// Node interface
export interface Node {
  id: string;
  type: NodeType;
  name: string;
  properties: Record<string, any>;
}

// Edge interface
export interface Edge {
  from: string;
  to: string;
  type: EdgeType;
  properties: Record<string, any>;
}

// Repository information
export interface RepoInfo {
  name: string;
  path: string;
  language: string[];
  commit?: string;
  branch?: string;
  totalFiles?: number;
  totalSize?: number;
}

// Graph metadata
export interface GraphMetadata {
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
  nodeTypeDistribution: Record<NodeType, number>;
  edgeTypeDistribution: Record<EdgeType, number>;
}

// Complete graph structure
export interface Graph {
  graph_version: string;
  repo: RepoInfo;
  nodes: Node[];
  edges: Edge[];
  metadata: GraphMetadata;
}

/**
 * Normalize node ID according to the format: {type}:{path}:{name}
 * @param type - Node type
 * @param path - File path or module path
 * @param name - Node name
 * @returns Normalized node ID
 */
export function normalizeNodeId(type: NodeType, path: string, name: string): string {
  // Remove leading/trailing slashes and normalize path separators
  const normalizedPath = path.replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
  // Remove special characters from name
  const normalizedName = name.replace(/[^\w.-]/g, '_');

  return `${type}:${normalizedPath}:${normalizedName}`;
}

/**
 * Parse a normalized node ID back into its components
 * @param nodeId - Normalized node ID
 * @returns Object containing type, path, and name
 */
export function parseNodeId(nodeId: string): { type: string; path: string; name: string } | null {
  const parts = nodeId.split(':');
  if (parts.length !== 3) {
    return null;
  }

  return {
    type: parts[0],
    path: parts[1],
    name: parts[2],
  };
}

/**
 * Create a unique edge key for deduplication
 * @param edge - Edge object
 * @returns Unique edge key
 */
export function createEdgeKey(edge: Edge): string {
  return `${edge.from}|${edge.to}|${edge.type}`;
}
