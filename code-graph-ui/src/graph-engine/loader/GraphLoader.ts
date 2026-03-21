/**
 * GraphLoader — 框架图数据加载器（重写版）
 *
 * 与 ArchitectureCanvas 通过 CustomEvent 通信：
 *   graphloader:merge      — 通知 Canvas 合并新节点/边
 *   graphloader:collapse   — 通知 Canvas 隐藏节点的展开子节点
 *   graphloader:uncollapse — 通知 Canvas 恢复显示
 *   graphloader:prune      — 通知 Canvas 执行 pruneDistantNodes
 */
import apiClient from '../../core/api/client'
import type { RawNode, RawEdge, ExpandResponse } from './types'
import { useGraphEngineStore } from '../store/graphEngineStore'
import { useMetaStore } from '../../store/metaStore'

const VISIBLE_NODE_LIMIT  = 2000
const PRUNE_TARGET        = 1800
const FALLBACK_NODE_LIMIT = 500
const PRUNE_DEBOUNCE_MS   = 200

type FrameworkRaw = {
  repo_id:    string
  node_count: number
  edge_count: number
  nodes:      RawNode[]
  edges:      RawEdge[]
}

export type LoadResult = {
  nodes:            RawNode[]
  edges:            RawEdge[]
  total_node_count: number
  total_edge_count: number
}

export class GraphLoader {
  private readonly repoId: string
  private cacheKey:        string
  private initialCache:    LoadResult | null = null
  private expandCache      = new Map<string, ExpandResponse>()
  private noChildrenSet    = new Set<string>()
  // nodeId → 被 hide 的直接子节点 ID 列表
  private collapsedNodes   = new Map<string, string[]>()
  private pruneTimer:      ReturnType<typeof setTimeout> | null = null

  constructor(repoId: string, analysisTimestamp = '') {
    this.repoId   = repoId
    this.cacheKey = `${repoId}:${analysisTimestamp}`
  }

  /** 仓库重新分析后调用，清除所有缓存 */
  invalidateCache(newTimestamp = ''): void {
    const newKey = `${this.repoId}:${newTimestamp}`
    if (newKey === this.cacheKey) return
    this.cacheKey     = newKey
    this.initialCache = null
    this.expandCache.clear()
    this.noChildrenSet.clear()
    this.collapsedNodes.clear()
  }

  // ── 初始加载 ──────────────────────────────────────────────────────────────

  async loadInitial(): Promise<LoadResult> {
    if (this.initialCache) return this.initialCache

    let raw = await apiClient.get<FrameworkRaw>('/graph/framework', {
      params: { repo_id: this.repoId },
    })

    if (raw.nodes.length === 0) {
      // 极端情况：无架构层节点，拉全量前 500
      const allRaw = await apiClient.get<FrameworkRaw>('/graph/framework', {
        params: { repo_id: this.repoId, node_types: 'all' },
      })
      const nodes = allRaw.nodes.slice(0, FALLBACK_NODE_LIMIT)
      console.warn(
        `[GraphLoader] 无架构层节点，展示全量前 ${FALLBACK_NODE_LIMIT} 个节点 (共 ${allRaw.node_count} 个)`
      )
      raw = { ...allRaw, nodes, node_count: nodes.length }
    }

    const result: LoadResult = {
      nodes:            raw.nodes,
      edges:            raw.edges,
      total_node_count: raw.node_count,
      total_edge_count: raw.edge_count,
    }
    this.initialCache = result
    return result
  }

  // ── 节点展开 ──────────────────────────────────────────────────────────────

  async expandNode(nodeId: string, depth = 1): Promise<ExpandResponse | null> {
    if (this.noChildrenSet.has(nodeId)) return null

    if (this.collapsedNodes.has(nodeId)) {
      // 已折叠 → 通知 Canvas uncollapse，不发请求
      this._dispatch('graphloader:uncollapse', { nodeId })
      this.collapsedNodes.delete(nodeId)
      useGraphEngineStore.getState().clearCollapsedCount(nodeId)
      return null
    }

    if (this.expandCache.has(nodeId)) {
      const cached = this.expandCache.get(nodeId)!
      this._dispatch('graphloader:merge', { nodes: cached.nodes, edges: cached.edges })
      useGraphEngineStore.getState().setLastExpandedNode(nodeId)
      this._schedulePrune(nodeId)
      return cached
    }

    const rawEdgeTypes = useMetaStore.getState().structuralEdgeTypes
    const structuralEdgeTypes = rawEdgeTypes.length > 0
      ? rawEdgeTypes.join(',')
      : 'contains,depends_on,imports,extends,uses,implements,overrides,belongs_to'
    const data = await apiClient.get<ExpandResponse>('/graph/expand', {
      params: {
        repo_id:    this.repoId,
        node_id:    nodeId,
        depth,
        edge_types: structuralEdgeTypes,
      },
    })

    if (data.node_count === 0) {
      this.noChildrenSet.add(nodeId)
      useGraphEngineStore.getState().setCollapsedCount(nodeId, 0)
      return data
    }

    this.expandCache.set(nodeId, data)
    this._dispatch('graphloader:merge', { nodes: data.nodes, edges: data.edges })
    useGraphEngineStore.getState().setLastExpandedNode(nodeId)
    useGraphEngineStore.getState().markExpanded(nodeId)
    this._schedulePrune(nodeId)
    return data
  }

  // ── 折叠 ─────────────────────────────────────────────────────────────────

  collapseNode(nodeId: string): void {
    const cached = this.expandCache.get(nodeId)
    if (!cached) return
    const childIds = cached.nodes.map(n => n.id)
    this.collapsedNodes.set(nodeId, childIds)
    this._dispatch('graphloader:collapse', { nodeId, childIds })
    useGraphEngineStore.getState().setCollapsedCount(nodeId, childIds.length)
  }

  // ── 内部工具 ─────────────────────────────────────────────────────────────

  private _dispatch(event: string, detail: Record<string, unknown>): void {
    window.dispatchEvent(new CustomEvent(event, { detail }))
  }

  private _schedulePrune(centerNodeId: string): void {
    if (this.pruneTimer) clearTimeout(this.pruneTimer)
    this.pruneTimer = setTimeout(() => {
      this._dispatch('graphloader:prune', {
        centerNodeId,
        limit:  VISIBLE_NODE_LIMIT,
        target: PRUNE_TARGET,
      })
    }, PRUNE_DEBOUNCE_MS)
  }
}

export function createGraphLoader(repoId: string, analysisTimestamp = ''): GraphLoader {
  return new GraphLoader(repoId, analysisTimestamp)
}
