# Graph Node Color System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend frontend color system to support all 27 backend node types and 22 edge types with HSL-based automatic color generation.

**Architecture:** Create modular color generation system with `colorGenerator.ts` for HSL algorithms, `nodeTypeColors.ts` and `edgeTypeColors.ts` for type mappings. Update `theme/index.ts` to export new system while maintaining backward compatibility. Dynamic filter generation in Architecture page.

**Tech Stack:** TypeScript, React, HSL color algorithms

**Spec Document:** `docs/superpowers/specs/2026-03-15-graph-node-color-system-design.md`

---

## File Structure

```
code-graph-ui/src/
├── theme/
│   ├── colorGenerator.ts      # NEW: HSL color generation algorithms
│   ├── nodeTypeColors.ts      # NEW: 27 node type color definitions
│   ├── edgeTypeColors.ts      # NEW: 22 edge type color definitions
│   └── index.ts               # MODIFY: Export new modules
├── types/
│   └── graph.ts               # MODIFY: Expand NodeType and EdgeType constants
└── pages/
    └── Architecture/
        └── index.tsx           # MODIFY: Dynamic filter generation
```

---

## Chunk 1: Color Generator Module

### Task 1: Create Color Generator Module

**Files:**
- Create: `code-graph-ui/src/theme/colorGenerator.ts`

- [ ] **Step 1: Write the color generator module**

```typescript
// code-graph-ui/src/theme/colorGenerator.ts

/**
 * HSL Color Generator for Graph Node/Edge Types
 *
 * Generates color schemes using HSL color space for consistent,
 * visually distinct colors across 27 node types and 22 edge types.
 */

// ─── Base Hue Definitions ─────────────────────────────────────────────────────

/**
 * Base hue values matching the existing Mission Control Dark theme.
 * Each hue represents a semantic category of code elements.
 */
export const BASE_HUES = {
  cyan: 190,    // #00d4ff - Code structure (Repository, Module, File)
  green: 150,   // #00f084 - Service layer (Service, API, Component)
  purple: 270,  // #b08eff - Data/Class layer (Class, Database, Table)
  amber: 40,    // #ffc145 - Event/Flow layer (Event, Topic, Flow)
  red: 350,     // #ff4568 - External/Infrastructure (ExternalAPI, Cluster)
  blue: 220,    // #44aaff - Architecture layer (Layer, Domain, BoundedContext)
} as const

export type HueName = keyof typeof BASE_HUES

// ─── Color Scheme Interfaces ──────────────────────────────────────────────────

/**
 * Complete color scheme for a node type.
 * Provides all color variants needed for different UI states.
 */
export interface NodeTypeColorScheme {
  /** Primary/accent color for the node */
  primary: string
  /** Background color for node container */
  bg: string
  /** Border color (typically matches primary) */
  border: string
  /** Text/label color */
  text: string
  /** Dimmed color for selected/hover state backgrounds */
  dim: string
}

// ─── Color Conversion Utilities ────────────────────────────────────────────────

/**
 * Convert HSL color values to hexadecimal string.
 *
 * @param h - Hue (0-360)
 * @param s - Saturation (0-100)
 * @param l - Lightness (0-100)
 * @returns Hex color string (e.g., "#00d4ff")
 */
export function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100

  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }

  return `#${f(0)}${f(8)}${f(4)}`
}

// ─── Color Generation Functions ────────────────────────────────────────────────

/**
 * Generate a complete color scheme for a node type.
 *
 * Creates 5 color variants (primary, bg, border, text, dim) from a base hue,
 * with optional variant number for generating distinct colors within the same hue family.
 *
 * @param baseHue - Base hue in degrees (0-360) or hue name from BASE_HUES
 * @param variant - Variant number (0-6) for lightness differentiation within same hue family
 * @returns Complete NodeTypeColorScheme
 *
 * @example
 * ```ts
 * // Generate cyan color for Repository (variant 0)
 * const repoColors = generateNodeColor('cyan', 0)
 *
 * // Generate purple color for DataSink (variant 5)
 * const sinkColors = generateNodeColor('purple', 5)
 * ```
 */
export function generateNodeColor(
  baseHue: number | HueName,
  variant: number = 0
): NodeTypeColorScheme {
  const hue = typeof baseHue === 'string' ? BASE_HUES[baseHue] : baseHue

  // Each variant shifts lightness by 3% for visual distinction
  const lightnessShift = variant * 3

  return {
    primary: hslToHex(hue, 85, 55 + lightnessShift),
    bg:      hslToHex(hue, 30, 8 + lightnessShift * 0.5),
    border:  hslToHex(hue, 85, 55 + lightnessShift),
    text:    hslToHex(hue, 90, 70 + lightnessShift),
    dim:     hslToHex(hue, 30, 12 + lightnessShift * 0.3),
  }
}

/**
 * Generate a single color for an edge type.
 *
 * @param baseHue - Base hue in degrees (0-360) or hue name from BASE_HUES
 * @returns Hex color string
 */
export function generateEdgeColor(baseHue: number | HueName): string {
  const hue = typeof baseHue === 'string' ? BASE_HUES[baseHue] : baseHue
  return hslToHex(hue, 80, 65)
}

/**
 * Generate a color for an unknown type based on its name hash.
 * Ensures consistent colors for the same type name across sessions.
 *
 * @param typeName - The type name to hash
 * @returns Complete NodeTypeColorScheme
 */
export function generateColorFromTypeName(typeName: string): NodeTypeColorScheme {
  const hash = hashString(typeName)
  const hue = (hash % 36) * 10  // Map to 0-350 range in 10-degree steps
  return generateNodeColor(hue, 0)
}

/**
 * Simple string hash function for deterministic color generation.
 * Uses djb2 algorithm variant.
 */
function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
  }
  return Math.abs(hash >>> 0)  // Ensure unsigned 32-bit integer
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd code-graph-ui && npx tsc --noEmit src/theme/colorGenerator.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd "C:/code/Code-Knowledge-Graph"
git add code-graph-ui/src/theme/colorGenerator.ts
git commit -m "$(cat <<'EOF'
feat(ui): add HSL color generator module for graph types

- Add BASE_HUES constant with 6 semantic color families
- Add NodeTypeColorScheme interface for complete node color schemes
- Add hslToHex() for HSL to hex conversion
- Add generateNodeColor() for node type color generation with variants
- Add generateEdgeColor() for edge type color generation
- Add generateColorFromTypeName() for unknown type fallback

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 2: Node Type Colors Module

### Task 2: Create Node Type Colors Module

**Files:**
- Create: `code-graph-ui/src/theme/nodeTypeColors.ts`

- [ ] **Step 1: Write the node type colors module**

```typescript
// code-graph-ui/src/theme/nodeTypeColors.ts

import {
  generateNodeColor,
  generateColorFromTypeName,
  type NodeTypeColorScheme,
} from './colorGenerator'

// ─── Node Type Color Definitions ───────────────────────────────────────────────

/**
 * Complete color mapping for 27 backend node types + 1 legacy frontend type.
 *
 * Backend types (27): Repository, Module, File, Class, Function, Component,
 * Service, API, DataObject, Table, Event, Topic, Pipeline, Cluster, Database,
 * Layer, Flow, BusinessFlow, Domain, BoundedContext, DomainEntity,
 * APIEndpoint, EventHandler, DataSource, DataSink, ExternalAPI, MessageQueue
 *
 * Legacy frontend types (1): Infrastructure (kept for backward compatibility)
 *
 * Color grouping strategy:
 * - Cyan (190°): Code structure - Repository, Module, File
 * - Green (150°): Service layer - Service, API, APIEndpoint, Component
 * - Purple (270°): Data/Class - Class, Database, Table, DataObject, DataSource, DataSink
 * - Amber (40°): Event/Flow - Event, Topic, EventHandler, MessageQueue, Flow, BusinessFlow, Pipeline
 * - Blue (220°): Architecture - Layer, Domain, BoundedContext, DomainEntity
 * - Red (350°): External/Infrastructure - ExternalAPI, Cluster, Infrastructure
 * - Custom (200°): Function - teal-gray
 */
export const NODE_TYPE_COLORS: Record<string, NodeTypeColorScheme> = {
  // ── Code Structure Layer (Cyan) ───────────────────────────────────────
  Repository:   generateNodeColor('cyan', 0),
  Module:       generateNodeColor('cyan', 1),
  File:         generateNodeColor('cyan', 2),

  // ── Service Layer (Green) ─────────────────────────────────────────────
  Service:      generateNodeColor('green', 0),
  API:          generateNodeColor('green', 1),
  APIEndpoint:  generateNodeColor('green', 2),
  Component:    generateNodeColor('green', 3),

  // ── Data/Class Layer (Purple) ──────────────────────────────────────────
  Class:        generateNodeColor('purple', 0),
  Database:     generateNodeColor('purple', 1),
  Table:        generateNodeColor('purple', 2),
  DataObject:   generateNodeColor('purple', 3),
  DataSource:   generateNodeColor('purple', 4),
  DataSink:     generateNodeColor('purple', 5),

  // ── Event/Flow Layer (Amber) ───────────────────────────────────────────
  Event:        generateNodeColor('amber', 0),
  Topic:        generateNodeColor('amber', 1),
  EventHandler: generateNodeColor('amber', 2),
  MessageQueue: generateNodeColor('amber', 3),
  Flow:         generateNodeColor('amber', 4),
  BusinessFlow: generateNodeColor('amber', 5),
  Pipeline:     generateNodeColor('amber', 6),

  // ── Architecture Layer (Blue) ───────────────────────────────────────────
  Layer:            generateNodeColor('blue', 0),
  Domain:           generateNodeColor('blue', 1),
  BoundedContext:   generateNodeColor('blue', 2),
  DomainEntity:     generateNodeColor('blue', 3),

  // ── External/Infrastructure (Red) ───────────────────────────────────────
  ExternalAPI:      generateNodeColor('red', 0),
  Cluster:          generateNodeColor('red', 1),
  Infrastructure:   generateNodeColor('red', 2),

  // ── Code Elements (Custom) ─────────────────────────────────────────────
  Function:     generateNodeColor(200, 0),  // Teal-gray for functions
}

// ─── Node Type Groups for Filter UI ───────────────────────────────────────────

/**
 * Node type groupings for organized filter display in UI.
 * Each group contains related types that should appear together.
 */
export const NODE_TYPE_GROUPS: Record<string, string[]> = {
  '代码结构': ['Repository', 'Module', 'File'],
  '代码元素': ['Class', 'Function', 'Component'],
  '服务层': ['Service', 'API', 'APIEndpoint'],
  '数据层': ['Database', 'Table', 'DataObject', 'DataSource', 'DataSink'],
  '事件层': ['Event', 'Topic', 'EventHandler', 'MessageQueue'],
  '流程层': ['Flow', 'BusinessFlow', 'Pipeline'],
  '架构层': ['Layer', 'Domain', 'BoundedContext', 'DomainEntity'],
  '外部': ['ExternalAPI', 'Cluster', 'Infrastructure'],
}

// ─── Color Retrieval Functions ────────────────────────────────────────────────

/**
 * Get color scheme for a node type.
 * Falls back to hash-generated color for unknown types.
 *
 * @param type - Node type name (case-insensitive)
 * @returns NodeTypeColorScheme with all color variants
 *
 * @example
 * ```ts
 * const colors = getNodeTypeColor('Service')
 * console.log(colors.primary) // "#00f084"
 *
 * // Unknown type gets auto-generated color
 * const unknownColors = getNodeTypeColor('CustomType')
 * ```
 */
export function getNodeTypeColor(type: string): NodeTypeColorScheme {
  // Try direct match first
  if (NODE_TYPE_COLORS[type]) {
    return NODE_TYPE_COLORS[type]
  }

  // Try case-insensitive match
  const normalizedType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()
  if (NODE_TYPE_COLORS[normalizedType]) {
    return NODE_TYPE_COLORS[normalizedType]
  }

  // Fallback: generate color from type name hash
  return generateColorFromTypeName(type)
}

/**
 * Check if a node type has an explicit color definition.
 * Useful for distinguishing known vs unknown types.
 */
export function hasNodeTypeColor(type: string): boolean {
  return type in NODE_TYPE_COLORS ||
         (type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()) in NODE_TYPE_COLORS
}

/**
 * Get all node type names that have explicit color definitions.
 */
export function getKnownNodeTypes(): string[] {
  return Object.keys(NODE_TYPE_COLORS)
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd code-graph-ui && npx tsc --noEmit src/theme/nodeTypeColors.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd "C:/code/Code-Knowledge-Graph"
git add code-graph-ui/src/theme/nodeTypeColors.ts
git commit -m "$(cat <<'EOF'
feat(ui): add node type colors for all 27 backend types

- Define NODE_TYPE_COLORS with 27 node type color schemes
- Add NODE_TYPE_GROUPS for organized filter UI display
- Add getNodeTypeColor() with case-insensitive fallback
- Add hasNodeTypeColor() and getKnownNodeTypes() utilities
- Colors organized by semantic groups (code, service, data, event, architecture)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 3: Edge Type Colors Module

### Task 3: Create Edge Type Colors Module

**Files:**
- Create: `code-graph-ui/src/theme/edgeTypeColors.ts`

- [ ] **Step 1: Write the edge type colors module**

```typescript
// code-graph-ui/src/theme/edgeTypeColors.ts

import { generateEdgeColor } from './colorGenerator'

// ─── Edge Type Color Definitions ───────────────────────────────────────────────

/**
 * Color mapping for all 22 backend edge types.
 *
 * Color grouping strategy:
 * - Green: Call relationships - calls, async_calls, handles
 * - Cyan: Dependency relationships - depends_on, imports, uses
 * - Purple: Data relationships - reads, writes, transforms
 * - Amber: Event relationships - produces, consumes, publishes, subscribes
 * - Blue: Architecture relationships - belongs_to, flow_step, implements
 * - Gray: Containment relationships - contains, defines, part_of
 * - Custom: Special relationships - deployed_on, routes_to, triggers
 */
export const EDGE_TYPE_COLORS: Record<string, string> = {
  // ── Call Relationships (Green) ─────────────────────────────────────────
  calls:       generateEdgeColor('green'),
  async_calls: generateEdgeColor('green'),
  handles:     generateEdgeColor('green'),

  // ── Dependency Relationships (Cyan) ─────────────────────────────────────
  depends_on:  generateEdgeColor('cyan'),
  imports:     generateEdgeColor('cyan'),
  uses:        generateEdgeColor('cyan'),

  // ── Data Relationships (Purple) ─────────────────────────────────────────
  reads:       generateEdgeColor('purple'),
  writes:      generateEdgeColor('purple'),
  transforms:  generateEdgeColor('purple'),

  // ── Event Relationships (Amber) ─────────────────────────────────────────
  produces:    generateEdgeColor('amber'),
  consumes:    generateEdgeColor('amber'),
  publishes:   generateEdgeColor('amber'),
  subscribes:  generateEdgeColor('amber'),

  // ── Architecture Relationships (Blue) ────────────────────────────────────
  belongs_to:  generateEdgeColor('blue'),
  flow_step:   generateEdgeColor('blue'),
  implements:  generateEdgeColor('blue'),

  // ── Containment Relationships (Gray) ─────────────────────────────────────
  contains:    '#6b7a9d',
  defines:     '#6b7a9d',
  part_of:     '#6b7a9d',

  // ── Special Relationships ────────────────────────────────────────────────
  deployed_on: '#9d7dff',  // Purple-pink for deployment
  routes_to:   '#44aaff',  // Light blue for routing
  triggers:    '#ffc145',  // Amber for triggers
}

/**
 * Default color for unknown edge types.
 */
export const DEFAULT_EDGE_COLOR = '#6b7a9d'

// ─── Edge Type Groups for Legend UI ───────────────────────────────────────────

/**
 * Edge type groupings for legend display.
 */
export const EDGE_TYPE_GROUPS: Record<string, string[]> = {
  '调用': ['calls', 'async_calls', 'handles'],
  '依赖': ['depends_on', 'imports', 'uses'],
  '数据': ['reads', 'writes', 'transforms'],
  '事件': ['produces', 'consumes', 'publishes', 'subscribes'],
  '架构': ['belongs_to', 'flow_step', 'implements'],
  '包含': ['contains', 'defines', 'part_of'],
  '其他': ['deployed_on', 'routes_to', 'triggers'],
}

// ─── Color Retrieval Functions ────────────────────────────────────────────────

/**
 * Get color for an edge type.
 * Falls back to default gray for unknown types.
 *
 * @param type - Edge type name
 * @returns Hex color string
 */
export function getEdgeTypeColor(type: string): string {
  return EDGE_TYPE_COLORS[type] ?? DEFAULT_EDGE_COLOR
}

/**
 * Check if an edge type has an explicit color definition.
 */
export function hasEdgeTypeColor(type: string): boolean {
  return type in EDGE_TYPE_COLORS
}

/**
 * Get all edge type names that have explicit color definitions.
 */
export function getKnownEdgeTypes(): string[] {
  return Object.keys(EDGE_TYPE_COLORS)
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd code-graph-ui && npx tsc --noEmit src/theme/edgeTypeColors.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd "C:/code/Code-Knowledge-Graph"
git add code-graph-ui/src/theme/edgeTypeColors.ts
git commit -m "$(cat <<'EOF'
feat(ui): add edge type colors for all 22 backend types

- Define EDGE_TYPE_COLORS with 22 edge type colors
- Add EDGE_TYPE_GROUPS for legend UI display
- Add getEdgeTypeColor() with fallback to default gray
- Add hasEdgeTypeColor() and getKnownEdgeTypes() utilities
- Colors organized by semantic groups (call, dependency, data, event, architecture)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 4: Update Theme Index

### Task 4: Update Theme Index to Export New Modules

**Files:**
- Modify: `code-graph-ui/src/theme/index.ts`

- [ ] **Step 1: Read current theme/index.ts content**

Run: `head -120 code-graph-ui/src/theme/index.ts`
Note: Need to preserve existing content and add new exports at the end

- [ ] **Step 2: Add new exports to theme/index.ts**

Add the following to the END of `code-graph-ui/src/theme/index.ts` (before the last closing lines if any, or append):

```typescript
// ─── New Color System (2026-03-15) ─────────────────────────────────────────────

// Re-export new color system modules
export {
  BASE_HUES,
  hslToHex,
  generateNodeColor,
  generateEdgeColor,
  generateColorFromTypeName,
} from './colorGenerator'
export type { NodeTypeColorScheme, HueName } from './colorGenerator'

export {
  NODE_TYPE_COLORS,
  NODE_TYPE_GROUPS,
  getNodeTypeColor,
  hasNodeTypeColor,
  getKnownNodeTypes,
} from './nodeTypeColors'

export {
  EDGE_TYPE_COLORS,
  EDGE_TYPE_GROUPS,
  DEFAULT_EDGE_COLOR,
  getEdgeTypeColor,
  hasEdgeTypeColor,
  getKnownEdgeTypes,
} from './edgeTypeColors'

// ─── Backward Compatibility Aliases ────────────────────────────────────────────

// Alias for backward compatibility with existing code
export { NODE_TYPE_COLORS as NodeTypeColors } from './nodeTypeColors'
export { EDGE_TYPE_COLORS as EdgeTypeColors } from './edgeTypeColors'
```

- [ ] **Step 3: Verify the existing getNodeTypeColor function**

The existing `getNodeTypeColor` function at line 96-104 should be REMOVED since we now import it from `nodeTypeColors.ts`. Check if it needs removal:

Run: `grep -n "export function getNodeTypeColor" code-graph-ui/src/theme/index.ts`

If found, the old function definition should be removed to avoid duplicate exports.

- [ ] **Step 4: Remove old duplicate function definitions**

If the old `getNodeTypeColor` and `NodeTypeColors` exist in index.ts, they need to be removed. The new exports from the modules will replace them.

Edit `code-graph-ui/src/theme/index.ts`:
- Remove lines 10-104 (old NodeTypeColors and getNodeTypeColor)
- Keep EdgeTypeColors and getEdgeTypeColor (they will be overwritten by new imports)

Actually, since we're importing from the new modules, we should:
1. Keep the OLD NodeTypeColors constant for reference (lines 10-89)
2. Remove the OLD getNodeTypeColor function (lines 96-104)
3. Remove the OLD EdgeTypeColors constant (lines 108-119)
4. Remove the OLD getEdgeTypeColor function (lines 126-128)
5. Add the new exports at the end

Let me provide the exact edit:

Remove lines 96-128 (the old function definitions) and replace with imports.

- [ ] **Step 5: Verify TypeScript compilation**

Run: `cd code-graph-ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd "C:/code/Code-Knowledge-Graph"
git add code-graph-ui/src/theme/index.ts
git commit -m "$(cat <<'EOF'
refactor(ui): update theme index to export new color system

- Export all new color modules (colorGenerator, nodeTypeColors, edgeTypeColors)
- Add backward compatibility aliases (NodeTypeColors, EdgeTypeColors)
- Remove old duplicate function definitions
- Preserve existing Ant Design theme configuration

BREAKING CHANGE: None - all exports maintain backward compatibility

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 5: Update Graph Types

### Task 5: Update Graph Types with All Node/Edge Types

**Files:**
- Modify: `code-graph-ui/src/types/graph.ts`

- [ ] **Step 1: Replace NodeType constant with expanded version**

Replace lines 26-37 in `code-graph-ui/src/types/graph.ts` with:

```typescript
// ─── Node Type Constants ─────────────────────────────────────────────────────

/**
 * All supported node types matching backend graph_schema.py.
 * Total: 27 types organized by semantic category.
 */
export const NodeType = {
  // ── Code Structure Layer ───────────────────────────────────────────────
  Repository: 'Repository',
  Module: 'Module',
  File: 'File',

  // ── Code Elements ───────────────────────────────────────────────────────
  Class: 'Class',
  Function: 'Function',
  Component: 'Component',

  // ── Service Layer ───────────────────────────────────────────────────────
  Service: 'Service',
  API: 'API',
  APIEndpoint: 'APIEndpoint',

  // ── Data Layer ──────────────────────────────────────────────────────────
  Database: 'Database',
  Table: 'Table',
  DataObject: 'DataObject',
  DataSource: 'DataSource',
  DataSink: 'DataSink',

  // ── Event Layer ─────────────────────────────────────────────────────────
  Event: 'Event',
  Topic: 'Topic',
  EventHandler: 'EventHandler',
  MessageQueue: 'MessageQueue',

  // ── Flow Layer ──────────────────────────────────────────────────────────
  Flow: 'Flow',
  BusinessFlow: 'BusinessFlow',
  Pipeline: 'Pipeline',

  // ── Architecture Layer ──────────────────────────────────────────────────
  Layer: 'Layer',
  Domain: 'Domain',
  BoundedContext: 'BoundedContext',
  DomainEntity: 'DomainEntity',

  // ── External/Infrastructure ─────────────────────────────────────────────
  ExternalAPI: 'ExternalAPI',
  Cluster: 'Cluster',
  Infrastructure: 'Infrastructure',
} as const
```

- [ ] **Step 2: Replace EdgeType constant with expanded version**

Replace lines 43-54 in `code-graph-ui/src/types/graph.ts` with:

```typescript
// ─── Edge Type Constants ──────────────────────────────────────────────────────

/**
 * All supported edge types matching backend graph_schema.py.
 * Total: 22 types organized by semantic category.
 */
export const EdgeType = {
  // ── Containment Relationships ──────────────────────────────────────────
  Contains: 'contains',
  Defines: 'defines',
  PartOf: 'part_of',

  // ── Dependency Relationships ────────────────────────────────────────────
  Imports: 'imports',
  DependsOn: 'depends_on',
  Uses: 'uses',

  // ── Call Relationships ──────────────────────────────────────────────────
  Calls: 'calls',
  AsyncCalls: 'async_calls',
  Handles: 'handles',

  // ── Data Relationships ──────────────────────────────────────────────────
  Reads: 'reads',
  Writes: 'writes',
  Transforms: 'transforms',

  // ── Event Relationships ─────────────────────────────────────────────────
  Produces: 'produces',
  Consumes: 'consumes',
  Publishes: 'publishes',
  Subscribes: 'subscribes',

  // ── Architecture Relationships ──────────────────────────────────────────
  BelongsTo: 'belongs_to',
  FlowStep: 'flow_step',
  Implements: 'implements',

  // ── Other Relationships ─────────────────────────────────────────────────
  DeployedOn: 'deployed_on',
  RoutesTo: 'routes_to',
  Triggers: 'triggers',
} as const
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd code-graph-ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd "C:/code/Code-Knowledge-Graph"
git add code-graph-ui/src/types/graph.ts
git commit -m "$(cat <<'EOF'
feat(ui): expand NodeType and EdgeType constants to match backend

- NodeType: expand from 10 to 27 types
- EdgeType: expand from 10 to 22 types
- Add all AI analysis types (Layer, Flow, Domain, etc.)
- Add all new edge types (async_calls, handles, etc.)
- Organize types by semantic category with comments

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 6: Update Architecture Page

### Task 6: Update Architecture Page with Dynamic Filters

**Files:**
- Modify: `code-graph-ui/src/pages/Architecture/index.tsx`

- [ ] **Step 1: Update imports**

Replace line 6 in `code-graph-ui/src/pages/Architecture/index.tsx`:

```typescript
import type { GraphNode, GraphEdge } from '../../types/graph'
```

With:

```typescript
import type { GraphNode, GraphEdge } from '../../types/graph'
import { getNodeTypeColor, NODE_TYPE_GROUPS } from '../../theme'
```

- [ ] **Step 2: Replace hardcoded NODE_FILTERS with dynamic generation**

Replace lines 10-18 in `code-graph-ui/src/pages/Architecture/index.tsx`:

```typescript
const NODE_FILTERS = [
  { type: 'all',           label: '全部',   color: '#6e7a99' },
  { type: 'Module',        label: '模块',   color: '#00d4ff' },
  { type: 'Component',     label: '组件',   color: '#00f084' },
  { type: 'Service',       label: '服务',   color: '#7ed957' },
  { type: 'API',           label: '接口',   color: '#ff6b6b' },
  { type: 'Function',      label: '函数',   color: '#ffc145' },
  { type: 'Class',         label: '类',     color: '#b08eff' },
]
```

With:

```typescript
/**
 * Build filter options dynamically from actual graph data.
 * Only shows types that have nodes in the current graph.
 */
function buildFilterOptions(typeCounts: Record<string, number>) {
  const allCount = Object.values(typeCounts).reduce((a, b) => a + b, 0)

  const options: Array<{ type: string; label: string; color: string; count: number }> = [
    { type: 'all', label: '全部', color: '#6e7a99', count: allCount },
  ]

  // Iterate through type groups in defined order
  for (const [groupName, types] of Object.entries(NODE_TYPE_GROUPS)) {
    for (const nodeType of types) {
      const count = typeCounts[nodeType] ?? 0
      if (count > 0) {
        const color = getNodeTypeColor(nodeType).primary
        options.push({
          type: nodeType,
          label: nodeType,
          color,
          count,
        })
      }
    }
  }

  return options
}
```

- [ ] **Step 3: Update useMemo to use dynamic filters**

Find the `useMemo` that computes `typeCounts` (around line 156) and add a new memo for filter options:

After the existing `typeCounts` useMemo, add:

```typescript
  // ── Build filter options from actual data ───────────────────────────────

  const filterOptions = useMemo(() => {
    return buildFilterOptions(typeCounts)
  }, [typeCounts])
```

- [ ] **Step 4: Update the filter rendering to use filterOptions**

Find the filter chips rendering section (around lines 259-273) and replace:

```typescript
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {NODE_FILTERS.map(f => {
              const count = f.type === 'all' ? allNodes.length : (typeCounts[f.type] ?? 0)
              if (f.type !== 'all' && count === 0) return null
              return (
                <FilterChip
                  key={f.type}
                  label={f.label}
                  color={f.color}
                  active={activeFilter === f.type}
                  count={count}
                  onClick={() => setActiveFilter(f.type)}
                />
              )
            })}
          </div>
```

With:

```typescript
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {filterOptions.map((option) => (
              <FilterChip
                key={option.type}
                label={option.label}
                color={option.color}
                active={activeFilter === option.type}
                count={option.count}
                onClick={() => setActiveFilter(option.type)}
              />
            ))}
          </div>
```

- [ ] **Step 5: Verify TypeScript compilation**

Run: `cd code-graph-ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Test the UI**

Run: `cd code-graph-ui && npm run dev`
Open: http://localhost:5173/architecture
Expected: Filter chips show all node types present in the graph with correct colors

- [ ] **Step 7: Commit**

```bash
cd "C:/code/Code-Knowledge-Graph"
git add code-graph-ui/src/pages/Architecture/index.tsx
git commit -m "$(cat <<'EOF'
feat(ui): dynamic filter generation in Architecture page

- Replace hardcoded NODE_FILTERS with buildFilterOptions()
- Filters now show all node types present in graph data
- Each filter chip gets color from getNodeTypeColor()
- Filter options are ordered by NODE_TYPE_GROUPS

This ensures the Architecture page correctly displays filters for all
27 backend node types when they appear in the analyzed repository.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 7: Integration Tests

### Task 7: Add Unit Tests for Color System

**Files:**
- Create: `code-graph-ui/src/theme/__tests__/colorGenerator.test.ts`
- Create: `code-graph-ui/src/theme/__tests__/nodeTypeColors.test.ts`

- [ ] **Step 1: Create colorGenerator tests**

```typescript
// code-graph-ui/src/theme/__tests__/colorGenerator.test.ts

import { describe, it, expect } from 'vitest'
import {
  hslToHex,
  generateNodeColor,
  generateEdgeColor,
  generateColorFromTypeName,
  BASE_HUES,
} from '../colorGenerator'

describe('colorGenerator', () => {
  describe('hslToHex', () => {
    it('should convert cyan (190, 85, 55) to correct hex', () => {
      const result = hslToHex(190, 85, 55)
      // Should be close to #00d4ff
      expect(result).toMatch(/^#[0-9a-f]{6}$/i)
    })

    it('should produce valid hex format', () => {
      for (let h = 0; h < 360; h += 30) {
        const result = hslToHex(h, 80, 60)
        expect(result).toMatch(/^#[0-9a-f]{6}$/i)
      }
    })
  })

  describe('generateNodeColor', () => {
    it('should generate complete color scheme', () => {
      const scheme = generateNodeColor('cyan', 0)
      expect(scheme).toHaveProperty('primary')
      expect(scheme).toHaveProperty('bg')
      expect(scheme).toHaveProperty('border')
      expect(scheme).toHaveProperty('text')
      expect(scheme).toHaveProperty('dim')
    })

    it('should accept hue number', () => {
      const scheme = generateNodeColor(190, 0)
      expect(scheme.primary).toMatch(/^#[0-9a-f]{6}$/i)
    })

    it('should create different colors for different variants', () => {
      const scheme0 = generateNodeColor('cyan', 0)
      const scheme5 = generateNodeColor('cyan', 5)
      expect(scheme0.primary).not.toBe(scheme5.primary)
    })
  })

  describe('generateEdgeColor', () => {
    it('should generate valid hex color', () => {
      const color = generateEdgeColor('green')
      expect(color).toMatch(/^#[0-9a-f]{6}$/i)
    })
  })

  describe('generateColorFromTypeName', () => {
    it('should generate consistent colors for same type name', () => {
      const color1 = generateColorFromTypeName('CustomType')
      const color2 = generateColorFromTypeName('CustomType')
      expect(color1.primary).toBe(color2.primary)
    })

    it('should generate different colors for different type names', () => {
      const color1 = generateColorFromTypeName('TypeA')
      const color2 = generateColorFromTypeName('TypeB')
      expect(color1.primary).not.toBe(color2.primary)
    })
  })
})
```

- [ ] **Step 2: Create nodeTypeColors tests**

```typescript
// code-graph-ui/src/theme/__tests__/nodeTypeColors.test.ts

import { describe, it, expect } from 'vitest'
import {
  NODE_TYPE_COLORS,
  getNodeTypeColor,
  hasNodeTypeColor,
  getKnownNodeTypes,
} from '../nodeTypeColors'

describe('nodeTypeColors', () => {
  describe('NODE_TYPE_COLORS', () => {
    it('should have 27 node types defined', () => {
      const typeCount = Object.keys(NODE_TYPE_COLORS).length
      expect(typeCount).toBe(27)
    })

    it('should include all required types', () => {
      const requiredTypes = [
        'Repository', 'Module', 'File', 'Class', 'Function', 'Component',
        'Service', 'API', 'APIEndpoint', 'Database', 'Table', 'DataObject',
        'DataSource', 'DataSink', 'Event', 'Topic', 'EventHandler', 'MessageQueue',
        'Flow', 'BusinessFlow', 'Pipeline', 'Layer', 'Domain', 'BoundedContext',
        'DomainEntity', 'ExternalAPI', 'Cluster', 'Infrastructure',
      ]

      for (const type of requiredTypes) {
        expect(NODE_TYPE_COLORS[type]).toBeDefined()
      }
    })
  })

  describe('getNodeTypeColor', () => {
    it('should return color for known types', () => {
      const color = getNodeTypeColor('Service')
      expect(color.primary).toBeDefined()
      expect(color.bg).toBeDefined()
    })

    it('should handle case-insensitive lookup', () => {
      const color1 = getNodeTypeColor('service')
      const color2 = getNodeTypeColor('Service')
      expect(color1.primary).toBe(color2.primary)
    })

    it('should generate color for unknown types', () => {
      const color = getNodeTypeColor('UnknownType123')
      expect(color.primary).toBeDefined()
      expect(color.bg).toBeDefined()
    })
  })

  describe('hasNodeTypeColor', () => {
    it('should return true for known types', () => {
      expect(hasNodeTypeColor('Service')).toBe(true)
      expect(hasNodeTypeColor('Module')).toBe(true)
    })

    it('should return false for unknown types', () => {
      expect(hasNodeTypeColor('UnknownTypeXYZ')).toBe(false)
    })
  })

  describe('getKnownNodeTypes', () => {
    it('should return array of 27 type names', () => {
      const types = getKnownNodeTypes()
      expect(types.length).toBe(27)
      expect(types).toContain('Service')
      expect(types).toContain('Module')
    })
  })
})
```

- [ ] **Step 3: Run tests**

Run: `cd code-graph-ui && npm test -- --run src/theme/__tests__`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
cd "C:/code/Code-Knowledge-Graph"
git add code-graph-ui/src/theme/__tests__
git commit -m "$(cat <<'EOF'
test(ui): add unit tests for color system modules

- Add colorGenerator.test.ts with HSL conversion and generation tests
- Add nodeTypeColors.test.ts with coverage and lookup tests
- Verify 27 node types are defined
- Test case-insensitive lookup
- Test fallback for unknown types

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 8: Final Verification

### Task 8: Run Full Test Suite and Build

- [ ] **Step 1: Run full TypeScript check**

Run: `cd code-graph-ui && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run lint**

Run: `cd code-graph-ui && npm run lint`
Expected: No errors (or only pre-existing warnings)

- [ ] **Step 3: Run all tests**

Run: `cd code-graph-ui && npm test -- --run`
Expected: All tests pass

- [ ] **Step 4: Build production bundle**

Run: `cd code-graph-ui && npm run build`
Expected: Build succeeds without errors

- [ ] **Step 5: Manual visual verification**

1. Start dev server: `npm run dev`
2. Open http://localhost:5173
3. Select a repository with graph data
4. Navigate to Architecture page
5. Verify:
   - All node types in graph appear as filter options
   - Each filter chip has correct color
   - Nodes in graph render with correct colors
   - Unknown types fallback to auto-generated colors (gray default if completely unknown)

- [ ] **Step 6: Final commit with summary**

```bash
cd "C:/code/Code-Knowledge-Graph"
git add -A
git commit -m "$(cat <<'EOF'
feat(ui): complete graph node color system implementation

Summary of changes:
- Add colorGenerator.ts with HSL color generation algorithms
- Add nodeTypeColors.ts with 27 node type color definitions
- Add edgeTypeColors.ts with 22 edge type color definitions
- Update theme/index.ts to export new modules
- Update types/graph.ts with expanded type constants
- Update Architecture page with dynamic filter generation
- Add unit tests for color system modules

All 27 backend node types and 22 edge types now have color definitions.
Unknown types automatically get hash-generated colors.

Closes: #issue-number

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Chunk | Description | Files Changed |
|-------|-------------|---------------|
| 1 | Color Generator Module | +1 new |
| 2 | Node Type Colors | +1 new |
| 3 | Edge Type Colors | +1 new |
| 4 | Theme Index Update | ~1 modified |
| 5 | Graph Types Update | ~1 modified |
| 6 | Architecture Page | ~1 modified |
| 7 | Unit Tests | +2 new |
| 8 | Final Verification | - |

**Total**: 6 new files, 3 modified files
