import React, { useState, useEffect, useMemo } from 'react';
import { Alert, Select } from 'antd';
import { useGraphStore } from '../../store/graphStore';
import { useRepoStore } from '../../store/repoStore';
import GraphViewer from '../../components/GraphViewer';
import type { GraphNode, GraphEdge } from '../../types/graph';

// ─── Types ────────────────────────────────────────────────────────────────────

type ImpactResult = {
  node: GraphNode;
  depth: number;
  path: string[];
};

type ImpactStats = {
  total: number;
  byType: Record<string, number>;
  byDepth: Record<number, number>;
  maxDepth: number;
};

// ─── Node Type Filter ─────────────────────────────────────────────────────────

const ANALYZABLE_TYPES = ['Component', 'Function', 'Service', 'API', 'Module', 'Class'];

// ─── Impact Analysis Logic ────────────────────────────────────────────────────

function computeImpact(
  sourceNodeId: string,
  allNodes: GraphNode[],
  allEdges: GraphEdge[],
  maxDepth = 5
): { results: ImpactResult[]; stats: ImpactStats } {
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));

  // Build adjacency list (both directions for full impact)
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  allEdges.forEach(e => {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    outgoing.get(e.source)!.push(e.target);
    incoming.get(e.target)!.push(e.source);
  });

  // BFS traversal (downstream impact)
  const visited = new Set<string>();
  const queue: { id: string; depth: number; path: string[] }[] = [
    { id: sourceNodeId, depth: 0, path: [sourceNodeId] }
  ];
  const results: ImpactResult[] = [];

  while (queue.length > 0) {
    const { id, depth, path } = queue.shift()!;

    if (visited.has(id) || depth > maxDepth) continue;
    visited.add(id);

    const node = nodeMap.get(id);
    if (!node) continue;

    if (id !== sourceNodeId) {
      results.push({ node, depth, path });
    }

    // Add downstream nodes
    const targets = outgoing.get(id) || [];
    targets.forEach(targetId => {
      if (!visited.has(targetId)) {
        queue.push({ id: targetId, depth: depth + 1, path: [...path, targetId] });
      }
    });
  }

  // Compute stats
  const stats: ImpactStats = {
    total: results.length,
    byType: {},
    byDepth: {},
    maxDepth: 0,
  };

  results.forEach(r => {
    stats.byType[r.node.type] = (stats.byType[r.node.type] || 0) + 1;
    stats.byDepth[r.depth] = (stats.byDepth[r.depth] || 0) + 1;
    stats.maxDepth = Math.max(stats.maxDepth, r.depth);
  });

  return { results, stats };
}

// ─── Component ────────────────────────────────────────────────────────────────

const ImpactAnalysis: React.FC = () => {
  const { activeRepo } = useRepoStore();
  const { graph, loadGraph } = useGraphStore();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [impactResults, setImpactResults] = useState<ImpactResult[]>([]);
  const [impactStats, setImpactStats] = useState<ImpactStats | null>(null);

  // Load graph on mount
  useEffect(() => {
    if (activeRepo?.graphId && !graph.data && !graph.loading) {
      loadGraph(activeRepo.graphId);
    }
  }, [activeRepo, graph.data, graph.loading, loadGraph]);

  // Filter nodes by analyzable types
  const analyzableNodes = useMemo(() => {
    if (!graph.data?.nodes) return [];
    return graph.data.nodes
      .filter(n => ANALYZABLE_TYPES.includes(n.type))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [graph.data]);

  // Compute impact when node is selected
  useEffect(() => {
    if (!selectedNodeId || !graph.data) {
      setImpactResults([]);
      setImpactStats(null);
      return;
    }

    const { results, stats } = computeImpact(
      selectedNodeId,
      graph.data.nodes,
      graph.data.edges
    );

    setImpactResults(results);
    setImpactStats(stats);
  }, [selectedNodeId, graph.data]);

  // Build impact graph (source + impacted nodes + edges)
  const impactGraph = useMemo(() => {
    if (!selectedNodeId || !graph.data || impactResults.length === 0) {
      return { nodes: [], edges: [] };
    }

    const sourceNode = graph.data.nodes.find(n => n.id === selectedNodeId);
    if (!sourceNode) return { nodes: [], edges: [] };

    const impactedNodeIds = new Set(impactResults.map(r => r.node.id));
    impactedNodeIds.add(selectedNodeId);

    const nodes = graph.data.nodes.filter(n => impactedNodeIds.has(n.id));
    const edges = graph.data.edges.filter(
      e => impactedNodeIds.has(e.source) && impactedNodeIds.has(e.target)
    );

    return { nodes, edges };
  }, [selectedNodeId, graph.data, impactResults]);

  // Depth color mapping
  const getDepthColor = (depth: number): string => {
    if (depth === 0) return '#ff4568'; // Direct (red)
    if (depth === 1) return '#ff8844'; // Primary (orange)
    if (depth === 2) return '#ffc145'; // Secondary (amber)
    return '#00d4ff'; // Tertiary+ (cyan)
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (!activeRepo) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          type="warning"
          message="未选择仓库"
          description="请先在仓库页面选择一个仓库。"
        />
      </div>
    );
  }

  if (graph.loading) {
    return (
      <div style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 16, height: 16, border: '2px solid var(--a-cyan)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--t-secondary)' }}>
          图谱加载中...
        </span>
      </div>
    );
  }

  if (graph.error) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" message="图谱加载失败" description={graph.error} />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, height: 'calc(100vh - 64px)', overflow: 'auto' }}>
      {/* Header */}
      <div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--t-muted)', letterSpacing: '0.15em', marginBottom: 6 }}>
          影响分析
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, color: 'var(--t-primary)', margin: 0 }}>
          影响半径计算
        </h1>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--t-secondary)', marginTop: 8, marginBottom: 0 }}>
          选择一个节点，分析其下游影响并识别所有受影响的组件。
        </p>
      </div>

      {/* Node Selector */}
      <div style={{
        background: 'var(--s-float)', border: '1px solid var(--b-subtle)',
        borderRadius: 'var(--radius-m)', padding: 20,
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
          选择目标节点
        </div>
        <Select
          showSearch
          placeholder="按名称或类型搜索..."
          style={{ width: '100%' }}
          value={selectedNodeId}
          onChange={setSelectedNodeId}
          filterOption={(input, option) =>
            (option?.label?.toString() ?? '').toLowerCase().includes(input.toLowerCase())
          }
          options={analyzableNodes.map(n => ({
            value: n.id,
            label: `${n.label} (${n.type})`,
          }))}
        />
      </div>

      {/* Impact Stats */}
      {impactStats && (
        <div style={{
          background: 'var(--s-float)', border: '1px solid var(--b-subtle)',
          borderRadius: 'var(--radius-m)', padding: 20,
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
            影响摘要
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
            {/* Total */}
            <div style={{
              background: 'var(--s-void)', border: '1px solid var(--b-faint)',
              borderRadius: 6, padding: 12,
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--t-muted)', letterSpacing: '0.08em', marginBottom: 6 }}>
                总影响
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: '#ff4568' }}>
                {impactStats.total}
              </div>
            </div>

            {/* Max Depth */}
            <div style={{
              background: 'var(--s-void)', border: '1px solid var(--b-faint)',
              borderRadius: 6, padding: 12,
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--t-muted)', letterSpacing: '0.08em', marginBottom: 6 }}>
                最大深度
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: '#ffc145' }}>
                {impactStats.maxDepth}
              </div>
            </div>

            {/* By Type */}
            {Object.entries(impactStats.byType)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 4)
              .map(([type, count]) => (
                <div key={type} style={{
                  background: 'var(--s-void)', border: '1px solid var(--b-faint)',
                  borderRadius: 6, padding: 12,
                }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--t-muted)', letterSpacing: '0.08em', marginBottom: 6 }}>
                    {type.toUpperCase()}
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: '#00d4ff' }}>
                    {count}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Impact Graph */}
      {impactGraph.nodes.length > 0 && (
        <div style={{
          background: 'var(--s-float)', border: '1px solid var(--b-subtle)',
          borderRadius: 'var(--radius-m)', padding: 20, flex: 1, minHeight: 500,
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
            影响图 · {impactGraph.nodes.length} 节点 · {impactGraph.edges.length} 边
          </div>
          <GraphViewer
            nodes={impactGraph.nodes}
            edges={impactGraph.edges}
            layout="force"
            height={460}
          />
        </div>
      )}

      {/* Depth Legend */}
      {impactStats && (
        <div style={{
          background: 'var(--s-float)', border: '1px solid var(--b-subtle)',
          borderRadius: 'var(--radius-m)', padding: 16,
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--t-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
            影响深度图例
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {[
              { depth: 0, label: '源节点', color: '#ff4568' },
              { depth: 1, label: '直接影响（深度 1）', color: '#ff8844' },
              { depth: 2, label: '二级影响（深度 2）', color: '#ffc145' },
              { depth: 3, label: '三级及以上影响（深度 3+）', color: '#00d4ff' },
            ].map(({ depth, label, color }) => (
              <div key={depth} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: color, border: `1px solid ${color}` }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-secondary)' }}>
                  {label}
                </span>
                {impactStats.byDepth[depth] && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--t-muted)' }}>
                    ({impactStats.byDepth[depth]})
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default ImpactAnalysis;
