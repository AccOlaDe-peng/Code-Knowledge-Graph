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
