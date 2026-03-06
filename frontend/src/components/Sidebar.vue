<template>
  <div class="sidebar">
    <nav class="sidebar-nav">
      <router-link
        to="/projects"
        class="nav-item"
        :class="{ 'is-active': activeMenu === '/projects' }"
      >
        <svg class="nav-icon" width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 3H8V8H3V3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
          <path d="M10 3H15V8H10V3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
          <path d="M3 10H8V15H3V10Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
          <path d="M10 10H15V15H10V10Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        </svg>
        <span class="nav-label">项目列表</span>
      </router-link>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const activeMenu = computed(() => {
  const path = route.path
  if (path.startsWith('/projects')) {
    return '/projects'
  }
  return path
})
</script>

<style scoped>
.sidebar {
  padding: 16px 0;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  margin: 0 12px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s ease;
  position: relative;
}

.nav-item::before {
  content: '';
  position: absolute;
  left: -12px;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--color-primary);
  border-radius: 0 2px 2px 0;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.nav-item:hover {
  background: var(--color-primary-muted);
  color: var(--color-primary);
}

.nav-item.is-active {
  background: var(--color-primary-muted);
  color: var(--color-primary);
}

.nav-item.is-active::before {
  opacity: 1;
}

.nav-icon {
  flex-shrink: 0;
}

.nav-label {
  flex: 1;
}
</style>
