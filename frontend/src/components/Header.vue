<template>
  <div class="header">
    <div class="header-left">
      <svg class="logo-icon" width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="7" cy="7" r="3" fill="var(--color-primary)" />
        <circle cx="21" cy="7" r="3" fill="var(--color-success)" />
        <circle cx="14" cy="21" r="3" fill="var(--color-warning)" />
        <line x1="9" y1="8" x2="12" y2="19" stroke="var(--border-default)" stroke-width="1.5" />
        <line x1="19" y1="8" x2="16" y2="19" stroke="var(--border-default)" stroke-width="1.5" />
        <line x1="10" y1="7" x2="18" y2="7" stroke="var(--border-default)" stroke-width="1.5" />
      </svg>
      <h1 class="brand-name">CodeGraph</h1>
    </div>
    <div class="header-right">
      <div class="user-avatar">
        {{ userInitial }}
      </div>
      <span class="user-email">{{ userStore.user?.email }}</span>
      <button class="logout-btn" @click="handleLogout">
        退出
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUserStore } from '../stores/user'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

const userStore = useUserStore()
const router = useRouter()

const userInitial = computed(() => {
  const email = userStore.user?.email || ''
  return email.charAt(0).toUpperCase()
})

const handleLogout = () => {
  userStore.logout()
  ElMessage.success('退出登录成功')
  router.push('/login')
}
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  height: 100%;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-icon {
  flex-shrink: 0;
}

.brand-name {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.3px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--color-primary-muted);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 13px;
  font-family: var(--font-mono);
  flex-shrink: 0;
}

.user-email {
  color: var(--text-secondary);
  font-size: 13px;
}

.logout-btn {
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: var(--font-sans);
}

.logout-btn:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
  background: var(--color-danger-muted);
}
</style>
