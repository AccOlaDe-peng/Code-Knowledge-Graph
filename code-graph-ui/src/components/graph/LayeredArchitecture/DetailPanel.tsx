import React from 'react'
import { Drawer, Tag } from 'antd'
import type { ArchitectureNode, ArchitectureData } from '../../../types/architecture'

type DetailPanelProps = {
  node: ArchitectureNode | null
  architectureData: ArchitectureData | null
  onClose: () => void
  onNodeClick: (nodeId: string) => void
}

const DetailPanel: React.FC<DetailPanelProps> = ({
  node,
  architectureData,
  onClose,
  onNodeClick,
}) => {
  if (!node) return null

  // 根据依赖 ID 查找节点名称
  const findNodeName = (nodeId: string): string => {
    if (!architectureData) return nodeId
    for (const layer of architectureData.layers) {
      const found = layer.nodes.find(n => n.id === nodeId)
      if (found) return found.displayName
    }
    return nodeId
  }

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{node.displayName}</span>
          {node.name !== node.displayName && (
            <span style={{ fontSize: 12, color: 'var(--t-muted)', fontWeight: 400 }}>
              ({node.name})
            </span>
          )}
        </div>
      }
      placement="right"
      width={400}
      onClose={onClose}
      open={!!node}
      styles={{
        body: { padding: '16px 20px' },
      }}
    >
      {/* 描述 */}
      {node.description && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--t-muted)', marginBottom: 6 }}>
            描述
          </div>
          <div style={{ fontSize: 13, color: 'var(--t-primary)', lineHeight: 1.6 }}>
            {node.description}
          </div>
        </div>
      )}

      {/* 源码路径 */}
      {node.source && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--t-muted)', marginBottom: 6 }}>
            源码路径
          </div>
          <div
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--a-cyan)',
              backgroundColor: 'rgba(0,0,0,0.3)',
              padding: '8px 10px',
              borderRadius: 4,
              wordBreak: 'break-all',
            }}
          >
            {node.source}
          </div>
        </div>
      )}

      {/* 功能列表 */}
      {(node.functions?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--t-muted)', marginBottom: 8 }}>
            功能 ({node.functions!.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {node.functions!.map((fn, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: 12,
                  color: 'var(--t-primary)',
                  padding: '6px 10px',
                  backgroundColor: 'rgba(0, 240, 132, 0.08)',
                  borderRadius: 4,
                  borderLeft: '2px solid #00f084',
                }}
              >
                {fn}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* API 端点 */}
      {(node.endpoints?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--t-muted)', marginBottom: 8 }}>
            API 端点 ({node.endpoints!.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {node.endpoints!.map((ep, idx) => (
              <Tag
                key={idx}
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  backgroundColor: 'rgba(0, 212, 255, 0.15)',
                  border: '1px solid rgba(0, 212, 255, 0.3)',
                  color: '#00d4ff',
                }}
              >
                {ep}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {/* 依赖 */}
      {(node.dependencies?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--t-muted)', marginBottom: 8 }}>
            依赖 ({node.dependencies!.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {node.dependencies!.map((dep, idx) => (
              <div
                key={idx}
                onClick={() => onNodeClick(dep)}
                style={{
                  fontSize: 12,
                  color: 'var(--a-cyan)',
                  padding: '6px 10px',
                  backgroundColor: 'rgba(0, 212, 255, 0.08)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  transition: 'background-color 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(0, 212, 255, 0.15)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(0, 212, 255, 0.08)'
                }}
              >
                {findNodeName(dep)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 属性 */}
      {(node.attributes?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--t-muted)', marginBottom: 8 }}>
            属性 ({node.attributes!.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {node.attributes!.map((attr, idx) => (
              <span
                key={idx}
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--t-muted)',
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  padding: '2px 6px',
                  borderRadius: 3,
                }}
              >
                {attr}
              </span>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  )
}

export default DetailPanel
