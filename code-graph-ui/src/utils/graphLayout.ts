import type { GraphNode, GraphEdge } from '../types/graph';

// ReactFlow 节点格式
export interface FlowNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: {
    label: string;
    nodeType: string;
    properties: Record<string, unknown> | undefined;
  };
}

// ReactFlow 边格式
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
  animated?: boolean;
}

// 节点类型颜色映射
export const NODE_TYPE_COLORS: Record<string, string> = {
  Module: '#1677ff',
  Component: '#52c41a',
  Function: '#faad14',
  Class: '#722ed1',
  Service: '#13c2c2',
  Database: '#eb2f96',
  API: '#fa541c',
  Event: '#a0d911',
  Cluster: '#2f54eb',
  Infrastructure: '#595959',
};

// 获取节点颜色
export function getNodeColor(nodeType: string): string {
  return NODE_TYPE_COLORS[nodeType] || '#8c8c8c';
}

// 将 GraphNode 转换为 ReactFlow 节点（简单网格布局）
export function toFlowNodes(nodes: GraphNode[], columns = 5): FlowNode[] {
  return nodes.map((node, index) => ({
    id: node.id,
    position: {
      x: (index % columns) * 220,
      y: Math.floor(index / columns) * 120,
    },
    data: {
      label: node.label,
      nodeType: node.type,
      properties: node.properties,
    },
  }));
}

// 将 GraphEdge 转换为 ReactFlow 边
export function toFlowEdges(edges: GraphEdge[]): FlowEdge[] {
  return edges.map((edge, index) => ({
    id: `e-${index}-${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    label: edge.type,
    animated: edge.type === 'calls',
  }));
}

// 按节点类型分组
export function groupByType(nodes: GraphNode[]): Record<string, GraphNode[]> {
  return nodes.reduce(
    (acc, node) => {
      const key = node.type;
      if (!acc[key]) acc[key] = [];
      acc[key].push(node);
      return acc;
    },
    {} as Record<string, GraphNode[]>
  );
}

// 统计各类型节点/边数量
export function countByType(items: Array<{ type: string }>): Record<string, number> {
  return items.reduce(
    (acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
}
