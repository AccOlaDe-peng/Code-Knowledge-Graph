/**
 * FieldLineage - 字段级血缘视图。
 *
 * 展示 AI 优先流水线分析出的字段级数据流转关系。
 * 功能：
 * - 实体选择器
 * - 字段选择器
 * - 血缘图展示（流入/流出）
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Select, Spin, Empty, Tag, Card, Tabs, Tooltip } from 'antd';
import { ArrowRightOutlined, ArrowLeftOutlined, SwapOutlined } from '@ant-design/icons';
import GraphViewer from '../../components/graph/GraphViewer';
import type { GraphNode, GraphEdge } from '../../types/graph';
import { useRepoStore } from '../../store/repoStore';
import { graphApi } from '../../api/graphApi';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EntityInfo {
  id: string;
  name: string;
  tableName: string;
  fields: FieldInfo[];
}

interface FieldInfo {
  id: string;
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

interface FlowInfo {
  fromEntity: string;
  fromField: string;
  toEntity: string;
  toField: string;
  flowType: string;
  flowPattern: string;
  description: string;
}

// ─── FieldLineage Page ────────────────────────────────────────────────────────

const FieldLineage: React.FC = () => {
  const { activeRepo } = useRepoStore();

  // Data state
  const [entities, setEntities] = useState<EntityInfo[]>([]);
  const [lineages, setLineages] = useState<FlowInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [flowDirection, setFlowDirection] = useState<'both' | 'in' | 'out'>('both');

  // Load entity and lineage data
  useEffect(() => {
    if (!activeRepo?.repoId) return;

    setLoading(true);
    setError(null);

    // Load graph data
    graphApi.getLineageView(activeRepo.repoId, { includeCalls: false })
      .then((res) => {
        // Extract entities and fields
        const entityMap = new Map<string, EntityInfo>();

        res.nodes.forEach((node: GraphNode) => {
          if (node.type === 'Entity') {
            const entity: EntityInfo = {
              id: node.id,
              name: node.label || node.id.replace('entity:', ''),
              tableName: node.properties?.table_name || '',
              fields: [],
            };
            entityMap.set(node.id, entity);
          } else if (node.type === 'Field') {
            // Parse entity name from field ID (format: entity:EntityName.fieldName)
            const parts = node.id.replace('field:', '').split('.');
            if (parts.length === 2) {
              const entityId = `entity:${parts[0]}`;
              const entity = entityMap.get(entityId);
              if (entity) {
                entity.fields.push({
                  id: node.id,
                  name: parts[1],
                  type: node.properties?.type || 'unknown',
                  isPrimaryKey: node.properties?.is_primary_key || false,
                  isForeignKey: node.properties?.is_foreign_key || false,
                });
              }
            }
          }
        });

        setEntities(Array.from(entityMap.values()));

        // Extract lineages
        const flowLineages: FlowInfo[] = res.edges
          .filter((edge: GraphEdge) => edge.type === 'flow_to')
          .map((edge: GraphEdge) => ({
            fromEntity: edge.properties?.from_entity || '',
            fromField: edge.properties?.from_field || '',
            toEntity: edge.properties?.to_entity || '',
            toField: edge.properties?.to_field || '',
            flowType: edge.properties?.flow_type || 'direct',
            flowPattern: edge.properties?.flow_pattern || '',
            description: edge.properties?.description || '',
          }));

        setLineages(flowLineages);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [activeRepo?.repoId]);

  // Get available fields for selected entity
  const availableFields = useMemo(() => {
    const entity = entities.find(e => e.id === selectedEntity);
    return entity?.fields || [];
  }, [entities, selectedEntity]);

  // Filter lineages based on selection
  const filteredLineages = useMemo(() => {
    if (!selectedEntity && !selectedField) return lineages;

    return lineages.filter(l => {
      if (selectedField) {
        // Filter by specific field
        const fieldKey = `${selectedEntity?.replace('entity:', '')}.${selectedField}`;
        if (flowDirection === 'in') {
          return l.toEntity === selectedEntity?.replace('entity:', '') && l.toField === selectedField;
        } else if (flowDirection === 'out') {
          return l.fromEntity === selectedEntity?.replace('entity:', '') && l.fromField === selectedField;
        }
        return (l.toEntity === selectedEntity?.replace('entity:', '') && l.toField === selectedField) ||
               (l.fromEntity === selectedEntity?.replace('entity:', '') && l.fromField === selectedField);
      }

      if (selectedEntity) {
        const entityName = selectedEntity.replace('entity:', '');
        if (flowDirection === 'in') {
          return l.toEntity === entityName;
        } else if (flowDirection === 'out') {
          return l.fromEntity === entityName;
        }
        return l.toEntity === entityName || l.fromEntity === entityName;
      }

      return true;
    });
  }, [lineages, selectedEntity, selectedField, flowDirection]);

  // Build graph from filtered lineages
  const { graphNodes, graphEdges } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();

    // Add nodes for entities and fields in lineages
    filteredLineages.forEach(l => {
      // Add source field node
      const fromFieldId = `field:${l.fromEntity}.${l.fromField}`;
      if (!nodeMap.has(fromFieldId)) {
        nodeMap.set(fromFieldId, {
          id: fromFieldId,
          type: 'Field',
          label: `${l.fromEntity}.${l.fromField}`,
          properties: { entity: l.fromEntity, field: l.fromField },
        });
      }

      // Add target field node
      const toFieldId = `field:${l.toEntity}.${l.toField}`;
      if (!nodeMap.has(toFieldId)) {
        nodeMap.set(toFieldId, {
          id: toFieldId,
          type: 'Field',
          label: `${l.toEntity}.${l.toField}`,
          properties: { entity: l.toEntity, field: l.toField },
        });
      }
    });

    const edges: GraphEdge[] = filteredLineages.map((l, i) => ({
      id: `edge-${i}`,
      source: `field:${l.fromEntity}.${l.fromField}`,
      target: `field:${l.toEntity}.${l.toField}`,
      type: 'flow_to',
      properties: {
        flow_type: l.flowType,
        flow_pattern: l.flowPattern,
        description: l.description,
      },
    }));

    return { graphNodes: Array.from(nodeMap.values()), graphEdges: edges };
  }, [filteredLineages]);

  // Reset field when entity changes
  useEffect(() => {
    setSelectedField(null);
  }, [selectedEntity]);

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!activeRepo?.repoId) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Empty description="请先选择一个仓库" />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'var(--t-primary)' }}>
          字段级血缘
        </h1>
        <Tag color="purple" style={{ marginLeft: 4 }}>AI 分析</Tag>
      </div>

      {/* Controls */}
      <Card
        size="small"
        style={{ background: 'var(--s-raised)', borderColor: 'var(--b-faint)' }}
        bodyStyle={{ padding: '12px 16px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {/* Entity selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--t-muted)', fontFamily: 'var(--font-mono)' }}>
              实体:
            </span>
            <Select
              placeholder="选择实体"
              allowClear
              style={{ minWidth: 200 }}
              value={selectedEntity}
              onChange={setSelectedEntity}
              options={entities.map(e => ({
                value: e.id,
                label: `${e.name}${e.tableName ? ` (${e.tableName})` : ''}`,
              }))}
              loading={loading}
            />
          </div>

          {/* Field selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--t-muted)', fontFamily: 'var(--font-mono)' }}>
              字段:
            </span>
            <Select
              placeholder="选择字段"
              allowClear
              style={{ minWidth: 180 }}
              value={selectedField}
              onChange={setSelectedField}
              options={availableFields.map(f => ({
                value: f.name,
                label: (
                  <span>
                    {f.name}
                    {f.isPrimaryKey && <Tag color="cyan" style={{ marginLeft: 4, fontSize: 9 }}>PK</Tag>}
                    {f.isForeignKey && <Tag color="orange" style={{ marginLeft: 4, fontSize: 9 }}>FK</Tag>}
                  </span>
                ),
              }))}
              disabled={!selectedEntity}
            />
          </div>

          {/* Flow direction */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--t-muted)', fontFamily: 'var(--font-mono)' }}>
              方向:
            </span>
            <Tabs
              size="small"
              activeKey={flowDirection}
              onChange={(key) => setFlowDirection(key as 'both' | 'in' | 'out')}
              items={[
                { key: 'both', label: <SwapOutlined /> },
                { key: 'in', label: <ArrowLeftOutlined /> },
                { key: 'out', label: <ArrowRightOutlined /> },
              ]}
              style={{ marginBottom: -8 }}
            />
          </div>

          {/* Stats */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
            <span style={{ fontSize: 11, color: 'var(--t-muted)', fontFamily: 'var(--font-mono)' }}>
              实体: <span style={{ color: 'var(--t-cyan)' }}>{entities.length}</span>
            </span>
            <span style={{ fontSize: 11, color: 'var(--t-muted)', fontFamily: 'var(--font-mono)' }}>
              血缘: <span style={{ color: 'var(--t-green)' }}>{filteredLineages.length}</span>
            </span>
          </div>
        </div>
      </Card>

      {/* Graph */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <Spin size="large" />
          </div>
        ) : error ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--t-error)' }}>
            {error}
          </div>
        ) : graphNodes.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <Empty description="暂无血缘数据，请先运行 AI 优先分析" />
          </div>
        ) : (
          <GraphViewer
            nodes={graphNodes}
            edges={graphEdges}
            layout="dagre"
            height="100%"
          />
        )}
      </div>

      {/* Lineage list (collapsed by default) */}
      {filteredLineages.length > 0 && (
        <Card
          size="small"
          title={
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--t-muted)' }}>
              血缘详情 ({filteredLineages.length})
            </span>
          }
          style={{ background: 'var(--s-raised)', borderColor: 'var(--b-faint)', maxHeight: 200, overflow: 'auto' }}
          bodyStyle={{ padding: '8px 12px' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filteredLineages.slice(0, 20).map((l, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  background: 'var(--s-base)',
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <span style={{ color: 'var(--t-primary)' }}>{l.fromEntity}.{l.fromField}</span>
                <ArrowRightOutlined style={{ color: 'var(--t-cyan)', fontSize: 10 }} />
                <span style={{ color: 'var(--t-primary)' }}>{l.toEntity}.{l.toField}</span>
                {l.flowPattern && (
                  <Tag style={{ marginLeft: 'auto', fontSize: 9 }}>{l.flowPattern}</Tag>
                )}
                {l.description && (
                  <Tooltip title={l.description}>
                    <span style={{ color: 'var(--t-muted)', cursor: 'help' }}>ⓘ</span>
                  </Tooltip>
                )}
              </div>
            ))}
            {filteredLineages.length > 20 && (
              <div style={{ textAlign: 'center', color: 'var(--t-muted)', fontSize: 10, padding: 8 }}>
                还有 {filteredLineages.length - 20} 条...
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
};

export default FieldLineage;
