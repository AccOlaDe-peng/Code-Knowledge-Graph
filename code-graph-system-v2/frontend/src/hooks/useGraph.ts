import { useState, useCallback } from 'react';
import { Graph, GraphNode, GraphEdge } from '../types/graph';

export interface GraphState {
  graph: Graph | null;
  loading: boolean;
  error: string | null;
  selectedNode: GraphNode | null;
  highlightedNodes: Set<string>;
  filteredNodeTypes: Set<string>;
  zoomLevel: number;
}

export function useGraph() {
  const [state, setState] = useState<GraphState>({
    graph: null,
    loading: false,
    error: null,
    selectedNode: null,
    highlightedNodes: new Set(),
    filteredNodeTypes: new Set(),
    zoomLevel: 1.0,
  });

  const setGraph = useCallback((graph: Graph | null) => {
    setState(prev => ({ ...prev, graph, error: null }));
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setState(prev => ({ ...prev, loading }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState(prev => ({ ...prev, error }));
  }, []);

  const selectNode = useCallback((node: GraphNode | null) => {
    setState(prev => ({ ...prev, selectedNode: node }));
  }, []);

  const highlightNodes = useCallback((nodeIds: string[]) => {
    setState(prev => ({
      ...prev,
      highlightedNodes: new Set(nodeIds),
    }));
  }, []);

  const clearHighlight = useCallback(() => {
    setState(prev => ({
      ...prev,
      highlightedNodes: new Set(),
    }));
  }, []);

  const toggleNodeTypeFilter = useCallback((nodeType: string) => {
    setState(prev => {
      const newFiltered = new Set(prev.filteredNodeTypes);
      if (newFiltered.has(nodeType)) {
        newFiltered.delete(nodeType);
      } else {
        newFiltered.add(nodeType);
      }
      return { ...prev, filteredNodeTypes: newFiltered };
    });
  }, []);

  const setZoomLevel = useCallback((zoom: number) => {
    setState(prev => ({ ...prev, zoomLevel: zoom }));
  }, []);

  const getVisibleNodes = useCallback((): GraphNode[] => {
    if (!state.graph) return [];

    let nodes = state.graph.nodes;

    // Filter by node type
    if (state.filteredNodeTypes.size > 0) {
      nodes = nodes.filter(node => !state.filteredNodeTypes.has(node.type));
    }

    return nodes;
  }, [state.graph, state.filteredNodeTypes]);

  const getVisibleEdges = useCallback((): GraphEdge[] => {
    if (!state.graph) return [];

    const visibleNodeIds = new Set(getVisibleNodes().map(n => n.id));

    return state.graph.edges.filter(
      edge => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)
    );
  }, [state.graph, getVisibleNodes]);

  return {
    ...state,
    setGraph,
    setLoading,
    setError,
    selectNode,
    highlightNodes,
    clearHighlight,
    toggleNodeTypeFilter,
    setZoomLevel,
    getVisibleNodes,
    getVisibleEdges,
  };
}
