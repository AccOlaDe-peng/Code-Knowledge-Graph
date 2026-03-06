<template>
  <div class="sidebar">
    <div class="sidebar-section">
      <div class="sidebar-section__label">导航</div>
      <nav class="sidebar-nav">
        <router-link
          to="/projects"
          class="nav-item"
          :class="{ 'is-active': activeMenu === '/projects' }"
        >
          <div class="nav-item__icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="2" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              <rect x="13" y="2" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              <rect x="2" y="13" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              <rect x="13" y="13" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="nav-item__label">项目列表</span>
        </router-link>

        <router-link
          to="/ai/settings"
          class="nav-item"
          :class="{ 'is-active': activeMenu === '/ai/settings' }"
        >
          <div class="nav-item__icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L13.09 8.26L19 6L15.45 11.09L21 13L15.45 14.91L19 20L13.09 17.74L12 24L10.91 17.74L5 20L8.55 14.91L3 13L8.55 11.09L5 6L10.91 8.26L12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="nav-item__label">AI 设置</span>
        </router-link>
      </nav>
    </div>

    <!-- 项目子导航，仅在项目页面内显示 -->
    <div v-if="currentProjectId" class="sidebar-section sidebar-section--project">
      <div class="sidebar-section__label">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style="flex-shrink:0">
          <path d="M3 7C3 5.9 3.9 5 5 5H19C20.1 5 21 5.9 21 7V17C21 18.1 20.1 19 19 19H5C3.9 19 3 18.1 3 17V7Z" stroke="currentColor" stroke-width="1.5"/>
          <path d="M8 12H16M12 8V16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        当前项目
      </div>
      <nav class="sidebar-nav">
        <router-link
          :to="`/projects/${currentProjectId}`"
          class="nav-item nav-item--sub"
          :class="{ 'is-active': isExactProjectDetail }"
        >
          <div class="nav-item__icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>
              <path d="M12 8V12L15 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <span class="nav-item__label">项目概览</span>
        </router-link>

        <router-link
          :to="`/projects/${currentProjectId}/graph`"
          class="nav-item nav-item--sub"
          :class="{ 'is-active': currentSub === 'graph' }"
        >
          <div class="nav-item__icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="5" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="19" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="12" cy="19" r="2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M6.5 6L10.5 17.5M13.5 17.5L17.5 6M7 5H17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <span class="nav-item__label">代码依赖图谱</span>
        </router-link>

        <router-link
          :to="`/projects/${currentProjectId}/ai-analysis`"
          class="nav-item nav-item--sub"
          :class="{ 'is-active': currentSub === 'ai-analysis' }"
        >
          <div class="nav-item__icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L13.09 8.26L19 6L15.45 11.09L21 13L15.45 14.91L19 20L13.09 17.74L12 24L10.91 17.74L5 20L8.55 14.91L3 13L8.55 11.09L5 6L10.91 8.26L12 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="nav-item__label">AI 分析报告</span>
        </router-link>

        <router-link
          :to="`/projects/${currentProjectId}/business-flow`"
          class="nav-item nav-item--sub"
          :class="{ 'is-active': currentSub === 'business-flow' }"
        >
          <div class="nav-item__icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="3" width="7" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
              <rect x="8.5" y="10" width="7" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
              <rect x="15" y="17" width="7" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
              <path d="M5.5 7V9Q5.5 11 8.5 11M12 14V16Q12 18 15 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <span class="nav-item__label">业务流程图</span>
        </router-link>

        <router-link
          :to="`/projects/${currentProjectId}/data-lineage`"
          class="nav-item nav-item--sub"
          :class="{ 'is-active': currentSub === 'data-lineage' }"
        >
          <div class="nav-item__icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="4" cy="12" r="2" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="12" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="12" cy="19" r="2" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="20" cy="12" r="2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M6 12H10M14 5.5L18 10.5M14 18.5L18 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <span class="nav-item__label">数据血缘图</span>
        </router-link>

        <router-link
          :to="`/projects/${currentProjectId}/semantic-graph`"
          class="nav-item nav-item--sub"
          :class="{ 'is-active': currentSub === 'semantic-graph' }"
        >
          <div class="nav-item__icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="4" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="20" cy="5" r="2" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="4" cy="19" r="2" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="20" cy="19" r="2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M6 6L10 10M18 6L14 10M6 18L10 14M18 18L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <span class="nav-item__label">AI 语义图谱</span>
        </router-link>
      </nav>
    </div>

    <div class="sidebar-footer">
      <div class="sidebar-footer__badge">
        <div class="badge-dot"></div>
        <span>CodeGraph v1.0</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const activeMenu = computed(() => {
  const path = route.path
  if (path.startsWith('/projects')) return '/projects'
  if (path.startsWith('/ai')) return '/ai/settings'
  return path
})

// 当前项目 ID（仅在 /projects/:id 及其子路由下有值）
const currentProjectId = computed(() => {
  const id = route.params.id
  return id ? String(id) : null
})

// 是否是精确的项目详情页（非子路由）
const isExactProjectDetail = computed(() => {
  if (!currentProjectId.value) return false
  return route.path === `/projects/${currentProjectId.value}`
})

// 当前激活的子视图
const currentSub = computed(() => {
  if (!currentProjectId.value) return null
  const base = `/projects/${currentProjectId.value}/`
  if (route.path.startsWith(base)) {
    return route.path.slice(base.length)
  }
  return null
})
</script>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 0 12px;
}

.sidebar-section {
  flex: 1;
}

.sidebar-section--project {
  flex: none;
  border-top: 1px solid var(--border-muted);
  padding-top: 12px;
  margin-top: 4px;
}

.sidebar-section__label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--text-tertiary);
  padding: 0 20px;
  margin-bottom: 6px;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 10px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s ease;
  position: relative;
}

.nav-item::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 25%;
  bottom: 25%;
  width: 2px;
  background: var(--color-primary);
  border-radius: 0 2px 2px 0;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.nav-item:hover {
  background: var(--color-primary-muted);
  color: var(--text-primary);
}

.nav-item.is-active {
  background: var(--color-primary-muted);
  color: var(--color-primary);
}

.nav-item.is-active::before {
  opacity: 1;
}

.nav-item__icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: transparent;
  transition: background 0.15s ease;
  flex-shrink: 0;
}

.nav-item.is-active .nav-item__icon {
  background: rgba(88, 166, 255, 0.15);
}

.nav-item__label {
  flex: 1;
}

.nav-item--sub {
  font-size: 12px;
  padding: 6px 10px;
}

.nav-item--sub .nav-item__icon {
  width: 24px;
  height: 24px;
}

/* Sidebar Footer */
.sidebar-footer {
  padding: 12px 20px 0;
  border-top: 1px solid var(--border-muted);
}

.sidebar-footer__badge {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
}

.badge-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-success);
  flex-shrink: 0;
}
</style>
