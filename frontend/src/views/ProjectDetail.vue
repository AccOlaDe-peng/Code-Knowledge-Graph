<template>
  <div class="project-detail">
    <div class="breadcrumb">
      <span class="breadcrumb-item" @click="goBack">项目列表</span>
      <span class="breadcrumb-separator">/</span>
      <span class="breadcrumb-item active">{{ project?.name }}</span>
    </div>

    <div v-loading="loading" class="detail-container">
      <div class="detail-header">
        <div class="header-left">
          <h1 class="project-name">{{ project?.name }}</h1>
          <div class="project-status">
            <span :class="['status-dot', `status-dot--${project?.status}`]"></span>
            <span class="status-text">{{ getStatusText(project?.status) }}</span>
          </div>
        </div>
        <div class="header-actions">
          <el-button
            v-if="project?.status !== 'analyzing'"
            :type="project?.status === 'failed' ? 'warning' : 'primary'"
            size="large"
            :loading="analyzing"
            @click="handleAnalyze"
          >
            {{ project?.status === 'pending' ? '开始分析' : '重新分析' }}
          </el-button>
          <el-button
            v-if="project?.status === 'completed' || project?.status === 'ready'"
            type="success"
            size="large"
            @click="viewGraph"
          >
            查看代码依赖图谱
          </el-button>
        </div>
      </div>

      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">项目名称</div>
          <div class="info-value">{{ project?.name }}</div>
        </div>
        <div class="info-item">
          <div class="info-label">状态</div>
          <div class="info-value">
            <span :class="['status-dot', `status-dot--${project?.status}`]"></span>
            {{ getStatusText(project?.status) }}
          </div>
        </div>
        <div class="info-item full-width">
          <div class="info-label">描述</div>
          <div class="info-value">{{ project?.description || '无' }}</div>
        </div>
        <div class="info-item">
          <div class="info-label">创建时间</div>
          <div class="info-value">{{ formatDate(project?.createdAt) }}</div>
        </div>
        <div class="info-item">
          <div class="info-label">更新时间</div>
          <div class="info-value">{{ formatDate(project?.updatedAt) }}</div>
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

const getStatusType = (status?: ProjectStatus) => {
  if (!status) return 'info'
  const typeMap = {
    pending: 'info',
    analyzing: 'warning',
    completed: 'success',
    failed: 'danger'
  }
  return typeMap[status] || 'info'
}

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
  if (!date) return ''
  return new Date(date).toLocaleString('zh-CN')
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
    ElMessage.success('分析任务已提交，请稍后查看结果')
    project.value.status = ProjectStatus.ANALYZING
    projectStore.updateProject(project.value.id, { status: ProjectStatus.ANALYZING })
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '提交分析任务失败')
  } finally {
    analyzing.value = false
  }
}

const viewGraph = () => {
  if (project.value) {
    router.push(`/projects/${project.value.id}/graph`)
  }
}

const goBack = () => {
  router.push('/projects')
}

const startPolling = () => {
  // 如果项目正在分析中，启动轮询
  if (project.value?.status === ProjectStatus.ANALYZING) {
    pollingTimer = window.setInterval(async () => {
      try {
        const projectId = route.params.id as string
        const response = await projectsApi.getProject(projectId)
        const updatedProject = response.data
        project.value = updatedProject
        projectStore.updateProject(projectId, updatedProject)

        // 如果状态不再是 analyzing，停止轮询
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
    }, 3000) // 每3秒轮询一次
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
.project-detail {
  max-width: 1000px;
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

.detail-container {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 32px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border-default);
}

.header-left {
  flex: 1;
}

.project-name {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 12px 0;
  font-family: var(--font-mono);
}

.project-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-text {
  font-size: 14px;
  color: var(--text-secondary);
  font-weight: 500;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-item.full-width {
  grid-column: 1 / -1;
}

.info-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.info-value {
  font-size: 15px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
