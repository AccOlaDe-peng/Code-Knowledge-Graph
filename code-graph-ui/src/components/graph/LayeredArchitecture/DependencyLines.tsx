import React, { useEffect, useRef, useCallback } from 'react'
import type { ArchitectureData } from '../../../types/architecture'
import { LAYER_COLORS, type LayerId } from '../../../types/architecture'

type DependencyLinesProps = {
  architectureData: ArchitectureData
  containerRef: React.RefObject<HTMLDivElement | null>
  hoveredNodeId: string | null
  showDependencies: boolean
  showDataFlow: boolean
}

type NodePosition = {
  id: string
  x: number
  y: number
  width: number
  height: number
  layerColor: string
}

const DependencyLines: React.FC<DependencyLinesProps> = ({
  architectureData,
  containerRef,
  hoveredNodeId,
  showDependencies,
  showDataFlow,
}) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const positionsRef = useRef<Map<string, NodePosition>>(new Map())

  // 收集所有节点位置
  const collectPositions = useCallback(() => {
    if (!containerRef.current) return

    const positions = new Map<string, NodePosition>()
    const containerRect = containerRef.current.getBoundingClientRect()

    architectureData.layers.forEach((layer) => {
      const layerColor = LAYER_COLORS[layer.id as LayerId]?.accent || '#4a5568'

      layer.nodes.forEach((node) => {
        const el = containerRef.current?.querySelector(`[data-node-id="${node.id}"]`)
        if (el) {
          const rect = el.getBoundingClientRect()
          positions.set(node.id, {
            id: node.id,
            x: rect.left - containerRect.left + rect.width / 2,
            y: rect.top - containerRect.top + rect.height / 2,
            width: rect.width,
            height: rect.height,
            layerColor,
          })
        }
      })
    })

    positionsRef.current = positions
  }, [architectureData, containerRef])

  // 绘制连线
  const drawLines = useCallback(() => {
    const svg = svgRef.current
    if (!svg) return

    // 清空
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild)
    }

    if (!showDependencies && !showDataFlow) return

    const positions = positionsRef.current
    const lines: Array<{
      from: string
      to: string
      type: 'dependency' | 'dataflow'
      color: string
    }> = []

    // 收集依赖关系
    if (showDependencies) {
      architectureData.layers.forEach((layer) => {
        layer.nodes.forEach((node) => {
          node.dependencies?.forEach((depId) => {
            if (positions.has(depId) && positions.has(node.id)) {
              lines.push({
                from: node.id,
                to: depId,
                type: 'dependency',
                color: '#00d4ff',
              })
            }
          })
        })
      })
    }

    // 收集数据流关系
    if (showDataFlow && architectureData.dataFlow?.flows) {
      architectureData.dataFlow.flows.forEach((flow) => {
        for (let i = 0; i < flow.path.length - 1; i++) {
          const fromName = flow.path[i]
          const toName = flow.path[i + 1]

          // 查找匹配的节点
          let fromId: string | null = null
          let toId: string | null = null

          architectureData.layers.forEach((layer) => {
            layer.nodes.forEach((node) => {
              if (node.displayName === fromName || node.name === fromName) {
                fromId = node.id
              }
              if (node.displayName === toName || node.name === toName) {
                toId = node.id
              }
            })
          })

          if (fromId && toId && positions.has(fromId) && positions.has(toId)) {
            lines.push({
              from: fromId,
              to: toId,
              type: 'dataflow',
              color: '#00f084',
            })
          }
        }
      })
    }

    // 绘制线条
    lines.forEach((line) => {
      const fromPos = positions.get(line.from)!
      const toPos = positions.get(line.to)!

      const isHighlighted = hoveredNodeId === line.from || hoveredNodeId === line.to

      // 创建贝塞尔曲线
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      const midY = (fromPos.y + toPos.y) / 2
      const d = `M ${fromPos.x} ${fromPos.y} C ${fromPos.x} ${midY}, ${toPos.x} ${midY}, ${toPos.x} ${toPos.y}`

      path.setAttribute('d', d)
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', line.color)
      path.setAttribute('stroke-width', isHighlighted ? '2' : '1')
      path.setAttribute('stroke-opacity', isHighlighted ? '1' : '0.4')
      path.setAttribute('stroke-dasharray', line.type === 'dataflow' ? '5,5' : 'none')

      svg.appendChild(path)
    })
  }, [architectureData, hoveredNodeId, showDependencies, showDataFlow])

  // 初始化和窗口变化时重新计算
  useEffect(() => {
    collectPositions()
    drawLines()

    const handleResize = () => {
      collectPositions()
      drawLines()
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [collectPositions, drawLines])

  // hover 变化时重绘
  useEffect(() => {
    drawLines()
  }, [hoveredNodeId, drawLines])

  return (
    <svg
      ref={svgRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  )
}

export default DependencyLines
