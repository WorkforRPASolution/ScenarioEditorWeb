import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { beginSession, nextUid, stepNo } from '../editor/session'
import { copySteps, pasteSteps, deleteSteps, moveSteps, setCell, movedRefKeys, applyStep, insertStep, STEP_MAX } from '../editor/commands'
import { sameStep, canonicalJson } from '../editor/diff'
import { checkStepFields } from '../editor/fieldRules'
import { firstError, CLICK_TYPES } from '../editor/panel'
import { refUrl, loadBitmap, newTempId } from '../editor/images'
import { cropPng, imageDataOf } from '../editor/crop'
import { locate } from '../editor/locate'
import { CAP_FLOWS, MIN_CAPTURE, LOCATE_MS, isRect, clipRect, nextStage, newStepDraft, baseRefFor, firstTrainRef } from '../editor/capture'
import { t } from '../messages'
import { useEditorStore } from './editorStore'

const UNDO_MAX = 50
const MOVED_MS = 1900 // 번호가 바뀐 갈 곳 칸 강조 시간(목업 S.moved)

const emptySelection = () => ({ uids: [], anchor: null })
const emptyPanel = () => ({ uid: null, isNew: false, draft: null, base: null })
const SOURCE_KEYS = ['process', 'model', 'name', 'crtime', 'fileId']
const sameSourceOf = (a, b) => !!a && !!b && SOURCE_KEYS.every((k) => a[k] === b[k])

export const useEditStore = defineStore('scenarioEditorEdit', () => {
  // 세션·작업본·되돌리기 스냅샷은 shallowRef + 불변 갱신 — Pinia 가 EditedScenario 를 깊게 감싸지 않게.
  const session = shallowRef(null)
  const selection = ref(emptySelection())
  const panel = shallowRef(emptyPanel())
  const undo = shallowRef([])
  const redo = shallowRef([])
  const clip = shallowRef(null)
  // 올릴 그림(tempId → Blob). Blob 을 반응형으로 감싸지 않게 shallowRef 이고, 바꿀 때마다 새 Map 으로 바꾼다(setUpload).
  const uploads = shallowRef(new Map())
  // 큰 화면 잡기(목업 S.cap): { flow, stage, why, before, train } — before = 잡기 전 패널 초안(Esc 로 되돌린다),
  // train = 누를 곳의 기준(찾을 그림 사각형: 이번에 잡은 것 또는 [다시 찍기]가 기준 화면에서 찾은 자리).
  const capture = shallowRef(null)
  const locating = ref(false) // [다시 찍기]가 기준 화면에서 찾을 그림을 찾는 중
  // 큰 화면 보기 요청({ kind: 'area' | 'all', n }) — 패널 그림을 누르면 영역에 맞춰·전체(목업 focusArea·viewAll), 잡기를 시작하면 전체
  const viewReq = shallowRef(null)
  const toast = ref(null)
  const dialog = ref(null)
  const moved = shallowRef(new Set())
  // 패널이 초점을 옮길 칸({ field, n } — n 은 같은 칸을 다시 요청해도 감시가 울리게)
  const focusReq = shallowRef(null)
  let movedTimer = null
  let bitmapCache = { url: null, promise: null } // 마지막으로 불러온 기준 화면 비트맵(잡기 중 여러 번 자를 때 다시 받지 않게)
  // 적용 안 한 변경 확인 창이 미뤄 둔 일 { next, onKeep }(확인 창 dialog 는 화면 값만 — 함수는 여기에)
  let pending = null

  // 고칠 수 있는 세션: 작업본이 있고 읽기 전용이 아니다(작업본이 없는 뼈대는 P1 처럼 보기만).
  const editable = computed(() => !!session.value?.working && session.value.readOnly === null)

  function reset() {
    selection.value = emptySelection()
    panel.value = emptyPanel()
    undo.value = []
    redo.value = []
    clip.value = null
    uploads.value = new Map()
    capture.value = null
    locating.value = false
    viewReq.value = null
    bitmapCache = { url: null, promise: null }
    toast.value = null
    dialog.value = null
    focusReq.value = null
    pending = null
    clearMoved()
  }

  function begin(skeleton, me) {
    reset()
    session.value = beginSession(skeleton, me)
  }

  function end() {
    reset()
    session.value = null
  }

  function clearMoved() {
    clearTimeout(movedTimer)
    movedTimer = null
    if (moved.value.size) moved.value = new Set()
  }

  // ── 선택: selection = 여러 줄, editorStore.selectedUid = 초점(보는 스텝) = 기준 줄(anchor) ──
  function setSelection(sel) {
    selection.value = sel
    if (sel.anchor !== null && sel.anchor !== undefined) useEditorStore().selectedUid = sel.anchor
  }
  // 초점이 다른 경로로 바뀌면 그 한 줄로 접는다(기준 줄과 같으면 그대로 — 여러 줄 선택 중 초점 이동이 아님). 패널도 초점을 따라간다.
  function syncFocus(uid) {
    if (!(selection.value.anchor === uid && (uid === null || selection.value.uids.includes(uid)))) {
      selection.value = uid === null || uid === undefined ? emptySelection() : { uids: [uid], anchor: uid }
    }
    syncPanel(uid)
  }

  // ── 오른쪽 편집 패널(목업 renderPanel·apply·guard) ──
  // panel.base = 패널을 연(또는 마지막으로 적용한) 작업본 스텝 객체, panel.draft = 고치는 중인 값(불변으로 바꾼다).
  const panelDirty = () => { const p = panel.value; return !!p.draft && !sameStep(p.draft, p.base) }
  const focusUid = () => useEditorStore().selectedUid
  const workingStep = (uid) => (uid == null ? null : session.value?.working?.steps.find((s) => s.uid === uid) ?? null)
  const saveBaseStep = (uid) => session.value?.saveBase?.steps.find((s) => s.uid === uid) ?? null

  // 그 스텝으로 패널을 연다(초안 = 기준 = 작업본 스텝 그대로).
  function openPanel(uid) {
    const step = workingStep(uid)
    capture.value = null
    panel.value = step ? { uid, isNew: false, draft: step, base: step } : emptyPanel()
  }
  // 초점·작업본이 바뀌면 패널을 맞춘다. 적용 안 한 변경은 지우지 않는다 — 다른 줄로 가는 길은 guard 가 먼저 묻고,
  // 묻지 않는 여러 줄 선택(Shift·Ctrl)은 초안을 그대로 두었다가 그 줄로 돌아오면 이어서 고친다.
  // 새 스텝 초안(아직 표에 없음)은 초점이 없는 동안 그대로 두고, 초점이 스텝으로 가면 버린다 — 값을 넣은 초안이면 그 길은 guard 가 먼저 묻는다.
  function syncPanel(uid = focusUid()) {
    if (!editable.value) { if (panel.value.uid !== null || panel.value.draft) panel.value = emptyPanel(); capture.value = null; return }
    const p = panel.value
    if (p.isNew) {
      if (uid == null || panelDirty()) return
    } else {
      if (panelDirty() && workingStep(p.uid)) return
      const step = workingStep(uid)
      if (p.uid === uid && p.base === step && step) return
    }
    openPanel(uid)
  }
  function updateDraft(fn) {
    const p = panel.value
    if (!p.draft) return
    panel.value = { ...p, draft: fn(p.draft) }
  }
  // 칸 검사(서버 code 이름). base = 저장 기준점의 같은 uid 스텝(옛 값 안내를 가른다), 새 스텝이면 null.
  function panelErrors() {
    const p = panel.value
    if (!p.draft || !session.value?.working) return {}
    return checkStepFields(p.draft, { working: session.value.working, isNew: p.isNew, base: p.isNew ? null : saveBaseStep(p.uid), user: useEditorStore().me })
  }
  function requestFocus(field) { focusReq.value = { field, n: (focusReq.value?.n ?? 0) + 1 } }
  // [적용]: 오류가 있으면 막고 첫 오류 칸으로 초점. 기준과 같으면 아무것도 쌓지 않는다. 저장 기준점과 같은 값이면 그 객체를 다시 쓴다.
  function applyPanel() {
    const p = panel.value
    if (!p.draft || p.isNew || !editable.value) return false
    const bad = firstError(panelErrors())
    if (bad) { requestFocus(bad); return false }
    capture.value = null
    if (sameStep(p.draft, p.base)) { if (p.draft !== p.base) panel.value = { ...p, draft: p.base }; return true }
    const sb = saveBaseStep(p.uid)
    const step = sb && sameStep(p.draft, sb) ? sb : p.draft
    panel.value = { uid: p.uid, isNew: false, draft: step, base: step }
    run(t('SEW_CMD_APPLIED', { no: noOf(p.uid) }), (w) => applyStep(w, step))
    return true
  }
  // [되돌리기]: 패널을 마지막 적용 값으로. 새 스텝이면 그 초안을 버린다(확인 창의 [버리고 …]).
  function discardPanel() {
    const p = panel.value
    if (p.isNew) { cancelNew(); return }
    capture.value = null
    if (p.draft && p.draft !== p.base) panel.value = { ...p, draft: p.base }
  }

  // 적용 안 한 변경이 있으면 확인 창을 세우고 next 를 미룬다(없으면 바로 한다). 확인 창 버튼은 미룬 일(action)에 따른다(R-T6c):
  // - 'move'(다른 줄·순서도·경고 순회·새 스텝)·'open'(다른 시나리오 열기)·'save'(저장 창): [계속 고치기]·[버리고 이동]·[적용하고 이동]
  // - 'command'(표 칸·삭제·붙여넣기·옮기기): [계속 고치기]·[버리고 계속]·[적용하고 계속] — 적용한 뒤 그 명령을 한다
  // - 'undo'·'redo': [계속 고치기]·[버리고 되돌리기]/[버리고 다시 하기] 만 — 적용하면 그 적용을 되돌리거나(되돌리기) 다시 할 것을 비우게(다시 하기) 된다
  // to = 가려는 스텝 uid(이동일 때). onKeep = [계속 고치기]로 접을 때 할 일(예: 주소를 열린 시나리오로 되돌리기).
  const NO_APPLY = new Set(['undo', 'redo'])
  // 만들던 새 스텝(isNew)은 [적용하고 …] 갈래가 없다 — 표에 넣을 자리는 [N번 앞에 넣기]·[맨 끝에 추가]로만 정한다.
  function guard(next, { action = 'move', to = null, onKeep = null } = {}) {
    if (!panelDirty()) { next(); return true }
    pending = { next, onKeep }
    dialog.value = panel.value.isNew ? { kind: 'guard', action, to, isNew: true } : { kind: 'guard', action, to }
    return false
  }
  function closeGuard() { const p = pending; pending = null; if (dialog.value?.kind === 'guard') dialog.value = null; return p ?? {} }
  function guardKeep() { closeGuard().onKeep?.() }
  function guardDrop() { const { next } = closeGuard(); discardPanel(); next?.() }
  function guardApply() {
    if (dialog.value?.kind === 'guard' && (NO_APPLY.has(dialog.value.action) || dialog.value.isNew)) return false
    const { next } = closeGuard()
    if (!applyPanel()) return false
    next?.()
    return true
  }

  // 다른 줄로 가기 — 패널에 적용 안 한 변경이 있으면 묻는다.
  function requestSelect(uid) {
    const go = () => setSelection({ uids: [uid], anchor: uid })
    if (uid === panel.value.uid) { go(); return true }
    return guard(go, { action: 'move', to: uid })
  }

  // 표 줄 누르기(목업 select): 그냥 = 한 줄, Shift = 기준 줄부터 범위, Ctrl/Cmd = 더하기·빼기. 번호 순으로 둔다.
  function clickRow(uid, { shift = false, toggle = false } = {}) {
    const steps = session.value?.working?.steps ?? []
    const order = (list) => steps.filter((s) => list.includes(s.uid)).map((s) => s.uid)
    const { uids, anchor } = selection.value
    if (shift && anchor && steps.some((s) => s.uid === anchor)) {
      const a = steps.findIndex((s) => s.uid === anchor)
      const b = steps.findIndex((s) => s.uid === uid)
      setSelection({ uids: steps.slice(Math.min(a, b), Math.max(a, b) + 1).map((s) => s.uid), anchor })
      return true
    }
    if (shift || toggle) {
      const next = order(uids.includes(uid) ? uids.filter((u) => u !== uid) : [...uids, uid])
      if (next.length === 1 && next[0] !== anchor) return requestSelect(next[0])
      setSelection({ uids: next, anchor: next.includes(anchor) ? anchor : (next[0] ?? anchor) })
      return true
    }
    return requestSelect(uid)
  }

  // ── 명령 ──
  const snapshot = () => ({ steps: session.value.working.steps, selection: selection.value })
  function restore(snap) {
    const w = session.value.working
    session.value = { ...session.value, working: { ...w, steps: snap.steps } }
    setSelection(snap.selection)
    syncPanel()
  }

  // 명령 실행 — fn(working) 이 { working, selection? } 를 주면 반영하고, 거절·막힘이면 그대로 돌려준다.
  // 번호가 바뀐 갈 곳은 잠깐 강조하고 알림에 그 수를 붙인다(목업 command).
  function run(label, fn) {
    const before = session.value.working
    const r = fn(before)
    if (!r?.working) return r
    undo.value = [...undo.value, snapshot()].slice(-UNDO_MAX)
    redo.value = []
    session.value = { ...session.value, working: r.working }
    if (r.selection) setSelection(r.selection)
    const keys = movedRefKeys(before, r.working)
    clearMoved()
    if (keys.size) {
      moved.value = keys
      movedTimer = setTimeout(clearMoved, MOVED_MS)
    }
    toast.value = { text: keys.size ? `${label} ${t('SEW_CMD_RENUMBERED', { n: keys.size })}` : label, undoable: true }
    syncPanel()
    return r
  }

  function undoLast() {
    if (!undo.value.length) return false
    const snap = undo.value[undo.value.length - 1]
    redo.value = [...redo.value, snapshot()]
    undo.value = undo.value.slice(0, -1)
    restore(snap)
    return true
  }

  function redoLast() {
    if (!redo.value.length) return false
    const snap = redo.value[redo.value.length - 1]
    undo.value = [...undo.value, snapshot()]
    redo.value = redo.value.slice(0, -1)
    restore(snap)
    return true
  }

  const notify = (text) => { toast.value = { text, undoable: false } }
  const refused = (code) => notify(t(`SEW_CMD_REFUSED_${code}`))
  const noOf = (uid) => stepNo(session.value.working, uid)

  // 작업본을 바꾸는 명령은 패널에 적용 안 한 변경이 있으면 먼저 묻는다(action 은 확인 창 버튼을 고른다).
  const guarded = (fn, action = 'command') => { if (!panelDirty()) return false; guard(fn, { action }); return true }

  function undoCommand() {
    if (guarded(undoCommand, 'undo')) return false
    if (!undoLast()) return false
    clearMoved()
    notify(t('SEW_CMD_UNDONE'))
    return true
  }
  function redoCommand() {
    if (guarded(redoCommand, 'redo')) return false
    if (!redoLast()) return false
    clearMoved()
    notify(t('SEW_CMD_REDONE'))
    return true
  }

  function copySelection(cut) {
    const uids = selection.value.uids
    if (!uids.length) return false
    const r = copySteps(session.value.working, uids, session.value.source, cut)
    if (r.refused) { refused(r.refused); return false }
    clip.value = r
    notify(t(cut ? 'SEW_CMD_CUT' : 'SEW_CMD_COPIED', { n: r.uids.length }))
    return true
  }

  // where: 'after' | 'before' | 'end'. 새 스텝이 되는 설비 상태 스텝이 든 묶음은 먼저 알린다(서버가 origin 없는 설비 상태 스텝을
  // CONDITION_NOT_CREATABLE 로 막는다) — confirmed 면 그대로 붙인다. 같은 작업본 안에서 잘라 옮기면 원래 스텝(origin 유지)이라 알리지 않는다.
  function pasteClip(where, { confirmed = false } = {}) {
    const c = clip.value
    if (!c) return false
    if (guarded(() => pasteClip(where, { confirmed }))) return false
    const sameSource = sameSourceOf(c.origin, session.value.source)
    const moving = c.cut && sameSource
    if (c.eqpStateCount > 0 && !moving && !confirmed) { dialog.value = { kind: 'pasteWarn', where, n: c.eqpStateCount }; return false }
    const working = session.value.working
    const anchor = selection.value.anchor
    const anchorUid = anchor && working.steps.some((s) => s.uid === anchor) ? anchor : null
    let s = session.value
    const makeUid = () => { const [uid, next] = nextUid(s, 'p'); s = next; return uid }
    const r = pasteSteps(working, c, { where, anchorUid }, { sameSource, makeUid })
    if (r.refused) { refused(r.refused); return false }
    const n = r.pasted.length
    const label = moving ? t('SEW_CMD_MOVED', { n }) : r.unresolved ? t('SEW_CMD_PASTED_UNRESOLVED', { n, open: r.unresolved }) : t('SEW_CMD_PASTED', { n })
    const firstOpen = moving ? null : r.working.steps.find((st) => r.pasted.includes(st.uid) && (st.next.onTrue.kind === 'unresolved' || st.next.onFalse.kind === 'unresolved'))
    const sel = firstOpen ? { uids: [firstOpen.uid], anchor: firstOpen.uid } : { uids: r.pasted, anchor: r.pasted[0] }
    run(label, () => ({ working: r.working, selection: sel }))
    session.value = { ...session.value, seq: s.seq }
    if (moving) clip.value = null
    return true
  }

  function deleteSelection() {
    const uids = selection.value.uids
    if (!uids.length) return false
    if (guarded(deleteSelection)) return false
    const working = session.value.working
    const r = deleteSteps(working, uids)
    if (r.blocked) { dialog.value = { kind: 'delblock', targets: [...uids], refs: r.blocked }; return false }
    const nos = uids.map(noOf).sort((a, b) => a - b)
    const rest = r.working.steps
    const nx = rest[Math.min(nos[0] - 1, rest.length - 1)]
    run(t('SEW_CMD_DELETED', { nos: nos.join('·') }), () => ({ working: r.working, selection: nx ? { uids: [nx.uid], anchor: nx.uid } : emptySelection() }))
    if (!nx) useEditorStore().selectedUid = null
    return true
  }

  function moveSelected(dir) {
    const uids = selection.value.uids
    if (!uids.length) return false
    if (guarded(() => moveSelected(dir))) return false
    const nos = uids.map(noOf).sort((a, b) => a - b)
    const r = moveSteps(session.value.working, uids, dir)
    if (r.refused) { refused(r.refused); return false }
    const what = nos.length > 1 ? t('SEW_CMD_WHAT_STEPS', { n: nos.length }) : t('SEW_CMD_WHAT_STEP', { no: nos[0] })
    run(t(dir < 0 ? 'SEW_CMD_MOVED_UP' : 'SEW_CMD_MOVED_DOWN', { what }), () => r)
    return true
  }

  const targetText = (tg) => (tg.kind === 'next' ? 'NEXT' : tg.kind === 'end' ? tg.value : tg.kind === 'step' ? t('SEW_CMD_TARGET_STEP', { no: noOf(tg.uid) }) : '—')
  // 표 칸 바로 고치기(설계 §4.2): 정확도·전처리 스킵·성공/실패 갈 곳. 값이 같으면 아무것도 쌓지 않는다.
  function editCell(uid, field, value) {
    const step = session.value.working.steps.find((s) => s.uid === uid)
    if (!step) return false
    const cur = field === 'accept' ? step.condition?.image?.accept : field === 'skip' ? step.condition?.skipPreprocessing : step.next[field]
    if (canonicalJson(cur) === canonicalJson(value)) return false
    if (guarded(() => editCell(uid, field, value))) return false
    const no = noOf(uid)
    const label = field === 'accept' ? t('SEW_CMD_CELL_ACCEPT', { no, v: value.toFixed(2) })
      : field === 'skip' ? t(value ? 'SEW_CMD_CELL_SKIP_ON' : 'SEW_CMD_CELL_SKIP_OFF', { no })
        : t('SEW_CMD_CELL_TARGET', { no, which: t(field === 'onTrue' ? 'SEW_CMD_WHICH_ON_TRUE' : 'SEW_CMD_WHICH_ON_FALSE'), to: targetText(value) })
    run(label, (w) => setCell(w, uid, field, value))
    return true
  }

  // ── 큰 화면 잡기(목업 CAP_FLOW·capStart·capNext·capDone·capCancel, 조작판 3~6) ──
  // 잡은 값은 패널 초안에만 들어간다. 작업본은 [적용](고른 스텝) 또는 [N번 앞에 넣기]·[맨 끝에 추가](새 스텝)로만 바뀐다.
  const imgCtx = () => ({ session: session.value, uploads: uploads.value, draftId: null })
  function setUpload(tempId, blob) {
    const m = new Map(uploads.value)
    m.set(tempId, blob)
    uploads.value = m
  }
  // 기준 화면 비트맵 — 같은 URL 이면 다시 받지 않는다. 실패하면 잊어 다음에 다시 받는다.
  function baseBitmap(url) {
    if (bitmapCache.url !== url) {
      const promise = loadBitmap(url)
      bitmapCache = { url, promise }
      promise.catch(() => { if (bitmapCache.promise === promise) bitmapCache = { url: null, promise: null } })
    }
    return bitmapCache.promise
  }
  function requestView(kind) { viewReq.value = { kind, n: (viewReq.value?.n ?? 0) + 1 } }

  // 잡기 시작: flow 의 첫 단계부터. why = 그림부터 다시 잡는 이유([다시 찍기]), train = 누를 곳의 기준 사각형(누를 곳만 찍을 때).
  function startCapture(flow, { why = null, train = null } = {}) {
    const p = panel.value
    if (!editable.value || !p.draft || !flow?.length) return false
    capture.value = { flow: [...flow], stage: flow[0], why, before: p.draft, train }
    requestView('all')
    return true
  }
  function advance(c, extra = {}) {
    const next = nextStage(c.flow, c.stage, panel.value.draft?.action?.type)
    capture.value = next ? { ...c, ...extra, stage: next } : null
  }
  const sameRect = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
  // 지금 단계의 값을 받는다. 영역·그림 = 기준 화면 픽셀 사각형 { x, y, w, h }, 누를 곳 = 점 { x, y }. 받았으면 true.
  async function captureNext(value) {
    const c = capture.value
    const d = panel.value.draft
    if (!c || !d) return false
    if (c.stage === 'click') {
      const tr = c.train
      if (!CLICK_TYPES.includes(d.action?.type)) { capture.value = null; return false } // 잡는 사이 동작을 클릭이 아닌 것으로 바꿨다
      if (!tr || !Number.isFinite(value?.x) || !Number.isFinite(value?.y)) return false
      // 누를 곳은 찾을 그림 왼쪽 위에서 잰 거리(서버 parseAction basis 'trainImage') — 그림 밖도 된다
      const click = { x: Math.round(value.x - tr.x), y: Math.round(value.y - tr.y), basis: 'trainImage' }
      updateDraft((s) => ({ ...s, action: { ...s.action, click } }))
      advance(c)
      return true
    }
    if (!isRect(value)) return false
    const area = d.condition?.searchArea
    const r = c.stage === 'train' && isRect(area) ? clipRect(value, area) : { x: Math.round(value.x), y: Math.round(value.y), w: Math.round(value.w), h: Math.round(value.h) }
    if (r.w < MIN_CAPTURE || r.h < MIN_CAPTURE) { notify(t('SEW_CAP_TOO_SMALL')); return false }
    if (c.stage === 'area' || c.stage === 'ocr') {
      if (!sameRect(area, r)) updateDraft((s) => ({ ...s, condition: { ...s.condition, searchArea: r } }))
      advance(c)
      return true
    }
    if (c.stage !== 'train') return false
    // 찾을 그림: 기준 화면에서 잘라 PNG 로(키 0 하나 — 사내 편집기처럼). 다른 출처 그림은 fetch 로 받아 canvas 를 오염시키지 않는다.
    const url = refUrl(d.images?.base, imgCtx())
    if (!url) { notify(t('SEW_CAP_NO_BASE')); return false }
    let blob
    try {
      blob = await cropPng(await baseBitmap(url), r)
    } catch {
      if (capture.value === c) notify(t('SEW_CAP_CROP_FAILED'))
      return false
    }
    if (capture.value !== c) return false // 자르는 사이 취소했거나 다른 스텝으로 갔다
    const tempId = newTempId()
    setUpload(tempId, blob)
    updateDraft((s) => {
      const cond = s.condition
      const image = cond?.kind === 'image' && cond.image ? cond.image : null
      const type = (image?.trainImages ?? []).find((ti) => ti.key === 0)?.type
      return {
        ...s,
        images: { ...s.images, train: { 0: { from: 'upload', tempId } } },
        condition: image ? { ...cond, image: { ...image, trainImages: [{ key: 0, type: typeof type === 'boolean' ? type : true }] } } : cond
      }
    })
    advance(c, { train: r })
    return true
  }
  // Esc·[취소]: 잡기 전 초안으로
  function cancelCapture() {
    const c = capture.value
    if (!c) return false
    capture.value = null
    const p = panel.value
    if (p.draft && p.draft !== c.before) panel.value = { ...p, draft: c.before }
    return true
  }
  // [그림은 그대로 두기]: 지금까지 잡은 값만 두고 끝낸다(목업 cap:keep)
  function finishCapture() { capture.value = null }

  // [다시 찍기](목업 repick·locateTrain, 조작판 4~6): 기준 화면의 검색 영역에서 찾을 그림을 찾아 한 곳이면 누를 곳만 찍는다.
  // 없음·여러 곳·시간 초과·불러오기 실패면 이유를 보이고 그림부터 잡는다.
  async function repick() {
    const p = panel.value
    const d = p.draft
    if (!editable.value || !d || d.condition?.kind !== 'image' || locating.value) return false
    const area = d.condition.searchArea
    if (!isRect(area)) return false
    const trainRef = firstTrainRef(d.images?.train)
    if (!trainRef) return startCapture(['train', 'click'])
    const ctx = imgCtx()
    const baseUrl = refUrl(d.images?.base, ctx)
    const trainUrl = refUrl(trainRef, ctx)
    locating.value = true
    let r
    try {
      if (!baseUrl || !trainUrl) throw new Error('no image')
      const [base, train] = await Promise.all([baseBitmap(baseUrl), loadBitmap(trainUrl)])
      r = locate(imageDataOf(base), imageDataOf(train), area, { timeLimitMs: LOCATE_MS })
      if (r.found === 'one') r = { ...r, w: train.width, h: train.height }
    } catch {
      r = { found: 'error' }
    } finally {
      locating.value = false
    }
    if (panel.value.uid !== p.uid || !panel.value.draft) return false // 찾는 사이 다른 스텝으로 갔다
    if (r.found === 'one') return startCapture(['click'], { train: { x: r.x, y: r.y, w: r.w, h: r.h } })
    const why = { many: 'SEW_CAP_WHY_MANY', timeout: 'SEW_CAP_WHY_TIMEOUT', error: 'SEW_CAP_WHY_ERROR' }[r.found] ?? 'SEW_CAP_WHY_NONE'
    return startCapture(['train', 'click'], { why: t(why) })
  }

  // ── 새 스텝(목업 startNew·addNew·newcancel, 조작판 7) ──
  // 넣을 자리의 기준 줄: 고른 스텝, 새 스텝을 만드는 중이면 그 초안이 기억한 줄.
  function insertAnchor() {
    const a = selection.value.anchor
    if (a && workingStep(a)) return a
    const p = panel.value
    return p.isNew && p.insertBefore && workingStep(p.insertBefore) ? p.insertBefore : null
  }
  // 종류를 고르면 패널이 새 스텝 초안을 연다. 이미지·OCR 은 고른 스텝(없으면 기준 화면이 있는 첫 스텝)의 기준 화면에서 잡기를 시작한다.
  // 패널에 적용 안 한 변경이 있으면 먼저 묻는다(다른 스텝으로 가는 것과 같은 이동).
  function startNew(kind) {
    if (!editable.value || (!CAP_FLOWS[kind] && kind !== 'none')) return false
    if (!panelDirty()) return openNew(kind)
    return guard(() => openNew(kind), { action: 'move' })
  }
  function openNew(kind) {
    const s = session.value
    if (!s?.working) return false
    if (s.working.steps.length >= STEP_MAX) { refused('STEP_LIMIT'); return false }
    const anchor = insertAnchor()
    const base = kind === 'none' ? null : baseRefFor(s.working, anchor)
    if (kind !== 'none' && !base) { notify(t('SEW_EDIT_NEW_NO_BASE')); return false }
    const [uid, next] = nextUid(s, 'n')
    session.value = next
    const draft = newStepDraft(kind, { uid, base })
    capture.value = null
    panel.value = { uid, isNew: true, draft, base: draft, insertBefore: anchor, tried: false }
    // 표에서 고른 줄을 비운다(새 스텝은 아직 표에 없다). 패널을 먼저 바꿔 두어 초점 감시가 초안을 지우지 않는다.
    selection.value = emptySelection()
    useEditorStore().selectedUid = null
    if (CAP_FLOWS[kind]) startCapture(CAP_FLOWS[kind])
    return true
  }
  // [N번 앞에 넣기](where 'before')·[맨 끝에 추가]('end'): 칸 검사를 통과해야 넣는다. 200개면 막고 알린다.
  function addNew(where) {
    const p = panel.value
    if (!editable.value || !p.isNew || !p.draft) return false
    const bad = firstError(panelErrors())
    if (bad) { panel.value = { ...p, tried: true }; requestFocus(bad); return false }
    const working = session.value.working
    const before = where === 'before' && p.insertBefore && workingStep(p.insertBefore) ? p.insertBefore : null
    const r = insertStep(working, p.draft, { beforeUid: before })
    if (r.refused) { refused(r.refused); return false }
    const label = before ? t('SEW_CMD_INSERTED', { no: noOf(before) }) : t('SEW_CMD_ADDED_END')
    capture.value = null
    panel.value = emptyPanel()
    // 되돌리면 넣기 전의 고른 줄로 돌아가게 스냅샷 전에 선택을 그 줄로 둔다
    if (p.insertBefore && workingStep(p.insertBefore)) selection.value = { uids: [p.insertBefore], anchor: p.insertBefore }
    run(label, () => ({ working: r.working, selection: { uids: [p.uid], anchor: p.uid } }))
    return true
  }
  // [취소]: 새 스텝 초안을 버리고 고른 스텝으로 돌아간다
  function cancelNew() {
    const p = panel.value
    if (!p.isNew) return false
    capture.value = null
    panel.value = emptyPanel()
    const a = p.insertBefore && workingStep(p.insertBefore) ? p.insertBefore : null
    if (a) setSelection({ uids: [a], anchor: a })
    syncPanel(a ?? focusUid())
    return true
  }

  return {
    session, selection, panel, undo, redo, clip, uploads, capture, locating, viewReq, toast, dialog, moved, focusReq, editable,
    begin, end, run, undoLast, redoLast,
    setSelection, syncFocus, requestSelect, clickRow, panelDirty, notify,
    openPanel, syncPanel, updateDraft, panelErrors, applyPanel, discardPanel, requestFocus,
    guard, guardKeep, guardDrop, guardApply,
    undoCommand, redoCommand, copySelection, pasteClip, deleteSelection, moveSelected, editCell,
    setUpload, requestView, startCapture, captureNext, cancelCapture, finishCapture, repick, startNew, addNew, cancelNew
  }
})
