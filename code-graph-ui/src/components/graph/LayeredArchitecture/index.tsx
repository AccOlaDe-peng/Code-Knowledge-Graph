/**
 * LayeredArchitecture - 分层架构图组件
 *
 * 渲染经典的分层架构图，支持：
 * - 水平泳道布局
 * - 节点点击查看详情
 * - 依赖关系连线
 * - 数据流可视化
 */
import React, { useState, useRef, useCallback } from 'react'
import { Switch, Tooltip } from 'antd'
import type { ArchitectureData, ArchitectureNode } from '../../../types/architecture'
import LayerComponent from './Layer'
import DetailPanel from './DetailPanel'
import DependencyLines from './DependencyLines'

type LayeredArchitectureProps = {
  data: ArchitectureData
  height?: string | number
}

const LayeredArchitecture: React.FC<LayeredArchitectureProps> = ({
  data,
  height = '100%',
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedNode, setSelectedNode] = useState<ArchitectureNode | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [showDependencies, setShowDependencies] = useState(true)
  const [showDataFlow, setShowDataFlow] = useState(false)

  // 节点点击
  const handleNodeClick = useCallback((node: ArchitectureNode) => {
    setSelectedNode(node)
  }, [])

  // 节点 hover
  const handleNodeHover = useCallback((nodeId: string | null) => {
    setHoveredNodeId(nodeId)
  }, [])

  // 关闭详情面板
  const handlePanelClose = useCallback(() => {
    setSelectedNode(null)
  }, [])

  // 从依赖 ID 跳转到节点
  const handleNodeNavigate = useCallback((nodeId: string) => {
    for (const layer of data.layers) {
      const node = layer.nodes.find(n => n.id === nodeId)
      if (node) {
        setSelectedNode(node)
        // 滚动到节点位置
        const el = containerRef.current?.querySelector(`[data-node-id="${nodeId}"]`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        break
      }
    }
  }, [data])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height, overflow: 'hidden' }}>
      {/* 顶部标题栏 */}
      <div
        style={{
          flexShrink: 0,
          padding: '12px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'rgba(0,0,0,0.2)',
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--t-primary)' }}>
            {data.fullName || data.name}
          </div>
          {data.description && (
            <div style={{ fontSize: 12, color: 'var(--t-muted)', marginTop: 4 }}>
              {data.description}
            </div>
          )}
        </div>

        {/* 显示控制 */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Tooltip title="显示节点间的依赖关系">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Switch
                size="small"
                checked={showDependencies}
                onChange={setShowDependencies}
              />
              <span style={{ fontSize: 11, color: 'var(--t-muted)' }}>依赖</span>
            </div>
          </Tooltip>
          <Tooltip title="显示数据流向路径">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Switch
                size="small"
                checked={showDataFlow}
                onChange={setShowDataFlow}
              />
              <span style={{ fontSize: 11, color: 'var(--t-muted)' }}>数据流</span>
            </div>
          </Tooltip>
        </div>
      </div>

      {/* 技术栈摘要 */}
      {data.techStack && Object.keys(data.techStack).length > 0 && (
        <div
          style={{
            flexShrink: 0,
            padding: '8px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            backgroundColor: 'rgba(0,0,0,0.1)',
          }}
        >
          {Object.entries(data.techStack).map(([key, value]) => (
            <span
              key={key}
              style={{
                fontSize: 10,
                color: 'var(--t-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <span style={{ color: 'var(--t-secondary)' }}>{key}:</span> {value}
            </span>
          ))}
        </div>
      )}

      {/* 分层架构主体 */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          position: 'relative',
        }}
      >
        {/* 依赖连线层 */}
        <DependencyLines
          architectureData={data}
          containerRef={containerRef}
          hoveredNodeId={hoveredNodeId}
          showDependencies={showDependencies}
          showDataFlow={showDataFlow}
        />

        {/* 层列表 */}
        {data.layers.map((layer) => (
          <div key={layer.id} data-layer-id={layer.id}>
            <LayerComponent
              layer={layer}
              selectedNodeId={selectedNode?.id ?? null}
              onNodeClick={handleNodeClick}
              onNodeHover={handleNodeHover}
              hoveredNodeId={hoveredNodeId}
            />
          </div>
        ))}
      </div>

      {/* 节点详情抽屉 */}
      <DetailPanel
        node={selectedNode}
        architectureData={data}
        onClose={handlePanelClose}
        onNodeClick={handleNodeNavigate}
      />
    </div>
  )
}

export default LayeredArchitecture
