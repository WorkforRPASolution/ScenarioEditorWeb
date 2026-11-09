// 초점 스텝의 찾을 그림 위치 보기(찾을 그림 밖 누를 곳 B). source() = { draft }(패널 초안) | { step }(표시 스텝) | null.
// 키(기준 화면·찾을 그림·검색 영역)가 SPOT_DELAY_MS 동안 그대로이면 editStore.findSpot 으로 찾는다 — 스텝을 빨리 넘기거나 영역을 끄는 동안
// 메인 스레드에서 도는 위치 찾기를 거듭하지 않게. 이미 찾은 키는 기다리지 않는다. 같은 키를 여러 화면(패널·상세·큰 화면)이 봐도 한 번만 찾는다.
// 결과는 지금 키로만 읽어 늦게 끝난 옛 결과가 다른 스텝에 붙지 않는다. 화면이 닫히면 예약을 거둔다.
// 큰 화면에서 검색 영역을 끄는 동안(editStore.areaDragging)은 찾지 않고 큰 화면 표시(marks)를 숨긴다 — 놓으면 그 영역으로 한 번 찾는다.
// 썸네일(around·note)은 새 키의 결과가 오기 전까지 같은 그림(기준 화면·찾을 그림)의 앞 결과를 그대로 보인다(끌 때 깜박이지 않게).
// 큰 화면은 지금 키의 결과만 그린다 — 앞 결과의 자리는 새 영역에서 틀릴 수 있다.
import { computed, watch, shallowRef, onScopeDispose } from 'vue'
import { useEditStore } from '../stores/editStore'
import { spotInputOfDraft, spotInputOfStep, spotKey, spotAround, spotMarks, spotNote } from '../editor/trainView'

export const SPOT_DELAY_MS = 150

export function useTrainSpot(source) {
  const edit = useEditStore()
  const input = computed(() => {
    const s = source()
    if (s?.draft) return spotInputOfDraft(s.draft, { session: edit.session, uploads: edit.uploads, draftId: edit.draftId })
    return s?.step ? spotInputOfStep(s.step) : null
  })
  const key = computed(() => spotKey(input.value))
  let timer = null
  const cancel = () => { clearTimeout(timer); timer = null }
  watch([key, () => edit.spotGen, () => edit.areaDragging], ([k, , dragging]) => {
    cancel()
    if (!k || dragging) return
    const have = edit.spots.get(k)
    if (have && have.found !== 'error') return
    timer = setTimeout(() => { timer = null; if (key.value === k) edit.findSpot(input.value) }, SPOT_DELAY_MS)
  }, { immediate: true })
  onScopeDispose(cancel)
  const result = computed(() => (key.value ? edit.spots.get(key.value) ?? null : null))
  // 썸네일용: 지금 키의 결과, 아직 없으면 같은 그림의 앞 결과
  const last = shallowRef(null)
  watch(result, (r) => { if (r) last.value = { baseUrl: input.value.baseUrl, trainUrl: input.value.trainUrl, result: r } }, { immediate: true, flush: 'sync' })
  const steady = computed(() => {
    if (result.value) return result.value
    const l = last.value
    const i = input.value
    return l && i && l.baseUrl === i.baseUrl && l.trainUrl === i.trainUrl ? l.result : null
  })
  return {
    input,
    result,
    around: computed(() => spotAround(input.value, steady.value)),
    marks: computed(() => (edit.areaDragging ? null : spotMarks(input.value, result.value))),
    note: computed(() => spotNote(input.value, steady.value))
  }
}
