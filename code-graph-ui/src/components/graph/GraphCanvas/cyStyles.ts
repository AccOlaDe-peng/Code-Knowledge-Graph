import type { StylesheetStyle } from 'cytoscape'
import { getNodeTypeColor, getEdgeTypeColor } from '../../../theme'

// ─── Node dimensions ──────────────────────────────────────────────────────────

export const NODE_WIDTH  = 140
export const NODE_HEIGHT =  48
export const LABEL_MAX_CHARS = 20

// ─── Colour helpers ───────────────────────────────────────────────────────────

export function resolveNodeColors(type: string) {
  const c = getNodeTypeColor(type)
  return {
    bg:         c.bg,
    border:     c.border,
    text:       c.text,
    // Slightly lighter background for selected/highlighted state
    bgSelected: c.dim,
  }
}

export function resolveEdgeColor(type: string): string {
  return getEdgeTypeColor(type)
}

// ─── Label truncation ─────────────────────────────────────────────────────────

export function truncateLabel(label: string): string {
  return label.length > LABEL_MAX_CHARS
    ? label.slice(0, LABEL_MAX_CHARS - 1) + '…'
    : label
}

// ─── Cytoscape Stylesheet ─────────────────────────────────────────────────────
// Uses Cytoscape's data() mapper for per-element colours so we don't need
// selector-per-type rules (which don't scale to many node types).

export function buildCyStylesheet(): StylesheetStyle[] {
  return [
    // ── Base node ────────────────────────────────────────────────────────────
    {
      selector: 'node',
      style: {
        'width':               NODE_WIDTH,
        'height':              NODE_HEIGHT,
        'shape':               'round-rectangle',

        // Colours mapped from per-element data
        'background-color':    'data(bg)',
        'border-width':        1.5,
        'border-color':        'data(borderColor)',
        'border-opacity':      0.9,

        // Label
        'label':               'data(label)',
        'color':               'data(textColor)',
        'font-size':           10,
        'font-family':         '"IBM Plex Mono", monospace',
        'font-weight':         500,
        'text-valign':         'center',
        'text-halign':         'center',
        'text-max-width':      `${NODE_WIDTH - 16}px`,
        'text-overflow-wrap':  'whitespace',
        'text-wrap':           'ellipsis',

        // Performance: skip overlay rendering by default
        'overlay-opacity':     0,

        // Smooth state transitions
        'transition-property': 'border-color, border-width, background-color, opacity',
        'transition-duration': '0.12s' as unknown as number,
      },
    },

    // ── Node: selected ───────────────────────────────────────────────────────
    {
      selector: 'node:selected',
      style: {
        'border-width':     2.5,
        'border-color':     '#00d4ff',
        'background-color': 'data(bgSelected)',
        'z-index':          10,
      },
    },

    // ── Node: active (press) ─────────────────────────────────────────────────
    {
      selector: 'node:active',
      style: {
        'overlay-opacity': 0.1,
        'overlay-color':   '#ffffff',
        'overlay-padding': 4,
      },
    },

    // ── Node: highlighted (search / hover neighbourhood) ─────────────────────
    {
      selector: 'node.highlighted',
      style: {
        'border-width':     2,
        'border-color':     '#00d4ff',
        'background-color': 'data(bgSelected)',
        'z-index':          9,
      },
    },

    // ── Node: faded (not in neighbourhood of selected node) ──────────────────
    {
      selector: 'node.faded',
      style: {
        'opacity': 0.22,
      },
    },

    // ── Node: hover ──────────────────────────────────────────────────────────
    {
      selector: 'node.hovered',
      style: {
        'border-width':  2,
        'border-color':  'data(borderColor)',
        'overlay-opacity': 0.06,
        'overlay-color': '#ffffff',
        'overlay-padding': 3,
        'z-index':       8,
      },
    },

    // ── Node: cluster proxy (synthetic compound node) ────────────────────────
    {
      selector: 'node.cluster-proxy',
      style: {
        'width':            160,
        'height':            56,
        'shape':            'round-rectangle',
        'border-style':     'dashed',
        'border-width':      1.5,
        'font-size':         9,
        'text-valign':      'center',
        'text-halign':      'center',
      },
    },

    // ── Base edge ────────────────────────────────────────────────────────────
    {
      selector: 'edge',
      style: {
        'width':                1.5,
        'line-color':           'data(edgeColor)',
        'target-arrow-color':   'data(edgeColor)',
        'target-arrow-shape':   'triangle',
        'arrow-scale':          0.9,
        'curve-style':          'bezier',
        'opacity':              0.65,

        // Edge labels (type name, shown at low density)
        'label':                'data(edgeLabel)',
        'font-size':             8,
        'font-family':          '"IBM Plex Mono", monospace',
        'color':                'data(edgeColor)',
        'text-rotation':        'autorotate',
        'text-margin-y':        -6,
        'text-opacity':          0.7,

        'overlay-opacity':       0,
        'transition-property':  'opacity, line-color',
        'transition-duration':  '0.12s' as unknown as number,
      },
    },

    // ── Edge: selected ───────────────────────────────────────────────────────
    {
      selector: 'edge:selected',
      style: {
        'width':   2.5,
        'opacity': 1,
        'z-index': 10,
      },
    },

    // ── Edge: highlighted (connected to selected/hovered node) ───────────────
    {
      selector: 'edge.highlighted',
      style: {
        'width':   2,
        'opacity': 0.9,
        'z-index': 8,
      },
    },

    // ── Edge: faded ──────────────────────────────────────────────────────────
    {
      selector: 'edge.faded',
      style: {
        'opacity': 0.07,
      },
    },

    // ── Labels: hide at very low zoom (managed by LOD, but as fallback) ──────
    {
      selector: 'node[zoom < 0.3]',
      style: {
        'font-size': 0,
      },
    },
  ]
}

// ─── Node element builder ────────────────────────────────────────────────────

import type { NodeDefinition } from 'cytoscape'
import type { EngineGraphNode } from '../../../graph-engine/types'

export function buildCyNode(node: EngineGraphNode): NodeDefinition {
  const colors = resolveNodeColors(node.type)
  return {
    data: {
      id:          node.id,
      label:       truncateLabel(node.label),
      fullLabel:   node.label,
      type:        node.type,
      bg:          colors.bg,
      bgSelected:  colors.bgSelected,
      borderColor: colors.border,
      textColor:   colors.text,
    },
    // Position may be null if layout hasn't run yet → Cytoscape places at (0,0)
    ...(node.position ? { position: node.position } : {}),
    // Classes for initial state
    classes: [
      node.isClusterProxy ? 'cluster-proxy' : '',
    ].filter(Boolean).join(' '),
  }
}

// ─── Edge element builder ────────────────────────────────────────────────────

import type { EdgeDefinition } from 'cytoscape'
import type { EngineGraphEdge } from '../../../graph-engine/types'

export function buildCyEdge(edge: EngineGraphEdge): EdgeDefinition {
  return {
    data: {
      id:        edge.id,
      source:    edge.source,
      target:    edge.target,
      edgeColor: resolveEdgeColor(edge.type),
      edgeLabel: edge.type,
      edgeType:  edge.type,
    },
  }
}
