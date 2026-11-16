<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { AgGridVue } from 'ag-grid-vue3'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { registerGrid, useGridTheme } from '../gridTheme'
import { toRows, renderTarget, renderNo, renderAccept, renderSkip } from '../stepRows'
import { unsavedChanges } from '../editor/diff'
import { acceptCode } from '../editor/fieldRules'
import { t } from '../messages'
import TargetPicker from './TargetPicker.vue'
import { useShown } from '../composables/useShown'
import '../pills.css'

defineOptions({ name: 'StepTable' })
registerGrid()
const store = useEditorStore()
const edit = useEditStore()
const theme = useGridTheme()
const gridApi = ref(null)
const tableEl = ref(null)
// 편집: 작업본이 있고 읽기 전용이 아닐 때만. 아니면 P1 그대로(한 줄 선택·칸 편집 없음).
const editable = computed(() => edit.editable)

// 바뀐 줄 표시(목업 rowHtml mark): 새 줄 nw · 고친 줄 ch · 오른쪽 패널에서 고치는 중(적용 전) pending
const marks = computed(() => {
  const m = new Map()
  const s = edit.session
  if (s.working.steps !== s.saveBase?.steps) {
    for (const c of unsavedChanges(s.working, s.saveBase)) {
      if (c.kind === 'added') m.set(c.uid, 'nw')
      else if (c.kind === 'changed') m.set(c.uid, 'ch')
    }
  }
  const p = edit.panel
  if (p.uid && !p.isNew && edit.panelDirty()) m.set(p.uid, 'pending')
  return m
})
// 값이 같은 줄은 앞 객체를 다시 써서 AG Grid 가 그 줄을 다시 그리지 않게 한다(칸 입력 초점·애니메이션 유지).
const sameTarget = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)
const sameRow = (a, b) => Object.keys(b).every((k) => (k.endsWith('Target') ? sameTarget(a[k], b[k]) : a[k] === b[k])) && Object.keys(a).length === Object.keys(b).length
let prevRows = new Map()
const rows = computed(() => {
  const c = edit.clip
  // 새 스텝을 만드는 중이면 넣을 자리를 표에 가는 줄로 보인다(그 줄 위, 맨 끝이면 마지막 줄 아래)
  const insert = edit.panel.isNew ? { before: edit.panel.insertBefore ?? null } : null
  const next = toRows(store.steps, editable.value ? { marks: marks.value, moved: edit.moved, cut: c?.cut ? new Set(c.uids) : null, insert } : null)
  const out = next.map((r) => { const p = prevRows.get(r.uid); return p && sameRow(p, r) ? p : r })
  prevRows = new Map(out.map((r) => [r.uid, r]))
  return out
})

// 정렬은 끈다 — P1 의 순서는 ↑↓·순서도와 같은 번호 순서여야 한다.
const defaultColDef = { sortable: false }
// P1: 클릭은 선택만 하고 Ctrl/Cmd 클릭으로 풀지는 못한다(store 의 선택과 표 강조가 어긋나지 않게).
// 편집: 여러 줄 선택은 editStore.selection 이 정하고 표 강조는 그걸 따라간다(AG Grid 클릭 선택은 끈다).
const rowSelection = computed(() => (editable.value
  ? { mode: 'multiRow', checkboxes: false, headerCheckbox: false, enableClickSelection: false }
  : { mode: 'singleRow', checkboxes: false, enableClickSelection: 'enableSelection' }))
const rowClassRules = { 'se-row-cut': (p) => !!p.data?.cut, 'se-row-ins-before': (p) => p.data?.ins === 'before', 'se-row-ins-after': (p) => p.data?.ins === 'after' }

const baseColumns = [
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
// AG Grid 는 값이 같은 칸을 다시 그리지 않는다. NO(바뀐 줄 점·경고)·갈 곳(강조)·정확도·스킵(조건 종류)은 다른 칸 값으로도 그리므로
// 줄 객체가 바뀌면 늘 다시 그린다(rows 가 값이 같은 줄은 같은 객체를 다시 쓰므로 바뀐 줄만).
const redraw = () => false
const editColumns = baseColumns.map((c) => {
  if (c.field === 'accept') return { ...c, cellRenderer: renderAccept, equals: redraw }
  if (c.field === 'skip') return { field: 'skip', headerName: c.headerName, width: c.width, cellRenderer: renderSkip, equals: redraw }
  if (['no', 'onFalse', 'onTrue'].includes(c.field)) return { ...c, equals: redraw }
  return c
})
const columnDefs = computed(() => (editable.value ? editColumns : baseColumns))

// 칸 렌더러가 부르는 것. editable 은 읽을 때마다 지금 값. 패널에 적용 안 한 변경이 있으면 editCell 이 먼저 묻는다(guard).
// 확인 창이 떠 있는 동안에는 받지 않는다(창이 닫히면 칸을 작업본 값으로 다시 그린다).
function onAccept(uid, text) {
  if (edit.dialog) return null
  const v = String(text).trim() === '' ? NaN : Number(text)
  const code = acceptCode(v)
  if (code) { const msg = t(`RULE_${code}`); edit.notify(msg); return msg }
  edit.editCell(uid, 'accept', v)
  return null
}
const onSkip = (uid, checked) => { if (!edit.dialog) edit.editCell(uid, 'skip', checked) }
const gridContext = { get editable() { return edit.editable }, onAccept, onSkip }

function syncSelection() {
  const api = gridApi.value
  if (!api) return
  if (!editable.value) {
    if (!store.selectedUid) return
    const node = api.getRowNode(store.selectedUid)
    if (node) { node.setSelected(true, true); api.ensureNodeVisible(node) }
    return
  }
  const want = new Set(edit.selection.uids)
  api.forEachNode((n) => { const on = want.has(n.id); if (n.isSelected() !== on) n.setSelected(on) })
  const node = store.selectedUid && api.getRowNode(store.selectedUid)
  if (node) api.ensureNodeVisible(node)
}
watch(() => store.selectedUid, () => nextTick(syncSelection))
watch(() => edit.selection, () => nextTick(syncSelection))
// 같은 줄 객체를 다시 쓰므로 편집 여부가 바뀌면(읽기 전용 판 ↔ 쓸 수 있는 판) 칸을 새로 그린다.
watch(editable, () => nextTick(() => { gridApi.value?.redrawRows?.(); syncSelection() }))
// 새 스텝을 만드는 중에 넣을 자리를 바꾸면(패널 바닥 "넣을 자리") 그 줄이 보이게 표를 움직인다 — 스텝이 많으면 초록 줄이 화면 밖일 수 있다.
// 맨 끝이면 마지막 줄. 시작할 때(고른 줄이 이미 보인다)·값만 고칠 때는 움직이지 않는다.
watch(() => [edit.panel.isNew ? edit.panel.uid : null, edit.panel.insertBefore ?? null], ([uid, at], [prevUid, prevAt]) => {
  if (!uid || uid !== prevUid || at === prevAt) return
  nextTick(() => {
    const api = gridApi.value
    const target = at ?? store.steps[store.steps.length - 1]?.uid
    const node = api && target ? api.getRowNode(target) : null
    if (node) api.ensureNodeVisible(node)
  })
})
function onReady(e) { gridApi.value = e.api; syncSelection() }
// 접혀 있던 목록을 펴면(숨은 동안 고른 줄이 바뀌었을 수 있다) 고른 줄이 보이게 다시 맞춘다
useShown(tableEl, () => nextTick(syncSelection))
// 확인 창(적용 안 한 변경 등)이 닫히면 칸을 작업본 값으로 다시 그린다 — 묻는 동안 칸에 친 값·체크가 남지 않게.
watch(() => edit.dialog, (now, before) => { if (before && !now) nextTick(() => gridApi.value?.refreshCells?.({ force: true })) })
function onGone() { gridApi.value = null } // 스텝 0개 등으로 표가 지워지면 옛 api 를 놓는다

// ── 빈 시나리오(목업 조작판 20 empty): 조건 없는 새 스텝·복사해 둔 스텝 붙여넣기. 이미지·OCR 은 기준 화면이 있어야 해서 여기 없다. ──
const clipCount = computed(() => edit.clip?.uids.length ?? 0)

// ── 다음 스텝 고르기 ──
const picker = ref(null)
const pickerStep = computed(() => (picker.value ? edit.session?.working?.steps.find((s) => s.uid === picker.value.uid) ?? null : null))
function openPicker(uid, key, el) {
  if (edit.dialog) return
  if (!edit.selection.uids.includes(uid) && !edit.requestSelect(uid)) return
  const r = el.getBoundingClientRect()
  const vw = window.innerWidth || 1280
  const vh = window.innerHeight || 800
  const x = Math.min(Math.max(r.left, 8), Math.max(8, vw - 312))
  const y = r.bottom + 4 + 410 > vh ? Math.max(8, vh - 410) : r.bottom + 4
  picker.value = { uid, key, x, y }
}
function onPick(target) {
  const p = picker.value
  picker.value = null
  if (p) edit.editCell(p.uid, p.key, target)
  tableEl.value?.focus?.()
}
function closePicker() { picker.value = null; tableEl.value?.focus?.() }

function onCellClicked(e) {
  const target = e.event?.target
  if (!editable.value) {
    const go = target?.closest?.('[data-go]')?.dataset.go ?? target?.dataset?.go
    store.select(go ?? e.data.uid)
    nextTick(syncSelection) // 이미 선택된 스텝을 눌러 선택이 안 바뀌어도 표 강조를 store 에 다시 맞춘다
    return
  }
  const pick = target?.closest?.('[data-pick]')
  if (pick) { const [uid, key] = pick.dataset.pick.split(':'); openPicker(uid, key, pick); return }
  if (target?.closest?.('[data-cell]')) { if (store.selectedUid !== e.data.uid) edit.requestSelect(e.data.uid); return }
  const ev = e.event || {}
  edit.clickRow(e.data.uid, { shift: !!ev.shiftKey, toggle: !!(ev.ctrlKey || ev.metaKey) })
  nextTick(syncSelection)
}

function neighbor(delta) {
  const list = store.steps
  if (!list.length) return null
  const i = list.findIndex((s) => s.uid === store.selectedUid)
  if (i < 0) return list[delta < 0 ? list.length - 1 : 0].uid
  return list[Math.min(list.length - 1, Math.max(0, i + delta))].uid
}
// 단축키는 표에 초점이 있을 때만(목업 keydown). 칸 입력 중이면 브라우저 기본 동작에 맡긴다.
// 확인 창이 떠 있는 동안에는 표 단축키를 듣지 않는다(미뤄 둔 이동을 덮어쓰지 않게).
function onKey(e) {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '')) return
  if (editable.value && edit.dialog) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') e.preventDefault(); return }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const d = e.key === 'ArrowDown' ? 1 : -1
    if (!editable.value) { store.moveSelection(d); return }
    const uid = neighbor(d)
    if (uid && uid !== store.selectedUid) edit.requestSelect(uid)
    return
  }
  if (!editable.value) return
  const cmd = e.ctrlKey || e.metaKey
  const k = (e.key ?? '').toLowerCase()
  if (cmd && k === 'z') { e.preventDefault(); if (e.shiftKey) edit.redoCommand(); else edit.undoCommand() }
  else if (cmd && k === 'y') { e.preventDefault(); edit.redoCommand() }
  else if (cmd && k === 'c') { e.preventDefault(); edit.copySelection(false) }
  else if (cmd && k === 'x') { e.preventDefault(); edit.copySelection(true) }
  else if (cmd && k === 'v') { e.preventDefault(); edit.pasteClip('after') }
  else if (e.key === 'Delete') { e.preventDefault(); edit.deleteSelection() }
}
</script>

<template>
  <div ref="tableEl" class="h-full outline-none" tabindex="0" data-testid="se-step-table" @keydown="onKey">
    <div v-if="!rows.length && editable" class="h-full flex flex-col items-center justify-center gap-2.5 px-6 text-center text-sm text-gray-500 dark:text-gray-400" data-testid="se-table-empty">
      <p class="text-gray-700 dark:text-gray-200">{{ t('SEW_EDIT_EMPTY_TITLE') }}</p>
      <div class="flex gap-2">
        <button type="button" data-testid="se-empty-new" class="h-7 px-3 rounded-md text-xs font-medium text-white bg-primary-500 hover:bg-primary-600" @click="edit.startNew('none')">{{ t('SEW_EDIT_EMPTY_NEW') }}</button>
        <button type="button" data-testid="se-empty-paste" :disabled="!clipCount" :title="clipCount ? undefined : t('SEW_EDIT_EMPTY_PASTE_NONE')"
          class="h-7 px-3 rounded-md text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:enabled:bg-gray-300 dark:hover:enabled:bg-gray-600 disabled:opacity-50" @click="edit.pasteClip('end')">
          {{ t('SEW_EDIT_EMPTY_PASTE') }}<span v-if="clipCount" class="ml-1 text-gray-500 dark:text-gray-400">{{ t('SEW_EDIT_PASTE_COUNT', { n: clipCount }) }}</span>
        </button>
      </div>
      <small class="text-xs leading-relaxed text-gray-400 dark:text-gray-500">{{ t('SEW_EDIT_EMPTY_HELP') }}<br>{{ t('SEW_EDIT_EMPTY_HELP_SNAPSHOT') }}<br>{{ t('SEW_EDIT_EMPTY_HELP_PASTE') }}</small>
    </div>
    <div v-else-if="!rows.length" class="h-full flex items-center justify-center text-sm text-gray-400">{{ t('SEW_UI_NO_STEPS') }}</div>
    <AgGridVue v-else :theme="theme" :row-data="rows" :column-defs="columnDefs" :get-row-id="(p) => p.data.uid" :suppress-cell-focus="true"
      :default-col-def="defaultColDef" :row-selection="rowSelection" :row-class-rules="rowClassRules" :context="gridContext" style="width: 100%; height: 100%"
      @grid-ready="onReady" @grid-pre-destroyed="onGone" @cell-clicked="onCellClicked" @row-data-updated="syncSelection" />
    <Teleport to="body">
      <TargetPicker v-if="picker && pickerStep" :steps="edit.session.working.steps" :self-uid="picker.uid" :which="picker.key" :current="pickerStep.next[picker.key]"
        :x="picker.x" :y="picker.y" @pick="onPick" @close="closePicker" />
    </Teleport>
  </div>
</template>
