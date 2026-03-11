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
  Module:         'Module',
  Component:      'Component',
  Function:       'Function',
  Class:          'Class',
  Service:        'Service',
  Database:       'Database',
  API:            'API',
  Event:          'Event',
  Cluster:        'Cluster',
  Infrastructure: 'Infrastructure',
} as const

export type NodeTypeValue = (typeof NodeType)[keyof typeof NodeType]

// ─── Edge Type Constants ──────────────────────────────────────────────────────

export const EdgeType = {
  Contains:   'contains',
  Calls:      'calls',
  DependsOn:  'depends_on',
  Imports:    'imports',
  Produces:   'produces',
  Consumes:   'consumes',
  Reads:      'reads',
  Writes:     'writes',
  Publishes:  'publishes',
  Subscribes: 'subscribes',
} as const

export type EdgeTypeValue = (typeof EdgeType)[keyof typeof EdgeType]

// ─── Graph Metrics ────────────────────────────────────────────────────────────

export type GraphMetrics = {
  nodeCount: number
  edgeCount: number
  nodeTypeCounts: Record<string, number>
  edgeTypeCounts: Record<string, number>
}
