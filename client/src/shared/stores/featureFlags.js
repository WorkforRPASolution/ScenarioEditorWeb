import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 서버 기능 플래그의 클라이언트 미러 — 라우트 meta.featureFlag와 메뉴 필터가 참조한다.
 * 값이 세팅되기 전(미로딩)에는 꺼짐으로 취급해 메뉴가 노출되지 않는다.
 */
export const useFeatureFlagsStore = defineStore('featureFlags', () => {
  const flags = ref({})

  function setFlag(name, value) {
    flags.value = { ...flags.value, [name]: value === true }
  }

  function isEnabled(name) {
    return flags.value[name] === true
  }

  return { flags, setFlag, isEnabled }
})
