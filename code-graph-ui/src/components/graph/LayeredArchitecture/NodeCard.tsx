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

/**
 * NodeCard - 架构图层节点卡片
 *
 * v2.1 - 入口节点功能说明：
 * - 展示 description（注释提取）
 * - 备选展示 keyMethods（关键方法名）
 */
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

  // 功能说明：优先 description，备选 keyMethods
  const renderDescription = () => {
    if (node.description) {
      return (
        <div
          style={{
            fontSize: 11,
            color: 'var(--t-secondary)',
            marginTop: 6,
            lineHeight: 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
          title={node.description}
        >
          {node.description}
        </div>
      )
    }

    if (node.keyMethods && node.keyMethods.length > 0) {
      return (
        <div
          style={{
            fontSize: 11,
            color: 'var(--t-muted)',
            marginTop: 6,
            fontFamily: 'var(--font-mono)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={node.keyMethods.join(', ')}
        >
          {node.keyMethods.join(', ')}
        </div>
      )
    }

    return null
  }

  return (
    <div
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        backgroundColor: isSelected
          ? `rgba(${hexToRgb(layerColor)}, 0.25)`
          : isHovered
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(255, 255, 255, 0.04)',
        border: isSelected
          ? `3px solid ${layerColor}`
          : isHovered
            ? `2.5px solid ${layerColor}`
            : `2px solid ${layerColor}66`,
        cursor: hasDetails ? 'pointer' : 'default',
        transition: 'all 0.15s ease',
        minWidth: 150,
        maxWidth: 210,
        boxShadow: isSelected
          ? `0 0 20px ${layerColor}35, 0 4px 12px rgba(0,0,0,0.3)`
          : isHovered
            ? `0 0 12px ${layerColor}20, 0 2px 8px rgba(0,0,0,0.25)`
            : '0 2px 6px rgba(0,0,0,0.2)',
      }}
    >
      {/* 节点名称 */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: isSelected ? layerColor : 'var(--t-primary)',
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textShadow: isSelected ? `0 0 8px ${layerColor}40` : 'none',
        }}
        title={node.displayName}
      >
        {node.displayName}
      </div>

      {/* 类名（如果有） */}
      {node.name !== node.displayName && (
        <div
          style={{
            fontSize: 10,
            color: '#8a98b8',
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

      {/* 功能说明（新增） */}
      {renderDescription()}

      {/* 功能数量标签 */}
      {hasDetails && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 8,
          }}
        >
          {(node.functions?.length ?? 0) > 0 && (
            <span
              style={{
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 5,
                backgroundColor: 'rgba(0, 240, 132, 0.18)',
                color: '#00f084',
                fontWeight: 500,
              }}
            >
              {node.functions!.length} 功能
            </span>
          )}
          {(node.endpoints?.length ?? 0) > 0 && (
            <span
              style={{
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 5,
                backgroundColor: 'rgba(0, 212, 255, 0.18)',
                color: '#00d4ff',
                fontWeight: 500,
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

// 辅助函数：Hex 转 RGB
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : '0, 212, 255'
}

export default NodeCard
