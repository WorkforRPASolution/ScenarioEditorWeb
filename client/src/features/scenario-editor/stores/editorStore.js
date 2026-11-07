import { defineStore } from 'pinia'
import { ref, computed, toRaw, watch } from 'vue'
import { scenarioEditorApi as api } from '../api'
import { errorCode, errorMessage } from '../messages'
import { useEditStore } from './editStore'
import { displaySteps } from '../editor/display'

const fail = (e) => ({ code: errorCode(e), message: errorMessage(e) })

export const useEditorStore = defineStore('scenarioEditor', () => {
  const me = ref(null)
  const meError = ref(null)
  const scopes = ref(null)
  const dataCheck = ref(null)
  const skeleton = ref(null)
  const opening = ref(null)
  const openError = ref(null)
  const selectedUid = ref(null)
  const view = ref('table')
  const expanded = ref(false)

  const edit = useEditStore()
  // 편집 중(작업본이 있음)이면 작업본을 뼈대 스텝 모양으로 — 표·순서도·큰 화면·상세가 고친 내용을 따라간다. 고친 것이 없으면 뼈대 배열 그대로.
  const steps = computed(() => {
    const session = edit.session
    if (session?.working && skeleton.value) return displaySteps(session, skeleton.value, { uploads: edit.uploads, draftId: edit.draftId ?? null })
    return skeleton.value?.steps ?? []
  })
  const selectedStep = computed(() => steps.value.find((s) => s.uid === selectedUid.value) ?? null)
  const count = (level) => steps.value.reduce((a, s) => a + s.notes.filter((n) => n.level === level).length, 0)
    + (skeleton.value?.notes ?? []).filter((n) => n.level === level).length
  const warningCount = computed(() => count('warning'))
  const infoCount = computed(() => count('info'))
  const dataCheckCount = computed(() => {
    const d = dataCheck.value
    if (!d) return 0
    return d.duplicateUsers.length + d.duplicateEqpIds.length + d.invalidEquipment.length + d.proxyIpDuplicates.length + d.duplicateProperties.length
  })

  async function init() {
    meError.value = null
    try {
      me.value = (await api.me()).data.data
    } catch (e) {
      meError.value = fail(e)
      return
    }
    const [s, d] = await Promise.allSettled([api.scopes(), api.dataCheck()])
    scopes.value = s.status === 'fulfilled' ? s.value.data.data : null
    dataCheck.value = d.status === 'fulfilled' ? d.value.data.data : null
  }

  async function refreshCaches() {
    await api.refreshCache()
    await init()
  }

  // 열기 요청이 겹치면 마지막 요청만 화면 상태를 바꾼다(앞 요청의 늦은 성공·실패·진행 표시 해제를 무시).
  let openSeq = 0
  async function openScenario({ process, model, name, crtime = 'current' }) {
    const id = ++openSeq
    expanded.value = false // 넓게 보기에서는 위쪽(여는 중·오류 표시)이 가려진다
    opening.value = { process, model, name, crtime, startedAt: Date.now() }
    openError.value = null
    try {
      const next = (await api.open(process, model, name, crtime)).data.data
      if (id !== openSeq) return
      skeleton.value = next
      edit.begin(toRaw(next), me.value)
      selectedUid.value = next.steps[0]?.uid ?? null
      edit.syncFocus(selectedUid.value) // 앞 시나리오와 첫 uid 가 같으면 아래 감시자가 울리지 않는다
    } catch (e) {
      if (id !== openSeq) return
      skeleton.value = null
      edit.end()
      selectedUid.value = null
      openError.value = { ...fail(e), target: { process, model, name, crtime } }
    } finally {
      if (id === openSeq) opening.value = null
    }
  }

  // 초점(보는 스텝)이 다른 경로(순서도·상세·경고 순회·↑↓)로 바뀌면 여러 줄 선택을 그 한 줄로 접는다.
  // 편집 저장소가 여러 줄을 고를 때는 기준 줄을 먼저 정하고 초점을 옮기므로 접히지 않는다.
  watch(selectedUid, (uid) => edit.syncFocus(uid), { flush: 'sync' })

  const select = (uid) => { selectedUid.value = uid }
  const selectByNo = (no) => { const s = steps.value[no - 1]; if (s) selectedUid.value = s.uid }
  function moveSelection(delta) {
    if (!steps.value.length) return
    const i = steps.value.findIndex((s) => s.uid === selectedUid.value)
    if (i < 0) {
      selectedUid.value = steps.value[delta < 0 ? steps.value.length - 1 : 0].uid
      return
    }
    selectedUid.value = steps.value[Math.min(steps.value.length - 1, Math.max(0, i + delta))].uid
  }
  // 경고·알림이 있는 스텝을 차례로 고른다. 옮겼으면 true — 스텝 경고가 없으면(시나리오 경고만) false 라 바가 시나리오 경고 줄을 보인다.
  function nextNoted() {
    const list = steps.value.filter((s) => s.notes.length)
    if (!list.length) return false
    const i = list.findIndex((s) => s.uid === selectedUid.value)
    selectedUid.value = list[(i + 1) % list.length].uid
    return true
  }

  return {
    me, meError, scopes, dataCheck, skeleton, opening, openError, selectedUid, view, expanded,
    steps, selectedStep, warningCount, infoCount, dataCheckCount,
    init, refreshCaches, openScenario, select, selectByNo, moveSelection, nextNoted
  }
})
