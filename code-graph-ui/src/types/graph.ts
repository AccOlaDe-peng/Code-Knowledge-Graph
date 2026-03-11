// 图谱节点类型
export interface GraphNode {
  id: string;
  type: string;
  label: string;
  properties: Record<string, unknown>;
}

// 图谱边类型
export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  properties?: Record<string, unknown>;
}

// 图谱数据
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// 节点类型常量
export const NodeType = {
  Module: 'Module',
  Component: 'Component',
  Function: 'Function',
  Class: 'Class',
  Service: 'Service',
  Database: 'Database',
  API: 'API',
  Event: 'Event',
  Cluster: 'Cluster',
  Infrastructure: 'Infrastructure',
} as const;

export type NodeTypeValue = (typeof NodeType)[keyof typeof NodeType];

// 边类型常量
export const EdgeType = {
  Contains: 'contains',
  Calls: 'calls',
  DependsOn: 'depends_on',
  Imports: 'imports',
  Produces: 'produces',
  Consumes: 'consumes',
  Reads: 'reads',
  Writes: 'writes',
  Publishes: 'publishes',
  Subscribes: 'subscribes',
} as const;

export type EdgeTypeValue = (typeof EdgeType)[keyof typeof EdgeType];

// 图谱指标
export interface GraphMetrics {
  nodeCount: number;
  edgeCount: number;
  nodeTypeCounts: Record<string, number>;
  edgeTypeCounts: Record<string, number>;
}
