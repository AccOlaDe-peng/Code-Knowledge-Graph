export enum ProjectStatus {
  PENDING = 'pending',
  ANALYZING = 'analyzing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface Project {
  id: string
  name: string
  description?: string
  status: ProjectStatus
  createdAt: string
  updatedAt: string
}
