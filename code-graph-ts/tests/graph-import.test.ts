import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { importToGraphStore } from '../src/services/graph-import.js'
import { GraphStore } from '../src/stores/graph-store.js'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GraphifyResult } from '../src/services/graphify.service.js'

const TMP_DIR = join(import.meta.dirname, '__import_test_tmp__')

describe('importToGraphStore', () => {
  let graphStore: GraphStore

  beforeEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
    mkdirSync(TMP_DIR, { recursive: true })
    graphStore = new GraphStore(TMP_DIR)
  })

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
  })

  it('导入 graphify graph.json 中的节点和边', () => {
    const graphJsonPath = join(TMP_DIR, 'graph.json')
    writeFileSync(graphJsonPath, JSON.stringify({
      nodes: [
        { id: 'file_mymod', label: 'mymod', type: 'module', source_file: 'mymod.ts', confidence: 1.0, community: 0 },
        { id: 'file_mymod_MyClass', label: 'MyClass', type: 'class', source_file: 'mymod.ts', confidence: 1.0, community: 0 },
      ],
      edges: [
        { source: 'file_mymod', target: 'file_mymod_MyClass', type: 'defines', confidence: 1.0 },
      ],
      communities: [],
    }))

    const result: GraphifyResult = {
      graphJsonPath,
      reportPath: '',
      htmlPath: '',
      nodeCount: 2,
      edgeCount: 1,
    }

    importToGraphStore(result, 'repo-1', graphStore)

    const graph = graphStore.getGraph('repo-1')
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(1)
  })

  it('节点 id 和 label 正确映射', () => {
    const graphJsonPath = join(TMP_DIR, 'graph.json')
    writeFileSync(graphJsonPath, JSON.stringify({
      nodes: [{ id: 'file_myfn', label: 'myfn', type: 'function', confidence: 0.9 }],
      edges: [],
    }))

    const result: GraphifyResult = {
      graphJsonPath, reportPath: '', htmlPath: '', nodeCount: 1, edgeCount: 0,
    }

    importToGraphStore(result, 'repo-2', graphStore)
    const graph = graphStore.getGraph('repo-2')
    expect(graph.nodes[0].id).toBe('file_myfn')
    expect(graph.nodes[0].label).toBe('myfn')
    expect(graph.nodes[0].type).toBe('function')
  })

  it('边 id 格式为 source-type-target', () => {
    const graphJsonPath = join(TMP_DIR, 'graph.json')
    writeFileSync(graphJsonPath, JSON.stringify({
      nodes: [
        { id: 'a', label: 'A', type: 'module' },
        { id: 'b', label: 'B', type: 'class' },
      ],
      edges: [
        { source: 'a', target: 'b', type: 'defines', confidence: 1.0 },
      ],
    }))

    const result: GraphifyResult = {
      graphJsonPath, reportPath: '', htmlPath: '', nodeCount: 2, edgeCount: 1,
    }

    importToGraphStore(result, 'repo-3', graphStore)
    const graph = graphStore.getGraph('repo-3')
    expect(graph.edges[0].id).toBe('a-defines-b')
  })

  it('graphify 特有属性保留到 metadata', () => {
    const graphJsonPath = join(TMP_DIR, 'graph.json')
    writeFileSync(graphJsonPath, JSON.stringify({
      nodes: [{ id: 'n1', label: 'N1', type: 'function', community: 2, cohesion_score: 0.85, source_file: 'main.ts' }],
      edges: [],
    }))

    const result: GraphifyResult = {
      graphJsonPath, reportPath: '', htmlPath: '', nodeCount: 1, edgeCount: 0,
    }

    importToGraphStore(result, 'repo-4', graphStore)
    const graph = graphStore.getGraph('repo-4')
    expect(graph.nodes[0].file).toBe('main.ts')
    expect(graph.nodes[0].metadata).toBeDefined()
  })

  it('空图谱不报错', () => {
    const graphJsonPath = join(TMP_DIR, 'graph.json')
    writeFileSync(graphJsonPath, JSON.stringify({ nodes: [], edges: [] }))

    const result: GraphifyResult = {
      graphJsonPath, reportPath: '', htmlPath: '', nodeCount: 0, edgeCount: 0,
    }

    importToGraphStore(result, 'repo-5', graphStore)
    const graph = graphStore.getGraph('repo-5')
    expect(graph.nodes).toHaveLength(0)
    expect(graph.edges).toHaveLength(0)
  })

  it('支持 graphify node-link 格式（links 替代 edges，relation 替代 type）', () => {
    const graphJsonPath = join(TMP_DIR, 'graph.json')
    writeFileSync(graphJsonPath, JSON.stringify({
      directed: false,
      nodes: [
        { id: 'src_app', label: 'app.ts', file_type: 'code', source_file: '/src/app.ts', community: 0, norm_label: 'app.ts' },
        { id: 'src_index', label: 'index.ts', file_type: 'code', source_file: '/src/index.ts', community: 0, norm_label: 'index.ts' },
      ],
      links: [
        { source: 'src_app', target: 'src_index', relation: 'imports', confidence: 'EXTRACTED', weight: 1.0, source_file: '/src/app.ts' },
      ],
    }))

    const result: GraphifyResult = {
      graphJsonPath, reportPath: '', htmlPath: '', nodeCount: 2, edgeCount: 1,
    }

    importToGraphStore(result, 'repo-6', graphStore)
    const graph = graphStore.getGraph('repo-6')
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].type).toBe('imports')
    expect(graph.edges[0].id).toBe('src_app-imports-src_index')
    expect(graph.edges[0].confidence).toBe(1.0)
    // file_type=code nodes should get type 'file' via inference
    expect(graph.nodes[0].type).toBe('file')
  })
})
