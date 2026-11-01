// STANDALONE STUB — 편입 시 WebManager 원본으로 교체
// 원본: WebManager@2f1eb0a client/src/shared/composables/useFeaturePermission.js (175줄). export 5개와 반환 모양을 지킨다.
// 단독판에는 권한 API 가 없어 모두 허용한다. 편집기 쓰기 권한은 기능 안에서 /me 의 canWrite 로 검사한다.
import { ref, computed } from 'vue'

const loading = ref(false)
const initialized = ref(true)
const allowAll = { read: true, write: true, delete: true }

async function fetchPermissions() {}
function clearPermissions() {}
async function refreshPermissions() {}

export function useFeaturePermission() {
  return {
    canRead: computed(() => true),
    canWrite: computed(() => true),
    canDelete: computed(() => true),
    hasAnyPermission: computed(() => true),
    isAdmin: computed(() => false),
    loading: computed(() => loading.value),
    initialized: computed(() => initialized.value),
    refresh: async () => {}
  }
}

export function useAllFeaturePermissions() {
  return {
    allPermissions: computed(() => ({})),
    isAdmin: computed(() => false),
    loading: computed(() => false),
    saving: computed(() => false),
    fetchAll: async () => {},
    updateFeature: async () => allowAll,
    refreshCache: async () => {}
  }
}

export { fetchPermissions, clearPermissions, refreshPermissions }
