import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { beginSession, nextUid, stepNo } from '../editor/session'
import { copySteps, pasteSteps, deleteSteps, moveSteps, setCell, movedRefKeys, applyStep } from '../editor/commands'
import { sameStep, canonicalJson } from '../editor/diff'
import { checkStepFields } from '../editor/fieldRules'
import { firstError } from '../editor/panel'
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
  const uploads = ref(new Map())
  const capture = shallowRef(null)
  const toast = ref(null)
  const dialog = ref(null)
  const moved = shallowRef(new Set())
  // 패널이 초점을 옮길 칸({ field, n } — n 은 같은 칸을 다시 요청해도 감시가 울리게)
  const focusReq = shallowRef(null)
  let movedTimer = null
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
    panel.value = step ? { uid, isNew: false, draft: step, base: step } : emptyPanel()
  }
  // 초점·작업본이 바뀌면 패널을 맞춘다. 적용 안 한 변경은 지우지 않는다 — 다른 줄로 가는 길은 guard 가 먼저 묻고,
  // 묻지 않는 여러 줄 선택(Shift·Ctrl)은 초안을 그대로 두었다가 그 줄로 돌아오면 이어서 고친다.
  function syncPanel(uid = focusUid()) {
    if (!editable.value) { if (panel.value.uid !== null || panel.value.draft) panel.value = emptyPanel(); return }
    const p = panel.value
    if (p.isNew) return // 새 스텝 초안(Task 7)
    if (panelDirty() && workingStep(p.uid)) return
    const step = workingStep(uid)
    if (p.uid === uid && p.base === step && step) return
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
    if (sameStep(p.draft, p.base)) { if (p.draft !== p.base) panel.value = { ...p, draft: p.base }; return true }
    const sb = saveBaseStep(p.uid)
    const step = sb && sameStep(p.draft, sb) ? sb : p.draft
    panel.value = { uid: p.uid, isNew: false, draft: step, base: step }
    run(t('SEW_CMD_APPLIED', { no: noOf(p.uid) }), (w) => applyStep(w, step))
    return true
  }
  // [되돌리기]: 패널을 마지막 적용 값으로
  function discardPanel() {
    const p = panel.value
    if (p.draft && p.draft !== p.base) panel.value = { ...p, draft: p.base }
  }

  // 적용 안 한 변경이 있으면 확인 창을 세우고 next 를 미룬다(없으면 바로 한다). 확인 창 버튼은 미룬 일(action)에 따른다(R-T6c):
  // - 'move'(다른 줄·순서도·경고 순회·새 스텝)·'open'(다른 시나리오 열기)·'save'(저장 창): [계속 고치기]·[버리고 이동]·[적용하고 이동]
  // - 'command'(표 칸·삭제·붙여넣기·옮기기): [계속 고치기]·[버리고 계속]·[적용하고 계속] — 적용한 뒤 그 명령을 한다
  // - 'undo'·'redo': [계속 고치기]·[버리고 되돌리기]/[버리고 다시 하기] 만 — 적용하면 그 적용을 되돌리거나(되돌리기) 다시 할 것을 비우게(다시 하기) 된다
  // to = 가려는 스텝 uid(이동일 때). onKeep = [계속 고치기]로 접을 때 할 일(예: 주소를 열린 시나리오로 되돌리기).
  const NO_APPLY = new Set(['undo', 'redo'])
  function guard(next, { action = 'move', to = null, onKeep = null } = {}) {
    if (!panelDirty()) { next(); return true }
    pending = { next, onKeep }
    dialog.value = { kind: 'guard', action, to }
    return false
  }
  function closeGuard() { const p = pending; pending = null; if (dialog.value?.kind === 'guard') dialog.value = null; return p ?? {} }
  function guardKeep() { closeGuard().onKeep?.() }
  function guardDrop() { const { next } = closeGuard(); discardPanel(); next?.() }
  function guardApply() {
    if (dialog.value?.kind === 'guard' && NO_APPLY.has(dialog.value.action)) return false
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

  return {
    session, selection, panel, undo, redo, clip, uploads, capture, toast, dialog, moved, focusReq, editable,
    begin, end, run, undoLast, redoLast,
    setSelection, syncFocus, requestSelect, clickRow, panelDirty, notify,
    openPanel, syncPanel, updateDraft, panelErrors, applyPanel, discardPanel, requestFocus,
    guard, guardKeep, guardDrop, guardApply,
    undoCommand, redoCommand, copySelection, pasteClip, deleteSelection, moveSelected, editCell
  }
})
