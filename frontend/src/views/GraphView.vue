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
        <div class="graph-legend">
          <div class="legend-item">
            <span class="legend-dot" style="background: var(--color-primary);"></span>
            <span class="legend-label">文件 (File)</span>
          </div>
          <div class="legend-item">
            <span class="legend-dot" style="background: var(--color-success);"></span>
            <span class="legend-label">函数 (Function)</span>
          </div>
          <div class="legend-item">
            <span class="legend-dot" style="background: var(--color-warning);"></span>
            <span class="legend-label">类 (Class)</span>
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
import G6, { Graph } from '@antv/g6'
import { graphApi } from '../api/graph'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const containerRef = ref<HTMLDivElement>()
let graph: Graph | null = null

const goBack = () => {
  const projectId = route.params.id as string
  router.push(`/projects/${projectId}`)
}

const loadGraphData = async () => {
  loading.value = true
  try {
    const projectId = route.params.id as string
    const response = await graphApi.getProjectDependencies(projectId)
    const data = response.data

    initGraph(data)
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '加载图谱数据失败')
  } finally {
    loading.value = false
  }
}

const initGraph = (data: any) => {
  if (!containerRef.value) return

  const width = containerRef.value.offsetWidth
  const height = 650

  // 根据节点类型设置颜色
  const nodeColorMap: Record<string, string> = {
    file: '#58a6ff',
    function: '#3fb950',
    class: '#d29922'
  }

  // 处理节点数据，添加颜色
  const processedData = {
    nodes: data.nodes.map((node: any) => ({
      ...node,
      style: {
        fill: nodeColorMap[node.type] || '#58a6ff',
        stroke: nodeColorMap[node.type] || '#58a6ff'
      }
    })),
    edges: data.edges
  }

  graph = new G6.Graph({
    container: containerRef.value,
    width,
    height,
    modes: {
      default: ['drag-canvas', 'zoom-canvas', 'drag-node']
    },
    layout: {
      type: 'force',
      preventOverlap: true,
      linkDistance: 150,
      nodeStrength: -300,
      edgeStrength: 0.6,
      collideStrength: 0.8
    },
    defaultNode: {
      size: 40,
      style: {
        lineWidth: 2
      },
      labelCfg: {
        style: {
          fill: '#e6edf3',
          fontSize: 12,
          fontFamily: 'var(--font-sans)'
        },
        position: 'bottom',
        offset: 10
      }
    },
    defaultEdge: {
      style: {
        stroke: '#30363d',
        lineWidth: 1.5,
        endArrow: {
          path: G6.Arrow.triangle(8, 10, 0),
          fill: '#30363d'
        }
      },
      labelCfg: {
        autoRotate: true,
        style: {
          fill: '#8b949e',
          fontSize: 10
        }
      }
    },
    nodeStateStyles: {
      hover: {
        lineWidth: 3,
        shadowColor: 'rgba(88, 166, 255, 0.5)',
        shadowBlur: 10
      },
      selected: {
        lineWidth: 3,
        shadowColor: 'rgba(88, 166, 255, 0.8)',
        shadowBlur: 15
      }
    }
  })

  graph.data(processedData)
  graph.render()

  graph.on('node:mouseenter', (evt) => {
    const { item } = evt
    if (item) {
      graph?.setItemState(item, 'hover', true)
    }
  })

  graph.on('node:mouseleave', (evt) => {
    const { item } = evt
    if (item) {
      graph?.setItemState(item, 'hover', false)
    }
  })

  graph.on('node:click', (evt) => {
    const { item } = evt
    if (item) {
      const model = item.getModel()
      ElMessage.info(`节点: ${model.label} (${model.type})`)
    }
  })
}

const fitView = () => {
  graph?.fitView()
}

const zoomIn = () => {
  const currentZoom = graph?.getZoom() || 1
  graph?.zoomTo(currentZoom * 1.2)
}

const zoomOut = () => {
  const currentZoom = graph?.getZoom() || 1
  graph?.zoomTo(currentZoom * 0.8)
}

const resetZoom = () => {
  graph?.zoomTo(1)
  graph?.fitCenter()
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
