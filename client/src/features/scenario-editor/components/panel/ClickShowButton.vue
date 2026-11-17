<script setup>
// [누를 곳 보기](2026-11-17 사내 요청 — 데스크톱 편집기의 클릭 위치 보기): 큰 화면의 스텝 그림에서 누를 곳을 잠깐 깜빡여 보인다.
// 편집 패널의 "하는 일"(ActionStation — 누를 곳 X·Y 옆)과 읽기 전용 상세의 "동작"(StepDetail)이 함께 쓴다. 스텝·초안을 바꾸지 않는다.
// 누를 곳은 찾은 그림 왼쪽 위에서 잰 값이라, 기준 화면의 검색 영역에서 찾을 그림을 한 곳 찾았을 때만 자리를 안다(useTrainSpot —
// 패널 썸네일·큰 화면과 같은 결과를 함께 쓴다). 그렇지 않거나 큰 화면에서 잡는 동안에는 꺼지고 까닭을 title 로 알린다.
// 요청은 editStore.showClick(uid) — 큰 화면(StepViewer)이 그 스텝을 보이고 있을 때 점을 그리고, 화면(ScenarioEditorView)이 스텝 그림 모드로 돌린다.
// 패널 초안은 큰 화면의 스텝과 갈릴 수 있다(여러 줄을 골랐다 풀면 패널은 고치던 스텝, 큰 화면은 기준 줄) — 큰 화면이 읽은 기준 화면이
// 패널의 스텝 것일 때만 켠다(editStore.screenSize 의 uid — 검색 영역 입력의 화면 밖 검사 panelScreen 과 같은 조건).
import { computed } from 'vue'
import { useEditStore } from '../../stores/editStore'
import { useTrainSpot } from '../../composables/useTrainSpot'
import { CLICK_SHOW_MS } from '../../editor/trainView'
import { t } from '../../messages'

defineOptions({ name: 'ClickShowButton' })
const props = defineProps({
  draft: { type: Object, default: null }, // 패널 초안
  step: { type: Object, default: null } // 표시 스텝(읽기 전용)
})
const edit = useEditStore()
const spot = useTrainSpot(() => (props.draft ? { draft: props.draft } : props.step ? { step: props.step } : null))
const why = computed(() => {
  if (edit.capture) return t('SEW_CLICK_SHOW_WHY_CAPTURE')
  if (!spot.input.value?.click) return t('SEW_CLICK_SHOW_WHY_NO_INPUT') // 찾을 것(기준 화면·영역·찾을 그림)이나 누를 곳이 없다
  const r = spot.result.value
  if (!r || !['one', 'many', 'none', 'timeout'].includes(r.found)) return t(r ? 'SEW_CLICK_SHOW_WHY_error' : 'SEW_CLICK_SHOW_WHY_FINDING')
  if (r.found !== 'one') return t(`SEW_CLICK_SHOW_WHY_${r.found}`)
  if (!spot.marks.value?.click) return t('SEW_CLICK_SHOW_WHY_FINDING') // 영역을 끄는 동안
  return props.draft && edit.screenSize?.uid !== edit.panel.uid ? t('SEW_CLICK_SHOW_WHY_OTHER') : null
})
const uid = computed(() => (props.draft ? edit.panel.uid : props.step?.uid))
</script>

<template>
  <button type="button" data-testid="se-click-show" :disabled="!!why" :title="why ?? t('SEW_CLICK_SHOW_TITLE', { sec: CLICK_SHOW_MS / 1000 })" :aria-label="t('SEW_CLICK_SHOW')"
    class="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md text-primary-700 dark:text-primary-300 hover:enabled:bg-primary-50 dark:hover:enabled:bg-primary-900/30 disabled:text-gray-400 disabled:opacity-60"
    @click="edit.showClick(uid)">
    <!-- 점과 둘레의 고리 — 큰 화면에 뜨는 점의 모양 -->
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6.2" /><circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none" /></svg>
  </button>
</template>
