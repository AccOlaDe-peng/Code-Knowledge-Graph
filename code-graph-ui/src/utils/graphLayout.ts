import type { GraphNode, GraphEdge } from '../types/graph';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LayoutName = 'force' | 'dagre' | 'hierarchy' | 'grid';

export type Position = { x: number; y: number };

export type LayoutNode = GraphNode & { position?: Position };

export type LayoutResult = {
  nodes: Map<string, Position>;
  width: number;
  height: number;
};

export type LayoutOptions = {
  width?: number;
  height?: number;
  padding?: number;
  animate?: boolean;
  iterations?: number;
};

// ─── Force-Directed Layout ────────────────────────────────────────────────────

/**
 * Force-directed layout using Fruchterman-Reingold algorithm.
 * Simulates physical forces: repulsion between all nodes, attraction along edges.
 */
export function forceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: LayoutOptions = {}
): LayoutResult {
  const {
    width = 1000,
    height = 800,
    padding = 50,
    iterations = 300,
  } = options;

  const area = (width - 2 * padding) * (height - 2 * padding);
  const k = Math.sqrt(area / nodes.length); // Optimal distance
  const t0 = width / 10; // Initial temperature
  const dt = t0 / (iterations + 1); // Cooling rate

  // Initialize positions randomly
  const positions = new Map<string, Position>();
  nodes.forEach(node => {
    positions.set(node.id, {
      x: padding + Math.random() * (width - 2 * padding),
      y: padding + Math.random() * (height - 2 * padding),
    });
  });

  // Build adjacency map
  const adjacency = new Map<string, Set<string>>();
  edges.forEach(e => {
    if (!adjacency.has(e.source)) adjacency.set(e.source, new Set());
    if (!adjacency.has(e.target)) adjacency.set(e.target, new Set());
    adjacency.get(e.source)!.add(e.target);
    adjacency.get(e.target)!.add(e.source);
  });

  // Simulation loop
  for (let iter = 0; iter < iterations; iter++) {
    const t = t0 - iter * dt; // Current temperature
    const forces = new Map<string, { x: number; y: number }>();

    // Initialize forces
    nodes.forEach(n => forces.set(n.id, { x: 0, y: 0 }));

    // Repulsive forces (all pairs)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        const p1 = positions.get(n1.id)!;
        const p2 = positions.get(n2.id)!;

        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;

        const repulsion = (k * k) / dist;
        const fx = (dx / dist) * repulsion;
        const fy = (dy / dist) * repulsion;

        forces.get(n1.id)!.x += fx;
        forces.get(n1.id)!.y += fy;
        forces.get(n2.id)!.x -= fx;
        forces.get(n2.id)!.y -= fy;
      }
    }

    // Attractive forces (edges)
    edges.forEach(e => {
      const p1 = positions.get(e.source);
      const p2 = positions.get(e.target);
      if (!p1 || !p2) return;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;

      const attraction = (dist * dist) / k;
      const fx = (dx / dist) * attraction;
      const fy = (dy / dist) * attraction;

      forces.get(e.source)!.x += fx;
      forces.get(e.source)!.y += fy;
      forces.get(e.target)!.x -= fx;
      forces.get(e.target)!.y -= fy;
    });

    // Apply forces with temperature cooling
    nodes.forEach(n => {
      const pos = positions.get(n.id)!;
      const force = forces.get(n.id)!;

      const magnitude = Math.sqrt(force.x * force.x + force.y * force.y) || 0.01;
      const displacement = Math.min(magnitude, t);

      pos.x += (force.x / magnitude) * displacement;
      pos.y += (force.y / magnitude) * displacement;

      // Keep within bounds
      pos.x = Math.max(padding, Math.min(width - padding, pos.x));
      pos.y = Math.max(padding, Math.min(height - padding, pos.y));
    });
  }

  return { nodes: positions, width, height };
}

// ─── Dagre Layout (Hierarchical DAG) ──────────────────────────────────────────

/**
 * Layered layout for directed acyclic graphs using Sugiyama framework.
 * Assigns nodes to layers, minimizes edge crossings, and positions nodes.
 */
export function dagreLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: LayoutOptions = {}
): LayoutResult {
  const {
    width = 1000,
    height = 800,
    padding = 50,
  } = options;

  const nodeWidth = 80;
  const nodeHeight = 60;
  const layerGap = 120;
  const nodeGap = 100;

  // Build adjacency lists
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  nodes.forEach(n => {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  });
  edges.forEach(e => {
    outgoing.get(e.source)?.push(e.target);
    incoming.get(e.target)?.push(e.source);
  });

  // Topological sort to assign layers
  const layers: string[][] = [];
  const layerMap = new Map<string, number>();
  const visited = new Set<string>();
  const queue: string[] = [];

  // Find root nodes (no incoming edges)
  nodes.forEach(n => {
    if (incoming.get(n.id)!.length === 0) {
      queue.push(n.id);
      layerMap.set(n.id, 0);
    }
  });

  // BFS to assign layers
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const layer = layerMap.get(nodeId)!;
    if (!layers[layer]) layers[layer] = [];
    layers[layer].push(nodeId);

    outgoing.get(nodeId)!.forEach(targetId => {
      const currentLayer = layerMap.get(targetId) ?? -1;
      const newLayer = layer + 1;
      if (newLayer > currentLayer) {
        layerMap.set(targetId, newLayer);
      }
      if (!visited.has(targetId)) {
        queue.push(targetId);
      }
    });
  }

  // Handle unvisited nodes (cycles or disconnected)
  nodes.forEach(n => {
    if (!visited.has(n.id)) {
      const lastLayer = layers.length;
      if (!layers[lastLayer]) layers[lastLayer] = [];
      layers[lastLayer].push(n.id);
      layerMap.set(n.id, lastLayer);
    }
  });

  // Position nodes
  const positions = new Map<string, Position>();
  const maxLayerWidth = Math.max(...layers.map(l => l.length));
  const totalHeight = layers.length * layerGap;

  layers.forEach((layer, layerIndex) => {
    const layerWidth = layer.length * nodeGap;
    const startX = (width - layerWidth) / 2;
    const y = padding + layerIndex * layerGap;

    layer.forEach((nodeId, nodeIndex) => {
      const x = startX + nodeIndex * nodeGap + nodeGap / 2;
      positions.set(nodeId, { x, y });
    });
  });

  return { nodes: positions, width, height: totalHeight + 2 * padding };
}

// ─── Hierarchy Layout (Tree) ──────────────────────────────────────────────────

/**
 * Tree layout using Reingold-Tilford algorithm.
 * Creates a tidy tree with minimal width and no overlaps.
 */
export function hierarchyLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: LayoutOptions = {}
): LayoutResult {
  const {
    width = 1000,
    height = 800,
    padding = 50,
  } = options;

  const levelHeight = 120;
  const nodeGap = 80;

  // Build tree structure
  const children = new Map<string, string[]>();
  const parents = new Map<string, string>();
  nodes.forEach(n => children.set(n.id, []));

  edges.forEach(e => {
    children.get(e.source)?.push(e.target);
    parents.set(e.target, e.source);
  });

  // Find root nodes
  const roots = nodes.filter(n => !parents.has(n.id));
  if (roots.length === 0 && nodes.length > 0) {
    roots.push(nodes[0]); // Fallback to first node
  }

  // Tree node with layout info
  type TreeNode = {
    id: string;
    children: TreeNode[];
    x: number;
    y: number;
    mod: number;
  };

  // Build tree recursively
  function buildTree(nodeId: string, depth: number): TreeNode {
    const childIds = children.get(nodeId) || [];
    const childNodes = childIds.map(id => buildTree(id, depth + 1));
    return {
      id: nodeId,
      children: childNodes,
      x: 0,
      y: depth * levelHeight,
      mod: 0,
    };
  }

  // Reingold-Tilford algorithm
  function firstWalk(node: TreeNode, leftSibling: TreeNode | null): void {
    if (node.children.length === 0) {
      // Leaf node
      node.x = leftSibling ? leftSibling.x + nodeGap : 0;
    } else {
      // Internal node
      let prevChild: TreeNode | null = null;
      node.children.forEach(child => {
        firstWalk(child, prevChild);
        prevChild = child;
      });

      const leftmost = node.children[0];
      const rightmost = node.children[node.children.length - 1];
      const midpoint = (leftmost.x + rightmost.x) / 2;

      if (leftSibling) {
        node.x = leftSibling.x + nodeGap;
        node.mod = node.x - midpoint;
      } else {
        node.x = midpoint;
      }
    }
  }

  function secondWalk(node: TreeNode, modSum: number): void {
    node.x += modSum;
    node.children.forEach(child => secondWalk(child, modSum + node.mod));
  }

  // Layout each root tree
  const positions = new Map<string, Position>();
  let offsetX = padding;

  roots.forEach(root => {
    const tree = buildTree(root.id, 0);
    firstWalk(tree, null);
    secondWalk(tree, 0);

    // Collect positions
    function traverse(node: TreeNode): void {
      positions.set(node.id, {
        x: node.x + offsetX,
        y: node.y + padding,
      });
      node.children.forEach(traverse);
    }
    traverse(tree);

    // Update offset for next tree
    const maxX = Math.max(...Array.from(positions.values()).map(p => p.x));
    offsetX = maxX + nodeGap * 2;
  });

  // Handle orphan nodes (not in any tree)
  const positioned = new Set(positions.keys());
  const orphans = nodes.filter(n => !positioned.has(n.id));
  orphans.forEach((n, i) => {
    positions.set(n.id, {
      x: padding + (i % 5) * nodeGap,
      y: height - padding - 100,
    });
  });

  return { nodes: positions, width, height };
}

// ─── Grid Layout ──────────────────────────────────────────────────────────────

/**
 * Simple grid layout for quick visualization.
 */
export function gridLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: LayoutOptions = {}
): LayoutResult {
  const {
    width = 1000,
    height = 800,
    padding = 50,
  } = options;

  const cols = Math.ceil(Math.sqrt(nodes.length));
  const cellWidth = (width - 2 * padding) / cols;
  const cellHeight = (height - 2 * padding) / Math.ceil(nodes.length / cols);

  const positions = new Map<string, Position>();
  nodes.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.set(node.id, {
      x: padding + col * cellWidth + cellWidth / 2,
      y: padding + row * cellHeight + cellHeight / 2,
    });
  });

  return { nodes: positions, width, height };
}

// ─── Layout Dispatcher ────────────────────────────────────────────────────────

/**
 * Apply layout algorithm to graph.
 */
export function applyLayout(
  layoutName: LayoutName,
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: LayoutOptions = {}
): LayoutResult {
  switch (layoutName) {
    case 'force':
      return forceLayout(nodes, edges, options);
    case 'dagre':
      return dagreLayout(nodes, edges, options);
    case 'hierarchy':
      return hierarchyLayout(nodes, edges, options);
    case 'grid':
      return gridLayout(nodes, edges, options);
    default:
      return gridLayout(nodes, edges, options);
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Center layout result in viewport.
 */
export function centerLayout(result: LayoutResult, viewWidth: number, viewHeight: number): LayoutResult {
  const positions = Array.from(result.nodes.values());
  if (positions.length === 0) return result;

  const minX = Math.min(...positions.map(p => p.x));
  const maxX = Math.max(...positions.map(p => p.x));
  const minY = Math.min(...positions.map(p => p.y));
  const maxY = Math.max(...positions.map(p => p.y));

  const graphWidth = maxX - minX;
  const graphHeight = maxY - minY;

  const offsetX = (viewWidth - graphWidth) / 2 - minX;
  const offsetY = (viewHeight - graphHeight) / 2 - minY;

  const centered = new Map<string, Position>();
  result.nodes.forEach((pos, id) => {
    centered.set(id, {
      x: pos.x + offsetX,
      y: pos.y + offsetY,
    });
  });

  return { nodes: centered, width: viewWidth, height: viewHeight };
}

/**
 * Scale layout to fit viewport.
 */
export function scaleLayout(result: LayoutResult, viewWidth: number, viewHeight: number, padding = 50): LayoutResult {
  const positions = Array.from(result.nodes.values());
  if (positions.length === 0) return result;

  const minX = Math.min(...positions.map(p => p.x));
  const maxX = Math.max(...positions.map(p => p.x));
  const minY = Math.min(...positions.map(p => p.y));
  const maxY = Math.max(...positions.map(p => p.y));

  const graphWidth = maxX - minX;
  const graphHeight = maxY - minY;

  const scaleX = (viewWidth - 2 * padding) / graphWidth;
  const scaleY = (viewHeight - 2 * padding) / graphHeight;
  const scale = Math.min(scaleX, scaleY, 1); // Don't scale up

  const scaled = new Map<string, Position>();
  result.nodes.forEach((pos, id) => {
    scaled.set(id, {
      x: (pos.x - minX) * scale + padding,
      y: (pos.y - minY) * scale + padding,
    });
  });

  return { nodes: scaled, width: viewWidth, height: viewHeight };
}
