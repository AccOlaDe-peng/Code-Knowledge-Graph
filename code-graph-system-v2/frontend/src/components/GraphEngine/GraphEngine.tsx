import React, { useEffect, useRef, useState } from 'react';
import Graph from 'graphology';
import { SigmaContainer, useLoadGraph, useSigma } from '@react-sigma/core';
import { GraphNode, GraphEdge } from '../../types/graph';
import '@react-sigma/core/lib/react-sigma.min.css';

interface GraphEngineProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (node: GraphNode) => void;
  onZoomChange?: (zoom: number) => void;
  highlightedNodes?: Set<string>;
  selectedNodeId?: string | null;
}

/**
 * Graph data loader component
 */
function GraphDataLoader({
  nodes,
  edges,
  onNodeClick,
  highlightedNodes,
  selectedNodeId,
}: GraphEngineProps) {
  const loadGraph = useLoadGraph();
  const sigma = useSigma();

  useEffect(() => {
    const graph = new Graph();

    // Add nodes
    nodes.forEach(node => {
      graph.addNode(node.id, {
        label: node.name,
        size: 10,
        color: getNodeColor(node.type),
        x: Math.random() * 100,
        y: Math.random() * 100,
        type: node.type,
        properties: node.properties,
      });
    });

    // Add edges
    edges.forEach(edge => {
      try {
        if (graph.hasNode(edge.from) && graph.hasNode(edge.to)) {
          graph.addEdge(edge.from, edge.to, {
            label: edge.type,
            size: 2,
            color: getEdgeColor(edge.type),
            type: 'arrow',
          });
        }
      } catch (error) {
        // Edge might already exist
        console.warn(`Failed to add edge ${edge.from} -> ${edge.to}:`, error);
      }
    });

    loadGraph(graph);

    // Setup click handler
    if (onNodeClick) {
      sigma.on('clickNode', ({ node }) => {
        const nodeData = nodes.find(n => n.id === node);
        if (nodeData) {
          onNodeClick(nodeData);
        }
      });
    }

    return () => {
      sigma.removeAllListeners();
    };
  }, [nodes, edges, loadGraph, sigma, onNodeClick]);

  // Update node styles based on highlight/selection
  useEffect(() => {
    const graph = sigma.getGraph();

    graph.forEachNode((nodeId) => {
      const isHighlighted = highlightedNodes?.has(nodeId);
      const isSelected = nodeId === selectedNodeId;

      if (isSelected) {
        graph.setNodeAttribute(nodeId, 'size', 15);
        graph.setNodeAttribute(nodeId, 'color', '#ff0000');
      } else if (isHighlighted) {
        graph.setNodeAttribute(nodeId, 'size', 12);
        graph.setNodeAttribute(nodeId, 'color', '#ffaa00');
      } else {
        const node = nodes.find(n => n.id === nodeId);
        if (node) {
          graph.setNodeAttribute(nodeId, 'size', 10);
          graph.setNodeAttribute(nodeId, 'color', getNodeColor(node.type));
        }
      }
    });
  }, [highlightedNodes, selectedNodeId, sigma, nodes]);

  return null;
}

/**
 * Main Graph Engine component
 */
export function GraphEngine(props: GraphEngineProps) {
  const [settings] = useState({
    renderEdgeLabels: false,
    defaultNodeColor: '#999',
    defaultEdgeColor: '#ccc',
    labelDensity: 0.07,
    labelGridCellSize: 60,
    labelRenderedSizeThreshold: 15,
    labelFont: 'Lato, sans-serif',
    zIndex: true,
  });

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <SigmaContainer
        settings={settings}
        style={{ width: '100%', height: '100%' }}
      >
        <GraphDataLoader {...props} />
      </SigmaContainer>
    </div>
  );
}

/**
 * Get node color based on type
 */
function getNodeColor(type: string): string {
  const colorMap: Record<string, string> = {
    Module: '#4CAF50',
    File: '#2196F3',
    Class: '#9C27B0',
    Function: '#FF9800',
    API: '#F44336',
    Database: '#00BCD4',
    Table: '#009688',
    Event: '#FFC107',
    Topic: '#FF5722',
  };

  return colorMap[type] || '#999999';
}

/**
 * Get edge color based on type
 */
function getEdgeColor(type: string): string {
  const colorMap: Record<string, string> = {
    imports: '#4CAF50',
    calls: '#2196F3',
    extends: '#9C27B0',
    implements: '#FF9800',
    depends_on: '#F44336',
    reads: '#00BCD4',
    writes: '#009688',
    produces: '#FFC107',
    consumes: '#FF5722',
  };

  return colorMap[type] || '#cccccc';
}
