import Graph from 'graphology'
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { GraphNode, GraphEdge, GraphData } from '../types/graph.js'

export class GraphStore {
  private graphs: Map<string, Graph> = new Map()
  private graphsDir: string

  constructor(baseDir: string) {
    this.graphsDir = join(baseDir, 'graphs')
    mkdirSync(this.graphsDir, { recursive: true })
  }

  private getOrCreateGraph(repoId: string): Graph {
    let g = this.graphs.get(repoId)
    if (!g) {
      g = new Graph()
      this.graphs.set(repoId, g)
    }
    return g
  }

  addNode(repoId: string, node: GraphNode): void {
    const g = this.getOrCreateGraph(repoId)
    if (g.hasNode(node.id)) {
      g.mergeNode(node.id, { ...node })
    } else {
      g.addNode(node.id, { ...node })
    }
  }

  addEdge(repoId: string, edge: GraphEdge): void {
    const g = this.getOrCreateGraph(repoId)
    if (!g.hasNode(edge.source)) g.addNode(edge.source, { id: edge.source, label: edge.source, type: 'unknown' })
    if (!g.hasNode(edge.target)) g.addNode(edge.target, { id: edge.target, label: edge.target, type: 'unknown' })
    if (!g.hasEdge(edge.id)) {
      g.addEdgeWithKey(edge.id, edge.source, edge.target, { ...edge })
    }
  }

  getGraph(repoId: string): GraphData {
    if (!this.graphs.has(repoId)) {
      this.load(repoId)
    }
    const g = this.graphs.get(repoId)
    if (!g) return { nodes: [], edges: [] }
    const nodes: GraphNode[] = []
    g.forEachNode((node, attr) => {
      nodes.push(attr as GraphNode)
    })
    const edges: GraphEdge[] = []
    g.forEachEdge((edge, attr, source, target) => {
      edges.push({ ...(attr as GraphEdge), source, target })
    })
    return { nodes, edges }
  }

  getNodesByTypes(repoId: string, types: string[]): GraphNode[] {
    const g = this.graphs.get(repoId)
    if (!g) return []
    const result: GraphNode[] = []
    const typeSet = new Set(types)
    g.forEachNode((node, attr) => {
      if (typeSet.has((attr as GraphNode).type)) {
        result.push(attr as GraphNode)
      }
    })
    return result
  }

  getNodeCount(repoId: string): number {
    return this.graphs.get(repoId)?.order ?? 0
  }

  getEdgeCount(repoId: string): number {
    return this.graphs.get(repoId)?.size ?? 0
  }

  save(repoId: string): void {
    const g = this.graphs.get(repoId)
    if (!g) return
    const data = this.getGraph(repoId)
    const filePath = join(this.graphsDir, `${repoId}.json`)
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  load(repoId: string): void {
    const filePath = join(this.graphsDir, `${repoId}.json`)
    if (!existsSync(filePath)) return
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const data: GraphData = JSON.parse(raw)
      const g = this.getOrCreateGraph(repoId)
      g.clear()
      for (const node of data.nodes) this.addNode(repoId, node)
      for (const edge of data.edges) this.addEdge(repoId, edge)
    } catch (e) {
      console.error(`Failed to load graph for ${repoId}:`, e)
    }
  }

  deleteGraph(repoId: string): void {
    this.graphs.delete(repoId)
    const filePath = join(this.graphsDir, `${repoId}.json`)
    if (existsSync(filePath)) unlinkSync(filePath)
  }
}
