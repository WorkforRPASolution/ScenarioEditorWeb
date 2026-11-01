// shell-modified: WebManager@2f1eb0a client/src/router/index.js — 라우트 배열을 편집기·unauthorized·/ redirect 로 바꾸고,
// 가드는 대역 인증 초기화만 남겼다(로그인·권한·코파일럿 플래그 단계 없음). meta 형식은 원본과 같다.
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../shared/stores/auth'

const routes = [
  { path: '/', redirect: '/scenario-editor' },
  {
    path: '/scenario-editor',
    name: 'ScenarioEditor',
    component: () => import('../features/scenario-editor/ScenarioEditorView.vue'),
    meta: {
      layout: 'default',
      requiresAuth: false,
      menu: {
        mainMenu: 'scenario',
        mainMenuLabel: 'Scenario',
        mainMenuIcon: 'edit',
        mainMenuOrder: 1,
        subMenu: 'scenario-editor',
        subMenuLabel: 'Scenario Editor',
        subMenuIcon: 'edit',
        subMenuOrder: 1
      }
    }
  },
  {
    path: '/unauthorized',
    name: 'Unauthorized',
    component: () => import('../features/errors/UnauthorizedView.vue'),
    meta: { layout: 'blank', requiresAuth: false }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()
  if (!authStore.initialized) {
    await authStore.initialize()
  }
  next()
})

export default router
