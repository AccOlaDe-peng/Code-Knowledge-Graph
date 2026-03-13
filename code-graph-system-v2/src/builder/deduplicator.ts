import { Node, Edge } from '../types/graph';

/**
 * Deduplicate nodes by ID
 */
export function deduplicateNodes(nodes: Node[]): Node[] {
  const seen = new Map<string, Node>();

  for (const node of nodes) {
    seen.set(node.id, node);
  }

  return Array.from(seen.values());
}

/**
 * Deduplicate edges by from+to+type
 */
export function deduplicateEdges(edges: Edge[]): Edge[] {
  const seen = new Map<string, Edge>();

  for (const edge of edges) {
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (!seen.has(key)) {
      seen.set(key, edge);
    }
  }

  return Array.from(seen.values());
}

/**
 * Validate that all edge references point to existing nodes
 */
export function validateEdgeReferences(nodes: Node[], edges: Edge[]): string[] {
  const nodeIds = new Set(nodes.map(n => n.id));
  const errors: string[] = [];

  for (const edge of edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge references non-existent source node: ${edge.from}`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge references non-existent target node: ${edge.to}`);
    }
  }

  return errors;
}
