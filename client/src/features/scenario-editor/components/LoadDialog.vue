<script setup>
import { ref, computed, watch } from 'vue'
import { AgGridVue } from 'ag-grid-vue3'
import { useEditorStore } from '../stores/editorStore'
import { scenarioEditorApi as api } from '../api'
import { t, LABELS, errorMessage } from '../messages'
import { formatCrtime, enabledLabel } from '../format'
import { safeStorage } from '../composables/useSafeStorage'
import { registerGrid, useGridTheme } from '../gridTheme'
import { useToast } from '@/shared/composables/useToast'
import BaseToast from '@/shared/components/BaseToast.vue'
import ModalShell from './ModalShell.vue'

defineOptions({ name: 'LoadDialog' })
registerGrid()
const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'open'])
const store = useEditorStore()
const theme = useGridTheme()
const { toast, showToast } = useToast()
const LAST = 'se-last-scope'

const process = ref('')
const model = ref('')
const rows = ref([])
const listError = ref('')
const search = ref('')
const enabledOnly = ref(false)
const selected = ref(null)
const selectedCrtime = ref(null)
const versions = ref([])
const versionsError = ref('')
// 지금 rows 를 받아 온 { process, model } — 열기 요청은 화면의 선택값이 아니라 이 쌍으로 보낸다
const loadedFor = ref(null)

const processes = computed(() => store.scopes?.processes ?? [])
const models = computed(() => processes.value.find((p) => p.process === process.value)?.models ?? [])
// 권한·설비를 못 읽었거나(null) 비었을 때(빈 배열) 빈 선택 상자만 보이지 않게 한 줄로 알린다
const scopesNotice = computed(() => {
  if (!store.scopes) return { text: t('SEW_UI_LOAD_SCOPES_FAILED'), error: true }
  if (processes.value.length === 0) return { text: t('SEW_UI_LOAD_NO_SCOPES'), error: false }
  return null
})
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter((r) => (!enabledOnly.value || r.isEnabled !== false) && r.name.toLowerCase().includes(q))
})

function pickInitial() {
  let last = null
  try { last = JSON.parse(safeStorage.get(LAST) || 'null') } catch { last = null }
  const allowed = (p, m) => processes.value.some((x) => x.process === p && x.models.some((y) => y.model === m))
  if (last && allowed(last.process, last.model)) { process.value = last.process; model.value = last.model; return }
  process.value = processes.value[0]?.process ?? ''
  model.value = processes.value[0]?.models[0]?.model ?? ''
}

// 요청마다 번호를 매겨 마지막 요청의 응답만 화면에 쓴다(앞 요청의 늦은 성공·실패는 버린다)
let listSeq = 0
let versionSeq = 0
async function loadList() {
  const id = ++listSeq
  versionSeq++
  rows.value = []; selected.value = null; selectedCrtime.value = null; versions.value = []; versionsError.value = ''; listError.value = ''; loadedFor.value = null
  if (!process.value || !model.value) return
  const pair = { process: process.value, model: model.value }
  safeStorage.set(LAST, JSON.stringify(pair))
  try {
    const next = (await api.list(pair.process, pair.model)).data.data
    if (id !== listSeq) return
    rows.value = next; loadedFor.value = pair
  } catch (e) {
    if (id === listSeq) listError.value = errorMessage(e)
  }
}

watch(() => props.modelValue, (open) => { if (open && !process.value) pickInitial() }, { immediate: true })
watch(processes, () => { if (props.modelValue && !process.value) pickInitial() })
watch(process, () => { if (!models.value.some((m) => m.model === model.value)) model.value = models.value[0]?.model ?? '' })
watch([process, model], loadList, { immediate: true })

async function onRowClicked(e) {
  const pair = loadedFor.value
  if (!pair) return
  const id = ++versionSeq
  if (selected.value?.name !== e.data.name) selectedCrtime.value = null
  selected.value = e.data
  versions.value = []; versionsError.value = ''
  try {
    const next = (await api.versions(pair.process, pair.model, e.data.name)).data.data
    if (id === versionSeq) versions.value = next
  } catch (err) {
    if (id === versionSeq) versionsError.value = errorMessage(err)
  }
}
function openRow(name, crtime = 'current') {
  const pair = loadedFor.value
  if (!pair) return
  emit('open', { process: pair.process, model: pair.model, name, crtime: String(crtime) })
}
const onRowDoubleClicked = (e) => openRow(e.data.name)
const openVersion = (v) => { if (selected.value) openRow(selected.value.name, v.isCurrent ? 'current' : v.crtime) }
function openSelected() {
  if (!selected.value) return
  const v = versions.value.find((x) => x.crtime === selectedCrtime.value)
  openRow(selected.value.name, v && !v.isCurrent ? v.crtime : 'current')
}

// useToast 는 ref 만 준다 — 화면에 그리는 건 아래 <BaseToast>
async function refresh() {
  try {
    await store.refreshCaches()
    const before = `${process.value}/${model.value}`
    if (!processes.value.some((p) => p.process === process.value && p.models.some((m) => m.model === model.value))) pickInitial()
    if (`${process.value}/${model.value}` === before) await loadList()
    // refreshCaches 는 내 정보·권한 읽기가 실패해도 던지지 않는다 — 결과 상태로 성공을 가린다
    if (store.meError) showToast('error', store.meError.message)
    else if (!store.scopes) showToast('error', t('SEW_UI_REFRESH_FAILED'))
    else showToast('success', t('SEW_UI_REFRESHED'))
  } catch (e) {
    showToast('error', errorMessage(e))
  }
}

const columnDefs = [
  { field: 'name', headerName: '이름', minWidth: 220, flex: 1 },
  { field: 'isEnabled', headerName: '켜짐', width: 70, valueFormatter: (p) => enabledLabel(p.value) },
  { field: 'typeName', headerName: '유형', width: 120, valueFormatter: (p) => LABELS.scenarioType[p.value] ?? p.value ?? '' },
  { field: 'triggerName', headerName: '트리거', width: 90 },
  { field: 'gradeName', headerName: '등급', width: 70 },
  { field: 'description', headerName: '설명', minWidth: 180, flex: 1 },
  { headerName: '최근 수정자', width: 120, valueGetter: (p) => p.data.lastOwner?.singleid ?? '' },
  { field: 'currentCrtime', headerName: '현재 버전', width: 160, valueFormatter: (p) => (p.value ? formatCrtime(p.value) : '') },
  // 열 합계(약 1170px)가 창의 표 영역(약 760px)보다 넓다 — 열 수 없는 원인(완료 조건 3)이 가로 스크롤 뒤로 숨지 않게 오른쪽에 고정한다
  { field: 'status', headerName: '상태', width: 140, pinned: 'right', valueFormatter: (p) => p.value.map((s) => LABELS.listStatus[s] ?? s).join(', ') }
]
const select = 'h-[38px] rounded-lg border border-gray-300 dark:border-dark-border bg-white dark:bg-dark-bg px-2 text-sm text-gray-900 dark:text-gray-100'
</script>

<template>
  <ModalShell :model-value="modelValue" title="시나리오 불러오기" :width="1040" :height="600" testid="se-load-dialog" @update:model-value="emit('update:modelValue', $event)">
    <div class="h-full flex flex-col">
      <div class="px-5 py-3 flex flex-wrap gap-2 items-center border-b border-gray-200 dark:border-dark-border">
        <select v-model="process" :class="select" data-testid="se-load-process"><option v-for="p in processes" :key="p.process" :value="p.process">{{ p.process }}</option></select>
        <select v-model="model" :class="select" data-testid="se-load-model"><option v-for="m in models" :key="m.model" :value="m.model">{{ m.model }}</option></select>
        <input v-model="search" :class="select" class="w-56" :placeholder="t('SEW_UI_SEARCH_NAME')" data-testid="se-load-search" />
        <label class="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1"><input v-model="enabledOnly" type="checkbox" data-testid="se-load-enabled" /> {{ t('SEW_UI_ENABLED_ONLY') }}</label>
        <span class="text-xs text-gray-500 ml-1">{{ t('SEW_UI_LOAD_SCOPE_HINT') }}</span>
        <button class="ml-auto h-[38px] px-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm" data-testid="se-load-refresh" @click="refresh">{{ t('SEW_UI_REFRESH_SCOPES') }}</button>
      </div>
      <p v-if="scopesNotice" class="px-5 py-2 text-sm border-b border-gray-200 dark:border-dark-border" :class="scopesNotice.error ? 'text-red-600' : 'text-gray-600 dark:text-gray-300'" data-testid="se-load-scopes-notice">{{ scopesNotice.text }}</p>
      <div class="flex-1 min-h-0 grid" style="grid-template-columns: minmax(0, 1fr) 280px">
        <div class="min-h-0 flex flex-col border-r border-gray-200 dark:border-dark-border">
          <p v-if="listError" class="p-3 text-sm text-red-600" data-testid="se-load-list-error">{{ listError }}</p>
          <AgGridVue class="flex-1 min-h-0" :theme="theme" :row-data="filtered" :column-defs="columnDefs" :get-row-id="(p) => p.data.name"
            :row-selection="{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }" @row-clicked="onRowClicked" @row-double-clicked="onRowDoubleClicked"
            style="width: 100%; height: 100%" data-testid="se-load-grid" />
        </div>
        <div class="p-3 flex flex-col min-h-0">
          <div class="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">버전 <span v-if="selected" class="font-normal text-gray-500">— {{ selected.name }}</span></div>
          <p v-if="versionsError" class="text-xs text-red-600" data-testid="se-load-versions-error">{{ versionsError }}</p>
          <ul class="flex-1 overflow-auto space-y-1 text-sm" role="listbox">
            <li v-for="v in versions" :key="v.crtime" role="option" :aria-selected="selectedCrtime === v.crtime" data-testid="se-load-version"
              class="px-2 py-1.5 rounded-md cursor-pointer flex items-center gap-2"
              :class="selectedCrtime === v.crtime ? 'bg-primary-100 dark:bg-primary-900/30' : 'hover:bg-gray-100 dark:hover:bg-dark-border'"
              @click="selectedCrtime = v.crtime" @dblclick="openVersion(v)">
              <span class="font-mono text-xs text-gray-800 dark:text-gray-200">{{ formatCrtime(v.crtime) }}</span>
              <span v-if="v.isCurrent" class="px-1.5 rounded text-[10px] bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-400">현재</span>
            </li>
          </ul>
          <p class="text-[11px] text-gray-500 mt-2">{{ t('SEW_UI_LOAD_VERSION_HINT') }}</p>
        </div>
      </div>
      <BaseToast :toast="toast" />
    </div>
    <template #footer>
      <button class="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-lg transition text-sm disabled:opacity-50" :disabled="!selected" data-testid="se-load-open"
        @click="openSelected">열기</button>
    </template>
  </ModalShell>
</template>
