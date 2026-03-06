import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('../views/Register.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/',
    component: () => import('../layouts/MainLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        redirect: '/projects'
      },
      {
        path: 'projects',
        name: 'ProjectList',
        component: () => import('../views/ProjectList.vue')
      },
      {
        path: 'projects/:id',
        name: 'ProjectDetail',
        component: () => import('../views/ProjectDetail.vue')
      },
      {
        path: 'projects/:id/graph',
        name: 'GraphView',
        component: () => import('../views/GraphView.vue')
      },
      {
        path: 'ai/settings',
        name: 'AiSettings',
        component: () => import('../views/AiSettingsView.vue')
      },
      {
        path: 'projects/:id/ai-analysis',
        name: 'AiAnalysis',
        component: () => import('../views/AiAnalysisView.vue')
      },
      {
        path: 'projects/:id/data-lineage',
        name: 'DataLineage',
        component: () => import('../views/DataLineageView.vue')
      },
      {
        path: 'projects/:id/semantic-graph',
        name: 'SemanticGraph',
        component: () => import('../views/SemanticGraphView.vue')
      },
      {
        path: 'projects/:id/business-flow',
        name: 'BusinessFlow',
        component: () => import('../views/BusinessFlowView.vue')
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('token')
  const requiresAuth = to.matched.some(record => record.meta.requiresAuth)

  if (requiresAuth && !token) {
    next('/login')
  } else if (!requiresAuth && token && (to.path === '/login' || to.path === '/register')) {
    next('/projects')
  } else {
    next()
  }
})

export default router
