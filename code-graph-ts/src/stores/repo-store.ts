import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RepoInfo } from '../types/repo.js'

export interface CreateRepoInput {
  name: string
  path?: string
  branch?: string
  languages?: string[]
  sourceMode?: string
}

const DATA_FILE = 'repos.json'

export class RepoStore {
  private repos: Map<string, RepoInfo> = new Map()
  private dataPath: string

  constructor(baseDir: string) {
    const dir = join(baseDir, 'repos')
    mkdirSync(dir, { recursive: true })
    this.dataPath = join(dir, DATA_FILE)
    this.load()
  }

  list(): RepoInfo[] {
    return Array.from(this.repos.values())
  }

  get(id: string): RepoInfo | undefined {
    return this.repos.get(id)
  }

  create(input: CreateRepoInput): RepoInfo {
    const now = new Date().toISOString()
    const repo: RepoInfo = {
      id: randomUUID(),
      name: input.name,
      path: input.path,
      branch: input.branch,
      languages: input.languages ?? [],
      sourceMode: input.sourceMode ?? 'local',
      createdAt: now,
      updatedAt: now,
      graphId: undefined,
      nodeCount: 0,
      edgeCount: 0,
      status: 'idle',
    }
    this.repos.set(repo.id, repo)
    this.save()
    return repo
  }

  update(id: string, patch: Partial<Omit<RepoInfo, 'id' | 'createdAt'>>): RepoInfo | undefined {
    const repo = this.repos.get(id)
    if (!repo) return undefined
    Object.assign(repo, patch, { updatedAt: new Date().toISOString() })
    this.repos.set(id, repo)
    this.save()
    return repo
  }

  delete(id: string): void {
    this.repos.delete(id)
    this.save()
  }

  private load(): void {
    if (!existsSync(this.dataPath)) return
    const raw = readFileSync(this.dataPath, 'utf-8')
    const arr: RepoInfo[] = JSON.parse(raw)
    for (const repo of arr) {
      this.repos.set(repo.id, repo)
    }
  }

  private save(): void {
    const arr = Array.from(this.repos.values())
    writeFileSync(this.dataPath, JSON.stringify(arr, null, 2), 'utf-8')
  }
}
