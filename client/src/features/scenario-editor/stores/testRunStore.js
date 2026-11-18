import { defineStore } from 'pinia'
import { ref, shallowRef, computed, watch } from 'vue'
import { scenarioEditorApi as api } from '../api'
import { errorCode, errorMessage } from '../messages'
import { safeStorage } from '../composables/useSafeStorage'
import { useEditorStore } from './editorStore'
import { useEditStore } from './editStore'
import {
  reasonError, stepError, searchTargets, selectableIds, clickSelect, toggleAll, hiddenCount, openRelation, blockReason,
  shouldStop, keepAfterRun, needsStatus, pollDelay, applyStatus, newRunId
} from '../editor/testRun'

// 시험 실행 창의 상태와 서버 호출(P5 설계 §4.10) — 규칙은 editor/testRun.js.
// - 고르기: 공정 → 모델 → 시나리오. 공정·모델을 바꾸면 아래 것과 설비 선택을 비운다. 늦게 온 목록·설비·정보는 요청 번호로 버린다(DC-010).
// - 실행: 고른 설비를 설비 ID 순으로 한 번에 하나씩 보낸다. 저절로 다시 보내는 것은 429(다른 실행 요청이 돈다 — 보내지 않은 것이 확실하다)뿐이다.
//   응답을 받지 못한 설비는 "접수 여부 모름" 으로 두고 다시 보내지 않는다 — 실행 상태 조회가 서버의 요청 기록에서 결과를 되찾는다.
// - 실행 상태: 창이 열려 있는 동안 끝 상태가 아닌 줄만 다시 묻는다. 실패하면 저절로 다시 읽지 않는다.
const STORE_KEY = 'se-test-run'
const BUSY_RETRIES = 20
const BUSY_WAIT_MS = 1000
const STATUS_GAP_MS = 3000 // 보내는 동안 실행 상태를 읽는 간격
const RECIPIENTS_WAIT_MS = 300 // 설비를 고르는 동안 수신인을 묶어서 받는다
const IDLE = Object.freeze({ status: 'idle', message: '' })
const LIMITS = Object.freeze({ maxEquipment: 200, recentMin: 10 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

export const useTestRunStore = defineStore('scenarioEditorTestRun', () => {
  const editor = useEditorStore()
  const edit = useEditStore()

  const open = ref(false)
  const sel = ref({ process: '', model: '', name: '' })
  const scenarios = shallowRef({ ...IDLE, rows: [] })
  const targets = shallowRef({ ...IDLE, items: [], limits: LIMITS })
  const info = shallowRef({ ...IDLE, data: null })
  // 결과 메일 수신인 — 고른 설비들의 수신 묶음과 주소(미리 보기)
  const recipients = shallowRef({ ...IDLE, groups: [] })
  const picked = shallowRef(new Set())
  const anchor = ref(null)
  const query = ref('')
  const reasonKind = ref('INSPECTION')
  const reasonText = ref('')
  const startStep = ref('1')
  const stage = ref('pick') // pick · confirm · running · done
  const again = ref(false)
  // { id, process, model, name, startStep, startDelay, items, halt, now, nowAt, lastSentAt, statusFailed }
  const run = shallowRef(null)
  let touched = false // 사용자가 무엇이든 골랐는가 — 그 뒤에는 열 때 처음 값을 넣지 않는다
  let listSeq = 0
  let eqpSeq = 0
  let infoSeq = 0
  let stopped = false
  let reading = null // 실행 상태를 읽는 중인 실행(run.id) — 앞 실행의 늦은 조회가 새 실행의 다시 읽기를 막지 않게 실행마다 가른다
  let confirmedRecent = new Set() // 확인 창에 "방금 요청함" 으로 보인 설비 — again 은 이 설비에만 싣는다
  let timer = null
  let mailSeq = 0
  let mailTimer = null

  const processes = computed(() => (editor.scopes?.processes ?? []).map((p) => p.process))
  const models = computed(() => ((editor.scopes?.processes ?? []).find((p) => p.process === sel.value.process)?.models ?? []).map((m) => m.model))
  const inScope = (process, model) => (editor.scopes?.processes ?? []).some((p) => p.process === process && (!model || p.models.some((m) => m.model === model)))

  // 편집기에 연 시나리오 — 설비에서 도는 것은 늘 배포된 현재 판이라, 고친 내용이 있거나 현재 판이 아닌 세션이면 알린다
  function openedScenario() {
    const sk = editor.skeleton
    if (!sk || sk.isNew) return null
    const s = edit.session
    // 현재 판 그대로인가: 연 때 현재 판이었고, **지금도** 그 판이 현재 판이다(연 뒤에 다른 사람이 새 판을 배포했으면 스텝 번호가 다를 수 있다)
    const nowCrtime = info.value.data?.current?.crtime
    const current = sk.version?.isCurrent === true && !s?.restoredFrom && !s?.fromDraft && nowCrtime !== undefined && sk.version.crtime === nowCrtime
    return { process: sk.process, model: sk.model, name: sk.name, unsaved: edit.unsavedCount, current }
  }
  const relation = computed(() => openRelation(sel.value, openedScenario()))
  // 그 번호 스텝의 설명 — 편집기의 번호와 설비에서 도는 번호가 같다고 말할 수 있을 때만(현재 판 그대로 열어 둠)
  const stepDesc = computed(() => {
    if (relation.value !== 'same' || stepError(startStep.value, editor.steps.length)) return null
    const step = editor.steps[Number(String(startStep.value).trim()) - 1]
    return typeof step?.descriptionToEmail === 'string' && step.descriptionToEmail !== '' ? step.descriptionToEmail : null
  })

  const shown = computed(() => searchTargets(targets.value.items, query.value))
  const hidden = computed(() => hiddenCount(picked.value, shown.value))
  const loading = computed(() => [scenarios.value, targets.value, info.value].some((x) => x.status === 'loading'))
  const reasonErr = computed(() => reasonError(reasonKind.value, reasonText.value))
  const stepErr = computed(() => stepError(startStep.value, info.value.data?.current?.stepCount ?? null))
  const block = computed(() => blockReason({
    name: sel.value.name, loading: loading.value, info: info.value.data, infoFailed: info.value.status === 'error', picked: picked.value.size, max: targets.value.limits.maxEquipment,
    reasonErr: reasonErr.value, stepErr: stepErr.value
  }))
  // 고른 설비 가운데 방금 이 시나리오의 실행을 요청한 설비(누가·언제)
  const recentPicked = computed(() => (info.value.data?.recent ?? []).filter((r) => picked.value.has(r.eqpId)))
  const pending = computed(() => (run.value?.items ?? []).filter((x) => x.outcome === 'waiting' || x.outcome === 'sending').length)

  const failed = (e) => ({ status: 'error', message: errorMessage(e) })
  function clearPicked() { picked.value = new Set(); anchor.value = null }

  async function loadScenarios() {
    const { process, model } = sel.value
    const id = ++listSeq
    scenarios.value = { status: 'loading', message: '', rows: [] }
    try {
      const rows = (await api.list(process, model)).data.data
      if (id === listSeq) scenarios.value = { status: 'ready', message: '', rows }
    } catch (e) {
      if (id === listSeq) scenarios.value = { ...failed(e), rows: [] }
    }
  }
  async function loadEquipment() {
    const { process, model } = sel.value
    const id = ++eqpSeq
    targets.value = { ...targets.value, status: 'loading', message: '' }
    try {
      const d = (await api.testRunEquipment(process, model)).data.data
      if (id !== eqpSeq) return
      targets.value = { status: 'ready', message: '', items: d.equipment, limits: d.limits ?? LIMITS }
      // 그 사이 사라졌거나 자동조치가 꺼진 설비의 선택을 푼다
      const can = new Set(selectableIds(d.equipment))
      if ([...picked.value].some((x) => !can.has(x))) picked.value = new Set([...picked.value].filter((x) => can.has(x)))
    } catch (e) {
      // 읽지 못했으면 줄도 선택도 비운다 — 앞의 줄이 남은 채 [실행] 이 켜지지 않게
      if (id === eqpSeq) { targets.value = { ...failed(e), items: [], limits: targets.value.limits }; clearPicked() }
    }
  }
  // keep = 읽는 동안 앞의 값을 보인 채로(확인으로 넘어갈 때의 다시 읽기 — 화면이 깜빡이지 않게)
  async function loadInfo({ keep = false } = {}) {
    const { process, model, name } = sel.value
    const id = ++infoSeq
    info.value = { status: 'loading', message: '', data: keep ? info.value.data : null }
    try {
      const data = (await api.testRunScenario(process, model, name)).data.data
      if (id === infoSeq) info.value = { status: 'ready', message: '', data }
    } catch (e) {
      if (id === infoSeq) info.value = { ...failed(e), data: null }
    }
  }
  const resetInfo = () => { infoSeq++; info.value = { ...IDLE, data: null } }

  // 결과 메일 수신인: 시나리오·고른 설비가 바뀌면 0.3초 묶어서 다시 받는다. 고른 것이 없으면 받지 않고 비운다. 늦게 온 답은 버린다.
  async function loadRecipients() {
    const { process, model, name } = sel.value
    const eqpIds = [...picked.value].sort(byId)
    const id = ++mailSeq
    recipients.value = { status: 'loading', message: '', groups: recipients.value.groups }
    try {
      const d = (await api.testRunRecipients({ process, model, name, eqpIds })).data.data
      if (id === mailSeq) recipients.value = { status: 'ready', message: '', groups: d.groups ?? [] }
    } catch (e) {
      if (id === mailSeq) recipients.value = { ...failed(e), groups: [] }
    }
  }
  watch([picked, () => sel.value.name, () => sel.value.model], () => {
    clearTimeout(mailTimer)
    mailSeq++
    if (!sel.value.name || !picked.value.size) { recipients.value = { ...IDLE, groups: [] }; return }
    mailTimer = setTimeout(loadRecipients, RECIPIENTS_WAIT_MS)
  })

  function applyProcess(process) {
    sel.value = { process, model: '', name: '' }
    clearPicked()
    listSeq++; eqpSeq++
    scenarios.value = { ...IDLE, rows: [] }
    targets.value = { ...IDLE, items: [], limits: targets.value.limits }
    resetInfo()
  }
  function applyModel(model) {
    sel.value = { process: sel.value.process, model, name: '' }
    clearPicked()
    resetInfo()
    if (!model) {
      listSeq++; eqpSeq++
      scenarios.value = { ...IDLE, rows: [] }
      targets.value = { ...IDLE, items: [], limits: targets.value.limits }
      return
    }
    safeStorage.set(STORE_KEY, JSON.stringify({ process: sel.value.process, model }))
    targets.value = { ...IDLE, items: [], limits: targets.value.limits } // 읽는 동안 앞 모델의 설비 줄이 남아 눌리지 않게
    loadScenarios()
    loadEquipment()
  }
  function applyName(name) {
    sel.value = { ...sel.value, name }
    startStep.value = '1'
    if (name) loadInfo()
    else resetInfo()
  }
  const setProcess = (process) => { touched = true; applyProcess(process) }
  const setModel = (model) => { touched = true; applyModel(model) }
  const setName = (name) => { touched = true; applyName(name) }

  // 처음 값: 편집기에 연 시나리오 → 마지막에 쓴 공정·모델(브라우저에 기억) → 내 공정이 하나뿐이면 그 공정
  function initial() {
    const o = openedScenario()
    if (o && inScope(o.process, o.model)) { applyProcess(o.process); applyModel(o.model); applyName(o.name); return }
    let last = null
    try { last = JSON.parse(safeStorage.get(STORE_KEY) || 'null') } catch { last = null }
    if (last && typeof last.process === 'string' && inScope(last.process)) {
      applyProcess(last.process)
      if (typeof last.model === 'string' && inScope(last.process, last.model)) applyModel(last.model)
      return
    }
    if (processes.value.length === 1) applyProcess(processes.value[0])
  }

  function show() {
    open.value = true
    if (!touched && !sel.value.model && !run.value) initial()
    if (run.value && stage.value === 'done') refreshStatus()
  }
  // 닫기: 보내는 중이면 남은 설비를 보내지 않는다(묻는 것은 창이 한다). 고른 것과 마지막 결과는 남는다.
  function hide() {
    open.value = false
    clearTimeout(timer)
    timer = null
    if (stage.value === 'running') stopped = true
    if (stage.value === 'confirm') stage.value = 'pick'
  }
  function reload() {
    if (!sel.value.model) return
    loadEquipment()
    if (sel.value.name) loadInfo()
  }

  function click(id, mods = {}) {
    const next = clickSelect({ picked: picked.value, anchor: anchor.value }, selectableIds(shown.value), id, mods)
    picked.value = next.picked
    anchor.value = next.anchor
  }
  function toggleAllShown(on) { picked.value = toggleAll(picked.value, selectableIds(shown.value), on) }

  // 확인으로 넘어가기 전에 시나리오 정보를 다시 읽는다 — 창을 연 뒤 다른 사람이 요청한 설비(방금 요청)와 그 사이 생긴 막는 까닭을 지금 값으로 보인다
  async function ask() {
    if (block.value || stage.value !== 'pick') return
    await loadInfo({ keep: true })
    if (block.value || stage.value !== 'pick') return
    again.value = false
    confirmedRecent = new Set(recentPicked.value.map((r) => r.eqpId))
    stage.value = 'confirm'
  }
  function cancel() { if (stage.value === 'confirm') stage.value = 'pick' }
  function stop() { if (stage.value === 'running') stopped = true }

  const setItem = (i, patch) => {
    const items = run.value.items.slice()
    items[i] = { ...items[i], ...patch }
    run.value = { ...run.value, items }
  }

  async function start() {
    if (stage.value !== 'confirm') return
    const { process, model, name } = sel.value
    const reason = reasonKind.value === 'other' ? { kind: 'other', text: reasonText.value.trim() } : { kind: reasonKind.value }
    const step = Number(String(startStep.value).trim())
    // again 은 확인 창에 "방금 요청함" 으로 보인 설비에만 싣는다 — 사용자가 보지 못한 설비의 보호까지 풀지 않는다(서버가 그 설비는 recent 로 막는다)
    const base = { runId: newRunId(), process, model, name, startStep: step, reason }
    const againFor = again.value ? confirmedRecent : new Set()
    run.value = {
      id: base.runId, process, model, name, startStep: step, startDelay: info.value.data?.startDelay ?? 0, halt: null, now: null, nowAt: null, lastSentAt: Date.now(), statusFailed: false,
      items: [...picked.value].sort(byId).map((eqpId) => ({ eqpId, outcome: 'waiting', detail: null, lost: false, sentAt: undefined, found: 0, status: null, retry: null, txnSeq: null, createDate: null }))
    }
    stage.value = 'running'
    stopped = false
    let halt = null
    let lastRead = Date.now()
    const count = run.value.items.length
    send: for (let i = 0; i < count; i++) {
      if (stopped) break
      setItem(i, { outcome: 'sending', sentAt: Date.now() }) // 서버의 기록을 받기 전까지는 화면이 보낸 시각으로 잰다
      for (let tries = 0; ; tries++) {
        try {
          const eqpId = run.value.items[i].eqpId
          const r = (await api.testRunRequest({ ...base, eqpId, again: againFor.has(eqpId) })).data.data
          setItem(i, { outcome: r.outcome, detail: r.detail ?? null })
          break
        } catch (e) {
          if (errorCode(e) === 'TEST_RUN_BUSY') {
            // 서버가 아무것도 보내지 않았다 — 같은 설비를 다시 보낸다
            if (tries < BUSY_RETRIES && !stopped) { await sleep(BUSY_WAIT_MS); continue }
            setItem(i, { outcome: 'waiting' })
            if (!stopped) halt = { key: 'SEW_RUN_HALT_BUSY' }
            break send
          }
          if (e?.response) {
            // 요청 전체가 막혔다(권한이 그 사이 사라짐·시나리오가 꺼짐 등) — 남은 설비도 같은 까닭으로 막힌다
            setItem(i, { outcome: 'waiting' })
            halt = { key: 'SEW_RUN_HALT_ERROR', params: { message: errorMessage(e) } }
            break send
          }
          // 웹 서버의 응답을 받지 못했다 — 서버는 보냈을 수 있다. 다시 보내지 않는다
          setItem(i, { outcome: 'unknown', lost: true })
          break
        }
      }
      run.value = { ...run.value, lastSentAt: Date.now() }
      if (shouldStop(run.value.items)) { halt = { key: 'SEW_RUN_HALT_STREAK' }; break }
      // 설비가 많으면 보내는 동안에도 앞 설비의 실행 상태를 읽는다
      if (open.value && Date.now() - lastRead >= STATUS_GAP_MS) { lastRead = Date.now(); refreshStatus() }
    }
    const items = run.value.items.map((x) => (x.outcome === 'waiting' || x.outcome === 'sending' ? { ...x, outcome: 'skipped' } : x))
    if (!halt && stopped && items.some((x) => x.outcome === 'skipped')) halt = { key: 'SEW_RUN_HALT_USER' }
    run.value = { ...run.value, items, halt }
    stage.value = 'done'
    schedule(0)
  }

  // 서버 시각의 어림값 — 마지막 답의 now 에 그 뒤 지난 시간을 더한다(브라우저 시계를 믿지 않는다)
  const nowOf = (r) => (r.now === null ? Date.now() : r.now + (Date.now() - r.nowAt))
  function schedule(delay) {
    clearTimeout(timer)
    timer = null
    if (!open.value || !run.value || run.value.statusFailed) return
    timer = setTimeout(() => { timer = null; refreshStatus() }, delay)
  }
  async function refreshStatus() {
    const r = run.value
    if (!r || reading === r.id) return
    const need = r.items.filter((x) => needsStatus(x, nowOf(r)))
    if (!need.length) return
    reading = r.id
    try {
      const pinned = Object.fromEntries(need.filter((x) => x.found && Number.isFinite(x.txnSeq)).map((x) => [x.eqpId, x.txnSeq]))
      const d = (await api.testRunStatus({ runId: r.id, pinned })).data.data
      if (run.value?.id !== r.id) return
      run.value = { ...run.value, items: applyStatus(run.value.items, d.items), now: d.now, nowAt: Date.now(), statusFailed: false }
    } catch (e) {
      if (run.value?.id !== r.id) return
      // 서버에 이 실행의 기록이 없다(404) — 응답을 놓친 요청이 기록 전에 끝난 것이다. 실패가 아니다(줄은 시간이 지나면 "기록 없음" 이 된다)
      if (errorCode(e) !== 'NOT_FOUND') { run.value = { ...run.value, statusFailed: true }; return }
      run.value = { ...run.value, statusFailed: false }
    } finally {
      if (reading === r.id) reading = null
    }
    if (stage.value !== 'done') return // 보내는 동안에는 보내는 쪽이 간격을 잰다
    const cur = run.value
    const delay = pollDelay(Date.now() - cur.lastSentAt)
    if (delay !== null && cur.items.some((x) => needsStatus(x, nowOf(cur)))) schedule(delay)
  }

  // [다시 고르기]: 고르기로 돌아가고 접수·모름이었던 설비의 선택을 푼다. 설비·방금 요청을 다시 읽는다.
  function pickAgain() {
    if (stage.value !== 'done' || !run.value) return
    picked.value = keepAfterRun(picked.value, run.value.items)
    clearTimeout(timer)
    timer = null
    run.value = null
    stage.value = 'pick'
    reload()
  }

  return {
    open, sel, scenarios, targets, info, recipients, picked, query, reasonKind, reasonText, startStep, stage, again, run,
    processes, models, relation, stepDesc, shown, hidden, loading, reasonErr, stepErr, block, recentPicked, pending,
    openedScenario, show, hide, setProcess, setModel, setName, reload, click, toggleAllShown, ask, cancel, start, stop, refreshStatus, pickAgain
  }
})
