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
    return api.get<GraphData>(`/graph/${projectId}/dependencies`)
  },

  getFileReferences: (projectId: string, filePath: string) => {
    return api.get<GraphData>(`/graph/${projectId}/file/${encodeURIComponent(filePath)}/references`)
  },

  getCircularDependencies: (projectId: string) => {
    return api.get<any>(`/graph/${projectId}/circular-dependencies`)
  },

  getFunctionCallChain: (projectId: string, functionName: string) => {
    return api.get<any>(`/graph/${projectId}/function/${functionName}/call-chain`)
  }
}
