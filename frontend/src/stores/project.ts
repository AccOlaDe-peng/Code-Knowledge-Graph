import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Project } from '../types/project'
import { ProjectStatus } from '../types/project'

export { ProjectStatus, type Project }

export const useProjectStore = defineStore('project', () => {
  const projects = ref<Project[]>([])
  const currentProject = ref<Project | null>(null)
  const loading = ref(false)

  const setProjects = (projectList: Project[]) => {
    projects.value = projectList
  }

  const setCurrentProject = (project: Project) => {
    currentProject.value = project
  }

  const addProject = (project: Project) => {
    projects.value.push(project)
  }

  const updateProject = (projectId: string, updates: Partial<Project>) => {
    const index = projects.value.findIndex(p => p.id === projectId)
    if (index !== -1) {
      projects.value[index] = { ...projects.value[index], ...updates }
    }
    if (currentProject.value?.id === projectId) {
      currentProject.value = { ...currentProject.value, ...updates }
    }
  }

  const deleteProject = (projectId: string) => {
    projects.value = projects.value.filter(p => p.id !== projectId)
    if (currentProject.value?.id === projectId) {
      currentProject.value = null
    }
  }

  return {
    projects,
    currentProject,
    loading,
    setProjects,
    setCurrentProject,
    addProject,
    updateProject,
    deleteProject
  }
})
