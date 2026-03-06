<template>
  <div class="graph-view">
    <div class="breadcrumb">
      <span class="breadcrumb-item" @click="goBack">项目列表</span>
      <span class="breadcrumb-separator">/</span>
      <span class="breadcrumb-item" @click="goProject">{{ route.params.id }}</span>
      <span class="breadcrumb-separator">/</span>
      <span class="breadcrumb-item active">AI 语义图谱</span>
    </div>

    <div v-loading="loading" class="page-layout">
      <!-- 无 AI 数据警告横幅 -->
      <div v-if="!loading && !hasAiData && !isEmpty" class="ai-warning-banner">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>当前语义分组仅基于文件路径关键词推断，准确度有限。
          <span class="banner-link" @click="goProject">触发 AI 分析</span> 后可获得更精准的语义图谱。
        </span>
      </div>

      <div class="graph-container-wrapper">
        <div class="graph-header">
          <div class="graph-title-block">
            <h1 class="graph-title">AI 语义图谱</h1>
            <p class="graph-subtitle">按业务语义将文件聚类到不同的功能域</p>
          </div>
          <div class="graph-header-right">
            <div v-if="nodeStats.total > 0" class="node-stats">
              <span class="stats-info">{{ domains.length }} 个业务域，{{ nodeStats.total }} 个文件</span>
            </div>
          </div>
        </div>

        <div v-if="isEmpty" class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
            <path d="M12 8V12M12 16H12.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>
          </svg>
          <p>暂无图谱数据</p>
          <p class="empty-hint">请先完成代码分析，再查看语义图谱</p>
        </div>

        <div v-show="!isEmpty" class="canvas-area">
          <div ref="containerRef" class="graph-canvas"></div>

          <!-- 域面板 -->
          <div v-if="domains.length > 0" class="domain-panel">
            <div class="domain-panel__title">业务域</div>
            <div class="domain-list">
              <div v-for="d in domains" :key="d.name" class="domain-item">
                <span class="domain-dot" :style="{ background: d.color }"></span>
                <span class="domain-name">{{ d.name }}</span>
                <span class="domain-count">{{ d.fileCount }}</span>
              </div>
            </div>
            <div class="domain-panel__legend">
              <div class="legend-row">
                <span class="legend-line" style="border-top: 2px solid #484f58;"></span>
                <span class="legend-text">文件依赖</span>
              </div>
              <div class="legend-row">
                <span class="legend-line" style="border-top: 1px dashed #58a6ff; opacity: 0.5;"></span>
                <span class="legend-text">属于域</span>
              </div>
            </div>
          </div>
        </div>

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

const MAX_NODES = 200

const loading = ref(false)
const isEmpty = ref(false)
const hasAiData = ref(true)
const containerRef = ref<HTMLDivElement>()
const nodeStats = ref({ total: 0, showing: 0 })
const domains = ref<Array<{ name: string; color: string; fileCount: number }>>([])
let graph: Graph | null = null

const goBack = () => router.push('/projects')
const goProject = () => router.push(`/projects/${route.params.id}`)

const loadGraphData = async () => {
  loading.value = true
  try {
    const projectId = route.params.id as string
    const response = await graphApi.getSemanticGraph(projectId)
    const data = response.data

    hasAiData.value = data.hasAiData
    domains.value = data.domains

    const allNodes = data.nodes
    const allEdges = data.edges

    isEmpty.value = allNodes.length === 0

    if (!isEmpty.value) {
      // 域节点不限制数量，文件节点按连接度取前 MAX_NODES
      const domainNodes = allNodes.filter(n => n.nodeType === 'domain')
      const fileNodes = allNodes.filter(n => n.nodeType === 'file')

      const degreeMap = new Map<string, number>()
      for (const e of allEdges) {
        degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1)
        degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1)
      }

      const topFileIds = new Set(
        fileNodes
          .slice()
          .sort((a, b) => (degreeMap.get(b.id) || 0) - (degreeMap.get(a.id) || 0))
          .slice(0, MAX_NODES)
          .map(n => n.id)
      )

      const filteredNodes = [...domainNodes, ...fileNodes.filter(n => topFileIds.has(n.id))]
      const filteredNodeIds = new Set(filteredNodes.map(n => n.id))
      const filteredEdges = allEdges.filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target))

      nodeStats.value = { total: fileNodes.length, showing: topFileIds.size }
      await initGraph(filteredNodes, filteredEdges)
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '加载语义图谱失败')
  } finally {
    loading.value = false
  }
}

const initGraph = async (
  nodes: Array<{ id: string; label: string; nodeType: string; color: string }>,
  edges: Array<{ id: string; source: string; target: string; edgeType: string }>
) => {
  if (!containerRef.value) return

  if (graph) {
    graph.destroy()
    graph = null
  }

  const width = containerRef.value.offsetWidth || 860
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
        data: { label: n.label, nodeType: n.nodeType, color: n.color },
      })),
      edges: edges.map((e, i) => ({
        id: `e${i}`,
        source: e.source,
        target: e.target,
        data: { edgeType: e.edgeType },
      })),
    },
    node: {
      style: (d: any) => {
        const isDomain = d.data?.nodeType === 'domain'
        return {
          size: isDomain ? 48 : 20,
          fill: isDomain ? d.data?.color : '#484f58',
          stroke: isDomain ? d.data?.color : '#30363d',
          lineWidth: isDomain ? 3 : 1,
          labelText: d.data?.label || d.id,
          labelFill: isDomain ? '#e6edf3' : '#8b949e',
          labelFontSize: isDomain ? 13 : 10,
          labelFontWeight: isDomain ? 700 : 400,
          labelPlacement: 'bottom',
          labelOffsetY: 4,
        }
      },
    },
    edge: {
      style: (d: any) => {
        const isBelongsTo = d.data?.edgeType === 'belongs_to'
        return {
          stroke: isBelongsTo ? '#58a6ff' : '#484f58',
          lineWidth: 1,
          lineDash: isBelongsTo ? [4, 4] : [],
          endArrow: !isBelongsTo,
          endArrowFill: '#484f58',
          opacity: isBelongsTo ? 0.35 : 0.6,
        }
      },
    },
    layout: {
      type: 'force',
      preventOverlap: true,
      linkDistance: 140,
      nodeStrength: -300,
    },
    behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
  })

  await graph.render()

  graph.on('node:click', (evt: any) => {
    const nodeData = evt.target?.data || {}
    const nodeId = evt.target?.id || ''
    if (nodeData.nodeType === 'domain') {
      const domain = domains.value.find(d => d.name === nodeData.label)
      ElMessage.info(`业务域：${nodeData.label}（${domain?.fileCount || 0} 个文件）`)
    } else {
      ElMessage.info(`文件：${nodeData.label || nodeId}`)
    }
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

.page-layout {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ai-warning-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(210,153,34,.08);
  border: 1px solid rgba(210,153,34,.25);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  font-size: 13px;
  color: var(--color-warning, #d29922);
}

.banner-link {
  text-decoration: underline;
  cursor: pointer;
  color: var(--color-primary);
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

.graph-header-right { display: flex; flex-direction: column; align-items: flex-end; }

.node-stats { font-size: 12px; }
.stats-info { color: var(--text-tertiary); }

.canvas-area {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.graph-canvas {
  flex: 1;
  height: 650px;
  background: var(--bg-base);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

/* 域面板 */
.domain-panel {
  width: 180px;
  flex-shrink: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.domain-panel__title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-tertiary);
}

.domain-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.domain-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.domain-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.domain-name {
  flex: 1;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.domain-count {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  background: var(--bg-surface);
  padding: 1px 6px;
  border-radius: 10px;
}

.domain-panel__legend {
  border-top: 1px solid var(--border-muted);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.legend-line {
  display: inline-block;
  width: 24px;
  flex-shrink: 0;
}

.legend-text { font-size: 11px; }

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
