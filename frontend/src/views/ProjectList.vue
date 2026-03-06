<template>
  <div class="project-list">
    <div class="page-header">
      <div class="header-content">
        <h1 class="page-title">项目列表</h1>
        <p class="page-subtitle">管理您的代码分析项目</p>
      </div>
      <el-button type="primary" size="large" @click="showCreateDialog = true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 6px;">
          <path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
        创建项目
      </el-button>
    </div>

    <div v-if="projectStore.projects.length === 0 && !loading" class="empty-state">
      <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="60" cy="60" r="50" stroke="var(--border-default)" stroke-width="2" stroke-dasharray="8 4" />
        <circle cx="40" cy="45" r="8" fill="var(--color-primary)" opacity="0.3" />
        <circle cx="80" cy="45" r="8" fill="var(--color-success)" opacity="0.3" />
        <circle cx="60" cy="75" r="8" fill="var(--color-warning)" opacity="0.3" />
        <line x1="45" y1="50" x2="55" y2="70" stroke="var(--border-default)" stroke-width="2" opacity="0.3" />
        <line x1="75" y1="50" x2="65" y2="70" stroke="var(--border-default)" stroke-width="2" opacity="0.3" />
      </svg>
      <h3 class="empty-title">还没有项目</h3>
      <p class="empty-desc">创建第一个项目开始分析代码依赖关系</p>
      <el-button type="primary" @click="showCreateDialog = true">创建项目</el-button>
    </div>

    <div v-else v-loading="loading" class="projects-grid">
      <div
        v-for="project in projectStore.projects"
        :key="project.id"
        class="project-card"
        @click="viewProject(project.id)"
      >
        <div class="card-header">
          <div class="card-title-row">
            <h3 class="card-title">{{ project.name }}</h3>
            <span class="provider-badge">{{ getProviderLabel(project) }}</span>
          </div>
          <div class="card-status">
            <span :class="['status-dot', `status-dot--${project.status}`]"></span>
            <span class="status-text">{{ getStatusText(project.status) }}</span>
          </div>
        </div>
        <p class="card-description">{{ project.description || '暂无描述' }}</p>
        <div class="card-meta">
          <span class="meta-item">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 1V7H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" />
            </svg>
            {{ formatDate(project.createdAt) }}
          </span>
        </div>
        <div class="card-actions" @click.stop>
          <el-button size="small" @click="viewProject(project.id)">
            查看
          </el-button>
          <el-button
            size="small"
            :type="project.status === 'failed' ? 'warning' : 'primary'"
            :disabled="project.status === 'analyzing'"
            :loading="analyzingIds.has(project.id)"
            @click="handleAnalyze(project.id)"
          >
            {{ project.status === 'analyzing' ? '分析中' : '分析' }}
          </el-button>
          <el-button
            size="small"
            type="success"
            :disabled="project.status !== 'completed' && project.status !== 'ready'"
            @click="viewGraph(project.id)"
          >
            图谱
          </el-button>
          <el-button
            size="small"
            type="danger"
            @click="handleDelete(project.id)"
          >
            删除
          </el-button>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="showCreateDialog"
      title="创建项目"
      width="500px"
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="100px"
      >
        <el-form-item label="项目名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入项目名称" />
        </el-form-item>
        <el-form-item label="项目描述" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            placeholder="请输入项目描述"
          />
        </el-form-item>
        <el-form-item label="代码来源" prop="provider">
          <el-select v-model="form.provider" placeholder="请选择代码来源">
            <el-option label="GitHub" value="github" />
            <el-option label="GitLab" value="gitlab" />
            <el-option label="ZIP文件" value="zip" />
          </el-select>
        </el-form-item>
        <el-form-item label="仓库地址" prop="repositoryUrl">
          <el-input
            v-model="form.repositoryUrl"
            placeholder="请输入仓库地址或ZIP文件路径"
          />
        </el-form-item>
        <el-form-item label="分支" prop="branch">
          <el-input
            v-model="form.branch"
            placeholder="留空则使用远端默认分支"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button
          type="primary"
          :loading="createLoading"
          @click="handleCreate"
        >
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, FormInstance } from 'element-plus'
import { useProjectStore } from '../stores/project'
import { ProjectStatus } from '../types/project'
import { projectsApi } from '../api/projects'

const router = useRouter()
const projectStore = useProjectStore()

const loading = ref(false)
const showCreateDialog = ref(false)
const createLoading = ref(false)
const analyzingIds = ref<Set<string>>(new Set())
let pollingTimer: number | null = null
const formRef = ref<FormInstance>()

const form = reactive({
  name: '',
  description: '',
  provider: 'github' as 'github' | 'gitlab' | 'zip',
  repositoryUrl: '',
  branch: ''
})

const rules = {
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
  provider: [{ required: true, message: '请选择代码来源', trigger: 'change' }],
  repositoryUrl: [{ required: true, message: '请输入仓库地址', trigger: 'blur' }]
}

const getStatusType = (status: ProjectStatus) => {
  const typeMap = {
    pending: 'info',
    analyzing: 'warning',
    completed: 'success',
    failed: 'danger'
  }
  return typeMap[status] || 'info'
}

const getStatusText = (status: ProjectStatus) => {
  const textMap = {
    pending: '待分析',
    analyzing: '分析中',
    completed: '已完成',
    failed: '失败'
  }
  return textMap[status] || status
}

const getProviderLabel = (project: any) => {
  const providerMap: Record<string, string> = {
    github: 'GitHub',
    gitlab: 'GitLab',
    zip: 'ZIP'
  }
  return providerMap[project.provider] || project.provider || 'Unknown'
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

const loadProjects = async () => {
  loading.value = true
  try {
    const response = await projectsApi.getProjects()
    projectStore.setProjects(response.data)
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '加载项目列表失败')
  } finally {
    loading.value = false
  }
}

const handleCreate = async () => {
  if (!formRef.value) return

  await formRef.value.validate(async (valid) => {
    if (valid) {
      createLoading.value = true
      try {
        const response = await projectsApi.createProject(form)
        const newProject = response.data
        projectStore.addProject(newProject)
        ElMessage.success('项目创建成功')
        showCreateDialog.value = false
        Object.assign(form, {
          name: '',
          description: '',
          provider: 'github',
          repositoryUrl: '',
          branch: ''
        })

        // 自动触发分析
        try {
          await projectsApi.analyzeProject(newProject.id)
          projectStore.updateProject(newProject.id, { status: ProjectStatus.ANALYZING })
          ElMessage.info('分析任务已自动启动')
        } catch (error: any) {
          ElMessage.warning('自动启动分析失败，请手动启动')
        }
      } catch (error: any) {
        ElMessage.error(error.response?.data?.message || '创建项目失败')
      } finally {
        createLoading.value = false
      }
    }
  })
}

const viewProject = (id: string) => {
  router.push(`/projects/${id}`)
}

const viewGraph = (id: string) => {
  router.push(`/projects/${id}/graph`)
}

const handleAnalyze = async (id: string) => {
  analyzingIds.value = new Set([...analyzingIds.value, id])
  try {
    await projectsApi.analyzeProject(id)
    projectStore.updateProject(id, { status: ProjectStatus.ANALYZING })
    ElMessage.info('分析任务已提交')
    if (!pollingTimer) startPolling()
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '提交分析失败')
  } finally {
    analyzingIds.value.delete(id)
    analyzingIds.value = new Set(analyzingIds.value)
  }
}

const handleDelete = async (id: string) => {
  try {
    await ElMessageBox.confirm('确定要删除该项目吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    await projectsApi.deleteProject(id)
    projectStore.deleteProject(id)
    ElMessage.success('删除成功')
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '删除失败')
    }
  }
}

// 检查是否有正在分析的项目
const hasAnalyzingProjects = computed(() => {
  return projectStore.projects.some(p => p.status === ProjectStatus.ANALYZING)
})

const startPolling = () => {
  // 如果有正在分析的项目，启动轮询
  if (hasAnalyzingProjects.value) {
    pollingTimer = window.setInterval(async () => {
      try {
        const response = await projectsApi.getProjects()
        projectStore.setProjects(response.data)

        // 如果没有正在分析的项目了，停止轮询
        if (!hasAnalyzingProjects.value) {
          stopPolling()
        }
      } catch (error) {
        console.error('轮询更新项目列表失败:', error)
      }
    }, 5000) // 每5秒轮询一次
  }
}

const stopPolling = () => {
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
}

onMounted(() => {
  loadProjects().then(() => {
    startPolling()
  })
})

onBeforeUnmount(() => {
  stopPolling()
})
</script>

<style scoped>
.project-list {
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
}

.header-content {
  flex: 1;
}

.page-title {
  font-size: 32px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px 0;
  font-family: var(--font-mono);
  letter-spacing: -0.5px;
}

.page-subtitle {
  font-size: 15px;
  color: var(--text-secondary);
  margin: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
}

.empty-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 24px 0 8px 0;
}

.empty-desc {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0 0 24px 0;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 20px;
}

.project-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.project-card:hover {
  border-color: var(--color-primary);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.card-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-badge {
  flex-shrink: 0;
  padding: 3px 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.card-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-text {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.card-description {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  min-height: 42px;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-top: 8px;
  border-top: 1px solid var(--border-muted);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.meta-item svg {
  flex-shrink: 0;
  opacity: 0.7;
}

.card-actions {
  display: flex;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-muted);
}

.card-actions .el-button {
  flex: 1;
}
</style>