<script setup>
// 메모 목록 창(P3 설계 §4.5) — 내 범위 설비의, 스냅샷 시각이 15일 안인 메모. 열 때마다 다시 받는다.
// - 거르기(공정·모델·설비·내 메모만)는 화면에서 한다. 항목은 목록에 있는 메모의 것만이다.
// - 줄을 고르고 [이 스냅샷으로 가기](또는 두 번 누르기) → 저장소가 그 설비·그 날 목록을 한 번 받아 그 줄을 고른다(SE-016).
// - 줄은 300건까지만 그린다(서버는 5,000건까지 준다).
import { ref, computed, watch } from 'vue'
import { useSnapshotStore } from '../../stores/snapshotStore'
import { memoOptions, filterMemos } from '../../editor/snapshotMemo'
import { expiryDays } from '../../editor/snapshotList'
import { t } from '../../messages'
import ModalShell from '../ModalShell.vue'
import '../panel/panel.css'
import '../../pills.css'
import './snapshot.css'

defineOptions({ name: 'MemoListDialog' })
const props = defineProps({ modelValue: Boolean, me: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])
const snap = useSnapshotStore()
const ROW_CAP = 300

const process = ref('')
const model = ref('')
const eqpId = ref('')
const mine = ref(false)
const picked = ref('') // 고른 줄의 키
const keyOf = (m) => `${m.eqpId}\n${m.fileName}`

watch(() => props.modelValue, (open) => {
  if (!open) return
  process.value = ''
  model.value = ''
  eqpId.value = ''
  mine.value = false
  picked.value = ''
  snap.loadMemoList()
}, { immediate: true })

const items = computed(() => snap.memoList.items)
const options = computed(() => memoOptions(items.value, { process: process.value, model: model.value }))
// 위 거르기를 바꿔 아래 값이 항목에서 빠지면 그 거르기를 푼다
watch(options, (o) => {
  if (model.value && !o.models.includes(model.value)) model.value = ''
  if (eqpId.value && !o.eqpIds.includes(eqpId.value)) eqpId.value = ''
})
const filtered = computed(() => filterMemos(items.value, { process: process.value, model: model.value, eqpId: eqpId.value, mine: mine.value, me: props.me }))
const rows = computed(() => filtered.value.slice(0, ROW_CAP))
const pickedItem = computed(() => (picked.value ? filtered.value.find((m) => keyOf(m) === picked.value) ?? null : null))
watch(filtered, () => { if (picked.value && !pickedItem.value) picked.value = '' })

const state = computed(() => {
  const l = snap.memoList
  if (l.status === 'error') return { text: l.error ? `${t('SEW_SNAP_MEMO_LIST_FAILED')} ${l.error}` : t('SEW_SNAP_MEMO_LIST_FAILED'), retry: true }
  if (l.status !== 'ready') return l.items.length ? null : { text: t('SEW_SNAP_MEMO_LIST_LOADING') }
  if (!l.items.length) return { text: t('SEW_SNAP_MEMO_LIST_EMPTY') }
  return filtered.value.length ? null : { text: t('SEW_SNAP_MEMO_LIST_NONE') }
})
const authorOf = (m) => m.memo.authorName || m.memo.author || t('SEW_SNAP_MEMO_SOMEONE')
const whenOf = (m) => `${String(m.date).slice(5)} ${m.time}`
const writtenOf = (m) => (typeof m.memo.writtenAt === 'string' ? m.memo.writtenAt.slice(5) : '')

const close = () => emit('update:modelValue', false)
function go(m = pickedItem.value) {
  if (!m) return
  close()
  snap.goToMemo(m)
}
const btnS = 'h-8 px-3 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:enabled:bg-gray-300 dark:hover:enabled:bg-gray-600 disabled:opacity-50'
const btnP = 'h-8 px-3 rounded-lg text-sm bg-primary-500 hover:enabled:bg-primary-600 text-white font-medium disabled:opacity-50'
</script>

<template>
  <ModalShell :model-value="modelValue" :title="t('SEW_SNAP_MEMO_LIST')" :width="900" :height="540" testid="se-memo-list" @update:model-value="close">
    <div class="h-full flex flex-col min-h-0 text-gray-800 dark:text-gray-100">
      <div class="px-5 py-2.5 flex flex-wrap items-center gap-2 border-b border-gray-200 dark:border-dark-border shrink-0 text-xs">
        <select v-model="process" class="se-inp se-memo-filter" :aria-label="t('SEW_SNAP_EQP_ALL_PROCESS')" data-testid="se-memo-list-process">
          <option value="">{{ t('SEW_SNAP_EQP_ALL_PROCESS') }}</option>
          <option v-for="p in options.processes" :key="p" :value="p">{{ p }}</option>
        </select>
        <select v-model="model" class="se-inp se-memo-filter" :aria-label="t('SEW_SNAP_EQP_ALL_MODEL')" data-testid="se-memo-list-model">
          <option value="">{{ t('SEW_SNAP_EQP_ALL_MODEL') }}</option>
          <option v-for="m in options.models" :key="m" :value="m">{{ m }}</option>
        </select>
        <select v-model="eqpId" class="se-inp se-memo-filter se-memo-filter-wide" :aria-label="t('SEW_SNAP_MEMO_LIST_ALL_EQP')" data-testid="se-memo-list-eqp">
          <option value="">{{ t('SEW_SNAP_MEMO_LIST_ALL_EQP') }}</option>
          <option v-for="e in options.eqpIds" :key="e" :value="e">{{ e }}</option>
        </select>
        <label class="flex items-center gap-1.5 select-none"><input v-model="mine" type="checkbox" data-testid="se-memo-list-mine" />{{ t('SEW_SNAP_MEMO_LIST_MINE') }}</label>
        <span v-if="snap.memoList.items.length" class="ml-auto tabular-nums text-gray-500 dark:text-gray-400" data-testid="se-memo-list-count">{{ t('SEW_SNAP_MEMO_LIST_COUNT', { n: filtered.length }) }}</span>
      </div>
      <p v-if="snap.memoList.truncated" class="px-5 py-1.5 text-[11px] bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 shrink-0" data-testid="se-memo-list-truncated">{{ t('SEW_SNAP_MEMO_LIST_TRUNCATED') }}</p>
      <div class="flex-1 min-h-0 overflow-auto">
        <div v-if="state" class="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-gray-500 dark:text-gray-400">
          <p data-testid="se-memo-list-state">{{ state.text }}</p>
          <button v-if="state.retry" type="button" :class="btnS" data-testid="se-memo-list-retry" @click="snap.loadMemoList()">{{ t('SEW_UI_RETRY') }}</button>
        </div>
        <table v-else class="se-memo-table w-full text-xs">
          <thead>
            <tr>
              <th>{{ t('SEW_SNAP_MEMO_LIST_COL_AUTHOR') }}</th><th>{{ t('SEW_SNAP_MEMO_LIST_COL_EQP') }}</th><th>{{ t('SEW_SNAP_MEMO_LIST_COL_TIME') }}</th>
              <th class="w-full">{{ t('SEW_SNAP_MEMO_LIST_COL_MEMO') }}</th><th>{{ t('SEW_SNAP_MEMO_LIST_COL_WRITTEN') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in rows" :key="keyOf(m)" :aria-selected="keyOf(m) === picked ? 'true' : 'false'" data-testid="se-memo-list-row" @click="picked = keyOf(m)" @dblclick="go(m)">
              <td>{{ authorOf(m) }}</td>
              <td>{{ m.eqpId }}</td>
              <td class="tabular-nums">{{ whenOf(m) }} <span v-if="expiryDays(m) !== null" class="se-snap-expires" data-testid="se-memo-list-expires">{{ t('SEW_SNAP_EXPIRES', { n: expiryDays(m) }) }}</span></td>
              <td class="se-memo-text" :title="m.memo.text">{{ m.memo.text }}</td>
              <td class="tabular-nums">{{ writtenOf(m) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!state && filtered.length > rows.length" class="px-5 py-2 text-xs text-gray-500 dark:text-gray-400" data-testid="se-memo-list-more">{{ t('SEW_SNAP_MEMO_LIST_MORE', { n: filtered.length - rows.length }) }}</p>
      </div>
    </div>
    <template #footer>
      <button type="button" :class="btnS" data-testid="se-memo-list-close" @click="close">{{ t('SEW_SNAP_MEMO_LIST_CLOSE') }}</button>
      <button type="button" :class="btnP" :disabled="!pickedItem" data-testid="se-memo-list-go" @click="go()">{{ t('SEW_SNAP_MEMO_LIST_GO') }}</button>
    </template>
  </ModalShell>
</template>
