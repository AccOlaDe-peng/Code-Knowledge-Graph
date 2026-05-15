import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GraphStore } from '../src/stores/graph-store.js'
import type { GraphNode, GraphEdge } from '../src/types/graph.js'

describe('GraphStore', () => {
  let store: GraphStore
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'graph-store-test-'))
    store = new GraphStore(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const makeNode = (id: string, type = 'function'): GraphNode => ({
    id,
    label: id,
    type,
  })

  const makeEdge = (id: string, source: string, target: string, type = 'calls'): GraphEdge => ({
    id,
    source,
    target,
    type,
  })

  it('初始时获取空图', () => {
    const graph = store.getGraph('non-existent')
    expect(graph.nodes).toEqual([])
    expect(graph.edges).toEqual([])
  })

  it('添加节点和边', () => {
    store.addNode('repo-1', makeNode('n1'))
    store.addNode('repo-1', makeNode('n2'))
    store.addEdge('repo-1', makeEdge('e1', 'n1', 'n2'))
    const graph = store.getGraph('repo-1')
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(1)
  })

  it('按类型筛选节点', () => {
    store.addNode('repo-1', makeNode('n1', 'module'))
    store.addNode('repo-1', makeNode('n2', 'file'))
    store.addNode('repo-1', makeNode('n3', 'module'))
    const filtered = store.getNodesByTypes('repo-1', ['module'])
    expect(filtered).toHaveLength(2)
  })

  it('统计节点和边数', () => {
    store.addNode('repo-1', makeNode('n1'))
    store.addNode('repo-1', makeNode('n2'))
    store.addEdge('repo-1', makeEdge('e1', 'n1', 'n2'))
    expect(store.getNodeCount('repo-1')).toBe(2)
    expect(store.getEdgeCount('repo-1')).toBe(1)
  })

  it('持久化并恢复', () => {
    store.addNode('repo-1', makeNode('n1', 'class'))
    store.save('repo-1')
    const store2 = new GraphStore(tempDir)
    const graph = store2.getGraph('repo-1')
    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0].type).toBe('class')
  })

  it('删除图', () => {
    store.addNode('repo-1', makeNode('n1'))
    store.deleteGraph('repo-1')
    expect(store.getGraph('repo-1').nodes).toEqual([])
  })
})
