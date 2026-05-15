# Real Analysis Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simulated analysis pipeline with a real one: git prepare → graphify CLI → import results into GraphStore.

**Architecture:** Add GitService and GraphifyService as new service classes, refactor AnalysisService to orchestrate them, update app.ts dependency injection. All changes stay within the existing Service→Store pattern.

**Tech Stack:** Node.js, Hono, TypeScript, child_process.spawn, graphify CLI (`pip install graphifyy`)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/services/git.service.ts` | Git path detection, clone, fetch, checkout |
| Create | `src/services/graphify.service.ts` | Invoke graphify CLI, parse progress, return result paths |
| Create | `src/services/graph-import.ts` | Convert graphify graph.json → GraphNode/GraphEdge, write to GraphStore |
| Modify | `src/services/analysis.service.ts` | Replace `simulateAnalysis` with `executePipeline` |
| Modify | `src/app.ts` | Create GitService/GraphifyService, inject into AnalysisService |
| Modify | `src/routes/analyze.ts` | Pass `branch` from request body to AnalysisService |
| Create | `tests/git-service.test.ts` | GitService unit tests |
| Create | `tests/graphify-service.test.ts` | GraphifyService unit tests |
| Create | `tests/graph-import.test.ts` | Graph import unit tests |
| Modify | `tests/e2e.test.ts` | Update e2e to work with new pipeline (mock graphify) |

---

### Task 1: GitService

**Files:**
- Create: `src/services/git.service.ts`
- Create: `tests/git-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/git-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitService } from '../src/services/git.service.js'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP_DIR = join(import.meta.dirname, '__git_test_tmp__')

describe('GitService', () => {
  let service: GitService

  beforeEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
    mkdirSync(TMP_DIR, { recursive: true })
    service = new GitService(join(TMP_DIR, 'repo-cache'))
  })

  it('本地路径已存在时直接返回', async () => {
    const localDir = join(TMP_DIR, 'my-local-repo')
    mkdirSync(localDir, { recursive: true })
    // 不是 git 仓库也能返回路径（只是没有 commit）
    const result = await service.prepareLocalPath(localDir)
    expect(result.localPath).toBe(localDir)
    expect(result.isClone).toBe(false)
  })

  it('本地路径不存在时当作 Git URL 处理', async () => {
    // Mock execFile to avoid real git clone
    const { execFile } = await import('node:child_process')
    const spy = vi.spyOn({ execFile }, 'execFile')

    // 使用一个非本地路径
    await expect(service.prepareLocalPath('https://github.com/nonexistent/repo.git'))
      .rejects.toThrow()
  })

  it('指定 branch 时对本地仓库执行 checkout', async () => {
    const { execFile } = await import('node:child_process')
    const spy = vi.spyOn(await import('node:child_process'), 'execFile')

    const localDir = join(TMP_DIR, 'git-repo')
    mkdirSync(localDir, { recursive: true })

    // execFile mock — git rev-parse 和 git checkout 都成功
    spy.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      if (_args.includes('rev-parse')) cb(null, { stdout: 'abc123' })
      else if (_args.includes('checkout')) cb(null, { stdout: '' })
      else cb(null, { stdout: '' })
    })

    const result = await service.prepareLocalPath(localDir, 'dev')
    expect(result.localPath).toBe(localDir)
    expect(result.gitCommit).toBe('abc123')
    expect(result.isClone).toBe(false)
    spy.mockRestore()
  })

  it('repo-cache 目录不存在时自动创建', () => {
    const cacheDir = join(TMP_DIR, 'new-cache')
    const svc = new GitService(cacheDir)
    expect(existsSync(cacheDir)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code-graph-ts && pnpm test tests/git-service.test.ts`
Expected: FAIL — module `../src/services/git.service.js` not found

- [ ] **Step 3: Write GitService implementation**

```typescript
// src/services/git.service.ts
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface GitPrepareResult {
  localPath: string
  gitCommit: string
  isClone: boolean
}

export class GitError extends Error {
  constructor(message: string, public readonly stderr: string) {
    super(message)
    this.name = 'GitError'
  }
}

export class GitService {
  private repoCacheDir: string

  constructor(repoCacheDir: string) {
    this.repoCacheDir = repoCacheDir
    mkdirSync(repoCacheDir, { recursive: true })
  }

  async prepareLocalPath(repoPath: string, branch?: string): Promise<GitPrepareResult> {
    if (existsSync(repoPath)) {
      return this.prepareLocalRepo(repoPath, branch)
    }
    return this.cloneRemoteRepo(repoPath, branch)
  }

  private async prepareLocalRepo(localPath: string, branch?: string): Promise<GitPrepareResult> {
    if (branch) {
      await this.git(localPath, 'checkout', branch).catch(() => {})
    }
    const gitCommit = await this.getHeadCommit(localPath)
    return { localPath, gitCommit, isClone: false }
  }

  private async cloneRemoteRepo(url: string, branch?: string): Promise<GitPrepareResult> {
    const repoName = this.extractRepoName(url)
    const cachePath = join(this.repoCacheDir, repoName)

    if (existsSync(join(cachePath, '.git'))) {
      await this.git(cachePath, 'fetch', '--all')
      if (branch) {
        await this.git(cachePath, 'checkout', branch).catch(async () => {
          await this.git(cachePath, 'checkout', 'main').catch(() => this.git(cachePath, 'checkout', 'master'))
        })
      }
      await this.git(cachePath, 'pull').catch(() => {})
    } else {
      const args = ['clone', url, cachePath]
      if (branch) args.splice(1, 0, '-b', branch)
      try {
        await this.git('', ...args)
      } catch (primaryErr) {
        if (branch) {
          const argsMain = ['clone', '-b', 'main', url, cachePath]
          try {
            await this.git('', ...argsMain)
          } catch {
            const argsMaster = ['clone', '-b', 'master', url, cachePath]
            await this.git('', ...argsMaster)
          }
        } else {
          throw primaryErr
        }
      }
    }

    const gitCommit = await this.getHeadCommit(cachePath)
    return { localPath: cachePath, gitCommit, isClone: true }
  }

  private async getHeadCommit(repoPath: string): Promise<string> {
    try {
      const { stdout } = await this.git(repoPath, 'rev-parse', 'HEAD')
      return stdout.trim()
    } catch {
      return ''
    }
  }

  private git(cwd: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
    const opts = cwd ? { cwd } : {}
    return execFileAsync('git', args, opts)
  }

  private extractRepoName(url: string): string {
    const base = basename(url)
    return base.endsWith('.git') ? base.slice(0, -4) : base
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd code-graph-ts && pnpm test tests/git-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd code-graph-ts
git add src/services/git.service.ts tests/git-service.test.ts
git commit -m "feat: GitService — 本地路径检测与远程仓库 clone/fetch/pull"
```

---

### Task 2: GraphifyService

**Files:**
- Create: `src/services/graphify.service.ts`
- Create: `tests/graphify-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/graphify-service.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GraphifyService } from '../src/services/graphify.service.js'
import type { GraphifyOptions } from '../src/services/graphify.service.js'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TMP_DIR = join(import.meta.dirname, '__graphify_test_tmp__')

describe('GraphifyService', () => {
  let service: GraphifyService

  beforeEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
    mkdirSync(TMP_DIR, { recursive: true })
    service = new GraphifyService(5000) // 5s timeout for tests
  })

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
  })

  it('graphify 不存在时抛出明确错误', async () => {
    const svc = new GraphifyService(2000)
    // 用不存在的 PATH 让 spawn 失败
    const origPath = process.env.PATH
    process.env.PATH = '/nonexistent'
    try {
      await expect(svc.run('/tmp', { mode: 'deep', update: false, directed: false }))
        .rejects.toThrow(/graphify/)
    } finally {
      process.env.PATH = origPath
    }
  })

  it('构建正确的 spawn 参数 — 全量 deep 模式', () => {
    const service = new GraphifyService()
    const args = service.buildArgs('/path/to/repo', { mode: 'deep', update: false, directed: false })
    expect(args).toEqual(['/path/to/repo', '--mode', 'deep'])
  })

  it('构建正确的 spawn 参数 — 增量更新', () => {
    const service = new GraphifyService()
    const args = service.buildArgs('/path/to/repo', { mode: 'deep', update: true, directed: false })
    expect(args).toEqual(['/path/to/repo', '--mode', 'deep', '--update'])
  })

  it('构建正确的 spawn 参数 — 有向图', () => {
    const service = new GraphifyService()
    const args = service.buildArgs('/path/to/repo', { mode: 'deep', update: false, directed: true })
    expect(args).toEqual(['/path/to/repo', '--mode', 'deep', '--directed'])
  })

  it('进度映射 — detect → scanning', () => {
    const service = new GraphifyService()
    expect(service.mapStage('detect')).toBe('scanning')
  })

  it('进度映射 — extract → static_analysis', () => {
    const service = new GraphifyService()
    expect(service.mapStage('extract')).toBe('static_analysis')
  })

  it('进度映射 — semantic → semantic_analysis', () => {
    const service = new GraphifyService()
    expect(service.mapStage('semantic')).toBe('semantic_analysis')
  })

  it('进度映射 — build → graph_building', () => {
    const service = new GraphifyService()
    expect(service.mapStage('build')).toBe('graph_building')
  })

  it('进度映射 — report → reporting', () => {
    const service = new GraphifyService()
    expect(service.mapStage('report')).toBe('reporting')
  })

  it('进度映射 — 未知阶段返回原值', () => {
    const service = new GraphifyService()
    expect(service.mapStage('unknown_step')).toBe('unknown_step')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code-graph-ts && pnpm test tests/graphify-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write GraphifyService implementation**

```typescript
// src/services/graphify.service.ts
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface GraphifyOptions {
  mode: 'normal' | 'deep'
  update: boolean
  directed: boolean
}

export interface GraphifyResult {
  graphJsonPath: string
  reportPath: string
  htmlPath: string
  nodeCount: number
  edgeCount: number
}

export type ProgressCallback = (stage: string, step: number, total: number, message: string) => void

const STAGE_MAP: Record<string, string> = {
  detect: 'scanning',
  extract: 'static_analysis',
  semantic: 'semantic_analysis',
  build: 'graph_building',
  report: 'reporting',
}

export class GraphifyService {
  private defaultTimeout: number
  private activeProcesses: Map<string, ChildProcess> = new Map()

  constructor(defaultTimeout: number = 30 * 60 * 1000) {
    this.defaultTimeout = defaultTimeout
  }

  async run(
    localPath: string,
    options: GraphifyOptions,
    onProgress?: ProgressCallback,
    abortSignal?: AbortSignal,
  ): Promise<GraphifyResult> {
    const args = this.buildArgs(localPath, options)
    const taskId = `${localPath}-${Date.now()}`

    return new Promise<GraphifyResult>((resolve, reject) => {
      let stderr = ''

      const proc = spawn('graphify', args, {
        cwd: localPath,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      this.activeProcesses.set(taskId, proc)

      const timeout = setTimeout(() => {
        proc.kill('SIGKILL')
        this.activeProcesses.delete(taskId)
        reject(new Error(`graphify timed out after ${this.defaultTimeout}ms`))
      }, this.defaultTimeout)

      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString()
        this.parseProgress(text, onProgress)
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      const cleanup = () => {
        clearTimeout(timeout)
        this.activeProcesses.delete(taskId)
      }

      proc.on('close', (code) => {
        cleanup()
        if (code !== 0) {
          const tail = stderr.length > 500 ? stderr.slice(-500) : stderr
          reject(new Error(`graphify exited with code ${code}: ${tail}`))
          return
        }

        const graphJsonPath = join(localPath, 'graphify-out', 'graph.json')
        const reportPath = join(localPath, 'graphify-out', 'GRAPH_REPORT.md')
        const htmlPath = join(localPath, 'graphify-out', 'graph.html')

        if (!existsSync(graphJsonPath)) {
          reject(new Error('graphify completed but graph.json not found'))
          return
        }

        try {
          const graphData = JSON.parse(readFileSync(graphJsonPath, 'utf-8'))
          const nodeCount = Array.isArray(graphData.nodes) ? graphData.nodes.length : 0
          const edgeCount = Array.isArray(graphData.edges) ? graphData.edges.length : 0

          resolve({ graphJsonPath, reportPath, htmlPath, nodeCount, edgeCount })
        } catch (e) {
          reject(new Error(`Failed to parse graph.json: ${(e as Error).message}`))
        }
      })

      proc.on('error', (err) => {
        cleanup()
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('graphify not found. Install with: pip install graphifyy'))
        } else {
          reject(err)
        }
      })

      if (abortSignal) {
        const onAbort = () => {
          proc.kill('SIGTERM')
          this.activeProcesses.delete(taskId)
          reject(new Error('Analysis canceled'))
        }
        if (abortSignal.aborted) {
          onAbort()
        } else {
          abortSignal.addEventListener('abort', onAbort, { once: true })
        }
      }
    })
  }

  buildArgs(localPath: string, options: GraphifyOptions): string[] {
    const args = [localPath]
    args.push('--mode', options.mode)
    if (options.update) args.push('--update')
    if (options.directed) args.push('--directed')
    return args
  }

  mapStage(graphifyStage: string): string {
    return STAGE_MAP[graphifyStage] ?? graphifyStage
  }

  killActive(taskId: string): void {
    const proc = this.activeProcesses.get(taskId)
    if (proc) {
      proc.kill('SIGTERM')
      this.activeProcesses.delete(taskId)
    }
  }

  private parseProgress(text: string, onProgress?: ProgressCallback): void {
    if (!onProgress) return
    const lines = text.split('\n')
    for (const line of lines) {
      const match = line.match(/step[:\s]+(\d+)\/(\d+).*stage[:\s]+(\w+)/i)
        ?? line.match(/\[(\d+)\/(\d+)\]\s*(\w+)/)
      if (match) {
        const step = parseInt(match[1], 10)
        const total = parseInt(match[2], 10)
        const stage = this.mapStage(match[3])
        onProgress(stage, step, total, line.trim())
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd code-graph-ts && pnpm test tests/graphify-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd code-graph-ts
git add src/services/graphify.service.ts tests/graphify-service.test.ts
git commit -m "feat: GraphifyService — graphify CLI 调用、进度解析、结果返回"
```

---

### Task 3: Graph Import (graphify graph.json → GraphStore)

**Files:**
- Create: `src/services/graph-import.ts`
- Create: `tests/graph-import.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/graph-import.test.ts
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code-graph-ts && pnpm test tests/graph-import.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write graph-import implementation**

```typescript
// src/services/graph-import.ts
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

function buildNodeMetadata(gNode: GraphifyNode): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  if (gNode.community !== undefined) metadata.community = gNode.community
  if (gNode.cohesion_score !== undefined) metadata.cohesionScore = gNode.cohesion_score
  for (const [key, value] of Object.entries(gNode)) {
    if (!INTERNAL_NODE_FIELDS.has(key) && value !== undefined) {
      metadata[key] = value
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined!
}

function buildEdgeMetadata(gEdge: GraphifyEdge): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(gEdge)) {
    if (!INTERNAL_EDGE_FIELDS.has(key) && value !== undefined) {
      metadata[key] = value
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined!
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd code-graph-ts && pnpm test tests/graph-import.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd code-graph-ts
git add src/services/graph-import.ts tests/graph-import.test.ts
git commit -m "feat: graph-import — graphify graph.json 转换为 GraphNode/GraphEdge 导入 GraphStore"
```

---

### Task 4: Refactor AnalysisService

**Files:**
- Modify: `src/services/analysis.service.ts`

- [ ] **Step 1: Write the failing test for pipeline execution**

```typescript
// Add to a new test file: tests/analysis-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AnalysisService } from '../src/services/analysis.service.js'
import { AnalysisStore } from '../src/stores/analysis-store.js'
import type { GitService, GitPrepareResult } from '../src/services/git.service.js'
import type { GraphifyService, GraphifyResult } from '../src/services/graphify.service.js'
import type { GraphStore } from '../src/stores/graph-store.js'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP_DIR = join(import.meta.dirname, '__analysis_test_tmp__')

describe('AnalysisService', () => {
  let analysisStore: AnalysisStore
  let service: AnalysisService
  let mockGitService: GitService
  let mockGraphifyService: GraphifyService
  let mockGraphStore: GraphStore

  beforeEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true })
    mkdirSync(TMP_DIR, { recursive: true })

    analysisStore = new AnalysisStore()

    mockGitService = {
      prepareLocalPath: vi.fn().mockResolvedValue({
        localPath: '/tmp/test-repo',
        gitCommit: 'abc123',
        isClone: false,
      } satisfies GitPrepareResult),
    } as unknown as GitService

    mockGraphifyService = {
      run: vi.fn().mockResolvedValue({
        graphJsonPath: join(TMP_DIR, 'graph.json'),
        reportPath: '',
        htmlPath: '',
        nodeCount: 10,
        edgeCount: 5,
      } satisfies GraphifyResult),
    } as unknown as GraphifyService

    mockGraphStore = {
      getNodeCount: vi.fn().mockReturnValue(0),
      addNode: vi.fn(),
      addEdge: vi.fn(),
      save: vi.fn(),
      getGraph: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
    } as unknown as GraphStore

    service = new AnalysisService(analysisStore, mockGitService, mockGraphifyService, mockGraphStore)
  })

  it('submitAnalysis 创建 pending 任务并启动流水线', async () => {
    // 写一个空 graph.json 让 import 不报错
    writeFileSync(join(TMP_DIR, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }))

    const task = service.submitAnalysis('repo-1', 'my-repo', '/tmp/test-repo')
    expect(task.status).toBe('pending')
    expect(task.id).toBeTruthy()
  })

  it('cancelAnalysis 传递 abort signal', () => {
    const task = service.submitAnalysis('repo-1', 'my-repo', '/tmp/test-repo')
    const canceled = service.cancelAnalysis(task.id)
    expect(canceled).toBeDefined()
    expect(canceled!.status).toBe('canceled')
  })

  it('同一仓库不并发分析', () => {
    service.submitAnalysis('repo-1', 'my-repo', '/tmp/test-repo')
    const task2 = service.submitAnalysis('repo-1', 'my-repo', '/tmp/test-repo')
    expect(task2.status).toBe('failed')
    expect(task2.error).toContain('already running')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code-graph-ts && pnpm test tests/analysis-service.test.ts`
Expected: FAIL — constructor signature mismatch (old AnalysisService takes only AnalysisStore)

- [ ] **Step 3: Rewrite AnalysisService**

```typescript
// src/services/analysis.service.ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AnalysisStore } from '../stores/analysis-store.js'
import type { AnalysisTask } from '../types/repo.js'
import type { SSEBroadcaster } from '../utils/sse.js'
import type { AnalysisProgressEvent } from '../types/api.js'
import type { GitService } from './git.service.js'
import type { GraphifyService, GraphifyOptions } from './graphify.service.js'
import type { GraphStore } from '../stores/graph-store.js'
import { importToGraphStore } from './graph-import.js'
import type { RepoService } from './repo.service.js'

interface AnalysisServiceDeps {
  analysisStore: AnalysisStore
  gitService: GitService
  graphifyService: GraphifyService
  graphStore: GraphStore
  repoService?: RepoService
}

export class AnalysisService {
  private broadcaster: SSEBroadcaster | null = null
  private deps: AnalysisServiceDeps
  private activeAbortControllers: Map<string, AbortController> = new Map()

  constructor(deps: AnalysisServiceDeps)
  constructor(analysisStore: AnalysisStore, gitService: GitService, graphifyService: GraphifyService, graphStore: GraphStore)
  constructor(analysisStoreOrDeps: AnalysisStore | AnalysisServiceDeps, gitService?: GitService, graphifyService?: GraphifyService, graphStore?: GraphStore) {
    if ('analysisStore' in analysisStoreOrDeps && !(analysisStoreOrDeps instanceof AnalysisStore)) {
      this.deps = analysisStoreOrDeps
    } else {
      this.deps = {
        analysisStore: analysisStoreOrDeps as AnalysisStore,
        gitService: gitService!,
        graphifyService: graphifyService!,
        graphStore: graphStore!,
      }
    }
  }

  setBroadcaster(broadcaster: SSEBroadcaster): void {
    this.broadcaster = broadcaster
  }

  setRepoService(repoService: RepoService): void {
    this.deps.repoService = repoService
  }

  submitAnalysis(repoId: string, repoName: string, repoPath?: string, branch?: string): AnalysisTask {
    const store = this.deps.analysisStore

    // 并发控制：同一仓库已有 running 任务
    const runningTasks = store.listByRepo(repoId).filter(t => t.status === 'running' || t.status === 'pending')
    if (runningTasks.length > 0) {
      const task = store.create(repoId, repoName)
      store.update(task.id, {
        status: 'failed',
        error: `Analysis already running for repo ${repoId}`,
      })
      return store.get(task.id)!
    }

    const task = store.create(repoId, repoName)
    const abortController = new AbortController()
    this.activeAbortControllers.set(task.id, abortController)

    this.executePipeline(task.id, repoPath ?? '', branch).catch((err) => {
      this.updateTask(task.id, {
        status: 'failed',
        error: err.message ?? 'Unknown error',
      })
    })

    return task
  }

  getStatus(taskId: string): AnalysisTask | undefined {
    return this.deps.analysisStore.get(taskId)
  }

  cancelAnalysis(taskId: string): AnalysisTask | undefined {
    const abortController = this.activeAbortControllers.get(taskId)
    if (abortController) {
      abortController.abort()
      this.activeAbortControllers.delete(taskId)
    }
    return this.deps.analysisStore.cancel(taskId)
  }

  listAnalyses(repoId: string): AnalysisTask[] {
    return this.deps.analysisStore.listByRepo(repoId)
  }

  private async executePipeline(taskId: string, repoPath: string, branch?: string): Promise<void> {
    const { gitService, graphifyService, graphStore, analysisStore, repoService } = this.deps

    // Stage 1: Git preparation
    this.updateTask(taskId, { status: 'running', stage: 'scanning', step: 1, total: 5, message: '准备代码路径...' })
    const gitResult = await gitService.prepareLocalPath(repoPath, branch)

    // Stage 2: Determine incremental vs full
    const hasExistingGraph = graphStore.getNodeCount(analysisStore.get(taskId)!.repoId) > 0
    const hasGraphifyOutput = existsSync(join(gitResult.localPath, 'graphify-out'))
    const isUpdate = hasExistingGraph && hasGraphifyOutput

    // Stage 3: Run graphify
    this.updateTask(taskId, { stage: 'static_analysis', step: 2, total: 5, message: isUpdate ? '增量分析...' : '全量分析...' })

    const options: GraphifyOptions = {
      mode: 'deep',
      update: isUpdate,
      directed: false,
    }

    const abortController = this.activeAbortControllers.get(taskId)

    const result = await graphifyService.run(
      gitResult.localPath,
      options,
      (stage, step, total, message) => {
        this.updateTask(taskId, { stage, step, total, message })
        this.broadcast(taskId, 'progress', {
          status: 'running',
          stage,
          step,
          total,
          message,
          elapsed_seconds: 0,
        })
      },
      abortController?.signal,
    )

    // Stage 4: Import results
    this.updateTask(taskId, { stage: 'reporting', step: 4, total: 5, message: '导入图谱数据...' })

    const repoId = analysisStore.get(taskId)!.repoId
    importToGraphStore(result, repoId, graphStore)

    // Stage 5: Finalize
    const graphData = graphStore.getGraph(repoId)
    const nodeCount = graphData.nodes.length
    const edgeCount = graphData.edges.length

    this.updateTask(taskId, {
      status: 'completed',
      stage: 'reporting',
      step: 5,
      total: 5,
      message: '分析完成',
      graphId: repoId,
      nodeCount,
      edgeCount,
    })

    // Update repo info
    if (repoService) {
      repoService.updateRepo(repoId, {
        status: 'completed',
        graphId: repoId,
        nodeCount,
        edgeCount,
        gitCommit: gitResult.gitCommit,
        lastAnalyzedAt: new Date().toISOString(),
        taskId,
        stage: 'reporting',
        step: 5,
        total: 5,
        message: '分析完成',
      })
    }

    this.broadcast(taskId, 'done', {
      status: 'completed',
      graph_id: repoId,
      node_count: nodeCount,
      edge_count: edgeCount,
    })

    this.activeAbortControllers.delete(taskId)
  }

  private updateTask(taskId: string, patch: Partial<Omit<AnalysisTask, 'id' | 'createdAt'>>): void {
    this.deps.analysisStore.update(taskId, patch)
  }

  private broadcast(taskId: string, event: string, data: AnalysisProgressEvent): void {
    this.broadcaster?.broadcast(taskId, event, data)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd code-graph-ts && pnpm test tests/analysis-service.test.ts`
Expected: PASS

- [ ] **Step 5: Run all existing tests to check nothing broke**

Run: `cd code-graph-ts && pnpm test`
Expected: All tests PASS (e2e test will need app.ts update — that's Task 5)

- [ ] **Step 6: Commit**

```bash
cd code-graph-ts
git add src/services/analysis.service.ts tests/analysis-service.test.ts
git commit -m "feat: AnalysisService 真实流水线 — git prepare + graphify + import"
```

---

### Task 5: Update app.ts Dependency Injection

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Update app.ts to create GitService, GraphifyService and inject into AnalysisService**

Replace the current `app.ts` content with:

```typescript
// src/app.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { registerRoutes } from './routes/index.js'
import { RepoStore } from './stores/repo-store.js'
import { AnalysisStore } from './stores/analysis-store.js'
import { GraphStore } from './stores/graph-store.js'
import { RepoService } from './services/repo.service.js'
import { AnalysisService } from './services/analysis.service.js'
import { GraphService } from './services/graph.service.js'
import { GitService } from './services/git.service.js'
import { GraphifyService } from './services/graphify.service.js'
import { createSSEBroadcaster } from './utils/sse.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ErrorResponse } from './types/api.js'

const DATA_DIR = process.env.DATA_DIR ?? join(homedir(), '.code-graph')

const repoStore = new RepoStore(DATA_DIR)
const analysisStore = new AnalysisStore()
const graphStore = new GraphStore(DATA_DIR)

const repoService = new RepoService(repoStore)
const gitService = new GitService(join(DATA_DIR, 'repo-cache'))
const graphifyService = new GraphifyService()
const analysisService = new AnalysisService(analysisStore, gitService, graphifyService, graphStore)
analysisService.setRepoService(repoService)
const graphService = new GraphService(graphStore)

const broadcaster = createSSEBroadcaster()
analysisService.setBroadcaster(broadcaster)

const app = new Hono()

app.use('*', cors())
app.use('*', logger())

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  const response: ErrorResponse = {
    error: 'internal_error',
    message: err.message ?? 'Internal server error',
    status: 500,
  }
  return c.json(response, 500)
})

registerRoutes(app, { repoService, analysisService, graphService, broadcaster })

export default app
```

- [ ] **Step 2: Update routes/analyze.ts to pass branch and repoPath**

Replace `src/routes/analyze.ts` with:

```typescript
// src/routes/analyze.ts
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AnalysisService } from '../services/analysis.service.js'
import type { SSEBroadcaster } from '../utils/sse.js'

export function createAnalyzeRoutes(analysisService: AnalysisService, broadcaster: SSEBroadcaster) {
  const router = new Hono()

  router.post('/repository', async (c) => {
    const body = await c.req.json()
    if (!body.repo_path) {
      return c.json({ error: 'bad_request', message: 'repo_path is required', status: 400 }, 400)
    }
    const task = analysisService.submitAnalysis(
      body.repo_id ?? 'unknown',
      body.repo_name ?? 'unknown',
      body.repo_path,
      body.branch,
    )
    return c.json({ task_id: task.id, status: task.status })
  })

  router.get('/status/:taskId', (c) => {
    const task = analysisService.getStatus(c.req.param('taskId'))
    if (!task) {
      return c.json({ error: 'not_found', message: 'Task not found', status: 404 }, 404)
    }
    return c.json({
      task_id: task.id,
      status: task.status,
      step: task.step,
      total: task.total,
      stage: task.stage,
      message: task.message,
      log: task.log,
      elapsed_seconds: task.elapsedSeconds,
      graph_id: task.graphId,
      node_count: task.nodeCount,
      edge_count: task.edgeCount,
      error: task.error,
    })
  })

  router.get('/stream/:taskId', (c) => {
    const taskId = c.req.param('taskId')
    return streamSSE(c, async (stream) => {
      const unsubscribe = broadcaster.subscribe(taskId, (event, data) => {
        stream.writeSSE({ event, data: JSON.stringify(data) })
      })

      const task = analysisService.getStatus(taskId)
      if (task && (task.status === 'completed' || task.status === 'failed' || task.status === 'canceled')) {
        stream.writeSSE({
          event: 'done',
          data: JSON.stringify({
            status: task.status,
            graph_id: task.graphId,
            node_count: task.nodeCount,
            edge_count: task.edgeCount,
            error: task.error,
          }),
        })
        unsubscribe()
        return
      }

      stream.onAbort(() => {
        unsubscribe()
      })

      await new Promise(() => {})
    })
  })

  router.post('/cancel/:taskId', (c) => {
    const taskId = c.req.param('taskId')
    const task = analysisService.cancelAnalysis(taskId)
    if (!task) {
      return c.json({ error: 'not_found', message: 'Task not found', status: 404 }, 404)
    }
    return c.json({ task_id: task.id, status: task.status, message: 'Analysis canceled' })
  })

  return router
}
```

- [ ] **Step 3: Update e2e test — the analysis endpoint now requires repo_path and triggers real pipeline**

The e2e test needs to mock at the service level. Update the analyze test section to use a local temp dir:

```typescript
// tests/e2e.test.ts — replace the analyze section in the first test
it('完整仓库管理流程', async () => {
  // 1. 创建仓库
  const createRes = await app.request('/repos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_name: 'e2e-repo', repo_path: '/tmp/e2e' }),
  })
  expect(createRes.status).toBe(200)
  const repo = await createRes.json()
  const repoId = repo.id

  // 2. 列出仓库
  const listRes = await app.request('/repos')
  const listBody = await listRes.json()
  expect(listBody.repos.length).toBeGreaterThanOrEqual(1)

  // 3. 获取元数据
  const metaRes = await app.request('/meta/node-types')
  expect(metaRes.status).toBe(200)
  const meta = await metaRes.json()
  expect(meta.architecture_types.length).toBeGreaterThan(0)

  // 4. 提交分析 — 使用本地临时目录
  const { mkdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const tmpDir = join('/tmp', `e2e-analyze-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })

  const analyzeRes = await app.request('/analyze/repository', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_path: tmpDir, repo_id: repoId, repo_name: 'e2e-repo' }),
  })
  expect(analyzeRes.status).toBe(200)
  const task = await analyzeRes.json()
  expect(task.task_id).toBeTruthy()

  // 5. 获取图数据（可能为空，graphify 可能未安装）
  const graphRes = await app.request(`/graph/framework?repo_id=${repoId}`)
  expect(graphRes.status).toBe(200)

  // 6. Pipeline stages
  const stagesRes = await app.request('/api/pipeline/stages')
  expect(stagesRes.status).toBe(200)
  const stages = await stagesRes.json()
  expect(stages.total).toBe(5)

  // 7. 删除仓库
  const delRes = await app.request(`/repos/${repoId}`, { method: 'DELETE' })
  expect(delRes.status).toBe(200)
})
```

- [ ] **Step 4: Run all tests**

Run: `cd code-graph-ts && pnpm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd code-graph-ts
git add src/app.ts src/routes/analyze.ts tests/e2e.test.ts
git commit -m "feat: 依赖注入更新 — GitService/GraphifyService 注入 AnalysisService + 传递 branch 参数"
```

---

### Task 6: Manual Smoke Test

**Files:** None (manual verification)

- [ ] **Step 1: Start the dev server**

Run: `cd code-graph-ts && pnpm dev`

- [ ] **Step 2: Test health endpoint**

Run: `curl http://localhost:8848/health`
Expected: `{"status":"ok",...}`

- [ ] **Step 3: Test creating a repo and submitting analysis**

Run:
```bash
# 创建仓库
curl -X POST http://localhost:8848/repos \
  -H 'Content-Type: application/json' \
  -d '{"repo_name":"test-repo","repo_path":"/tmp/test-smoke-repo"}'

# 创建临时代码目录
mkdir -p /tmp/test-smoke-repo

# 提交分析
curl -X POST http://localhost:8848/analyze/repository \
  -H 'Content-Type: application/json' \
  -d '{"repo_path":"/tmp/test-smoke-repo","repo_name":"test-repo"}'
```

Expected: Analysis task created, returns `task_id`. If graphify is not installed, task should fail with a clear error message.

- [ ] **Step 4: Verify graphify not-installed error is clear**

If graphify is not installed, check the task status:
```bash
curl http://localhost:8848/analyze/status/<task_id>
```
Expected: `{"status":"failed","error":"graphify not found. Install with: pip install graphifyy",...}`

- [ ] **Step 5: Install graphify and re-test (optional)**

Run: `pip install graphifyy`

Then submit analysis again on a real repo. Verify:
- SSE stream shows progress
- Task completes with node_count > 0
- Graph data is accessible via `/graph/framework`

---

### Task 7: Final Cleanup and Verification

- [ ] **Step 1: Run full test suite**

Run: `cd code-graph-ts && pnpm test`
Expected: All tests PASS

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd code-graph-ts && pnpm build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Final commit**

```bash
cd code-graph-ts
git add -A
git commit -m "chore: 真实分析流水线完成 — 所有测试通过"
```
