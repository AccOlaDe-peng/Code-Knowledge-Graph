import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  build: 'graph_building',
  cluster: 'semantic_analysis',
  report: 'reporting',
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PIPELINE_SCRIPT = process.env.GRAPHIFY_PIPELINE_SCRIPT || join(__dirname, '..', 'scripts', 'graphify_pipeline.py')

function findPython(): string {
  if (process.env.GRAPHIFY_PYTHON) return process.env.GRAPHIFY_PYTHON

  const candidates = ['python3', 'python3.12', 'python3.11', 'python3.10', 'python']
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ['-c', 'import graphify'], { stdio: 'pipe', timeout: 5000 })
      return cmd
    } catch {
      continue
    }
  }
  return 'python3'
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
    const pythonBin = findPython()
    const args = this.buildArgs(localPath, options)
    const taskId = `${localPath}-${Date.now()}`

    return new Promise<GraphifyResult>((resolve, reject) => {
      let stderr = ''

      const proc = spawn(pythonBin, args, {
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
          const nodes = graphData.nodes ?? []
          const edges = graphData.edges ?? graphData.links ?? []
          const nodeCount = nodes.length
          const edgeCount = edges.length

          resolve({ graphJsonPath, reportPath, htmlPath, nodeCount, edgeCount })
        } catch (e) {
          reject(new Error(`Failed to parse graph.json: ${(e as Error).message}`))
        }
      })

      proc.on('error', (err) => {
        cleanup()
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('python3 not found. Install Python 3 to run graphify'))
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
    const args = [PIPELINE_SCRIPT, localPath]
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
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (obj.step !== undefined && obj.total !== undefined && obj.stage !== undefined) {
          const stage = this.mapStage(obj.stage)
          onProgress(stage, obj.step, obj.total, obj.message ?? '')
        }
      } catch {
        // Not JSON progress line, skip
      }
    }
  }
}
