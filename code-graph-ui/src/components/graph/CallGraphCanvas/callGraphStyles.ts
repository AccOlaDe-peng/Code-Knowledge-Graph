// src/components/graph/CallGraphCanvas/callGraphStyles.ts

import type { StylesheetStyle, NodeDefinition, EdgeDefinition } from 'cytoscape'
import type { GraphNode, GraphEdge } from '../../../types/graph'

// ─── Constants ────────────────────────────────────────────────────────────────

export const NODE_W = 200
export const NODE_H = 48
export const LABEL_MAX = 18

// ─── Label truncation (spec: 18 visible chars max) ───────────────────────────

function truncateLabel(label: string): string {
  return label.length > LABEL_MAX ? label.slice(0, LABEL_MAX) + '…' : label
}

// ─── Accent colour per node type ─────────────────────────────────────────────

export function getAccent(type: string): string {
  const t = type.toLowerCase()
  if (t === 'api') return '#00d4ff'
  if (t === 'function') return '#00f084'
  if (t === 'class') return '#b08eff'
  return '#ffc145'
}

// ─── Edge ID (stable, avoids collision for multi-edge node pairs) ─────────────

export function edgeId(e: GraphEdge): string {
  return `${e.source}-[${e.type || 'edge'}]->${e.target}`
}

// ─── Element builders ─────────────────────────────────────────────────────────

export function buildCyNode(
  node: GraphNode,
  degrees: { in: number; out: number },
): NodeDefinition {
  const accent = getAccent(node.type)
  const nameLabel = truncateLabel(node.label)
  // Degree line: shown only if non-zero
  const degParts: string[] = []
  if (degrees.in > 0)  degParts.push(`←${degrees.in}`)
  if (degrees.out > 0) degParts.push(`${degrees.out}→`)
  const degLabel = degParts.join('  ')
  const label = degLabel ? `${nameLabel}\n${degLabel}` : nameLabel

  return {
    data: {
      id:      node.id,
      label,
      accent,
      // Used by background-gradient workaround for left-border effect:
      bg:      '#0a0f16',
      nodeType: node.type,
    },
  }
}

export function buildCyEdge(edge: GraphEdge): EdgeDefinition {
  return {
    data: {
      id:     edgeId(edge),
      source: edge.source,
      target: edge.target,
      type:   edge.type,
    },
  }
}

// ─── Stylesheet ───────────────────────────────────────────────────────────────

export function buildCallGraphStylesheet(): StylesheetStyle[] {
  return [
    // ── Base node ──────────────────────────────────────────────────────────────
    {
      selector: 'node',
      style: {
        // Dimensions
        'width':  NODE_W,
        'height': NODE_H,
        'shape':  'round-rectangle',

        // Background & border
        'background-color': '#0a0f16',
        'border-width':     1,
        'border-color':     'data(accent)',  // Use accent color as border
        'border-opacity':   1,

        // Label (multi-line: name + degrees)
        'label':           'data(label)',
        'color':           '#8ab4c8',
        'font-size':       11,
        'font-family':     '"IBM Plex Mono", monospace',
        'font-weight':     400,
        'text-valign':     'center',
        'text-halign':     'center',
        'text-wrap':       'wrap',
        'text-max-width':  `${NODE_W - 20}px`,
        'text-overflow-wrap': 'whitespace',

        // Perf
        'overlay-opacity': 0,

        // Transitions
        'transition-property': 'border-color, border-width, background-color, opacity',
        'transition-duration': '0.12s' as unknown as number,
      },
    },

    // ── Node: selected ─────────────────────────────────────────────────────────
    {
      selector: 'node:selected',
      style: {
        'border-width':   2,
        'border-color':   'data(accent)',
        'color':          'data(accent)',
        'z-index':        10,
      },
    },

    // ── Node: highlighted (search match) ───────────────────────────────────────
    {
      selector: 'node.highlighted',
      style: {
        'border-width': 2,
        'border-color': 'data(accent)',
        'z-index':      9,
      },
    },

    // ── Node: dimmed (not in search results) ───────────────────────────────────
    {
      selector: 'node.dimmed',
      style: {
        'opacity': 0.25,
      },
    },

    // ── Base edge ──────────────────────────────────────────────────────────────
    {
      selector: 'edge',
      style: {
        'width':               1,
        'line-color':          '#1a2d20',
        'target-arrow-color':  '#1a2d20',
        'target-arrow-shape':  'triangle',
        'arrow-scale':         0.8,
        'curve-style':         'bezier',
        'opacity':             0.5,
        'overlay-opacity':     0,
        'transition-property': 'opacity, line-color, width',
        'transition-duration': '0.12s' as unknown as number,
      },
    },

    // ── Edge: focal (connected to focused node) ─────────────────────────────────
    {
      selector: 'edge.focal-edge',
      style: {
        'line-color':         '#00f084',
        'target-arrow-color': '#00f084',
        'width':              2,
        'opacity':            1,
        'z-index':            8,
      },
    },

    // ── Edge: dimmed ───────────────────────────────────────────────────────────
    {
      selector: 'edge.dimmed',
      style: {
        'opacity': 0.1,
      },
    },

    // ── Edge: hidden during node drag (performance optimization) ───────────────
    {
      selector: 'edge.hidden-during-drag',
      style: {
        'display': 'none',
      },
    },
  ]
}
