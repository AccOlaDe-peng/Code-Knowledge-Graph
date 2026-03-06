<template>
  <div class="ai-settings">
    <!-- 页头 -->
    <div class="page-header">
      <div class="page-header__left">
        <h1 class="page-title">AI 配置</h1>
        <p class="page-desc">管理你的 AI 模型配置，选择一个配置用于代码分析。</p>
      </div>
      <button class="btn-primary" @click="openCreateDialog">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        新建配置
      </button>
    </div>

    <!-- 配置列表 -->
    <div v-loading="loading" class="configs-container">
      <div v-if="configs.length > 0" class="configs-list">
        <div
          v-for="config in configs"
          :key="config.id"
          class="config-card"
          :class="{ 'is-active': config.isActive }"
        >
          <!-- 活跃标识 -->
          <div v-if="config.isActive" class="config-card__badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M20 6L9 17L4 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            当前使用
          </div>

          <!-- 配置信息 -->
          <div class="config-card__body">
            <div class="config-card__header">
              <h3 class="config-card__name">{{ config.configName }}</h3>
              <div class="config-card__actions">
                <button
                  v-if="!config.isActive"
                  class="btn-text btn-text--primary"
                  @click="handleSetActive(config.id)"
                >
                  设为当前
                </button>
                <button class="btn-icon" title="编辑" @click="openEditDialog(config)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13M18.5 2.5C18.8978 2.1022 19.4374 1.87868 20 1.87868C20.5626 1.87868 21.1022 2.1022 21.5 2.5C21.8978 2.8978 22.1213 3.43739 22.1213 4C22.1213 4.56261 21.8978 5.1022 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
                <button class="btn-icon btn-icon--danger" title="删除" @click="handleDelete(config.id)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M3 6H5H21M8 6V4C8 3.45 8.45 3 9 3H15C15.55 3 16 3.45 16 4V6M19 6V20C19 20.55 18.55 21 18 21H6C5.45 21 5 20.55 5 20V6H19Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>

            <div class="config-card__info">
              <div class="config-info-item">
                <span class="config-info-label">提供商</span>
                <span class="config-info-value">{{ config.provider.displayName }}</span>
              </div>
              <div class="config-info-item">
                <span class="config-info-label">模型</span>
                <span class="config-info-value">{{ config.model.displayName }}</span>
              </div>
              <div class="config-info-item">
                <span class="config-info-label">API Key</span>
                <span class="config-info-value config-info-value--mono">{{ maskApiKey(config.apiKey) }}</span>
              </div>
              <div v-if="config.baseUrl" class="config-info-item">
                <span class="config-info-label">API 地址</span>
                <span class="config-info-value config-info-value--mono">{{ config.baseUrl }}</span>
              </div>
            </div>

            <div v-if="config.lastUsedAt" class="config-card__footer">
              <span class="config-card__time">最后使用：{{ formatDate(config.lastUsedAt) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" class="empty-state__icon">
          <path d="M12 2L13.09 8.26L19 6L15.45 11.09L21 13L15.45 14.91L19 20L13.09 17.74L12 24L10.91 17.74L5 20L8.55 14.91L3 13L8.55 11.09L5 6L10.91 8.26L12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
        <p class="empty-state__text">还没有 AI 配置</p>
        <p class="empty-state__hint">创建一个配置以开始使用 AI 代码分析功能</p>
        <button class="btn-primary" style="margin-top: 16px;" @click="openCreateDialog">
          新建配置
        </button>
      </div>
    </div>

    <!-- 创建/编辑配置对话框 -->
    <el-dialog
      v-model="showDialog"
      :title="isEditing ? '编辑配置' : '新建配置'"
      width="500px"
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-position="top">
        <el-form-item label="配置名称" prop="configName">
          <el-input v-model="form.configName" placeholder="例如：生产环境、测试环境" clearable />
        </el-form-item>

        <el-form-item label="AI 提供商" prop="providerId">
          <el-select
            v-model="form.providerId"
            placeholder="选择提供商"
            style="width: 100%"
            @change="handleProviderChange"
          >
            <el-option
              v-for="provider in providers"
              :key="provider.id"
              :label="provider.displayName"
              :value="provider.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="模型" prop="modelId">
          <el-select
            v-model="form.modelId"
            placeholder="选择模型"
            style="width: 100%"
            :disabled="!form.providerId"
          >
            <el-option
              v-for="model in availableModels"
              :key="model.id"
              :label="`${model.displayName} (${model.modelName})`"
              :value="model.id"
            >
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>{{ model.displayName }}</span>
                <span style="font-size: 11px; color: var(--text-tertiary);">
                  {{ (model.contextWindow / 1000).toFixed(0) }}K 上下文
                </span>
              </div>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item label="API Key" prop="apiKey">
          <el-input
            v-model="form.apiKey"
            type="password"
            placeholder="粘贴你的 API Key"
            show-password
          />
        </el-form-item>

        <el-form-item label="自定义 API 地址（可选）" prop="baseUrl">
          <el-input
            v-model="form.baseUrl"
            placeholder="留空使用默认地址"
            clearable
          />
          <div class="form-hint">可用于代理或私有化部署端点</div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">
          {{ isEditing ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import { aiApi } from '../api/ai'
import type { AiProvider, AiModel, AiConfig } from '../types/ai'

// ── State ──────────────────────────────────────────────────────────────────
const configs = ref<AiConfig[]>([])
const providers = ref<AiProvider[]>([])
const loading = ref(false)
const showDialog = ref(false)
const submitting = ref(false)
const isEditing = ref(false)
const editingId = ref('')
const formRef = ref<FormInstance>()
const form = ref({
  configName: '',
  providerId: '',
  modelId: '',
  apiKey: '',
  baseUrl: '',
})

const formRules: FormRules = {
  configName: [{ required: true, message: '请输入配置名称', trigger: 'blur' }],
  providerId: [{ required: true, message: '请选择提供商', trigger: 'change' }],
  modelId: [{ required: true, message: '请选择模型', trigger: 'change' }],
  apiKey: [{ required: true, message: '请输入 API Key', trigger: 'blur' }],
}

// ── Computed ───────────────────────────────────────────────────────────────
const availableModels = computed<AiModel[]>(() => {
  if (!form.value.providerId) return []
  const provider = providers.value.find((p) => p.id === form.value.providerId)
  return provider?.models ?? []
})

// ── Helpers ────────────────────────────────────────────────────────────────
const maskApiKey = (key: string) => {
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}

const formatDate = (d: string) =>
  new Date(d).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

// ── Actions ────────────────────────────────────────────────────────────────
const loadConfigs = async () => {
  loading.value = true
  try {
    const res = await aiApi.getConfigs()
    configs.value = res.data
  } catch {
    ElMessage.error('加载配置失败')
  } finally {
    loading.value = false
  }
}

const loadProviders = async () => {
  try {
    const res = await aiApi.getProviders()
    providers.value = res.data
  } catch {
    ElMessage.error('加载提供商失败')
  }
}

const openCreateDialog = () => {
  isEditing.value = false
  editingId.value = ''
  form.value = {
    configName: '',
    providerId: '',
    modelId: '',
    apiKey: '',
    baseUrl: '',
  }
  showDialog.value = true
}

const openEditDialog = (config: AiConfig) => {
  isEditing.value = true
  editingId.value = config.id
  form.value = {
    configName: config.configName,
    providerId: config.providerId,
    modelId: config.modelId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || '',
  }
  showDialog.value = true
}

const handleProviderChange = () => {
  form.value.modelId = ''
}

const handleSubmit = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    if (isEditing.value) {
      await aiApi.updateConfig(editingId.value, form.value)
      ElMessage.success('配置已更新')
    } else {
      await aiApi.createConfig(form.value)
      ElMessage.success('配置已创建')
    }
    showDialog.value = false
    await loadConfigs()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message ?? '操作失败')
  } finally {
    submitting.value = false
  }
}

const handleSetActive = async (id: string) => {
  try {
    await aiApi.setActiveConfig(id)
    ElMessage.success('已设为当前配置')
    await loadConfigs()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message ?? '设置失败')
  }
}

const handleDelete = async (id: string) => {
  try {
    await ElMessageBox.confirm('确定删除这个配置吗？此操作不可撤销。', '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await aiApi.deleteConfig(id)
    ElMessage.success('已删除')
    await loadConfigs()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.response?.data?.message ?? '删除失败')
  }
}

onMounted(() => {
  loadProviders()
  loadConfigs()
})
</script>

<style scoped>
.ai-settings {
  max-width: 960px;
}

/* Page Header */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
}

.page-header__left {
  flex: 1;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.page-desc {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s ease;
}

.btn-primary:hover {
  background: #4a8fd8;
}

/* Configs Container */
.configs-container {
  min-height: 200px;
}

.configs-list {
  display: grid;
  gap: 16px;
}

/* Config Card */
.config-card {
  position: relative;
  background: var(--bg-surface);
  border: 2px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 20px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.config-card:hover {
  border-color: rgba(88, 166, 255, 0.4);
}

.config-card.is-active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.1);
}

.config-card__badge {
  position: absolute;
  top: 16px;
  right: 16px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-primary);
  background: var(--color-primary-muted);
  border: 1px solid rgba(88, 166, 255, 0.3);
  border-radius: 12px;
}

.config-card__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.config-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.config-card__name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.config-card__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-text {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-text--primary {
  color: var(--color-primary);
  background: var(--color-primary-muted);
  border-color: rgba(88, 166, 255, 0.25);
}

.btn-text--primary:hover {
  background: rgba(88, 166, 255, 0.2);
  border-color: rgba(88, 166, 255, 0.4);
}

.btn-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-tertiary);
  transition: all 0.15s ease;
}

.btn-icon:hover {
  background: var(--bg-elevated);
  border-color: var(--border-default);
  color: var(--text-secondary);
}

.btn-icon--danger:hover {
  background: var(--color-danger-muted);
  border-color: rgba(248, 81, 73, 0.3);
  color: var(--color-danger);
}

.config-card__info {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.config-info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.config-info-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.config-info-value {
  font-size: 13px;
  color: var(--text-primary);
}

.config-info-value--mono {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
}

.config-card__footer {
  padding-top: 12px;
  border-top: 1px solid var(--border-muted);
}

.config-card__time {
  font-size: 12px;
  color: var(--text-tertiary);
}

/* Empty State */
.empty-state {
  padding: 60px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.empty-state__icon {
  color: var(--text-tertiary);
  margin-bottom: 8px;
}

.empty-state__text {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-secondary);
}

.empty-state__hint {
  font-size: 13px;
  color: var(--text-tertiary);
  text-align: center;
  max-width: 320px;
}

/* Form Hint */
.form-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 6px;
}
</style>

