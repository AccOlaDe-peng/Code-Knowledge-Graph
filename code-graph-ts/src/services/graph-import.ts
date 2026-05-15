import { readFileSync } from 'node:fs'
import type { GraphNode, GraphEdge } from '../types/graph.js'
import type { GraphStore } from '../stores/graph-store.js'
import type { GraphifyResult } from './graphify.service.js'

const INTERNAL_NODE_FIELDS = new Set(['id', 'label', 'type', 'source_file', 'confidence', 'community', 'cohesion_score', 'location'])
const INTERNAL_EDGE_FIELDS = new Set(['source', 'target', 'type', 'confidence', 'weight', 'source_file', 'location'])

interface GraphifyNode {
  id: string
  label: string
  type: string
  source_file?: string
  confidence?: number
  community?: number
  cohesion_score?: number
  location?: { startLine: number; endLine?: number }
  [key: string]: unknown
}

interface GraphifyEdge {
  source: string
  target: string
  type: string
  confidence?: number
  weight?: number
  source_file?: string
  location?: { startLine: number; endLine?: number }
  [key: string]: unknown
}

interface GraphifyGraphJson {
  nodes: GraphifyNode[]
  edges: GraphifyEdge[]
}

export function importToGraphStore(result: GraphifyResult, repoId: string, graphStore: GraphStore): void {
  const raw = readFileSync(result.graphJsonPath, 'utf-8')
  const data: GraphifyGraphJson = JSON.parse(raw)

  for (const gNode of data.nodes) {
    const node: GraphNode = {
      id: gNode.id,
      label: gNode.label,
      type: gNode.type,
      file: gNode.source_file,
      location: gNode.location,
      confidence: gNode.confidence,
      metadata: buildNodeMetadata(gNode),
    }
    graphStore.addNode(repoId, node)
  }

  for (const gEdge of data.edges) {
    const edge: GraphEdge = {
      id: `${gEdge.source}-${gEdge.type}-${gEdge.target}`,
      source: gEdge.source,
      target: gEdge.target,
      type: gEdge.type,
      confidence: gEdge.confidence,
      weight: gEdge.weight,
      file: gEdge.source_file,
      location: gEdge.location,
      metadata: buildEdgeMetadata(gEdge),
    }
    graphStore.addEdge(repoId, edge)
  }

  graphStore.save(repoId)
}

function buildNodeMetadata(gNode: GraphifyNode): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {}
  if (gNode.community !== undefined) metadata.community = gNode.community
  if (gNode.cohesion_score !== undefined) metadata.cohesionScore = gNode.cohesion_score
  for (const [key, value] of Object.entries(gNode)) {
    if (!INTERNAL_NODE_FIELDS.has(key) && value !== undefined) {
      metadata[key] = value
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function buildEdgeMetadata(gEdge: GraphifyEdge): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(gEdge)) {
    if (!INTERNAL_EDGE_FIELDS.has(key) && value !== undefined) {
      metadata[key] = value
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined
}
