<template>
  <div class="login-page">
    <div class="login-left">
      <div class="brand-section">
        <svg class="brand-logo" width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="5" fill="var(--color-primary)" />
          <circle cx="36" cy="12" r="5" fill="var(--color-success)" />
          <circle cx="24" cy="36" r="5" fill="var(--color-warning)" />
          <line x1="15" y1="14" x2="21" y2="33" stroke="var(--text-tertiary)" stroke-width="2" />
          <line x1="33" y1="14" x2="27" y2="33" stroke="var(--text-tertiary)" stroke-width="2" />
          <line x1="17" y1="12" x2="31" y2="12" stroke="var(--text-tertiary)" stroke-width="2" />
        </svg>
        <h1 class="brand-title">CodeGraph</h1>
        <p class="brand-desc">代码知识图谱可视化平台</p>
        <p class="brand-tagline">分析代码依赖关系，洞察项目架构</p>
      </div>
      <div class="decorative-graph">
        <svg width="100%" height="200" viewBox="0 0 400 200" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="80" cy="60" r="8" fill="var(--color-primary)" opacity="0.6" />
          <circle cx="200" cy="40" r="6" fill="var(--color-success)" opacity="0.5" />
          <circle cx="320" cy="80" r="7" fill="var(--color-warning)" opacity="0.5" />
          <circle cx="140" cy="140" r="9" fill="var(--color-primary)" opacity="0.4" />
          <circle cx="280" cy="160" r="6" fill="var(--color-danger)" opacity="0.4" />
          <line x1="80" y1="60" x2="140" y2="140" stroke="var(--border-default)" stroke-width="1" opacity="0.3" />
          <line x1="200" y1="40" x2="320" y2="80" stroke="var(--border-default)" stroke-width="1" opacity="0.3" />
          <line x1="140" y1="140" x2="280" y2="160" stroke="var(--border-default)" stroke-width="1" opacity="0.3" />
          <line x1="80" y1="60" x2="200" y2="40" stroke="var(--border-default)" stroke-width="1" opacity="0.3" />
        </svg>
      </div>
    </div>
    <div class="login-right">
      <div class="login-form-container">
        <h2 class="form-title">登录</h2>
        <p class="form-subtitle">使用您的账号登录 CodeGraph</p>
        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          class="login-form"
        >
          <el-form-item prop="email">
            <el-input
              v-model="form.email"
              placeholder="邮箱地址"
              type="email"
              size="large"
            />
          </el-form-item>
          <el-form-item prop="password">
            <el-input
              v-model="form.password"
              placeholder="密码"
              type="password"
              size="large"
              show-password
              @keyup.enter="handleLogin"
            />
          </el-form-item>
          <el-button
            type="primary"
            :loading="loading"
            size="large"
            class="login-btn"
            @click="handleLogin"
          >
            登录
          </el-button>
        </el-form>
        <div class="form-footer">
          <span class="footer-text">还没有账号？</span>
          <router-link to="/register" class="footer-link">立即注册</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, FormInstance } from 'element-plus'
import { useUserStore } from '../stores/user'
import { authApi } from '../api/auth'

const router = useRouter()
const userStore = useUserStore()

const formRef = ref<FormInstance>()
const loading = ref(false)

const form = reactive({
  email: '',
  password: ''
})

const rules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度至少6位', trigger: 'blur' }
  ]
}

const handleLogin = async () => {
  if (!formRef.value) return

  await formRef.value.validate(async (valid) => {
    if (valid) {
      loading.value = true
      try {
        const response = await authApi.login(form)
        const { access_token, user } = response.data

        userStore.setToken(access_token)
        userStore.setUser(user)

        ElMessage.success('登录成功')
        await router.push('/projects')
      } catch (error: any) {
        ElMessage.error(error.response?.data?.message || '登录失败')
      } finally {
        loading.value = false
      }
    }
  })
}
</script>

<style scoped>
.login-page {
  display: flex;
  height: 100vh;
  background: var(--bg-base);
}

.login-left {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 60px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-default);
  position: relative;
}

.brand-section {
  text-align: center;
  z-index: 1;
}

.brand-logo {
  margin-bottom: 24px;
}

.brand-title {
  font-family: var(--font-mono);
  font-size: 42px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 16px 0;
  letter-spacing: -1px;
}

.brand-desc {
  font-size: 18px;
  color: var(--text-secondary);
  margin: 0 0 8px 0;
  font-weight: 500;
}

.brand-tagline {
  font-size: 14px;
  color: var(--text-tertiary);
  margin: 0;
}

.decorative-graph {
  position: absolute;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  width: 80%;
  max-width: 400px;
  opacity: 0.6;
}

.login-right {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 60px;
  background: var(--bg-base);
}

.login-form-container {
  width: 100%;
  max-width: 400px;
}

.form-title {
  font-size: 28px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.form-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0 0 32px 0;
}

.login-form {
  margin-bottom: 24px;
}

.login-form :deep(.el-form-item) {
  margin-bottom: 20px;
}

.login-btn {
  width: 100%;
  margin-top: 8px;
  font-weight: 500;
}

.form-footer {
  text-align: center;
  padding-top: 16px;
  border-top: 1px solid var(--border-default);
}

.footer-text {
  color: var(--text-secondary);
  font-size: 14px;
}

.footer-link {
  color: var(--color-primary);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  margin-left: 6px;
  transition: color 0.15s ease;
}

.footer-link:hover {
  color: var(--color-primary-hover);
}
</style>
