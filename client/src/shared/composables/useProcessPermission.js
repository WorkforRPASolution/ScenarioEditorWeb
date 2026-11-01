// STANDALONE STUB — 편입 시 WebManager 원본으로 교체
// 원본: WebManager@2f1eb0a client/src/shared/composables/useProcessPermission.js (62줄). 반환 키 5개를 지킨다.
// 편집기의 공정 권한은 서버(/scenario-editor/scopes)가 계산하므로 여기서는 받은 목록을 그대로 돌려준다.
import { computed } from 'vue'

const cache = new Map()

export function useProcessPermission() {
  const canViewAll = computed(() => true)
  const getUserProcesses = () => []
  const getFilteredProcesses = (source) => cache.get(source) || []
  const buildUserProcessFilter = () => null
  const setProcesses = (source, processes) => {
    cache.set(source, Array.isArray(processes) ? processes : [])
  }
  return { canViewAll, getUserProcesses, getFilteredProcesses, buildUserProcessFilter, setProcesses }
}
