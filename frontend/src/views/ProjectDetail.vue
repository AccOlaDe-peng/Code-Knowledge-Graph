<template>
  <div class="project-detail">

    <!-- Breadcrumb -->
    <div class="breadcrumb">
      <span class="bc-item" @click="goBack">项目列表</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" class="bc-sep">
        <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="bc-item bc-item--active">{{ project?.name || '…' }}</span>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="skeleton-wrap">
      <div class="skeleton-header">
        <div class="skeleton-line w-48 h-8"></div>
        <div class="skeleton-line w-24 h-5 mt-2"></div>
      </div>
      <div class="skeleton-grid">
        <div v-for="n in 4" :key="n" class="skeleton-cell">
          <div class="skeleton-line w-16 h-3 mb-2"></div>
          <div class="skeleton-line w-32 h-5"></div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div v-else-if="project" class="detail-card">

      <!-- Header section -->
      <div class="detail-header">
        <div class="header-main">
          <div class="project-title-row">
            <h1 class="project-name">{{ project.name }}</h1>
            <span :class="['status-badge', `sb--${project.status}`]">
              <span :class="['sb-dot', project.status === 'analyzing' && 'is-pulsing']"></span>
              {{ getStatusText(project.status) }}
            </span>
          </div>
          <p v-if="project.description" class="project-desc">{{ project.description }}</p>
          <p v-else class="project-desc project-desc--muted">暂无描述</p>
        </div>

        <!-- Action Buttons -->
        <div class="header-actions">
          <button
            v-if="project.status !== 'analyzing'"
            :class="['action-btn', project.status === 'failed' ? 'action-btn--warn' : 'action-btn--primary']"
            :disabled="analyzing"
            @click="handleAnalyze"
          >
            <svg v-if="analyzing" class="spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 2V6M12 18V22M4.93 4.93L7.76 7.76M16.24 16.24L19.07 19.07M2 12H6M18 12H22M4.93 19.07L7.76 16.24M16.24 7.76L19.07 4.93" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M5 3L19 12L5 21V3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
            {{ analyzing ? '提交中…' : project.status === 'pending' ? '开始分析' : '重新分析' }}
          </button>

          <button
            v-if="project.status === 'completed'"
            class="action-btn action-btn--ghost"
            @click="viewGraph"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="5" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="19" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="12" cy="19" r="2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M6.5 6L10.5 17.5M13.5 17.5L17.5 6M7 5H17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            代码图谱
          </button>

          <button
            v-if="project.status === 'completed'"
            class="action-btn action-btn--accent"
            @click="viewAiAnalysis"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L13.09 8.26L19 6L15.45 11.09L21 13L15.45 14.91L19 20L13.09 17.74L12 24L10.91 17.74L5 20L8.55 14.91L3 13L8.55 11.09L5 6L10.91 8.26L12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
            AI 分析
          </button>
        </div>
      </div>

      <!-- Analyzing Progress Banner -->
      <div v-if="project.status === 'analyzing'" class="analyzing-banner">
        <div class="analyzing-beam"></div>
        <div class="analyzing-content">
          <div class="analyzing-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L13.09 8.26L19 6L15.45 11.09L21 13L15.45 14.91L19 20L13.09 17.74L12 24L10.91 17.74L5 20L8.55 14.91L3 13L8.55 11.09L5 6L10.91 8.26L12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="analyzing-text">
            <div class="analyzing-title">AI 正在深度分析代码库</div>
            <div class="analyzing-hint">正在扫描依赖关系、风险点和技术债务，通常需要 1-5 分钟…</div>
          </div>
          <div class="analyzing-dots">
            <span></span><span></span><span></span>
          </div>
        </div>
        <div class="analyzing-progress">
          <div class="analyzing-progress-bar"></div>
        </div>
      </div>

      <!-- Failed Banner -->
      <div v-if="project.status === 'failed'" class="failed-banner">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/>
          <path d="M12 8V12M12 16H12.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        分析失败，请检查项目配置后重试
      </div>

      <!-- Info Grid -->
      <div class="info-grid">
        <div class="info-cell">
          <div class="info-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path d="M21 16V8C21 6.9 20.1 6 19 6H5C3.9 6 3 6.9 3 8V16C3 17.1 3.9 18 5 18H19C20.1 18 21 17.1 21 16Z" stroke="currentColor" stroke-width="1.5"/>
              <path d="M8 12H16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            项目名称
          </div>
          <div class="info-value">{{ project.name }}</div>
        </div>

        <div class="info-cell">
          <div class="info-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>
              <path d="M12 8V12L15 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            当前状态
          </div>
          <div class="info-value">
            <span :class="['status-dot-sm', `sds--${project.status}`]"></span>
            {{ getStatusText(project.status) }}
          </div>
        </div>

        <div class="info-cell">
          <div class="info-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M16 2V6M8 2V6M3 10H21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            创建时间
          </div>
          <div class="info-value info-value--mono">{{ formatDate(project.createdAt) }}</div>
        </div>

        <div class="info-cell">
          <div class="info-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path d="M23 4V10H17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M20.49 15A9 9 0 1 1 21.35 8.36L23 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            最后更新
          </div>
          <div class="info-value info-value--mono">{{ formatDate(project.updatedAt) }}</div>
        </div>

        <div v-if="project.description" class="info-cell info-cell--wide">
          <div class="info-label">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6C5.47 2 4.96 2.21 4.59 2.59C4.21 2.96 4 3.47 4 4V20C4 20.53 4.21 21.04 4.59 21.41C4.96 21.79 5.47 22 6 22H18C18.53 22 19.04 21.79 19.41 21.41C19.79 21.04 20 20.53 20 20V8L14 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              <path d="M14 2V8H20M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            项目描述
          </div>
          <div class="info-value">{{ project.description }}</div>
        </div>
      </div>

      <!-- Completed Quick Actions -->
      <div v-if="project.status === 'completed'" class="quick-actions">
        <div class="qa-label">快速访问</div>
        <div class="qa-cards">
          <div class="qa-card" @click="viewGraph">
            <div class="qa-card__icon qa-card__icon--graph">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="5" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="19" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="12" cy="19" r="2.5" stroke="currentColor" stroke-width="1.5"/>
                <path d="M7 5.5H17M6 6.5L11 17.5M13 17.5L18 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </div>
            <div class="qa-card__body">
              <div class="qa-card__title">代码依赖图谱</div>
              <div class="qa-card__desc">可视化文件、类、函数之间的依赖关系</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" class="qa-card__arrow">
              <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>

          <div class="qa-card" @click="viewAiAnalysis">
            <div class="qa-card__icon qa-card__icon--ai">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L13.09 8.26L19 6L15.45 11.09L21 13L15.45 14.91L19 20L13.09 17.74L12 24L10.91 17.74L5 20L8.55 14.91L3 13L8.55 11.09L5 6L10.91 8.26L12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="qa-card__body">
              <div class="qa-card__title">AI 分析报告</div>
              <div class="qa-card__desc">查看代码总结、风险分析与技术债务评估</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" class="qa-card__arrow">
              <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>

          <div class="qa-card" @click="viewDataLineage">
            <div class="qa-card__icon qa-card__icon--lineage">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="4" cy="12" r="2.5" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="12" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="12" cy="19" r="2.5" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="20" cy="12" r="2.5" stroke="currentColor" stroke-width="1.5"/>
                <path d="M6.5 12H9.5M14.5 5.5L17.5 10.5M14.5 18.5L17.5 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </div>
            <div class="qa-card__body">
              <div class="qa-card__title">数据血缘图</div>
              <div class="qa-card__desc">追踪数据从源头到流向的完整路径</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" class="qa-card__arrow">
              <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>

          <div class="qa-card" @click="viewSemanticGraph">
            <div class="qa-card__icon qa-card__icon--semantic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="4" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="20" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="4" cy="19" r="2" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="20" cy="19" r="2" stroke="currentColor" stroke-width="1.5"/>
                <path d="M6 6L10 10M18 6L14 10M6 18L10 14M18 18L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </div>
            <div class="qa-card__body">
              <div class="qa-card__title">AI 语义图谱</div>
              <div class="qa-card__desc">基于 AI 分析按业务语义聚类代码模块</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" class="qa-card__arrow">
              <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>

          <div class="qa-card" @click="viewBusinessFlow">
            <div class="qa-card__icon qa-card__icon--flow">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="3" width="8" height="5" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
                <rect x="8" y="10" width="8" height="5" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
                <rect x="14" y="17" width="8" height="5" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
                <path d="M6 8V10.5Q6 12 8 12M12 15V17.5Q12 19 14 19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </div>
            <div class="qa-card__body">
              <div class="qa-card__title">业务流程图</div>
              <div class="qa-card__desc">展示 Controller → Service → Repository 调用链</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" class="qa-card__arrow">
              <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useProjectStore } from '../stores/project'
import { ProjectStatus, type Project } from '../types/project'
import { projectsApi } from '../api/projects'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()

const loading = ref(false)
const analyzing = ref(false)
const project = ref<Project | null>(null)
let pollingTimer: number | null = null

const getStatusText = (status?: ProjectStatus) => {
  if (!status) return ''
  const textMap = {
    pending: '待分析',
    analyzing: '分析中',
    completed: '已完成',
    failed: '失败'
  }
  return textMap[status] || status
}

const formatDate = (date?: string) => {
  if (!date) return '—'
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const loadProject = async () => {
  loading.value = true
  try {
    const projectId = route.params.id as string
    const response = await projectsApi.getProject(projectId)
    project.value = response.data
    projectStore.setCurrentProject(response.data)
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '加载项目详情失败')
  } finally {
    loading.value = false
  }
}

const handleAnalyze = async () => {
  if (!project.value) return

  analyzing.value = true
  try {
    await projectsApi.analyzeProject(project.value.id)
    ElMessage.success('分析任务已提交，请稍候…')
    project.value.status = ProjectStatus.ANALYZING
    projectStore.updateProject(project.value.id, { status: ProjectStatus.ANALYZING })
    startPolling()
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '提交分析任务失败')
  } finally {
    analyzing.value = false
  }
}

const viewGraph = () => {
  if (project.value) router.push(`/projects/${project.value.id}/graph`)
}

const viewAiAnalysis = () => {
  if (project.value) router.push(`/projects/${project.value.id}/ai-analysis`)
}

const viewDataLineage = () => {
  if (project.value) router.push(`/projects/${project.value.id}/data-lineage`)
}

const viewSemanticGraph = () => {
  if (project.value) router.push(`/projects/${project.value.id}/semantic-graph`)
}

const viewBusinessFlow = () => {
  if (project.value) router.push(`/projects/${project.value.id}/business-flow`)
}

const goBack = () => {
  router.push('/projects')
}

const startPolling = () => {
  if (project.value?.status === ProjectStatus.ANALYZING) {
    pollingTimer = window.setInterval(async () => {
      try {
        const projectId = route.params.id as string
        const response = await projectsApi.getProject(projectId)
        const updatedProject = response.data
        project.value = updatedProject
        projectStore.updateProject(projectId, updatedProject)

        if (updatedProject.status !== ProjectStatus.ANALYZING) {
          stopPolling()
          if (updatedProject.status === ProjectStatus.COMPLETED) {
            ElMessage.success('项目分析完成！')
          } else if (updatedProject.status === ProjectStatus.FAILED) {
            ElMessage.error('项目分析失败')
          }
        }
      } catch (error) {
        console.error('轮询更新项目状态失败:', error)
      }
    }, 3000)
  }
}

const stopPolling = () => {
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
}

onMounted(() => {
  loadProject().then(() => {
    startPolling()
  })
})

onBeforeUnmount(() => {
  stopPolling()
})
</script>

<style scoped>
/* ── Layout ─────────────────────────────────── */
.project-detail {
  max-width: 900px;
  animation: page-in 0.25s ease;
}

@keyframes page-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Breadcrumb ─────────────────────────────── */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 24px;
}

.bc-item {
  font-size: 13px;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color 0.15s;
}

.bc-item:hover { color: var(--color-primary); }

.bc-item--active {
  color: var(--text-secondary);
  cursor: default;
}

.bc-sep {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* ── Skeleton ───────────────────────────────── */
.skeleton-wrap {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 32px;
}

.skeleton-header { margin-bottom: 32px; }
.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.skeleton-line {
  background: var(--bg-elevated);
  border-radius: 4px;
  animation: shimmer 1.5s ease-in-out infinite;
}

.skeleton-cell { display: flex; flex-direction: column; }
.w-16 { width: 64px; }
.w-24 { width: 96px; }
.w-32 { width: 128px; }
.w-48 { width: 192px; }
.h-3  { height: 12px; }
.h-5  { height: 20px; }
.h-8  { height: 32px; }
.mt-2 { margin-top: 8px; }
.mb-2 { margin-bottom: 8px; }

@keyframes shimmer {
  0%, 100% { opacity: 0.4; }
  50%       { opacity: 0.8; }
}

/* ── Main Card ──────────────────────────────── */
.detail-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

/* ── Detail Header ──────────────────────────── */
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  padding: 28px 32px;
  border-bottom: 1px solid var(--border-muted);
}

.header-main { flex: 1; min-width: 0; }

.project-title-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.project-name {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  font-family: var(--font-mono);
  letter-spacing: -0.5px;
  margin: 0;
}

.project-desc {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
}

.project-desc--muted { color: var(--text-tertiary); font-style: italic; }

/* Status Badge */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 20px;
  flex-shrink: 0;
}

.sb-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.is-pulsing { animation: pulse 1.4s ease-in-out infinite; }

.sb--pending   { background: rgba(139,148,158,.12); color: var(--color-info);    border: 1px solid rgba(139,148,158,.25); }
.sb--pending .sb-dot   { background: var(--color-info); }
.sb--analyzing { background: rgba(210,153,34,.12);  color: var(--color-warning); border: 1px solid rgba(210,153,34,.25); }
.sb--analyzing .sb-dot { background: var(--color-warning); }
.sb--completed { background: rgba(63,185,80,.12);   color: var(--color-success); border: 1px solid rgba(63,185,80,.25); }
.sb--completed .sb-dot { background: var(--color-success); }
.sb--failed    { background: rgba(248,81,73,.12);   color: var(--color-danger);  border: 1px solid rgba(248,81,73,.25); }
.sb--failed .sb-dot    { background: var(--color-danger); }

/* Action Buttons */
.header-actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
  align-items: flex-start;
  flex-wrap: wrap;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 600;
  border-radius: var(--radius-md);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.action-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.action-btn--primary {
  background: var(--color-primary);
  color: #fff;
}
.action-btn--primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
  box-shadow: 0 0 14px rgba(88, 166, 255, 0.3);
}

.action-btn--warn {
  background: rgba(210,153,34,.15);
  color: var(--color-warning);
  border-color: rgba(210,153,34,.3);
}
.action-btn--warn:hover:not(:disabled) {
  background: rgba(210,153,34,.25);
}

.action-btn--ghost {
  background: var(--bg-elevated);
  color: var(--text-secondary);
  border-color: var(--border-default);
}
.action-btn--ghost:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.action-btn--accent {
  background: rgba(168,85,247,.15);
  color: #a855f7;
  border-color: rgba(168,85,247,.3);
}
.action-btn--accent:hover {
  background: rgba(168,85,247,.25);
  box-shadow: 0 0 14px rgba(168, 85, 247, 0.2);
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* ── Analyzing Banner ───────────────────────── */
.analyzing-banner {
  position: relative;
  overflow: hidden;
  border-bottom: 1px solid var(--border-muted);
  background: linear-gradient(135deg, rgba(210,153,34,0.06) 0%, rgba(88,166,255,0.06) 100%);
}

.analyzing-beam {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, transparent, var(--color-warning), transparent);
  animation: scan-v 2s ease-in-out infinite;
}

@keyframes scan-v {
  0%   { opacity: 0; left: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { opacity: 0; left: 100%; }
}

.analyzing-content {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 32px 12px;
}

.analyzing-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(210,153,34,.15);
  border: 1px solid rgba(210,153,34,.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-warning);
  flex-shrink: 0;
  animation: glow-pulse 2s ease-in-out infinite;
}

@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(210, 153, 34, 0); }
  50%       { box-shadow: 0 0 12px 4px rgba(210, 153, 34, 0.2); }
}

.analyzing-text { flex: 1; }

.analyzing-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 3px;
}

.analyzing-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}

.analyzing-dots {
  display: flex;
  gap: 4px;
  align-items: center;
}

.analyzing-dots span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-warning);
  animation: dot-bounce 1.4s ease-in-out infinite;
}

.analyzing-dots span:nth-child(2) { animation-delay: 0.2s; }
.analyzing-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes dot-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

.analyzing-progress {
  height: 2px;
  background: var(--border-muted);
  overflow: hidden;
}

.analyzing-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--color-warning), var(--color-primary), var(--color-warning));
  background-size: 200% 100%;
  animation: progress-sweep 2s linear infinite;
}

@keyframes progress-sweep {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── Failed Banner ──────────────────────────── */
.failed-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 32px;
  background: rgba(248,81,73,.08);
  border-bottom: 1px solid rgba(248,81,73,.2);
  font-size: 13px;
  color: var(--color-danger);
}

/* ── Info Grid ──────────────────────────────── */
.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0;
  border-bottom: 1px solid var(--border-muted);
}

.info-cell {
  padding: 20px 32px;
  border-right: 1px solid var(--border-muted);
  border-bottom: 1px solid var(--border-muted);
}

.info-cell:nth-child(2n) { border-right: none; }
.info-cell:last-child { border-bottom: none; }

.info-cell--wide {
  grid-column: 1 / -1;
  border-right: none;
}

.info-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.7px;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}

.info-value {
  font-size: 14px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-value--mono {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-secondary);
}

.status-dot-sm {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sds--pending   { background: var(--color-info); }
.sds--analyzing { background: var(--color-warning); animation: pulse 1.4s ease-in-out infinite; }
.sds--completed { background: var(--color-success); }
.sds--failed    { background: var(--color-danger); }

/* ── Quick Actions ──────────────────────────── */
.quick-actions {
  padding: 24px 32px;
}

.qa-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 14px;
}

.qa-cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.qa-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s ease;
}

.qa-card:hover {
  border-color: rgba(88,166,255,.3);
  background: var(--bg-overlay);
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(0,0,0,.3);
}

.qa-card__icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.qa-card__icon--graph {
  background: rgba(88,166,255,.12);
  border: 1px solid rgba(88,166,255,.2);
  color: var(--color-primary);
}

.qa-card__icon--ai {
  background: rgba(168,85,247,.12);
  border: 1px solid rgba(168,85,247,.2);
  color: #a855f7;
}

.qa-card__icon--lineage {
  background: rgba(248,81,73,.12);
  border: 1px solid rgba(248,81,73,.2);
  color: #f85149;
}

.qa-card__icon--semantic {
  background: rgba(188,140,255,.12);
  border: 1px solid rgba(188,140,255,.2);
  color: #bc8cff;
}

.qa-card__icon--flow {
  background: rgba(63,185,80,.12);
  border: 1px solid rgba(63,185,80,.2);
  color: var(--color-success);
}

.qa-card__body { flex: 1; min-width: 0; }

.qa-card__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 3px;
}

.qa-card__desc {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.4;
}

.qa-card__arrow {
  color: var(--text-tertiary);
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.qa-card:hover .qa-card__arrow {
  transform: translateX(2px);
  color: var(--color-primary);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}
</style>
