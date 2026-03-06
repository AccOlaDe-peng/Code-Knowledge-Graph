<template>
  <div class="graph-view">
    <div class="breadcrumb">
      <span class="breadcrumb-item" @click="goBack">项目列表</span>
      <span class="breadcrumb-separator">/</span>
      <span class="breadcrumb-item" @click="goBack">{{ route.params.id }}</span>
      <span class="breadcrumb-separator">/</span>
      <span class="breadcrumb-item active">代码依赖图谱</span>
    </div>

    <div v-loading="loading" class="graph-container-wrapper">
      <div class="graph-header">
        <h1 class="graph-title">代码依赖图谱</h1>
        <div class="graph-header-right">
          <div v-if="nodeStats.total > 0" class="node-stats">
            <span v-if="nodeStats.showing < nodeStats.total" class="stats-warning">
              显示 {{ nodeStats.showing }} / {{ nodeStats.total }} 个节点（按连接数取前 {{ MAX_NODES }} 个）
            </span>
            <span v-else class="stats-info">
              共 {{ nodeStats.total }} 个节点，{{ nodeStats.edges }} 条依赖关系
            </span>
          </div>
          <div class="graph-legend">
            <div class="legend-item">
              <span class="legend-dot" style="background: var(--color-primary);"></span>
              <span class="legend-label">文件</span>
            </div>
            <div class="legend-item">
              <span class="legend-dot" style="background: var(--color-success);"></span>
              <span class="legend-label">函数</span>
            </div>
            <div class="legend-item">
              <span class="legend-dot" style="background: var(--color-warning);"></span>
              <span class="legend-label">类</span>
            </div>
          </div>
        </div>
      </div>

      <div ref="containerRef" class="graph-canvas"></div>

      <div class="graph-toolbar">
        <button class="toolbar-btn" @click="fitView" title="适应画布">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="2" width="12" height="12" stroke="currentColor" stroke-width="1.5" rx="1" />
            <path d="M5 8H11M8 5V11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
        <button class="toolbar-btn" @click="zoomIn" title="放大">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5" />
            <path d="M7 4V10M4 7H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <path d="M11 11L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
        <button class="toolbar-btn" @click="zoomOut" title="缩小">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5" />
            <path d="M4 7H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <path d="M11 11L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
        <button class="toolbar-btn" @click="resetZoom" title="重置">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 3L3 13M3 3L13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Graph } from '@antv/g6'
import { graphApi } from '../api/graph'

const route = useRoute()
const router = useRouter()

const MAX_NODES = 150

const loading = ref(false)
const containerRef = ref<HTMLDivElement>()
const nodeStats = ref({ total: 0, showing: 0, edges: 0 })
let graph: Graph | null = null

const goBack = () => {
  const projectId = route.params.id as string
  router.push(`/projects/${projectId}`)
}

const transformGraphData = (rawData: Array<{ file: string; imports: string[] }>) => {
  // 计算每个节点的度（连接数），按度排序后取 Top N
  const degreeMap = new Map<string, number>()
  const allEdges: Array<{ source: string; target: string; type: string }> = []

  for (const item of rawData) {
    degreeMap.set(item.file, (degreeMap.get(item.file) || 0))
    for (const imp of item.imports) {
      degreeMap.set(item.file, (degreeMap.get(item.file) || 0) + 1)
      degreeMap.set(imp, (degreeMap.get(imp) || 0) + 1)
      allEdges.push({ source: item.file, target: imp, type: 'imports' })
    }
  }

  const totalNodes = degreeMap.size

  // 按连接数降序取 Top MAX_NODES
  const topNodes = Array.from(degreeMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_NODES)
    .map(([filePath]) => filePath)

  const nodeSet = new Set(topNodes)

  // 只保留两端节点都在 nodeSet 中的边
  const edges = allEdges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target))

  const nodes = topNodes.map(filePath => ({
    id: filePath,
    label: filePath.split('/').pop() || filePath,
    type: 'file'
  }))

  nodeStats.value = { total: totalNodes, showing: nodes.length, edges: edges.length }

  return { nodes, edges }
}

const loadGraphData = async () => {
  loading.value = true
  try {
    const projectId = route.params.id as string
    const response = await graphApi.getProjectDependencies(projectId)
    const rawData = response.data

    const data = Array.isArray(rawData) ? transformGraphData(rawData) : rawData
    await initGraph(data)
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '加载图谱数据失败')
  } finally {
    loading.value = false
  }
}

const initGraph = async (data: any) => {
  if (!containerRef.value) return

  const width = containerRef.value.offsetWidth || 800
  const height = 650

  const nodeColorMap: Record<string, string> = {
    file: '#58a6ff',
    function: '#3fb950',
    class: '#d29922'
  }

  const nodeCount = data.nodes.length

  graph = new Graph({
    container: containerRef.value,
    width,
    height,
    autoFit: 'view',
    animation: false,
    data: {
      nodes: data.nodes.map((node: any) => ({
        id: node.id,
        data: { label: node.label, nodeType: node.type }
      })),
      edges: data.edges.map((edge: any, i: number) => ({
        id: `e${i}-${edge.source}-${edge.target}`.slice(0, 64),
        source: edge.source,
        target: edge.target,
        data: { edgeType: edge.type }
      }))
    },
    node: {
      style: (d: any) => ({
        size: 32,
        fill: nodeColorMap[d.data?.nodeType] || '#58a6ff',
        stroke: nodeColorMap[d.data?.nodeType] || '#58a6ff',
        lineWidth: 2,
        labelText: d.data?.label || d.id,
        labelFill: '#e6edf3',
        labelFontSize: 11,
        labelPlacement: 'bottom',
        labelOffsetY: 4
      })
    },
    edge: {
      style: {
        stroke: '#484f58',
        lineWidth: 1,
        endArrow: true,
        endArrowFill: '#484f58'
      }
    },
    // 节点少用 force，多用 dagre（拓扑排序，渲染更快）
    layout: nodeCount <= 50
      ? { type: 'force', preventOverlap: true, linkDistance: 120, nodeStrength: -200 }
      : { type: 'dagre', rankdir: 'LR', nodesep: 16, ranksep: 60, controlPoints: false },
    behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
  })

  await graph.render()

  graph.on('node:click', (evt: any) => {
    const nodeData = evt.target?.data || {}
    const nodeId = evt.target?.id || ''
    ElMessage.info(`节点: ${nodeData.label || nodeId} (${nodeData.nodeType || 'file'})`)
  })
}

const fitView = () => {
  graph?.fitView()
}

const zoomIn = () => {
  const currentZoom = graph?.getZoom() ?? 1
  graph?.zoomTo(currentZoom * 1.2, undefined, { duration: 200 })
}

const zoomOut = () => {
  const currentZoom = graph?.getZoom() ?? 1
  graph?.zoomTo(currentZoom * 0.8, undefined, { duration: 200 })
}

const resetZoom = () => {
  graph?.zoomTo(1, undefined, { duration: 200 })
  graph?.fitView()
}

onMounted(() => {
  loadGraphData()
})

onBeforeUnmount(() => {
  if (graph) {
    graph.destroy()
  }
})
</script>

<style scoped>
.graph-view {
  max-width: 1600px;
  margin: 0 auto;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
  font-size: 13px;
}

.breadcrumb-item {
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.15s ease;
}

.breadcrumb-item:hover {
  color: var(--color-primary);
}

.breadcrumb-item.active {
  color: var(--text-primary);
  cursor: default;
}

.breadcrumb-separator {
  color: var(--text-tertiary);
}

.graph-container-wrapper {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 24px;
  position: relative;
}

.graph-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.graph-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  font-family: var(--font-mono);
}

.graph-header-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.node-stats {
  font-size: 12px;
}

.stats-warning {
  color: var(--color-warning, #d29922);
}

.stats-info {
  color: var(--text-tertiary);
}

.graph-legend {
  display: flex;
  gap: 20px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-label {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.graph-canvas {
  width: 100%;
  height: 650px;
  background: var(--bg-base);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  position: relative;
}

.graph-toolbar {
  position: absolute;
  bottom: 40px;
  right: 40px;
  display: flex;
  gap: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 8px;
  box-shadow: var(--shadow-md);
}

.toolbar-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.toolbar-btn:hover {
  background: var(--color-primary-muted);
  color: var(--color-primary);
}

.toolbar-btn:active {
  transform: scale(0.95);
}
</style>
