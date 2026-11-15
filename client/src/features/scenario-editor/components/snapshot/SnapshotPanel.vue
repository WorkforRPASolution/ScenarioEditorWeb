<script setup>
// 스냅샷 왼쪽 패널(P3 설계 §4.2) — 설비 고르기, 날짜(◀ ▶·달력), 거르기(전체·태그·메모), 하루 목록, [메모 목록]·[새로 고침].
// 상태(설비·날짜·목록·고른 것)는 저장소가 갖는다.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useSnapshotStore } from '../../stores/snapshotStore'
import { useEditorStore } from '../../stores/editorStore'
import { FILTERS } from '../../editor/snapshotList'
import { weekdayOf } from '../../editor/snapshotDates'
import { t } from '../../messages'
import EquipmentPicker from './EquipmentPicker.vue'
import SnapshotCalendar from './SnapshotCalendar.vue'
import SnapshotList from './SnapshotList.vue'
import MemoListDialog from './MemoListDialog.vue'
import '../panel/panel.css'
import './snapshot.css'

defineOptions({ name: 'SnapshotPanel' })
defineProps({ prefer: { type: Object, default: null } })
const snap = useSnapshotStore()
const editor = useEditorStore()
const memoListOpen = ref(false) // 메모 목록 창 — 설비를 고르기 전에도 연다(다른 설비의 메모로 갈 수 있다)

// ── 날짜 ──
const dateRow = ref(null)
const calOpen = ref(false)
const dateText = computed(() => (snap.date ? `${snap.date} (${t('SEW_SNAP_WEEKDAYS')[weekdayOf(snap.date)]})` : t('SEW_SNAP_DATE_NONE')))
const canPick = computed(() => !!snap.eqpId && !!snap.minDate)
const atFirst = computed(() => !snap.date || snap.date <= snap.minDate)
const atLast = computed(() => !snap.date || snap.date >= snap.maxDate)
function toggleCalendar() {
  calOpen.value = !calOpen.value
  if (calOpen.value) snap.openCalendar()
}
// 달력 바깥을 누르거나 Esc 를 누르면 닫는다
function onDocDown(e) { if (calOpen.value && !dateRow.value?.contains(e.target)) calOpen.value = false }
function onDocKey(e) { if (e.key === 'Escape' && calOpen.value) calOpen.value = false }
onMounted(() => { document.addEventListener('mousedown', onDocDown); document.addEventListener('keydown', onDocKey) })
onBeforeUnmount(() => { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onDocKey) })

// ── 목록 자리에 보일 글(없으면 목록) ──
const state = computed(() => {
  const l = snap.list
  if (snap.equipment.status === 'ready' && !snap.equipment.items.length) return { text: t('SEW_SNAP_EQP_EMPTY') }
  if (!snap.eqpId) return { text: t('SEW_SNAP_PICK_EQP') }
  if (l.status === 'error') {
    const failed = t('SEW_SNAP_LIST_FAILED')
    return { text: l.error && l.error !== failed ? `${failed} ${l.error}` : failed, retry: true }
  }
  if (l.items.length) return snap.shown.length ? null : { text: t(snap.filter === 'memo' ? 'SEW_SNAP_NO_MEMO' : 'SEW_SNAP_NO_TAG') }
  if (l.status === 'ready') return { text: snap.date ? t('SEW_SNAP_EMPTY_DAY') : t('SEW_SNAP_NO_RECENT') }
  return { text: t('SEW_SNAP_LOADING') }
})
const btn = 'h-7 px-2 rounded-md text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:enabled:bg-gray-300 dark:hover:enabled:bg-gray-600 disabled:opacity-50'
</script>

<template>
  <div class="h-full flex flex-col min-h-0 text-gray-800 dark:text-gray-100" data-testid="se-snap-panel">
    <div class="h-10 px-3 flex items-center gap-2 border-b border-gray-200 dark:border-dark-border shrink-0">
      <span class="text-sm font-semibold shrink-0">{{ t('SEW_SNAP_TITLE') }}</span>
      <!-- 지금 설비 — 입력 칸에 검색어가 남아 있어도 무엇을 보고 있는지 알 수 있게 -->
      <span v-if="snap.eqpId" class="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400" :title="snap.eqpId" data-testid="se-snap-current">{{ snap.eqpId }}</span>
      <button type="button" :class="btn" class="ml-auto shrink-0" data-testid="se-snap-collapse" @click="snap.setOpen(false)">{{ t('SEW_SNAP_COLLAPSE') }}</button>
    </div>
    <div class="p-2.5 flex flex-col gap-2 border-b border-gray-200 dark:border-dark-border shrink-0">
      <EquipmentPicker :prefer="prefer" />
      <div ref="dateRow" class="relative flex gap-1.5">
        <button type="button" :class="btn" :disabled="atFirst" :title="t('SEW_SNAP_DATE_PREV')" :aria-label="t('SEW_SNAP_DATE_PREV')" data-testid="se-snap-date-prev" @click="snap.moveDate(-1)">◀</button>
        <button type="button" :class="btn" class="flex-1 min-w-0 truncate tabular-nums" :disabled="!canPick" :title="t('SEW_SNAP_DATE_PICK')" :aria-expanded="calOpen ? 'true' : 'false'" data-testid="se-snap-date" @click="toggleCalendar">{{ dateText }} ▾</button>
        <button type="button" :class="btn" :disabled="atLast" :title="t('SEW_SNAP_DATE_NEXT')" :aria-label="t('SEW_SNAP_DATE_NEXT')" data-testid="se-snap-date-next" @click="snap.moveDate(1)">▶</button>
        <SnapshotCalendar v-if="calOpen" @close="calOpen = false" />
      </div>
      <div class="flex items-center gap-2">
        <span class="se-seg">
          <button v-for="f in FILTERS" :key="f" type="button" :disabled="!snap.eqpId" :aria-pressed="snap.filter === f ? 'true' : 'false'" :data-testid="`se-snap-filter-${f}`" @click="snap.setFilter(f)">{{ t(`SEW_SNAP_FILTER_${f}`) }}</button>
        </span>
        <span v-if="snap.eqpId && snap.list.items.length" class="ml-auto text-xs text-gray-500 dark:text-gray-400 tabular-nums" data-testid="se-snap-count">{{ t('SEW_SNAP_COUNT', { n: snap.shown.length }) }}</span>
      </div>
    </div>
    <p v-if="snap.list.truncated && !state" class="px-3 py-1.5 text-[11px] bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 shrink-0" data-testid="se-snap-truncated">{{ t('SEW_SNAP_TRUNCATED', { n: snap.list.items.length }) }}</p>
    <!-- 서버가 메모를 읽지 못했다 — 스냅샷은 메모 없이 보인다 -->
    <p v-if="snap.list.memoFailed && snap.list.items.length" class="px-3 py-1.5 text-[11px] bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 shrink-0" data-testid="se-snap-memo-failed">{{ t('SEW_SNAP_MEMO_FAILED_READ') }}</p>
    <div class="flex-1 min-h-0">
      <div v-if="state" class="h-full flex flex-col items-center justify-center gap-2 px-4 text-center text-xs text-gray-500 dark:text-gray-400">
        <p data-testid="se-snap-state">{{ state.text }}</p>
        <button v-if="state.retry" type="button" :class="btn" data-testid="se-snap-retry" @click="snap.refresh()">{{ t('SEW_UI_RETRY') }}</button>
      </div>
      <SnapshotList v-else />
    </div>
    <div class="px-2.5 py-2 flex gap-1.5 border-t border-gray-200 dark:border-dark-border shrink-0">
      <button type="button" :class="btn" data-testid="se-snap-memo-list-open" @click="memoListOpen = true">{{ t('SEW_SNAP_MEMO_LIST') }}</button>
      <button type="button" :class="btn" :disabled="!snap.eqpId" data-testid="se-snap-refresh" @click="snap.refresh()">{{ t('SEW_SNAP_REFRESH') }}</button>
    </div>
    <MemoListDialog v-model="memoListOpen" :me="editor.me?.singleid ?? ''" />
  </div>
</template>
