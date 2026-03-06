import api from './index'

export interface GraphNode {
  id: string
  label: string
  type: 'file' | 'function' | 'class'
}

export interface GraphEdge {
  source: string
  target: string
  type: 'imports' | 'contains' | 'calls'
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export const graphApi = {
  getProjectDependencies: (projectId: string) => {
    return api.get<any>(`/graph/projects/${projectId}`)
  },

  getFileReferences: (projectId: string, filePath: string) => {
    return api.get<any>(`/graph/projects/${projectId}/files/${encodeURIComponent(filePath)}/references`)
  },

  getCircularDependencies: (projectId: string) => {
    return api.get<any>(`/graph/projects/${projectId}/circular-dependencies`)
  },

  getFunctionCallChain: (projectId: string, functionName: string) => {
    return api.get<any>(`/graph/projects/${projectId}/functions/${functionName}/call-chain`)
  },

  getDataLineage: (projectId: string) => {
    return api.get<{
      nodes: Array<{ id: string; label: string; dataRole: string }>
      edges: Array<{ id: string; source: string; target: string }>
    }>(`/graph/projects/${projectId}/data-lineage`)
  },

  getBusinessFlow: (projectId: string) => {
    return api.get<{
      nodes: Array<{ id: string; label: string; layer: string; endpoints: Array<{ method: string; path: string; handler: string }> }>
      edges: Array<{ id: string; source: string; target: string }>
    }>(`/graph/projects/${projectId}/business-flow`)
  },

  getSemanticGraph: (projectId: string) => {
    return api.get<{
      hasAiData: boolean
      domains: Array<{ name: string; color: string; fileCount: number }>
      nodes: Array<{ id: string; label: string; nodeType: 'domain' | 'file'; color: string }>
      edges: Array<{ id: string; source: string; target: string; edgeType: string }>
    }>(`/graph/projects/${projectId}/semantic-graph`)
  }
}
