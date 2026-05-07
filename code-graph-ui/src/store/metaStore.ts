import { create } from 'zustand'

const FALLBACK_ARCHITECTURE_TYPES = new Set([
  'Module', 'Layer', 'Service', 'BoundedContext', 'Domain',
  'Component', 'APIEndpoint', 'ExternalAPI', 'DataSource',
  'Database', 'API', 'DataSink',
])

const FALLBACK_STRUCTURAL_EDGE_TYPES = [
  'contains', 'depends_on', 'imports', 'extends',
  'uses', 'implements', 'overrides', 'belongs_to',
]

interface MetaState {
  architectureTypes:    Set<string>
  structuralEdgeTypes:  string[]
  callEdgeTypes:        string[]
  version:              string
  fetchNodeTypes:       () => Promise<void>
}

export const useMetaStore = create<MetaState>((set, get) => ({
  architectureTypes:   FALLBACK_ARCHITECTURE_TYPES,
  structuralEdgeTypes: FALLBACK_STRUCTURAL_EDGE_TYPES,
  callEdgeTypes:       ['calls'],
  version:             '0',

  fetchNodeTypes: async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const baseUrl = (import.meta as any).env?.VITE_API_BASE_URL ?? ''
      const res = await fetch(`${baseUrl}/meta/node-types`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.version !== get().version) {
        set({
          architectureTypes:   new Set<string>(data.architecture_types ?? []),
          structuralEdgeTypes: data.structural_edge_types ?? FALLBACK_STRUCTURAL_EDGE_TYPES,
          callEdgeTypes:       data.call_edge_types ?? ['calls'],
          version:             data.version ?? '1',
        })
      }
    } catch (err) {
      console.warn('[MetaStore] fetchNodeTypes failed, using fallback constants:', err)
    }
  },
}))
