import { defineStore } from 'pinia'
import { ref, computed, toRaw, watch } from 'vue'
import { scenarioEditorApi as api } from '../api'
import { t, errorCode, errorMessage } from '../messages'
import { buildMeta } from '../editor/request'
import { formatCrtime } from '../format'
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
    if (session?.working && skeleton.value) return displaySteps(session, skeleton.value, { uploads: edit.uploads, draftId: edit.draftId, user: me.value })
    return skeleton.value?.steps ?? []
  })
  // 시나리오 알림. 스텝을 바꾸면 저장된 순서로 계산한 NO_SUCCESS 는 낡으므로 뺀다(R-T5c — 저장 창의 서버 /check 가 다시 본다).
  const scenarioNotes = computed(() => {
    const notes = skeleton.value?.notes ?? []
    const s = edit.session
    return s?.working && s.working.steps !== s.saveBase?.steps ? notes.filter((n) => n.code !== 'NO_SUCCESS') : notes
  })
  const selectedStep = computed(() => steps.value.find((s) => s.uid === selectedUid.value) ?? null)
  const count = (level) => steps.value.reduce((a, s) => a + s.notes.filter((n) => n.level === level).length, 0)
    + scenarioNotes.value.filter((n) => n.level === level).length
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
  // 여는 동안(opening)은 편집 저장소가 고치기를 막는다(editable) — 새 세션을 시작하기 전에 여는 중 표시를 먼저 내려야
  // 새 세션의 패널이 첫 스텝을 연다.
  // load() 는 읽기를 마치고 세션을 시작할 함수를 돌려준다. 실패하면 오류 상태(target 으로 다시 시도 — kind 가 여는 길을 고른다).
  let openSeq = 0
  async function runOpen(target, load) {
    const id = ++openSeq
    expanded.value = false // 넓게 보기에서는 위쪽(여는 중·오류 표시)이 가려진다
    opening.value = { ...target, startedAt: Date.now() }
    openError.value = null
    try {
      const begin = await load()
      if (id !== openSeq) return
      opening.value = null
      begin()
    } catch (e) {
      if (id !== openSeq) return
      skeleton.value = null
      edit.end()
      selectedUid.value = null
      openError.value = { ...(e?.seOpen ?? fail(e)), target }
    } finally {
      if (id === openSeq) opening.value = null
    }
  }
  function openScenario({ process, model, name, crtime = 'current' }) {
    return runOpen({ process, model, name, crtime }, async () => {
      const next = (await api.open(process, model, name, crtime)).data.data
      return () => {
        skeleton.value = next
        edit.begin(toRaw(next), me.value)
        selectedUid.value = next.steps[0]?.uid ?? null
        edit.syncFocus(selectedUid.value) // 앞 시나리오와 첫 uid 가 같으면 아래 감시자가 울리지 않는다
      }
    })
  }

  // [이 버전으로 되돌려 열기](P2-D Task 7, 설계 §6.7): 옛 판과 현재 판을 읽어 되돌린 작업본을 연다. 바로 배포하지 않는다.
  function openRestore({ process, model, name, crtime }) {
    return runOpen({ kind: 'restore', process, model, name, crtime }, async () => {
      const [old, cur] = await Promise.all([api.open(process, model, name, String(crtime)), api.open(process, model, name, 'current')])
      return () => {
        if (edit.beginRestore(old.data.data, cur.data.data)) edit.notify(t('SEW_LOAD_RESTORED', { at: formatCrtime(crtime) }))
      }
    })
  }

  // 원본이 지워진 초안의 기준 판이 서버 사본(디스크 캐시)으로 남았는지 — 배포의 [다시 만듭니다]와 같은 판정(force 검사에 SOURCE_GONE 이 없다, 2026-11-07 결정 (a)).
  // draft = GET /drafts/:id + 키. 검사 결과의 다른 막힘은 상관없다(열고 나서 저장 창이 보인다).
  async function draftSourceKept(draft) {
    const working = draft.scenario
    const { meta } = buildMeta({ working, source: working.source, headCrtime: draft.headCrtime ?? null, propertyRev: draft.propertyRev ?? null },
      { target: { process: draft.process, model: draft.model, name: draft.name }, extra: { force: true } })
    const r = (await api.check(meta)).data.data
    return !r.blocks.some((b) => b.code === 'SOURCE_GONE')
  }

  // [초안 이어서 열기](P2-D Task 7, 설계 §6.1): 초안과 그 기준 판 뼈대를 읽어 연다. target = { process, model, name, draftId }(목록의 키).
  // 기준 판이 없으면(지워짐 404) 서버 사본이 있을 때만 초안 그대로 연다. 새 시나리오 초안은 기준 판이 없다.
  function openDraft({ process, model, name, draftId }) {
    return runOpen({ kind: 'draft', process, model, name, draftId }, async () => {
      const draft = { ...(await api.getDraft(draftId)).data.data, process, model, name }
      let base = null
      if (draft.base) {
        try {
          base = (await api.open(process, model, name, String(draft.base.crtime))).data.data
        } catch (e) {
          if (errorCode(e) !== 'NOT_FOUND') throw e
          if (!(await draftSourceKept(draft))) throw Object.assign(new Error('draft source gone'), { seOpen: { code: 'DRAFT_SOURCE_GONE', message: t('SEW_LOAD_DRAFT_GONE_OPEN') } })
        }
      }
      return () => {
        if (!edit.beginFromDraft(draft, base)) return
        const key = edit.session.fromDraft.stale ? 'SEW_LOAD_DRAFT_OPENED_STALE' : edit.session.fromDraft.gone ? 'SEW_LOAD_DRAFT_OPENED_GONE' : 'SEW_LOAD_DRAFT_OPENED'
        edit.notify(t(key, { time: formatCrtime(Date.parse(draft.savedAt)).slice(5, 16) }))
      }
    })
  }

  // 편집 저장소가 만든 뼈대를 연 것으로 둔다 — 새 시나리오(서버에 없음)·되돌려 열기·초안 이어서 열기(세션과 함께 부른다).
  // 진행 중인 열기는 버린다 — 늦게 끝나도 이 뼈대를 덮지 않게(마지막 동작이 이긴다, openScenario 와 같은 규칙).
  function showSkeleton(sk) {
    openSeq++
    opening.value = null
    openError.value = null
    expanded.value = false
    skeleton.value = sk
    selectedUid.value = null
  }

  // 성과(심의 저장·성과 저장 뒤 서버가 다시 읽은 값). 뼈대 객체는 그대로 두고 그 칸만 바꾼다 — 뼈대를 갈면 순서도·주소 감시가 다시 돈다.
  function setPerformance(performance) {
    if (skeleton.value) skeleton.value.performance = performance ?? null
  }

  // 초점(보는 스텝)이 다른 경로(순서도·상세·경고 순회·↑↓)로 바뀌면 여러 줄 선택을 그 한 줄로 접는다.
  // 편집 저장소가 여러 줄을 고를 때는 기준 줄을 먼저 정하고 초점을 옮기므로 접히지 않는다.
  watch(selectedUid, (uid) => edit.syncFocus(uid), { flush: 'sync' })

  // 초점 옮기기. 오른쪽 패널에 적용 안 한 변경이 있으면 편집 저장소가 먼저 묻는다(순서도·경고 순회·상세의 갈 곳 표시도 같은 길).
  function focus(uid) {
    if (uid !== selectedUid.value && edit.panelDirty() && uid !== edit.panel.uid) { edit.requestSelect(uid); return }
    selectedUid.value = uid
  }
  const select = (uid) => focus(uid)
  const selectByNo = (no) => { const s = steps.value[no - 1]; if (s) focus(s.uid) }
  function moveSelection(delta) {
    if (!steps.value.length) return
    const i = steps.value.findIndex((s) => s.uid === selectedUid.value)
    if (i < 0) {
      focus(steps.value[delta < 0 ? steps.value.length - 1 : 0].uid)
      return
    }
    focus(steps.value[Math.min(steps.value.length - 1, Math.max(0, i + delta))].uid)
  }
  // 경고·알림이 있는 스텝을 차례로 고른다. 옮겼으면 true — 스텝 경고가 없으면(시나리오 경고만) false 라 바가 시나리오 경고 줄을 보인다.
  function nextNoted() {
    const list = steps.value.filter((s) => s.notes.length)
    if (!list.length) return false
    const i = list.findIndex((s) => s.uid === selectedUid.value)
    focus(list[(i + 1) % list.length].uid)
    return true
  }

  return {
    me, meError, scopes, dataCheck, skeleton, opening, openError, selectedUid, view, expanded,
    steps, scenarioNotes, selectedStep, warningCount, infoCount, dataCheckCount,
    init, refreshCaches, openScenario, openRestore, openDraft, draftSourceKept, showSkeleton, setPerformance, select, selectByNo, moveSelection, nextNoted
  }
})
