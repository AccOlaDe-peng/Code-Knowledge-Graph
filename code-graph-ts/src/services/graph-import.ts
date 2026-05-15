import { readFileSync } from 'node:fs'
import type { GraphNode, GraphEdge } from '../types/graph.js'
import type { GraphStore } from '../stores/graph-store.js'
import type { GraphifyResult } from './graphify.service.js'

const INTERNAL_NODE_FIELDS = new Set(['id', 'label', 'type', 'source_file', 'confidence', 'community', 'cohesion_score', 'location', 'norm_label', 'file_type', 'source_location'])
const INTERNAL_EDGE_FIELDS = new Set(['source', 'target', 'type', 'relation', 'confidence', 'confidence_score', 'weight', 'source_file', 'source_location', 'location', '_src', '_tgt'])

interface GraphifyNode {
  id: string
  label: string
  type?: string
  file_type?: string
  source_file?: string
  source_location?: string
  confidence?: number | string
  community?: number
  cohesion_score?: number
  norm_label?: string
  location?: { startLine: number; endLine?: number }
  [key: string]: unknown
}

interface GraphifyEdge {
  source: string
  target: string
  type?: string
  relation?: string
  confidence?: number | string
  confidence_score?: number
  weight?: number
  source_file?: string
  source_location?: string
  _src?: string
  _tgt?: string
  location?: { startLine: number; endLine?: number }
  [key: string]: unknown
}

interface GraphifyGraphJson {
  nodes: GraphifyNode[]
  edges?: GraphifyEdge[]
  links?: GraphifyEdge[]
}

export function importToGraphStore(result: GraphifyResult, repoId: string, graphStore: GraphStore): void {
  const raw = readFileSync(result.graphJsonPath, 'utf-8')
  const data: GraphifyGraphJson = JSON.parse(raw)

  const edges = data.edges ?? data.links ?? []

  for (const gNode of data.nodes) {
    const nodeType = gNode.type ?? inferNodeType(gNode)
    const node: GraphNode = {
      id: gNode.id,
      label: gNode.label,
      type: nodeType,
      file: gNode.source_file,
      location: gNode.location,
      confidence: normalizeConfidence(gNode.confidence),
      metadata: buildNodeMetadata(gNode),
    }
    graphStore.addNode(repoId, node)
  }

  for (const gEdge of edges) {
    const edgeType = gEdge.type ?? gEdge.relation ?? 'related_to'
    const edge: GraphEdge = {
      id: `${gEdge.source}-${edgeType}-${gEdge.target}`,
      source: gEdge.source,
      target: gEdge.target,
      type: edgeType,
      confidence: normalizeConfidence(gEdge.confidence_score ?? gEdge.confidence),
      weight: gEdge.weight,
      file: gEdge.source_file,
      location: gEdge.location,
      metadata: buildEdgeMetadata(gEdge),
    }
    graphStore.addEdge(repoId, edge)
  }

  graphStore.save(repoId)
}

function inferNodeType(gNode: GraphifyNode): string {
  if (gNode.file_type === 'code') return 'file'
  if (gNode.norm_label) {
    const label = gNode.norm_label as string
    if (label.includes('()') || label.startsWith('.')) return 'function'
    if (label[0] === label[0].toUpperCase() && !label.includes('.')) return 'class'
  }
  return 'entity'
}

function normalizeConfidence(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') return value
  if (value === 'EXTRACTED') return 1.0
  if (value === 'INFERRED') return 0.7
  if (value === 'AMBIGUOUS') return 0.2
  const parsed = parseFloat(value)
  return isNaN(parsed) ? undefined : parsed
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
