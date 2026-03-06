<template>
  <div class="graph-view">
    <div class="breadcrumb">
      <span class="breadcrumb-item" @click="goBack">项目列表</span>
      <span class="breadcrumb-separator">/</span>
      <span class="breadcrumb-item" @click="goProject">{{ route.params.id }}</span>
      <span class="breadcrumb-separator">/</span>
      <span class="breadcrumb-item active">数据血缘图</span>
    </div>

    <div v-loading="loading" class="graph-container-wrapper">
      <div class="graph-header">
        <div class="graph-title-block">
          <h1 class="graph-title">数据血缘图</h1>
          <p class="graph-subtitle">追踪文件级别的数据流动：从数据源经转换层到数据汇</p>
        </div>
        <div class="graph-header-right">
          <div v-if="nodeStats.total > 0" class="node-stats">
            <span v-if="nodeStats.showing < nodeStats.total" class="stats-warning">
              显示 {{ nodeStats.showing }} / {{ nodeStats.total }} 个节点
            </span>
            <span v-else class="stats-info">
              共 {{ nodeStats.total }} 个节点，{{ nodeStats.edges }} 条数据流
            </span>
          </div>
          <div class="graph-legend">
            <div v-for="item in legendItems" :key="item.label" class="legend-item">
              <span class="legend-dot" :style="{ background: item.color }"></span>
              <span class="legend-label">{{ item.label }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="isEmpty" class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
          <path d="M12 8V12M12 16H12.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>
        </svg>
        <p>未检测到数据 IO 操作</p>
        <p class="empty-hint">代码中未发现 HTTP 调用或数据库操作，无法构建血缘图</p>
      </div>

      <div v-show="!isEmpty" ref="containerRef" class="graph-canvas"></div>

      <div class="graph-toolbar">
        <button class="toolbar-btn" @click="fitView" title="适应画布">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="12" stroke="currentColor" stroke-width="1.5" rx="1"/>
            <path d="M5 8H11M8 5V11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="toolbar-btn" @click="zoomIn" title="放大">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M7 4V10M4 7H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M11 11L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="toolbar-btn" @click="zoomOut" title="缩小">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M4 7H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M11 11L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="toolbar-btn" @click="resetZoom" title="重置">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M13 3L3 13M3 3L13 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
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
const isEmpty = ref(false)
const containerRef = ref<HTMLDivElement>()
const nodeStats = ref({ total: 0, showing: 0, edges: 0 })
let graph: Graph | null = null

const DATA_ROLE_COLORS: Record<string, string> = {
  source: '#f85149',
  transform: '#58a6ff',
  sink: '#bc8cff',
  mixed: '#d29922',
  unknown: '#484f58',
}

const legendItems = [
  { label: '数据源', color: '#f85149' },
  { label: '数据转换', color: '#58a6ff' },
  { label: '数据汇', color: '#bc8cff' },
  { label: '混合', color: '#d29922' },
]

const goBack = () => router.push('/projects')
const goProject = () => router.push(`/projects/${route.params.id}`)

const loadGraphData = async () => {
  loading.value = true
  try {
    const projectId = route.params.id as string
    const response = await graphApi.getDataLineage(projectId)
    const { nodes, edges } = response.data

    const totalNodes = nodes.length

    // 按连接度排序，取前 MAX_NODES 个
    const degreeMap = new Map<string, number>()
    for (const e of edges) {
      degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1)
      degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1)
    }

    const topIds = new Set(
      nodes
        .slice()
        .sort((a, b) => (degreeMap.get(b.id) || 0) - (degreeMap.get(a.id) || 0))
        .slice(0, MAX_NODES)
        .map(n => n.id)
    )

    const filteredNodes = nodes.filter(n => topIds.has(n.id))
    const filteredEdges = edges.filter(e => topIds.has(e.source) && topIds.has(e.target))

    nodeStats.value = { total: totalNodes, showing: filteredNodes.length, edges: filteredEdges.length }

    // 检查是否有有效数据（非全 unknown）
    const hasRealData = filteredNodes.some(n => n.dataRole !== 'unknown')
    isEmpty.value = filteredNodes.length === 0 || !hasRealData

    if (!isEmpty.value) {
      await initGraph(filteredNodes, filteredEdges)
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '加载数据血缘图失败')
  } finally {
    loading.value = false
  }
}

const initGraph = async (
  nodes: Array<{ id: string; label: string; dataRole: string }>,
  edges: Array<{ id: string; source: string; target: string }>
) => {
  if (!containerRef.value) return

  if (graph) {
    graph.destroy()
    graph = null
  }

  const width = containerRef.value.offsetWidth || 900
  const height = 650

  graph = new Graph({
    container: containerRef.value,
    width,
    height,
    autoFit: 'view',
    animation: false,
    data: {
      nodes: nodes.map(n => ({
        id: n.id,
        data: { label: n.label, dataRole: n.dataRole },
      })),
      edges: edges.map((e, i) => ({
        id: `e${i}`,
        source: e.source,
        target: e.target,
      })),
    },
    node: {
      style: (d: any) => ({
        size: 32,
        fill: DATA_ROLE_COLORS[d.data?.dataRole] || DATA_ROLE_COLORS.unknown,
        stroke: DATA_ROLE_COLORS[d.data?.dataRole] || DATA_ROLE_COLORS.unknown,
        lineWidth: 2,
        labelText: d.data?.label || d.id,
        labelFill: '#e6edf3',
        labelFontSize: 11,
        labelPlacement: 'bottom',
        labelOffsetY: 4,
      }),
    },
    edge: {
      style: {
        stroke: '#484f58',
        lineWidth: 1,
        endArrow: true,
        endArrowFill: '#484f58',
      },
    },
    layout: { type: 'dagre', rankdir: 'LR', nodesep: 20, ranksep: 80, controlPoints: false },
    behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
  })

  await graph.render()

  graph.on('node:click', (evt: any) => {
    const nodeData = evt.target?.data || {}
    const nodeId = evt.target?.id || ''
    const roleLabel: Record<string, string> = {
      source: '数据源', transform: '数据转换', sink: '数据汇', mixed: '混合', unknown: '未知'
    }
    ElMessage.info(`${nodeData.label || nodeId}（${roleLabel[nodeData.dataRole] || ''}）`)
  })
}

const fitView = () => graph?.fitView()
const zoomIn = () => { const z = graph?.getZoom() ?? 1; graph?.zoomTo(z * 1.2, undefined, { duration: 200 }) }
const zoomOut = () => { const z = graph?.getZoom() ?? 1; graph?.zoomTo(z * 0.8, undefined, { duration: 200 }) }
const resetZoom = () => { graph?.zoomTo(1, undefined, { duration: 200 }); graph?.fitView() }

onMounted(() => { loadGraphData() })
onBeforeUnmount(() => { if (graph) graph.destroy() })
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

.breadcrumb-item:hover { color: var(--color-primary); }
.breadcrumb-item.active { color: var(--text-primary); cursor: default; }
.breadcrumb-separator { color: var(--text-tertiary); }

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
  align-items: flex-start;
  margin-bottom: 20px;
}

.graph-title-block { display: flex; flex-direction: column; gap: 4px; }

.graph-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  font-family: var(--font-mono);
}

.graph-subtitle {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0;
}

.graph-header-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.node-stats { font-size: 12px; }
.stats-warning { color: var(--color-warning, #d29922); }
.stats-info { color: var(--text-tertiary); }

.graph-legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 400px;
  color: var(--text-tertiary);
  gap: 12px;
}

.empty-state p { margin: 0; font-size: 15px; }
.empty-hint { font-size: 13px !important; }

.graph-canvas {
  width: 100%;
  height: 650px;
  background: var(--bg-base);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
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
</style>
