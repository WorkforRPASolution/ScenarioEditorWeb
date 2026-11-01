<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { AgGridVue } from 'ag-grid-vue3'
import { useEditorStore } from '../stores/editorStore'
import { registerGrid, useGridTheme } from '../gridTheme'
import { toRows, renderTarget, renderNo } from '../stepRows'
import { t } from '../messages'
import '../pills.css'

defineOptions({ name: 'StepTable' })
registerGrid()
const store = useEditorStore()
const theme = useGridTheme()
const rows = computed(() => toRows(store.steps))
const gridApi = ref(null)

const columnDefs = [
  { field: 'no', headerName: 'NO', width: 72, cellRenderer: renderNo },
  { field: 'condition', headerName: '조건', width: 100 },
  { field: 'accept', headerName: '정확도', width: 80, type: 'rightAligned' },
  { field: 'retry', headerName: '재시도', width: 80, type: 'rightAligned' },
  { field: 'interval', headerName: '간격(초)', width: 90, type: 'rightAligned' },
  { field: 'skip', headerName: '전처리 스킵', width: 100, valueFormatter: (p) => (p.value === null ? '—' : p.value ? '☑' : '☐') },
  { field: 'onFalse', headerName: '실패 시', width: 100, cellRenderer: renderTarget },
  { field: 'onTrue', headerName: '성공 시', width: 100, cellRenderer: renderTarget },
  { field: 'action', headerName: '동작', width: 120 },
  { field: 'desc', headerName: '설명 (메일)', flex: 1, minWidth: 200 }
]

function syncSelection() {
  const api = gridApi.value
  if (!api || !store.selectedUid) return
  const node = api.getRowNode(store.selectedUid)
  if (node) { node.setSelected(true, true); api.ensureNodeVisible(node) }
}
watch(() => store.selectedUid, () => nextTick(syncSelection))
function onReady(e) { gridApi.value = e.api; syncSelection() }
function onCellClicked(e) {
  const go = e.event?.target?.closest?.('[data-go]')?.dataset.go ?? e.event?.target?.dataset?.go
  store.select(go ?? e.data.uid)
}
function onKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); store.moveSelection(e.key === 'ArrowDown' ? 1 : -1) }
}
</script>

<template>
  <div class="h-full outline-none" tabindex="0" data-testid="se-step-table" @keydown="onKey">
    <div v-if="!rows.length" class="h-full flex items-center justify-center text-sm text-gray-400">{{ t('SEW_UI_NO_STEPS') }}</div>
    <AgGridVue v-else :theme="theme" :row-data="rows" :column-defs="columnDefs" :get-row-id="(p) => p.data.uid" :suppress-cell-focus="true"
      :row-selection="{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }" style="width: 100%; height: 100%" @grid-ready="onReady" @cell-clicked="onCellClicked" />
  </div>
</template>
