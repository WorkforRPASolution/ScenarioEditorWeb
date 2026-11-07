import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { beginSession } from '../editor/session'

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

  return { session, selection, panel, undo, redo, clip, uploads, capture, toast, dialog, begin, end }
})
