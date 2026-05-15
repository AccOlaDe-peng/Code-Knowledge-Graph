export const NodeTypes = {
  Repository: 'repository',
  Module: 'module',
  File: 'file',
  Class: 'class',
  Function: 'function',
  Component: 'component',
  Service: 'service',
  API: 'api',
  APIEndpoint: 'api_endpoint',
  Database: 'database',
  Table: 'table',
  DataObject: 'data_object',
  DataSource: 'data_source',
  DataSink: 'data_sink',
  Event: 'event',
  Topic: 'topic',
  EventHandler: 'event_handler',
  MessageQueue: 'message_queue',
  Pipeline: 'pipeline',
  Flow: 'flow',
  BusinessFlow: 'business_flow',
  Layer: 'layer',
  Domain: 'domain',
  BoundedContext: 'bounded_context',
  DomainEntity: 'domain_entity',
  ExternalAPI: 'external_api',
  Cluster: 'cluster',
  Infrastructure: 'infrastructure',
  Entity: 'entity',
  Field: 'field',
  FlowNode: 'flow_node',
  Interface: 'interface',
  Method: 'method',
  Controller: 'controller',
  Config: 'config',
  Endpoint: 'endpoint',
  Community: 'community',
} as const

export type NodeType = typeof NodeTypes[keyof typeof NodeTypes]

export const EdgeTypes = {
  contains: 'contains',
  imports: 'imports',
  defines: 'defines',
  calls: 'calls',
  depends_on: 'depends_on',
  implements: 'implements',
  reads: 'reads',
  writes: 'writes',
  produces: 'produces',
  consumes: 'consumes',
  publishes: 'publishes',
  subscribes: 'subscribes',
  deployed_on: 'deployed_on',
  uses: 'uses',
  routes_to: 'routes_to',
  triggers: 'triggers',
  belongs_to: 'belongs_to',
  flow_step: 'flow_step',
  transforms: 'transforms',
  part_of: 'part_of',
  async_calls: 'async_calls',
  handles: 'handles',
  queries: 'queries',
  flow_to: 'flow_to',
  references: 'references',
  shares_data_with: 'shares_data_with',
  conceptually_related_to: 'conceptually_related_to',
  belongs_to_community: 'belongs_to_community',
  extends: 'extends',
  overrides: 'overrides',
} as const

export type EdgeType = typeof EdgeTypes[keyof typeof EdgeTypes]

export const Confidence = {
  EXTRACTED: 3,
  INFERRED: 2,
  AMBIGUOUS: 1,
} as const

export interface SourceLocation {
  startLine: number
  endLine?: number
}

export interface GraphNode {
  id: string
  label: string
  type: string
  file?: string
  location?: SourceLocation
  confidence?: number
  metadata?: Record<string, unknown>
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  type: string
  confidence?: number
  weight?: number
  file?: string
  location?: SourceLocation
  metadata?: Record<string, unknown>
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
