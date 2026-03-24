/**
 * ArchitectureCanvas — Cytoscape.js 画布组件（框架图专用）
 *
 * 监听来自 GraphLoader 的 CustomEvent：
 *   graphloader:merge      — 合并新节点/边，局部环形布局
 *   graphloader:collapse   — element.hide() 子节点
 *   graphloader:uncollapse — element.show() 子节点
 *   graphloader:prune      — 折叠距最后展开节点最远的节点
 *   architecturecanvas:relayout — 触发 cose-bilkent 全图重排
 */
import React, { useEffect, useRef, useCallback } from 'react'
import cytoscape from 'cytoscape'
import dagre from 'cytoscape-dagre'
import coseBilkent from 'cytoscape-cose-bilkent'
import { useGraphEngineStore } from '../../../graph-engine/store/graphEngineStore'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
cytoscape.use(dagre as any)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
cytoscape.use(coseBilkent as any)

interface ArchitectureCanvasProps {
  onNodeExpand:   (nodeId: string) => void
  onNodeCollapse: (nodeId: string) => void
  height?:        string | number
}

export const ArchitectureCanvas: React.FC<ArchitectureCanvasProps> = ({
  onNodeExpand,
  onNodeCollapse,
  height = '100%',
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef        = useRef<cytoscape.Core | null>(null)

  const expandedNodes  = useGraphEngineStore(s => s.expandedNodes)
  const collapsedCount = useGraphEngineStore(s => s.collapsedCount)

  // ── 初始化 Cytoscape ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    const cy = cytoscape({
      container: containerRef.current,
      style: [
        {
          selector: 'node',
          style: {
            'label':            'data(label)',
            'background-color': '#1a2035',
            'border-color':     '#00d4ff',
            'border-width':     1,
            'color':            '#e0e6f0',
            'font-size':        11,
            'text-valign':      'center',
            'text-halign':      'center',
            'width':            120,
            'height':           40,
            'shape':            'round-rectangle',
          },
        },
        {
          selector: 'edge',
          style: {
            'line-color':             '#2a3a5c',
            'target-arrow-color':     '#2a3a5c',
            'target-arrow-shape':     'triangle',
            'curve-style':            'bezier',
            'width':                  1.5,
            'line-opacity':           0.8,
          },
        },
        // calls 边 - 青绿色动画
        {
          selector: 'edge[type="calls"]',
          style: {
            'line-color':         '#00f084',
            'target-arrow-color': '#00f084',
            'line-opacity':       0.85,
            'line-style':         'solid',
          },
        },
        // contains 边 - 紫色虚线
        {
          selector: 'edge[type="contains"]',
          style: {
            'line-color':         '#b08eff',
            'target-arrow-color': '#b08eff',
            'line-opacity':       0.6,
            'line-style':         'dashed',
          },
        },
        // depends_on 边 - 琥珀色
        {
          selector: 'edge[type="depends_on"]',
          style: {
            'line-color':         '#ffc145',
            'target-arrow-color': '#ffc145',
            'line-opacity':       0.85,
          },
        },
        // reads 边 - 青色
        {
          selector: 'edge[type="reads"]',
          style: {
            'line-color':         '#00d4ff',
            'target-arrow-color': '#00d4ff',
            'line-opacity':       0.85,
          },
        },
        // writes 边 - 红色
        {
          selector: 'edge[type="writes"]',
          style: {
            'line-color':         '#ff6b6b',
            'target-arrow-color': '#ff6b6b',
            'line-opacity':       0.85,
          },
        },
        // implements 边 - 紫色
        {
          selector: 'edge[type="implements"]',
          style: {
            'line-color':         '#b08eff',
            'target-arrow-color': '#b08eff',
            'line-opacity':       0.7,
            'line-style':         'dotted',
          },
        },
        // imports 边 - 灰色
        {
          selector: 'edge[type="imports"]',
          style: {
            'line-color':         '#6b8aaa',
            'target-arrow-color': '#6b8aaa',
            'line-opacity':       0.6,
          },
        },
        {
          selector: ':hidden',
          style: { 'display': 'none' },
        },
      ],
      layout: { name: 'preset' },
      userZoomingEnabled: true,
      userPanningEnabled: true,
    })

    // 节点点击：展开 or 折叠
    cy.on('tap', 'node', (evt) => {
      const nodeId     = evt.target.id() as string
      const isExpanded = useGraphEngineStore.getState().expandedNodes.has(nodeId)
      if (isExpanded) {
        onNodeCollapse(nodeId)
      } else {
        onNodeExpand(nodeId)
      }
    })

    // ── 边脉冲动画 ───────────────────────────────────────────────────────────
    let animationFrame: number | null = null
    let pulsePhase = 0

    const animateEdges = () => {
      const edges = cy.edges(':visible')
      const pulse = Math.sin(pulsePhase) * 0.25 + 0.75 // 0.5 ~ 1.0

      edges.forEach(edge => {
        // 通过调整透明度实现脉冲效果
        edge.style('line-opacity', pulse)
      })

      pulsePhase += 0.025 // 控制动画速度
      animationFrame = requestAnimationFrame(animateEdges)
    }

    // 启动动画
    animateEdges()

    cyRef.current = cy
    // NOTE: 调用方必须用 useCallback 稳定 onNodeExpand/onNodeCollapse 引用，
    // 否则 prop 变化会导致 cy.destroy() + 重建，丢失图谱状态。
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame)
      cy.destroy()
      cyRef.current = null
    }
  }, [onNodeExpand, onNodeCollapse])

  // ── 监听 graphloader:merge — 合并新节点/边 ────────────────────────────────
  const handleMerge = useCallback((evt: Event) => {
    const cy = cyRef.current
    if (!cy) return
    const { nodes, edges } = (evt as CustomEvent).detail as {
      nodes: Array<{ id: string; type: string; name?: string; properties?: Record<string, unknown> }>
      edges: Array<{ from: string; to: string; type: string }>
    }

    const existingNodeIds = new Set(cy.nodes().map(n => n.id()))
    const newNodes = nodes.filter(n => !existingNodeIds.has(n.id))
    newNodes.forEach(n => {
      cy.add({ group: 'nodes', data: { id: n.id, label: n.name ?? n.id, type: n.type } })
    })

    const existingEdgeIds = new Set(cy.edges().map(e => e.id()))
    edges.forEach(e => {
      const edgeId = `${e.from}-${e.type}-${e.to}`
      if (!existingEdgeIds.has(edgeId)) {
        try {
          cy.add({ group: 'edges', data: { id: edgeId, source: e.from, target: e.to, type: e.type } })
        } catch { /* 端点节点不存在时忽略 */ }
      }
    })

    // 局部布局：新节点环形排布在最后展开节点周围
    if (newNodes.length > 0) {
      const lastExpandedId = useGraphEngineStore.getState().lastExpandedNodeId
      const parentEl = lastExpandedId ? cy.getElementById(lastExpandedId) : null
      if (parentEl && parentEl.length > 0) {
        const parentPos = parentEl.position()
        const radius    = Math.max(150, newNodes.length * 20)
        newNodes.forEach((n, i) => {
          const angle = (2 * Math.PI * i) / newNodes.length
          cy.getElementById(n.id).position({
            x: parentPos.x + radius * Math.cos(angle),
            y: parentPos.y + radius * Math.sin(angle),
          })
        })
      }
    }
  }, [])

  // ── 监听 graphloader:collapse ─────────────────────────────────────────────
  const handleCollapse = useCallback((evt: Event) => {
    const cy = cyRef.current
    if (!cy) return
    const { childIds } = (evt as CustomEvent).detail as { nodeId: string; childIds: string[] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    childIds.forEach(id => (cy.getElementById(id) as any).hide())
  }, [])

  // ── 监听 graphloader:uncollapse ───────────────────────────────────────────
  const handleUncollapse = useCallback((evt: Event) => {
    const cy = cyRef.current
    if (!cy) return
    const { childIds } = (evt as CustomEvent).detail as { nodeId: string; childIds: string[] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    childIds.forEach(id => (cy.getElementById(id) as any).show())
  }, [])

  // ── 监听 graphloader:prune — pruneDistantNodes ────────────────────────────
  const handlePrune = useCallback((evt: Event) => {
    const cy = cyRef.current
    if (!cy) return
    const { centerNodeId, target } = (evt as CustomEvent).detail as {
      centerNodeId: string
      target:       number
    }

    const visibleNodes = cy.nodes(':visible')
    if (visibleNodes.length <= target) return

    const centerEl = cy.getElementById(centerNodeId)
    if (!centerEl.length) return

    // 计算从 centerEl 出发的最短路径（一次 dijkstra，供所有节点复用）
    const dijkstra = cy.elements().dijkstra({ root: centerEl, directed: false })

    const scores = visibleNodes.map(node => {
      if (node.id() === centerNodeId) return { node, score: -1 }
      const topoDist    = dijkstra.distanceTo(node) ?? 999
      const pos1        = centerEl.position()
      const pos2        = node.position()
      const visualDist  = Math.min(
        Math.sqrt((pos1.x - pos2.x) ** 2 + (pos1.y - pos2.y) ** 2) / 1000,
        1,
      )
      return { node, score: topoDist * 0.6 + visualDist * 0.4 }
    }).sort((a, b) => b.score - a.score)

    let currentVisible = visibleNodes.length
    for (const { node, score } of scores) {
      if (currentVisible <= target) break
      if (score < 0) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(node as any).hide()
      currentVisible--
    }
  }, [])

  // ── 监听 architecturecanvas:dagre-layout — 初始加载后 dagre 层次布局 ──────
  const handleDagreLayout = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.layout({ name: 'dagre', rankDir: 'TB', animate: false } as any).run()
    cy.fit(undefined, 40)
  }, [])

  // ── 监听 architecturecanvas:relayout — cose-bilkent 全图重排 ─────────────
  const handleRelayout = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cy.layout({ name: 'cose-bilkent', animate: true } as any).run()
  }, [])

  useEffect(() => {
    window.addEventListener('graphloader:merge',           handleMerge)
    window.addEventListener('graphloader:collapse',        handleCollapse)
    window.addEventListener('graphloader:uncollapse',      handleUncollapse)
    window.addEventListener('graphloader:prune',           handlePrune)
    window.addEventListener('architecturecanvas:dagre-layout', handleDagreLayout)
    window.addEventListener('architecturecanvas:relayout', handleRelayout)
    return () => {
      window.removeEventListener('graphloader:merge',           handleMerge)
      window.removeEventListener('graphloader:collapse',        handleCollapse)
      window.removeEventListener('graphloader:uncollapse',      handleUncollapse)
      window.removeEventListener('graphloader:prune',           handlePrune)
      window.removeEventListener('architecturecanvas:dagre-layout', handleDagreLayout)
      window.removeEventListener('architecturecanvas:relayout', handleRelayout)
    }
  }, [handleMerge, handleCollapse, handleUncollapse, handlePrune, handleDagreLayout, handleRelayout])

  // ── Badge 更新 ────────────────────────────────────────────────────────────
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.nodes().forEach(node => {
      const id = node.id()
      if (collapsedCount.has(id) && (collapsedCount.get(id) ?? 0) > 0) {
        node.data('badge', `↺${collapsedCount.get(id)}`)
      } else if (expandedNodes.has(id)) {
        node.data('badge', '−')
      } else {
        node.data('badge', '+')
      }
    })
  }, [expandedNodes, collapsedCount])

  return <div ref={containerRef} style={{ width: '100%', height }} />
}

export default ArchitectureCanvas
