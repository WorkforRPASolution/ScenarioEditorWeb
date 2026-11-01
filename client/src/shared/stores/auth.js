// STANDALONE STUB — 편입 시 WebManager 원본으로 교체
// 원본: WebManager@2f1eb0a client/src/shared/stores/auth.js (261줄). 반환 키와 getter·hasPermission·hasRole 본문은 원본과 같다
// (menu.test·processFilter.test 가 user 를 직접 대입해 hasRole·hasPermission·authorityManager 를 본다).
// 다른 점: isAuthenticated 는 토큰이 없어 user 만 본다(원본은 token && user).
// 로그인·토큰·권한 API 가 없다. 사용자는 GET /scenario-editor/me (서버 설정 SingleID) 로 정한다.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const token = ref(null)
  const loading = ref(false)
  const initialized = ref(false)
  const featurePermissions = ref({})
  const featurePermissionsLoaded = ref(false)

  const isAuthenticated = computed(() => !!user.value)
  const permissions = computed(() => user.value?.permissions || {})
  const authorityManager = computed(() => user.value?.authorityManager ?? 3)
  const roleName = computed(() => user.value?.roleName || 'Guest')
  const isAdmin = computed(() => authorityManager.value === 1)

  const hasPermission = (feature) => {
    return permissions.value[feature] === true
  }

  const hasRole = (allowedRoles) => {
    if (Array.isArray(allowedRoles)) {
      return allowedRoles.includes(authorityManager.value)
    }
    return authorityManager.value === allowedRoles
  }

  const hasFeaturePermission = () => {
    return true
  }

  async function fetchFeaturePermissions() {
    featurePermissionsLoaded.value = true
  }

  function clearFeaturePermissions() {
    featurePermissions.value = {}
    featurePermissionsLoaded.value = false
  }

  async function refreshFeaturePermissions() {}

  async function login() {
    return { success: false, error: '단독판에는 로그인이 없습니다', code: 'STANDALONE' }
  }

  async function logout() {}

  async function refresh() {
    return isAuthenticated.value
  }

  async function fetchUser() {
    try {
      const res = await api.get('/scenario-editor/me')
      const me = res.data?.data
      if (!me) throw new Error('no data')
      user.value = {
        id: me.singleid,
        singleid: me.singleid,
        name: me.name || me.singleid,
        email: '',
        authorityManager: me.authorityManager,
        roleName: me.authorityName,
        permissions: {}
      }
      return true
    } catch {
      user.value = null
      return false
    }
  }

  async function initialize() {
    if (initialized.value) return
    loading.value = true
    try {
      await fetchUser()
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  return {
    user, token, loading, initialized, featurePermissions, featurePermissionsLoaded,
    isAuthenticated, permissions, authorityManager, roleName, isAdmin,
    hasPermission, hasRole, hasFeaturePermission,
    fetchFeaturePermissions, clearFeaturePermissions, refreshFeaturePermissions,
    login, logout, refresh, fetchUser, initialize
  }
})
