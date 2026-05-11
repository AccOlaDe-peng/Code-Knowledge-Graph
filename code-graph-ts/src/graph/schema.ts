// Graph Schema — no enum (erasableSyntaxOnly: true)

// ── Node Types ──────────────────────────────────────────

const NodeType = {
  // Static
  Repository: 'Repository',
  Module: 'Module',
  File: 'File',
  Class: 'Class',
  Function: 'Function',
  Component: 'Component',
  Service: 'Service',
  API: 'API',
  DataObject: 'DataObject',
  Table: 'Table',
  Event: 'Event',
  Topic: 'Topic',
  Pipeline: 'Pipeline',
  Cluster: 'Cluster',
  Database: 'Database',
  // V2 AI
  Layer: 'Layer',
  Flow: 'Flow',
  BusinessFlow: 'BusinessFlow',
  Domain: 'Domain',
  BoundedContext: 'BoundedContext',
  DomainEntity: 'DomainEntity',
  // AI added
  APIEndpoint: 'APIEndpoint',
  EventHandler: 'EventHandler',
  DataSource: 'DataSource',
  DataSink: 'DataSink',
  ExternalAPI: 'ExternalAPI',
  MessageQueue: 'MessageQueue',
  // AI-first
  Entity: 'Entity',
  Field: 'Field',
  FlowNode: 'FlowNode',
  // Graph structure
  Community: 'Community',
  Interface: 'Interface',
  Method: 'Method',
  Controller: 'Controller',
  Config: 'Config',
  Endpoint: 'Endpoint',
} as const;

type NodeType = (typeof NodeType)[keyof typeof NodeType];

// ── Edge Types ──────────────────────────────────────────

const EdgeType = {
  // Structural
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
  // V2 AI
  belongs_to: 'belongs_to',
  flow_step: 'flow_step',
  transforms: 'transforms',
  part_of: 'part_of',
  // AI added
  async_calls: 'async_calls',
  handles: 'handles',
  extends: 'extends',
  overrides: 'overrides',
  // Lineage
  queries: 'queries',
  flow_to: 'flow_to',
  // AI-first
  maps_to: 'maps_to',
  has_field: 'has_field',
  one_to_one: 'one_to_one',
  one_to_many: 'one_to_many',
  many_to_one: 'many_to_one',
  many_to_many: 'many_to_many',
  // Semantic
  references: 'references',
  shares_data_with: 'shares_data_with',
  conceptually_related_to: 'conceptually_related_to',
  belongs_to_community: 'belongs_to_community',
} as const;

type EdgeType = (typeof EdgeType)[keyof typeof EdgeType];

// ── Confidence ──────────────────────────────────────────

const Confidence = {
  EXTRACTED: 'EXTRACTED',
  INFERRED: 'INFERRED',
  AMBIGUOUS: 'AMBIGUOUS',
} as const;

type Confidence = (typeof Confidence)[keyof typeof Confidence];

// Priority: higher number = higher confidence
const CONFIDENCE_PRIORITY: Record<Confidence, number> = {
  EXTRACTED: 3,
  INFERRED: 2,
  AMBIGUOUS: 1,
} as const;

// ── Data Flow Types (LineageAgent) ─────────────────────────

// Data flow edge types for lineage tracking
const DataFlowType = {
  assignment: 'assignment',       // x = foo()
  call_arg: 'call_arg',           // service.process(data)
  return: 'return',               // return result
  db_read: 'db_read',             // repo.findById(id)
  db_write: 'db_write',           // repo.save(entity)
} as const;

type DataFlowType = (typeof DataFlowType)[keyof typeof DataFlowType];

// Location reference for data flow endpoints
interface DataFlowLocation {
  file: string;
  line: number;
  entity: string;      // Variable, function, or class name
  field?: string;      // Optional field-level granularity
}

// Data flow edge for lineage analysis (distinct from GraphEdge)
// Used by LineageAgent static extraction before conversion to GraphEdge
interface DataFlowEdge {
  source: DataFlowLocation;
  target: DataFlowLocation;
  type: DataFlowType;
  confidence: Confidence;
  // Additional context for ambiguous edge resolution
  context?: {
    codeSnippet?: string;   // Original code for LLM context
    pattern?: string;       // Matched AST pattern type
  };
}

// Patterns considered ambiguous during static extraction
// These trigger AMBIGUOUS confidence, deferred to LLM pass
const AMBIGUOUS_PATTERNS = {
  computed_property: 'computed_property',     // obj[key], arr[i]
  reflection_call: 'reflection_call',         // Reflect.get, Reflect.set
  generic_instantiation: 'generic_instantiation', // new T<K>()
  cross_file_symbol: 'cross_file_symbol',     // Symbol defined in another file
  dynamic_import: 'dynamic_import',           // import(...), require(...)
} as const;

type AmbiguousPattern = (typeof AMBIGUOUS_PATTERNS)[keyof typeof AMBIGUOUS_PATTERNS];

// Circuit breaker threshold for ambiguous edges
// If >50% edges are ambiguous, skip LLM pass and mark all as AMBIGUOUS
const CIRCUIT_BREAKER_THRESHOLD = 0.5;

// Maximum file size for parsing (1MB)
const MAX_FILE_SIZE = 1_000_000;

// Source priority for deterministic merge ordering
const SOURCE_PRIORITY: Record<string, number> = {
  ast: 10,
  lineage: 5,
  semantic: 1,
  'graph-build': 3,
  report: 2,
} as const;

// ── Core Interfaces ─────────────────────────────────────

interface SourceLocation {
  file: string;
  startLine: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
}

interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  file: string;
  location?: SourceLocation;
  confidence?: Confidence;
  metadata: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  confidence: Confidence;
  weight: number;
  file?: string;
  location?: SourceLocation;
  metadata?: Record<string, unknown>;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Node/Edge Type Sets for Filtering ───────────────────

const ARCHITECTURE_NODE_TYPES: ReadonlySet<NodeType> = new Set([
  NodeType.Repository, NodeType.Module, NodeType.Service,
  NodeType.Controller, NodeType.Repository, NodeType.Database,
  NodeType.Cluster, NodeType.Layer, NodeType.BoundedContext,
  NodeType.Domain, NodeType.ExternalAPI, NodeType.MessageQueue,
  NodeType.Community, NodeType.APIEndpoint,
] as const);

const STRUCTURAL_EDGE_TYPES: ReadonlySet<EdgeType> = new Set([
  EdgeType.contains, EdgeType.depends_on, EdgeType.imports,
  EdgeType.extends, EdgeType.uses, EdgeType.implements,
  EdgeType.overrides, EdgeType.belongs_to,
] as const);

const LINEAGE_EDGE_TYPES: ReadonlySet<EdgeType> = new Set([
  EdgeType.reads, EdgeType.writes, EdgeType.produces,
  EdgeType.consumes, EdgeType.queries, EdgeType.flow_to,
  EdgeType.transforms, EdgeType.depends_on, EdgeType.imports,
] as const);

// ── Validation ──────────────────────────────────────────

interface ValidationError {
  location: string;
  message: string;
  severity: 'error' | 'warning';
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

function validateGraph(data: GraphData): ValidationResult {
  const errors: ValidationError[] = [];

  // Layer 1: Node structure + ID uniqueness
  const nodeIds = new Set<string>();
  for (const node of data.nodes) {
    if (!node.id) {
      errors.push({ location: `node[${data.nodes.indexOf(node)}]`, message: 'Missing id', severity: 'error' });
    }
    if (nodeIds.has(node.id)) {
      errors.push({ location: `node:${node.id}`, message: 'Duplicate node id', severity: 'error' });
    }
    nodeIds.add(node.id);

    if (!node.type) {
      errors.push({ location: `node:${node.id}`, message: 'Missing type', severity: 'error' });
    }
    if (!node.label) {
      errors.push({ location: `node:${node.id}`, message: 'Missing label', severity: 'warning' });
    }
  }

  // Layer 2: Edge structure + reference integrity
  for (const edge of data.edges) {
    if (!edge.id) {
      errors.push({ location: `edge[${data.edges.indexOf(edge)}]`, message: 'Missing id', severity: 'error' });
    }
    if (!edge.source || !nodeIds.has(edge.source)) {
      errors.push({ location: `edge:${edge.id}`, message: `Dangling source: ${edge.source}`, severity: 'error' });
    }
    if (!edge.target || !nodeIds.has(edge.target)) {
      errors.push({ location: `edge:${edge.id}`, message: `Dangling target: ${edge.target}`, severity: 'error' });
    }
    if (!edge.type) {
      errors.push({ location: `edge:${edge.id}`, message: 'Missing type', severity: 'error' });
    }
    if (!edge.confidence) {
      errors.push({ location: `edge:${edge.id}`, message: 'Missing confidence', severity: 'warning' });
    }
  }

  // Layer 3: Semantic hints (warnings only)
  for (const edge of data.edges) {
    if (edge.source === edge.target) {
      errors.push({ location: `edge:${edge.id}`, message: 'Self-referencing edge', severity: 'warning' });
    }
  }

  const hasErrors = errors.some(e => e.severity === 'error');
  return { valid: !hasErrors, errors };
}

// ── Architecture Layer Config ─────────────────────────────────

const LayerId = {
  api: 'api',
  business: 'business',
  data: 'data',
  infrastructure: 'infrastructure',
} as const;

type LayerId = (typeof LayerId)[keyof typeof LayerId];

const LayerConfig = {
  api: { name: 'API 层', color: '#00d4ff' },
  business: { name: '业务层', color: '#00f084' },
  data: { name: '数据层', color: '#ffc145' },
  infrastructure: { name: '基础设施层', color: '#ff6b9d' },
} as const;

export {
  NodeType,
  EdgeType,
  Confidence,
  CONFIDENCE_PRIORITY,
  SOURCE_PRIORITY,
  ARCHITECTURE_NODE_TYPES,
  STRUCTURAL_EDGE_TYPES,
  LINEAGE_EDGE_TYPES,
  validateGraph,
  DataFlowType,
  AMBIGUOUS_PATTERNS,
  CIRCUIT_BREAKER_THRESHOLD,
  MAX_FILE_SIZE,
  LayerId,
  LayerConfig,
};

export type {
  NodeType as NodeTypeType,
  EdgeType as EdgeTypeType,
  Confidence as ConfidenceType,
  SourceLocation,
  GraphNode,
  GraphEdge,
  GraphData,
  ValidationError,
  ValidationResult,
  DataFlowType as DataFlowTypeType,
  DataFlowLocation,
  DataFlowEdge,
  AmbiguousPattern,
  LayerId as LayerIdType,
};
