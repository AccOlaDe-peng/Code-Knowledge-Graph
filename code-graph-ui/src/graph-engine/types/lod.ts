// ─── LOD Level ────────────────────────────────────────────────────────────────
// Ordered from coarsest (Repository) to finest (Function).
// Each level is a superset of the one above it.

export const LODLevel = {
  /** Only the single Repository node. Useful for initial paint / very low zoom. */
  Repository: 'repository',
  /** Repository + Module nodes. Default initial load. */
  Module:     'module',
  /** + File nodes. */
  File:       'file',
  /** + Class and Component nodes. */
  Class:      'class',
  /** All node types, including Function, API, Service, etc. */
  Function:   'function',
} as const

export type LODLevelValue = (typeof LODLevel)[keyof typeof LODLevel]

// ─── LOD Rank ─────────────────────────────────────────────────────────────────
// Numeric rank for programmatic comparison: lower = coarser / higher in tree.

export const LOD_RANK: Record<LODLevelValue, number> = {
  repository: 0,
  module:     1,
  file:       2,
  class:      3,
  function:   4,
}

// ─── Visible Node Types per LOD ───────────────────────────────────────────────
// Each level includes all types from levels above it.
// "Static" types only — AI-generated types (Layer, Flow, etc.) are always
// shown when present, regardless of LOD.

export const LOD_VISIBLE_TYPES: Record<LODLevelValue, readonly string[]> = {
  repository: [
    'Repository',
  ],
  module: [
    'Repository', 'Module',
  ],
  file: [
    'Repository', 'Module', 'File',
  ],
  class: [
    'Repository', 'Module', 'File', 'Class', 'Component',
  ],
  function: [
    'Repository', 'Module', 'File', 'Class', 'Component',
    'Function', 'API', 'Service', 'Database',
    'Event', 'Topic', 'Pipeline', 'Cluster', 'DataObject', 'Table',
  ],
}

// ─── LOD Auto-switch Rules ────────────────────────────────────────────────────
// When auto-LOD is enabled, zoom changes drive automatic level transitions.

export type LODAutoRule = {
  /** Inclusive lower bound of zoom range. */
  minZoom: number
  /** Exclusive upper bound of zoom range (Infinity for the last rule). */
  maxZoom: number
  level:   LODLevelValue
}

/**
 * Default zoom → LOD mapping.
 * Rules are evaluated in order; first match wins.
 */
export const DEFAULT_LOD_AUTO_RULES: readonly LODAutoRule[] = [
  { minZoom: 0,    maxZoom: 0.15,     level: 'module'   },
  { minZoom: 0.15, maxZoom: 0.35,     level: 'file'     },
  { minZoom: 0.35, maxZoom: 0.75,     level: 'class'    },
  { minZoom: 0.75, maxZoom: Infinity, level: 'function' },
]

// ─── Graph LOD State ──────────────────────────────────────────────────────────
// Runtime state managed by lodSlice inside GraphEngineStore.

export type GraphLODState = {
  /** Currently active LOD level. */
  currentLevel: LODLevelValue

  /**
   * When true, LodController auto-switches level based on zoom changes.
   * When false, currentLevel only changes via setLODLevel().
   */
  autoEnabled: boolean

  /**
   * True when the user has explicitly called setLODLevel().
   * Prevents autoEnabled from overriding the manual choice until
   * the user explicitly re-enables auto mode.
   */
  manualOverride: boolean

  /**
   * Derived from currentLevel via LOD_VISIBLE_TYPES.
   * Cached here so selectors do not need to re-derive on every render.
   */
  visibleTypes: ReadonlyArray<string>
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Resolve which LOD level should be active for a given zoom value. */
export function resolveLODForZoom(
  zoom: number,
  rules: readonly LODAutoRule[] = DEFAULT_LOD_AUTO_RULES,
): LODLevelValue {
  for (const rule of rules) {
    if (zoom >= rule.minZoom && zoom < rule.maxZoom) return rule.level
  }
  return 'function'
}

/** Returns true if `candidate` is a coarser (higher) level than `current`. */
export function isCoarserThan(candidate: LODLevelValue, current: LODLevelValue): boolean {
  return LOD_RANK[candidate] < LOD_RANK[current]
}

/** Returns true if `candidate` is a finer (deeper) level than `current`. */
export function isFineThan(candidate: LODLevelValue, current: LODLevelValue): boolean {
  return LOD_RANK[candidate] > LOD_RANK[current]
}

/** Build the initial LOD state for a new engine session. */
export function createDefaultLODState(): GraphLODState {
  return {
    currentLevel:   'module',
    autoEnabled:    true,
    manualOverride: false,
    visibleTypes:   LOD_VISIBLE_TYPES['module'],
  }
}
