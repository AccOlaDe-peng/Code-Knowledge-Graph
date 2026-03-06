<template>
  <div class="analysis-page">

    <!-- Page Header -->
    <div class="page-header">
      <div class="page-header__left">
        <div class="header-eyebrow">
          <span class="eyebrow-pulse"></span>
          AI 代码智能分析
        </div>
        <h1 class="page-title">分析报告</h1>
        <p class="page-subtitle">
          <span v-if="!loading">{{ filteredAnalyses.length }} 项结果 · {{ uniqueFiles.length }} 个文件</span>
          <span v-else>正在加载...</span>
        </p>
      </div>
      <button class="run-btn" @click="handleTriggerAnalysis">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L13.09 8.26L19 6L15.45 11.09L21 13L15.45 14.91L19 20L13.09 17.74L12 24L10.91 17.74L5 20L8.55 14.91L3 13L8.55 11.09L5 6L10.91 8.26L12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
        重新分析
      </button>
    </div>

    <!-- Filter Bar -->
    <div class="filter-bar">
      <div class="type-toggles">
        <button :class="['type-btn', selectedType === '' && 'is-active']" @click="selectedType = ''">
          全部
        </button>
        <button :class="['type-btn type-btn--summary', selectedType === 'code_summary' && 'is-active']" @click="selectedType = 'code_summary'">
          <span class="type-btn__dot dot--summary"></span>
          代码总结
        </button>
        <button :class="['type-btn type-btn--risk', selectedType === 'risk_analysis' && 'is-active']" @click="selectedType = 'risk_analysis'">
          <span class="type-btn__dot dot--risk"></span>
          风险分析
        </button>
        <button :class="['type-btn type-btn--debt', selectedType === 'tech_debt' && 'is-active']" @click="selectedType = 'tech_debt'">
          <span class="type-btn__dot dot--debt"></span>
          技术债务
        </button>
      </div>

      <el-select v-model="selectedFile" placeholder="全部文件" clearable style="width: 260px">
        <el-option label="全部文件" value="" />
        <el-option v-for="file in uniqueFiles" :key="file" :label="file" :value="file" />
      </el-select>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="scan-state">
      <div class="scan-display">
        <div class="scan-grid-lines">
          <div v-for="n in 6" :key="n" class="scan-grid-line"></div>
        </div>
        <div class="scan-beam"></div>
        <div class="scan-corner scan-corner--tl"></div>
        <div class="scan-corner scan-corner--tr"></div>
        <div class="scan-corner scan-corner--bl"></div>
        <div class="scan-corner scan-corner--br"></div>
      </div>
      <div class="scan-label">
        <span class="scan-label__dot"></span>
        AI 正在扫描分析中
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="filteredAnalyses.length === 0" class="empty-state">
      <div class="empty-icon-wrap">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L13.09 8.26L19 6L15.45 11.09L21 13L15.45 14.91L19 20L13.09 17.74L12 24L10.91 17.74L5 20L8.55 14.91L3 13L8.55 11.09L5 6L10.91 8.26L12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
      </div>
      <p class="empty-title">暂无分析结果</p>
      <p class="empty-hint">点击「重新分析」以启动 AI 代码扫描</p>
    </div>

    <!-- Analysis List -->
    <div v-else class="analyses-list">
      <div
        v-for="(analysis, index) in filteredAnalyses"
        :key="analysis.id"
        :class="['analysis-card', `card--${analysis.analysisType}`]"
        :style="{ animationDelay: `${index * 55}ms` }"
      >
        <!-- Left Type Strip -->
        <div class="card-strip"></div>

        <!-- Card Header -->
        <div class="card-head">
          <div class="file-info">
            <svg class="file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M13 2H6C5.47 2 4.96 2.21 4.59 2.59C4.21 2.96 4 3.47 4 4V20C4 20.53 4.21 21.04 4.59 21.41C4.96 21.79 5.47 22 6 22H18C18.53 22 19.04 21.79 19.41 21.41C19.79 21.04 20 20.53 20 20V9L13 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              <path d="M13 2V9H20" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
            <code class="file-path">{{ analysis.filePath }}</code>
          </div>
          <div class="card-badges">
            <span :class="['type-badge', `tbadge--${analysis.analysisType}`]">
              {{ getAnalysisTypeText(analysis.analysisType) }}
            </span>
            <span :class="['status-pill', `sp--${analysis.status}`]">
              <span class="sp-dot"></span>
              {{ statusLabelMap[analysis.status] || analysis.status }}
            </span>
          </div>
        </div>

        <!-- ── CODE SUMMARY ───────────────────────────────── -->
        <div v-if="analysis.analysisType === 'code_summary'" class="card-body">
          <p class="summary-text">{{ analysis.summary }}</p>

          <div v-if="(analysis.analysisJson as CodeSummaryResult).businessLogic" class="business-logic">
            <div class="body-label">业务逻辑</div>
            <p class="business-text">{{ (analysis.analysisJson as CodeSummaryResult).businessLogic }}</p>
          </div>

          <div v-if="(analysis.analysisJson as CodeSummaryResult).keyComponents?.length" class="sub-section">
            <div class="body-label">关键组件</div>
            <div class="component-chips">
              <span
                v-for="(comp, i) in (analysis.analysisJson as CodeSummaryResult).keyComponents"
                :key="i"
                :class="['comp-chip', `chip--${comp.type}`]"
                :title="comp.responsibility"
              >
                <span class="chip-type-tag">{{ comp.type }}</span>
                <span class="chip-name">{{ comp.name }}</span>
              </span>
            </div>
          </div>

          <div v-if="(analysis.analysisJson as CodeSummaryResult).designPatterns?.length" class="sub-section">
            <div class="body-label">设计模式</div>
            <div class="pattern-chips">
              <span
                v-for="(pattern, i) in (analysis.analysisJson as CodeSummaryResult).designPatterns"
                :key="i"
                class="pattern-chip"
              >{{ pattern }}</span>
            </div>
          </div>
        </div>

        <!-- ── RISK ANALYSIS ───────────────────────────────── -->
        <div v-if="analysis.analysisType === 'risk_analysis'" class="card-body">
          <div class="risk-overview">
            <div class="risk-overview__left">
              <div class="risk-level-label">综合风险等级</div>
              <span :class="['risk-level-badge', `rlb--${analysis.riskLevel}`]">
                {{ getRiskLevelText(analysis.riskLevel) }}
              </span>
            </div>
            <div class="risk-gauge-wrap">
              <div class="risk-gauge-track">
                <div
                  :class="['risk-gauge-fill', `rgf--${analysis.riskLevel}`]"
                  :style="{ width: getRiskWidth(analysis.riskLevel) }"
                ></div>
              </div>
              <div class="risk-gauge-markers">
                <span>低</span><span>中</span><span>高</span><span>严重</span>
              </div>
            </div>
          </div>

          <div v-if="(analysis.analysisJson as RiskAnalysisResult).risks?.length" class="risks-list">
            <div
              v-for="(risk, i) in (analysis.analysisJson as RiskAnalysisResult).risks"
              :key="i"
              :class="['risk-item', `ri--${risk.severity}`]"
            >
              <div class="risk-sev-bar"></div>
              <div class="risk-body">
                <div class="risk-meta-row">
                  <span :class="['sev-chip', `sc--${risk.severity}`]">{{ risk.severity }}</span>
                  <span class="risk-type-label">{{ risk.type }}</span>
                  <code class="risk-location">{{ risk.location }}</code>
                </div>
                <p class="risk-desc">{{ risk.description }}</p>
                <div class="suggestion-row">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" class="suggestion-icon">
                    <path d="M12 2C8.13 2 5 5.13 5 9C5 11.38 6.19 13.47 8 14.74V17C8 17.55 8.45 18 9 18H15C15.55 18 16 17.55 16 17V14.74C17.81 13.47 19 11.38 19 9C19 5.13 15.87 2 12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                    <path d="M9 21H15M12 18V21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                  <span>{{ risk.suggestion }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ── TECH DEBT ───────────────────────────────── -->
        <div v-if="analysis.analysisType === 'tech_debt'" class="card-body">
          <div class="debt-overview">
            <div class="quality-gauge-wrap">
              <svg class="quality-gauge-svg" viewBox="0 0 100 60">
                <!-- Track arc -->
                <path
                  d="M 5 55 A 45 45 0 0 1 95 55"
                  fill="none"
                  stroke="var(--border-default)"
                  stroke-width="8"
                  stroke-linecap="round"
                />
                <!-- Score arc -->
                <path
                  d="M 5 55 A 45 45 0 0 1 95 55"
                  fill="none"
                  :stroke="getQualityColor(analysis.techDebtScore || 0)"
                  stroke-width="8"
                  stroke-linecap="round"
                  stroke-dasharray="141"
                  :stroke-dashoffset="getGaugeOffset(analysis.techDebtScore || 0)"
                  class="gauge-arc"
                />
              </svg>
              <div class="gauge-score-display">
                <div class="gauge-score-num">{{ analysis.techDebtScore ?? '—' }}</div>
                <div class="gauge-score-den">/ 100</div>
              </div>
            </div>
            <div class="quality-meta">
              <div class="quality-label">代码质量分</div>
              <div :class="['quality-verdict', `verdict--${getQualityVerdict(analysis.techDebtScore || 0)}`]">
                {{ getQualityVerdictText(analysis.techDebtScore || 0) }}
              </div>
              <div class="quality-desc">
                {{ getQualityDescription(analysis.techDebtScore || 0) }}
              </div>
            </div>
          </div>

          <div v-if="(analysis.analysisJson as TechDebtResult).techDebts?.length" class="debts-list">
            <div
              v-for="(debt, i) in (analysis.analysisJson as TechDebtResult).techDebts"
              :key="i"
              :class="['debt-item', `di--${debt.priority}`]"
            >
              <div class="debt-pri-bar"></div>
              <div class="debt-body">
                <div class="debt-meta-row">
                  <span :class="['pri-chip', `pc--${debt.priority}`]">{{ debt.priority }}</span>
                  <span class="effort-chip">{{ debt.estimatedEffort }}</span>
                  <code class="debt-location">{{ debt.location }}</code>
                </div>
                <p class="debt-desc">{{ debt.description }}</p>
                <div class="suggestion-row">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" class="suggestion-icon">
                    <path d="M14.7 6.3A1 1 0 0 0 13.3 6.3L5 14.6V19H9.4L17.7 10.7A1 1 0 0 0 17.7 9.3L14.7 6.3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                    <path d="M12 6L18 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                  <span>{{ debt.suggestion }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Card Footer -->
        <div class="card-foot">
          <div class="foot-left">
            <span class="foot-item">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/>
                <path d="M8 21H16M12 17V21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              {{ analysis.model?.displayName || '未知模型' }}
            </span>
            <span class="foot-item">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              {{ (analysis.promptTokens || 0) + (analysis.completionTokens || 0) }} tokens
            </span>
          </div>
          <span class="foot-time">{{ formatDate(analysis.createdAt) }}</span>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { aiApi } from '../api/ai'
import type {
  AiAnalysis,
  CodeSummaryResult,
  RiskAnalysisResult,
  TechDebtResult,
} from '../types/ai'

const route = useRoute()
const projectId = route.params.id as string

const analyses = ref<AiAnalysis[]>([])
const loading = ref(false)
const selectedFile = ref('')
const selectedType = ref('')

const uniqueFiles = computed(() => {
  return [...new Set(analyses.value.map((a) => a.filePath))]
})

const filteredAnalyses = computed(() => {
  return analyses.value.filter((analysis) => {
    if (selectedFile.value && analysis.filePath !== selectedFile.value) return false
    if (selectedType.value && analysis.analysisType !== selectedType.value) return false
    return true
  })
})

const loadAnalyses = async () => {
  loading.value = true
  try {
    const response = await aiApi.getProjectAnalyses(projectId)
    analyses.value = response.data
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '加载分析结果失败')
  } finally {
    loading.value = false
  }
}

const handleTriggerAnalysis = async () => {
  try {
    await aiApi.triggerAnalysis(projectId, {
      analysisTypes: ['code_summary', 'risk_analysis', 'tech_debt'],
    })
    ElMessage.success('已触发 AI 分析，请稍后刷新查看结果')
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '触发分析失败')
  }
}

const statusLabelMap: Record<string, string> = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
}

const getAnalysisTypeText = (type: string) => {
  const typeMap: Record<string, string> = {
    code_summary: '代码总结',
    risk_analysis: '风险分析',
    tech_debt: '技术债务',
  }
  return typeMap[type] || type
}

const getRiskLevelType = (level?: string) => {
  const typeMap: Record<string, any> = {
    low: 'success',
    medium: 'warning',
    high: 'danger',
    critical: 'danger',
  }
  return typeMap[level || 'low'] || 'info'
}

const getRiskLevelText = (level?: string) => {
  const textMap: Record<string, string> = {
    low: '低风险',
    medium: '中风险',
    high: '高风险',
    critical: '严重',
  }
  return textMap[level || 'low'] || level || '未知'
}

const getRiskWidth = (level?: string) => {
  const widths: Record<string, string> = {
    low: '25%',
    medium: '50%',
    high: '75%',
    critical: '100%',
  }
  return widths[level || 'low'] || '0%'
}

const getSeverityType = (severity: string) => {
  return getRiskLevelType(severity)
}

const getPriorityType = (priority: string) => {
  const typeMap: Record<string, any> = {
    low: 'info',
    medium: 'warning',
    high: 'danger',
  }
  return typeMap[priority] || 'info'
}

const getQualityColor = (score: number) => {
  if (score >= 80) return '#3fb950'
  if (score >= 60) return '#d29922'
  return '#f85149'
}

const getGaugeOffset = (score: number) => {
  return Math.round(141 * (1 - score / 100))
}

const getQualityVerdict = (score: number) => {
  if (score >= 80) return 'good'
  if (score >= 60) return 'warn'
  return 'bad'
}

const getQualityVerdictText = (score: number) => {
  if (score >= 80) return '质量良好'
  if (score >= 60) return '需要关注'
  return '亟待改善'
}

const getQualityDescription = (score: number) => {
  if (score >= 80) return '代码结构清晰，维护成本低'
  if (score >= 60) return '存在一定技术债务，建议逐步优化'
  return '技术债务较重，建议尽快安排重构'
}

const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

onMounted(() => {
  loadAnalyses()
})
</script>

<style scoped>
/* ── Page Layout ──────────────────────────────── */
.analysis-page {
  max-width: 900px;
  animation: page-in 0.25s ease;
}

@keyframes page-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Page Header ──────────────────────────────── */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 28px;
}

.header-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}

.eyebrow-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  box-shadow: 0 0 6px var(--color-primary);
  animation: pulse 2s ease-in-out infinite;
}

.page-title {
  font-size: 26px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px;
  letter-spacing: -0.5px;
}

.page-subtitle {
  font-size: 13px;
  color: var(--text-tertiary);
}

.run-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 18px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
  box-shadow: 0 0 0 0 rgba(88, 166, 255, 0);
  flex-shrink: 0;
  margin-top: 4px;
}

.run-btn:hover {
  background: var(--color-primary-hover);
  box-shadow: 0 0 16px rgba(88, 166, 255, 0.3);
}

.run-btn:active {
  transform: scale(0.97);
}

/* ── Filter Bar ──────────────────────────────── */
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
  padding: 12px 16px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}

.type-toggles {
  display: flex;
  gap: 4px;
}

.type-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
}

.type-btn:hover {
  color: var(--text-primary);
  background: var(--bg-elevated);
}

.type-btn.is-active {
  color: var(--text-primary);
  background: var(--bg-elevated);
  border-color: var(--border-default);
}

.type-btn__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.type-btn--summary.is-active { border-color: rgba(88,166,255,0.4); color: #58a6ff; }
.type-btn--risk.is-active    { border-color: rgba(249,115,22,0.4); color: #f97316; }
.type-btn--debt.is-active    { border-color: rgba(168,85,247,0.4); color: #a855f7; }

.dot--summary { background: #58a6ff; }
.dot--risk    { background: #f97316; }
.dot--debt    { background: #a855f7; }

/* ── Loading / Scan State ──────────────────────── */
.scan-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 60px 0;
}

.scan-display {
  width: 280px;
  height: 140px;
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.scan-grid-lines {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  padding: 12px 0;
}

.scan-grid-line {
  height: 1px;
  background: var(--border-muted);
  margin: 0 16px;
  opacity: 0.6;
}

.scan-beam {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, var(--color-primary) 30%, #7dd3fc 50%, var(--color-primary) 70%, transparent 100%);
  box-shadow: 0 0 12px 2px rgba(88, 166, 255, 0.4);
  animation: scan-move 2s ease-in-out infinite;
}

@keyframes scan-move {
  0%   { top: 0%; opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}

.scan-corner {
  position: absolute;
  width: 10px;
  height: 10px;
  border-color: var(--color-primary);
  border-style: solid;
}

.scan-corner--tl { top: 8px; left: 8px; border-width: 2px 0 0 2px; }
.scan-corner--tr { top: 8px; right: 8px; border-width: 2px 2px 0 0; }
.scan-corner--bl { bottom: 8px; left: 8px; border-width: 0 0 2px 2px; }
.scan-corner--br { bottom: 8px; right: 8px; border-width: 0 2px 2px 0; }

.scan-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.scan-label__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  animation: pulse 1.5s ease-in-out infinite;
}

/* ── Empty State ──────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 80px 0;
}

.empty-icon-wrap {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-secondary);
}

.empty-hint {
  font-size: 13px;
  color: var(--text-tertiary);
}

/* ── Analysis List ──────────────────────────────── */
.analyses-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ── Analysis Card ──────────────────────────────── */
.analysis-card {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  animation: card-in 0.35s ease both;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.analysis-card:hover {
  border-color: rgba(88, 166, 255, 0.2);
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.3);
}

@keyframes card-in {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

.card-strip {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
}

.card--code_summary .card-strip { background: #58a6ff; }
.card--risk_analysis .card-strip { background: #f97316; }
.card--tech_debt .card-strip { background: #a855f7; }

/* ── Card Header ──────────────────────────────── */
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 12px 22px;
  border-bottom: 1px solid var(--border-muted);
  gap: 12px;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.file-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.file-path {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-badges {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.type-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: var(--radius-sm);
  letter-spacing: 0.2px;
}

.tbadge--code_summary {
  background: rgba(88,166,255,0.12);
  color: #58a6ff;
  border: 1px solid rgba(88,166,255,0.25);
}

.tbadge--risk_analysis {
  background: rgba(249,115,22,0.12);
  color: #f97316;
  border: 1px solid rgba(249,115,22,0.25);
}

.tbadge--tech_debt {
  background: rgba(168,85,247,0.12);
  color: #a855f7;
  border: 1px solid rgba(168,85,247,0.25);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 10px;
}

.sp-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sp--pending   { background: rgba(139,148,158,.1); color: var(--color-info); }
.sp--pending .sp-dot { background: var(--color-info); }

.sp--processing { background: rgba(210,153,34,.1); color: var(--color-warning); }
.sp--processing .sp-dot { background: var(--color-warning); animation: pulse 1.2s ease-in-out infinite; }

.sp--completed { background: rgba(63,185,80,.1); color: var(--color-success); }
.sp--completed .sp-dot { background: var(--color-success); }

.sp--failed { background: rgba(248,81,73,.1); color: var(--color-danger); }
.sp--failed .sp-dot { background: var(--color-danger); }

/* ── Card Body ──────────────────────────────── */
.card-body {
  padding: 18px 22px;
}

/* Code Summary */
.summary-text {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 16px;
}

.business-logic {
  margin-bottom: 16px;
}

.business-text {
  font-size: 13px;
  color: var(--text-tertiary);
  line-height: 1.6;
  margin-top: 6px;
}

.sub-section {
  margin-top: 14px;
}

.body-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}

.component-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.comp-chip {
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--border-default);
  font-size: 12px;
}

.chip-type-tag {
  padding: 3px 7px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}

.chip--class .chip-type-tag  { background: rgba(88,166,255,0.15); color: #58a6ff; }
.chip--function .chip-type-tag { background: rgba(63,185,80,0.15); color: var(--color-success); }

.chip-name {
  padding: 3px 8px;
  font-family: var(--font-mono);
  color: var(--text-primary);
  background: var(--bg-elevated);
}

.pattern-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pattern-chip {
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

/* Risk Analysis */
.risk-overview {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 14px 16px;
  background: var(--bg-elevated);
  border-radius: var(--radius-md);
  margin-bottom: 16px;
}

.risk-overview__left {
  flex-shrink: 0;
}

.risk-level-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 6px;
}

.risk-level-badge {
  font-size: 13px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
}

.rlb--low      { background: rgba(63,185,80,.15); color: var(--color-success); border: 1px solid rgba(63,185,80,.3); }
.rlb--medium   { background: rgba(210,153,34,.15); color: var(--color-warning); border: 1px solid rgba(210,153,34,.3); }
.rlb--high     { background: rgba(249,115,22,.15); color: #f97316; border: 1px solid rgba(249,115,22,.3); }
.rlb--critical { background: rgba(248,81,73,.15); color: var(--color-danger); border: 1px solid rgba(248,81,73,.3); }

.risk-gauge-wrap {
  flex: 1;
}

.risk-gauge-track {
  height: 5px;
  background: var(--bg-overlay);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 6px;
}

.risk-gauge-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.6s cubic-bezier(0.23, 1, 0.32, 1);
}

.rgf--low      { background: var(--color-success); }
.rgf--medium   { background: var(--color-warning); }
.rgf--high     { background: #f97316; }
.rgf--critical { background: var(--color-danger); }

.risk-gauge-markers {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-tertiary);
}

.risks-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.risk-item {
  display: flex;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-elevated);
  border: 1px solid var(--border-muted);
}

.risk-sev-bar {
  width: 3px;
  flex-shrink: 0;
}

.ri--low .risk-sev-bar      { background: var(--color-success); }
.ri--medium .risk-sev-bar   { background: var(--color-warning); }
.ri--high .risk-sev-bar     { background: #f97316; }
.ri--critical .risk-sev-bar { background: var(--color-danger); }

.risk-body {
  flex: 1;
  padding: 10px 14px;
  min-width: 0;
}

.risk-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
  flex-wrap: wrap;
}

.sev-chip {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.sc--low      { background: rgba(63,185,80,.15); color: var(--color-success); }
.sc--medium   { background: rgba(210,153,34,.15); color: var(--color-warning); }
.sc--high     { background: rgba(249,115,22,.15); color: #f97316; }
.sc--critical { background: rgba(248,81,73,.15); color: var(--color-danger); }

.risk-type-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: capitalize;
}

.risk-location {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
  margin-left: auto;
}

.risk-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 8px;
}

.suggestion-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  color: var(--color-primary);
  line-height: 1.5;
}

.suggestion-icon {
  color: var(--color-primary);
  flex-shrink: 0;
  margin-top: 1px;
}

/* Tech Debt */
.debt-overview {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 16px 20px;
  background: var(--bg-elevated);
  border-radius: var(--radius-md);
  margin-bottom: 16px;
}

.quality-gauge-wrap {
  position: relative;
  width: 100px;
  flex-shrink: 0;
}

.quality-gauge-svg {
  width: 100px;
  display: block;
}

.gauge-arc {
  transition: stroke-dashoffset 0.8s cubic-bezier(0.23, 1, 0.32, 1);
}

.gauge-score-display {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  line-height: 1.1;
  padding-bottom: 2px;
}

.gauge-score-num {
  font-size: 22px;
  font-weight: 800;
  color: var(--text-primary);
  font-family: var(--font-mono);
  letter-spacing: -1px;
}

.gauge-score-den {
  font-size: 10px;
  color: var(--text-tertiary);
  font-weight: 500;
}

.quality-meta {
  flex: 1;
}

.quality-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 6px;
}

.quality-verdict {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 4px;
}

.verdict--good { color: var(--color-success); }
.verdict--warn { color: var(--color-warning); }
.verdict--bad  { color: var(--color-danger); }

.quality-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.5;
}

.debts-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.debt-item {
  display: flex;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-elevated);
  border: 1px solid var(--border-muted);
}

.debt-pri-bar {
  width: 3px;
  flex-shrink: 0;
}

.di--low .debt-pri-bar    { background: var(--color-info); }
.di--medium .debt-pri-bar { background: var(--color-warning); }
.di--high .debt-pri-bar   { background: var(--color-danger); }

.debt-body {
  flex: 1;
  padding: 10px 14px;
  min-width: 0;
}

.debt-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
  flex-wrap: wrap;
}

.pri-chip {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.pc--low    { background: rgba(139,148,158,.15); color: var(--color-info); }
.pc--medium { background: rgba(210,153,34,.15);  color: var(--color-warning); }
.pc--high   { background: rgba(248,81,73,.15);   color: var(--color-danger); }

.effort-chip {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 3px;
  background: var(--bg-overlay);
  color: var(--text-tertiary);
  text-transform: capitalize;
}

.debt-location {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
  margin-left: auto;
}

.debt-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 8px;
}

/* ── Card Footer ──────────────────────────────── */
.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 22px 12px;
  border-top: 1px solid var(--border-muted);
}

.foot-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.foot-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.foot-time {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}
</style>
