export const RepoStatus = {
  IDLE: 'idle',
  ANALYZING: 'analyzing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export const AnalysisTaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  COMPLETED_PARTIAL: 'completed_partial',
  FAILED: 'failed',
  ERROR: 'error',
  CANCELED: 'canceled',
} as const

export interface RepoInfo {
  id: string
  name: string
  path?: string
  branch?: string
  languages: string[]
  sourceMode: string
  createdAt: string
  updatedAt: string
  graphId?: string
  nodeCount: number
  edgeCount: number
  status: string
  taskId?: string
  stage?: string
  step?: number
  total?: number
  message?: string
  error?: string
  gitCommit?: string
  lastAnalyzedAt?: string
}

export interface AnalysisTask {
  id: string
  repoId: string
  repoName: string
  status: string
  stage?: string
  step?: number
  total?: number
  message?: string
  log?: string
  elapsedSeconds?: number
  graphId?: string
  nodeCount?: number
  edgeCount?: number
  error?: string
  createdAt: string
  updatedAt: string
}
