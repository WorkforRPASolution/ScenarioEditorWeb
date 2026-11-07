import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { beginSession } from '../editor/session'

const UNDO_MAX = 50

const emptySelection = () => ({ uids: [], anchor: null })
const emptyPanel = () => ({ uid: null, isNew: false, draft: null, base: null })

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
  }

  function begin(skeleton, me) {
    reset()
    session.value = beginSession(skeleton, me)
  }

  function end() {
    reset()
    session.value = null
  }

  const snapshot = () => ({ steps: session.value.working.steps, selection: selection.value })
  function restore(snap) {
    const w = session.value.working
    session.value = { ...session.value, working: { ...w, steps: snap.steps } }
    selection.value = snap.selection
  }

  // 명령 실행 — fn(working) 이 { working, selection? } 를 주면 반영하고, 거절·막힘이면 그대로 돌려준다.
  function run(label, fn) {
    const r = fn(session.value.working)
    if (!r?.working) return r
    undo.value = [...undo.value, snapshot()].slice(-UNDO_MAX)
    redo.value = []
    session.value = { ...session.value, working: r.working }
    if (r.selection) selection.value = r.selection
    toast.value = { text: label, undoable: true }
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

  return { session, selection, panel, undo, redo, clip, uploads, capture, toast, dialog, begin, end, run, undoLast, redoLast }
})
