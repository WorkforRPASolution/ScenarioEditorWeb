import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { beginSession, nextUid, stepNo } from '../editor/session'
import { copySteps, pasteSteps, deleteSteps, moveSteps, setCell, movedRefKeys } from '../editor/commands'
import { sameStep, canonicalJson } from '../editor/diff'
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
  let movedTimer = null

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
  // 초점이 다른 경로로 바뀌면 그 한 줄로 접는다(기준 줄과 같으면 그대로 — 여러 줄 선택 중 초점 이동이 아님).
  function syncFocus(uid) {
    if (selection.value.anchor === uid && (uid === null || selection.value.uids.includes(uid))) return
    selection.value = uid === null || uid === undefined ? emptySelection() : { uids: [uid], anchor: uid }
  }

  // 패널에 적용하지 않은 변경(Task 6 이 패널을 단다). 지금은 초안이 마지막 적용 값과 다르면.
  const panelDirty = () => { const p = panel.value; return !!p.draft && !sameStep(p.draft, p.base) }

  // 다른 줄로 가기 — 패널에 적용 안 한 변경이 있으면 세 갈래 확인 창을 세우고 멈춘다(확인 창은 Task 6).
  function requestSelect(uid) {
    if (panelDirty() && uid !== panel.value.uid) { dialog.value = { kind: 'guard', to: uid }; return false }
    setSelection({ uids: [uid], anchor: uid })
    return true
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

  function undoCommand() {
    if (!undoLast()) return false
    clearMoved()
    notify(t('SEW_CMD_UNDONE'))
    return true
  }
  function redoCommand() {
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

  // where: 'after' | 'before' | 'end'. 설비 상태 스텝이 든 묶음은 먼저 알린다(서버가 CONDITION_NOT_CREATABLE 로 막는다) — confirmed 면 그대로 붙인다.
  function pasteClip(where, { confirmed = false } = {}) {
    const c = clip.value
    if (!c) return false
    if (c.eqpStateCount > 0 && !confirmed) { dialog.value = { kind: 'pasteWarn', where, n: c.eqpStateCount }; return false }
    const working = session.value.working
    const anchor = selection.value.anchor
    const anchorUid = anchor && working.steps.some((s) => s.uid === anchor) ? anchor : null
    const sameSource = sameSourceOf(c.origin, session.value.source)
    let s = session.value
    const makeUid = () => { const [uid, next] = nextUid(s, 'p'); s = next; return uid }
    const r = pasteSteps(working, c, { where, anchorUid }, { sameSource, makeUid })
    if (r.refused) { refused(r.refused); return false }
    const n = r.pasted.length
    const moving = c.cut && sameSource
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
    const nos = uids.map(noOf).sort((a, b) => a - b)
    const r = moveSteps(session.value.working, uids, dir)
    if (r.refused) { refused(r.refused); return false }
    const what = nos.length > 1 ? `스텝 ${nos.length}개를` : `${nos[0]}번 스텝을`
    run(t(dir < 0 ? 'SEW_CMD_MOVED_UP' : 'SEW_CMD_MOVED_DOWN', { what }), () => r)
    return true
  }

  const targetText = (tg) => (tg.kind === 'next' ? 'NEXT' : tg.kind === 'end' ? tg.value : tg.kind === 'step' ? `${noOf(tg.uid)}번` : '—')
  // 표 칸 바로 고치기(설계 §4.2): 정확도·전처리 스킵·성공/실패 갈 곳. 값이 같으면 아무것도 쌓지 않는다.
  function editCell(uid, field, value) {
    const step = session.value.working.steps.find((s) => s.uid === uid)
    if (!step) return false
    const cur = field === 'accept' ? step.condition?.image?.accept : field === 'skip' ? step.condition?.skipPreprocessing : step.next[field]
    if (canonicalJson(cur) === canonicalJson(value)) return false
    const no = noOf(uid)
    const label = field === 'accept' ? t('SEW_CMD_CELL_ACCEPT', { no, v: value.toFixed(2) })
      : field === 'skip' ? t(value ? 'SEW_CMD_CELL_SKIP_ON' : 'SEW_CMD_CELL_SKIP_OFF', { no })
        : t('SEW_CMD_CELL_TARGET', { no, which: field === 'onTrue' ? '성공' : '실패', to: targetText(value) })
    run(label, (w) => setCell(w, uid, field, value))
    return true
  }

  return {
    session, selection, panel, undo, redo, clip, uploads, capture, toast, dialog, moved, editable,
    begin, end, run, undoLast, redoLast,
    setSelection, syncFocus, requestSelect, clickRow, panelDirty, notify,
    undoCommand, redoCommand, copySelection, pasteClip, deleteSelection, moveSelected, editCell
  }
})
