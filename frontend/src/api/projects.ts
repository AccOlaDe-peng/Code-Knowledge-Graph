import api from './index'
import type { Project } from '../types/project'

export interface CreateProjectDto {
  name: string
  description?: string
  repositoryUrl: string
  provider: 'github' | 'gitlab' | 'zip'
}

export interface UpdateProjectDto {
  name?: string
  description?: string
}

export const projectsApi = {
  getProjects: () => {
    return api.get<Project[]>('/projects')
  },

  getProject: (id: string) => {
    return api.get<Project>(`/projects/${id}`)
  },

  createProject: (data: CreateProjectDto) => {
    return api.post<Project>('/projects', data)
  },

  updateProject: (id: string, data: UpdateProjectDto) => {
    return api.patch<Project>(`/projects/${id}`, data)
  },

  deleteProject: (id: string) => {
    return api.delete(`/projects/${id}`)
  },

  analyzeProject: (id: string) => {
    return api.post(`/projects/${id}/analyze`)
  }
}
