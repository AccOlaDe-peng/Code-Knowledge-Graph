import React from 'react'
import type { ArchitectureLayer, ArchitectureNode, LayerId } from '../../../types/architecture'
import { LAYER_COLORS } from '../../../types/architecture'
import NodeCard from './NodeCard'

type LayerProps = {
  layer: ArchitectureLayer
  selectedNodeId: string | null
  onNodeClick: (node: ArchitectureNode) => void
  onNodeHover: (nodeId: string | null) => void
  hoveredNodeId: string | null
}

const LayerComponent: React.FC<LayerProps> = ({
  layer,
  selectedNodeId,
  onNodeClick,
  onNodeHover,
  hoveredNodeId,
}) => {
  const colors = LAYER_COLORS[layer.id as LayerId] || {
    bg: '#1a2035',
    border: '#4a5568',
    accent: '#4a5568',
  }

  return (
    <div
      style={{
        display: 'flex',
        minHeight: 120,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        backgroundColor: colors.bg,
      }}
    >
      {/* 层标签 */}
      <div
        style={{
          width: 160,
          minWidth: 160,
          padding: '16px 12px',
          borderRight: `2px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          background: 'rgba(0,0,0,0.2)',
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: colors.accent,
            marginBottom: 4,
          }}
        >
          {layer.name}
        </div>
        {layer.alias && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--t-muted)',
              marginBottom: 6,
            }}
          >
            {layer.alias}
          </div>
        )}
        {layer.technology && (
          <div
            style={{
              fontSize: 9,
              color: 'var(--t-muted)',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.4,
            }}
          >
            {layer.technology}
          </div>
        )}
        <div
          style={{
            marginTop: 8,
            fontSize: 10,
            color: 'var(--t-muted)',
          }}
        >
          {layer.nodes.length} 个节点
        </div>
      </div>

      {/* 节点区域 */}
      <div
        style={{
          flex: 1,
          padding: 16,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'flex-start',
          alignContent: 'flex-start',
        }}
      >
        {layer.nodes.map((node) => (
          <div key={node.id} data-node-id={node.id}>
            <NodeCard
              node={node}
              layerColor={colors.accent}
              isSelected={selectedNodeId === node.id}
              isHovered={hoveredNodeId === node.id}
              onClick={() => onNodeClick(node)}
              onHover={() => onNodeHover(node.id)}
              onLeave={() => onNodeHover(null)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default LayerComponent
