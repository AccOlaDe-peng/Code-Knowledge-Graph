import React from 'react'
import type { ArchitectureNode } from '../../../types/architecture'

type NodeCardProps = {
  node: ArchitectureNode
  layerColor: string
  isSelected: boolean
  isHovered: boolean
  onClick: () => void
  onHover: () => void
  onLeave: () => void
}

const NodeCard: React.FC<NodeCardProps> = ({
  node,
  layerColor,
  isSelected,
  isHovered,
  onClick,
  onHover,
  onLeave,
}) => {
  const hasDetails = (node.functions?.length ?? 0) > 0 ||
    (node.dependencies?.length ?? 0) > 0 ||
    (node.endpoints?.length ?? 0) > 0

  return (
    <div
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        padding: '10px 14px',
        borderRadius: 6,
        backgroundColor: isSelected
          ? 'rgba(0, 212, 255, 0.15)'
          : isHovered
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(255, 255, 255, 0.03)',
        border: `1px solid ${isSelected ? layerColor : isHovered ? layerColor : 'rgba(255,255,255,0.1)'}`,
        cursor: hasDetails ? 'pointer' : 'default',
        transition: 'all 0.15s ease',
        minWidth: 140,
        maxWidth: 200,
      }}
    >
      {/* 节点名称 */}
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: isSelected ? layerColor : 'var(--t-primary)',
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={node.displayName}
      >
        {node.displayName}
      </div>

      {/* 类名（如果有） */}
      {node.name !== node.displayName && (
        <div
          style={{
            fontSize: 9,
            color: 'var(--t-muted)',
            fontFamily: 'var(--font-mono)',
            marginBottom: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={node.name}
        >
          {node.name}
        </div>
      )}

      {/* 功能数量标签 */}
      {hasDetails && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginTop: 6,
          }}
        >
          {(node.functions?.length ?? 0) > 0 && (
            <span
              style={{
                fontSize: 9,
                padding: '2px 6px',
                borderRadius: 4,
                backgroundColor: 'rgba(0, 240, 132, 0.2)',
                color: '#00f084',
              }}
            >
              {node.functions!.length} 功能
            </span>
          )}
          {(node.endpoints?.length ?? 0) > 0 && (
            <span
              style={{
                fontSize: 9,
                padding: '2px 6px',
                borderRadius: 4,
                backgroundColor: 'rgba(0, 212, 255, 0.2)',
                color: '#00d4ff',
              }}
            >
              {node.endpoints!.length} API
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default NodeCard
