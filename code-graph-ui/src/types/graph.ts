// ─── Core Graph Types ────────────────────────────────────────────────────────

export type GraphNode = {
  id: string
  type: string
  label: string
  properties?: Record<string, unknown>
}

export type GraphEdge = {
  source: string
  target: string
  type: string
}

export type Graph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// Backward-compatible alias
export type GraphData = Graph

// ─── Node Type Constants ─────────────────────────────────────────────────────

export const NodeType = {
  // 代码结构层
  Repository: 'Repository',
  Module: 'Module',
  File: 'File',

  // 代码元素
  Class: 'Class',
  Function: 'Function',
  Component: 'Component',

  // 服务层
  Service: 'Service',
  API: 'API',
  APIEndpoint: 'APIEndpoint',

  // 数据层
  Database: 'Database',
  Table: 'Table',
  DataObject: 'DataObject',
  DataSource: 'DataSource',
  DataSink: 'DataSink',

  // 事件层
  Event: 'Event',
  Topic: 'Topic',
  EventHandler: 'EventHandler',
  MessageQueue: 'MessageQueue',

  // 流程层
  Flow: 'Flow',
  BusinessFlow: 'BusinessFlow',
  Pipeline: 'Pipeline',

  // 架构层
  Layer: 'Layer',
  Domain: 'Domain',
  BoundedContext: 'BoundedContext',
  DomainEntity: 'DomainEntity',

  // 外部/基础设施
  ExternalAPI: 'ExternalAPI',
  Cluster: 'Cluster',
  Infrastructure: 'Infrastructure',
} as const

export type NodeTypeValue = (typeof NodeType)[keyof typeof NodeType]

// ─── Edge Type Constants ──────────────────────────────────────────────────────

export const EdgeType = {
  // 包含关系
  Contains: 'contains',
  Defines: 'defines',
  PartOf: 'part_of',

  // 依赖关系
  Imports: 'imports',
  DependsOn: 'depends_on',
  Uses: 'uses',

  // 调用关系
  Calls: 'calls',
  AsyncCalls: 'async_calls',
  Handles: 'handles',

  // 数据关系
  Reads: 'reads',
  Writes: 'writes',
  Transforms: 'transforms',

  // 事件关系
  Produces: 'produces',
  Consumes: 'consumes',
  Publishes: 'publishes',
  Subscribes: 'subscribes',

  // 架构关系
  BelongsTo: 'belongs_to',
  FlowStep: 'flow_step',
  Implements: 'implements',

  // 其他
  DeployedOn: 'deployed_on',
  RoutesTo: 'routes_to',
  Triggers: 'triggers',
} as const

export type EdgeTypeValue = (typeof EdgeType)[keyof typeof EdgeType]

// ─── Graph Metrics ────────────────────────────────────────────────────────────

export type GraphMetrics = {
  nodeCount: number
  edgeCount: number
  nodeTypeCounts: Record<string, number>
  edgeTypeCounts: Record<string, number>
}
