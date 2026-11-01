import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { scenarioEditorApi as api } from '../api'
import { errorCode, errorMessage } from '../messages'

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

  const steps = computed(() => skeleton.value?.steps ?? [])
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

  async function openScenario({ process, model, name, crtime = 'current' }) {
    opening.value = { process, model, name, crtime, startedAt: Date.now() }
    openError.value = null
    try {
      skeleton.value = (await api.open(process, model, name, crtime)).data.data
      selectedUid.value = skeleton.value.steps[0]?.uid ?? null
    } catch (e) {
      openError.value = { ...fail(e), target: { process, model, name, crtime } }
    } finally {
      opening.value = null
    }
  }

  const select = (uid) => { selectedUid.value = uid }
  const selectByNo = (no) => { const s = steps.value[no - 1]; if (s) selectedUid.value = s.uid }
  function moveSelection(delta) {
    if (!steps.value.length) return
    const i = Math.max(0, steps.value.findIndex((s) => s.uid === selectedUid.value))
    selectedUid.value = steps.value[Math.min(steps.value.length - 1, Math.max(0, i + delta))].uid
  }
  function nextNoted() {
    const list = steps.value.filter((s) => s.notes.length)
    if (!list.length) return
    const i = list.findIndex((s) => s.uid === selectedUid.value)
    selectedUid.value = list[(i + 1) % list.length].uid
  }

  return {
    me, meError, scopes, dataCheck, skeleton, opening, openError, selectedUid, view, expanded,
    steps, selectedStep, warningCount, infoCount, dataCheckCount,
    init, refreshCaches, openScenario, select, selectByNo, moveSelection, nextNoted
  }
})
