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
 * v2.0 - 高对比度设计优化：
 * - 背景透明度提升
 * - 边框宽度从 1px 提升到 2.5px
 * - 添加发光效果
 * - 文字对比度提升
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

  return (
    <div
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        backgroundColor: isSelected
          ? `rgba(${hexToRgb(layerColor)}, 0.25)`  // 动态颜色
          : isHovered
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(255, 255, 255, 0.04)',  // 从 0.03 提升
        border: isSelected
          ? `3px solid ${layerColor}`
          : isHovered
            ? `2.5px solid ${layerColor}`
            : `2px solid ${layerColor}66`,  // 从 1px 提升到 2px
        cursor: hasDetails ? 'pointer' : 'default',
        transition: 'all 0.15s ease',
        minWidth: 150,
        maxWidth: 210,
        boxShadow: isSelected
          ? `0 0 20px ${layerColor}35, 0 4px 12px rgba(0,0,0,0.3)`  // 发光效果
          : isHovered
            ? `0 0 12px ${layerColor}20, 0 2px 8px rgba(0,0,0,0.25)`
            : '0 2px 6px rgba(0,0,0,0.2)',
      }}
    >
      {/* 节点名称 */}
      <div
        style={{
          fontSize: 13,           // 从 12 提升
          fontWeight: 600,
          color: isSelected ? layerColor : 'var(--t-primary)',
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textShadow: isSelected ? `0 0 8px ${layerColor}40` : 'none',  // 发光文字
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
            color: '#8a98b8',  // 从 var(--t-muted) 提升亮度
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
                backgroundColor: 'rgba(0, 240, 132, 0.18)',  // 从 0.2 透明度提升亮度感
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
    : '0, 212, 255'  // 默认青色
}

export default NodeCard
