import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { AnalysisTask } from '../types/repo.js'

export class AnalysisStore {
  private tasks: Map<string, AnalysisTask> = new Map()
  private emitter = new EventEmitter()

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.emitter.on(event, listener)
  }

  create(repoId: string, repoName: string): AnalysisTask {
    const now = new Date().toISOString()
    const task: AnalysisTask = {
      id: randomUUID(),
      repoId,
      repoName,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(task.id, task)
    this.emitter.emit('task:created', task)
    return task
  }

  get(id: string): AnalysisTask | undefined {
    return this.tasks.get(id)
  }

  list(): AnalysisTask[] {
    return Array.from(this.tasks.values())
  }

  listByRepo(repoId: string): AnalysisTask[] {
    return this.list().filter(t => t.repoId === repoId)
  }

  update(id: string, patch: Partial<Omit<AnalysisTask, 'id' | 'createdAt'>>): AnalysisTask | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined
    Object.assign(task, patch, { updatedAt: new Date().toISOString() })
    this.tasks.set(id, task)
    this.emitter.emit('task:updated', task)
    return task
  }

  cancel(id: string): AnalysisTask | undefined {
    return this.update(id, { status: 'canceled', message: 'Analysis canceled by user' })
  }
}
