<script setup>
// 메모 목록 창(P3 설계 §4.5) — 내 범위 설비의, 스냅샷 시각이 15일 안인 메모. 열 때마다 다시 받는다.
// - 거르기(공정·모델·설비·내 메모만)는 화면에서 한다. 항목은 목록에 있는 메모의 것만이다.
// - 줄을 고르고 [이 스냅샷으로 가기](또는 두 번 누르기) → 저장소가 그 설비·그 날 목록을 한 번 받아 그 줄을 고른다(SE-016).
// - 줄은 300건까지만 그린다(서버는 5,000건까지 준다).
// - 고르기(사내 요청 2026-11-16): 줄을 누르면 그 줄 하나, 체크 칸·Ctrl(⌘)은 더하고 빼기, Shift 는 범위, 머리 칸은 보이는 줄 모두.
//   고른 것은 늘 보이는 줄 안에 있다(거르기로 사라지면 뺀다 — 보이지 않는 메모를 지우지 않는다).
//   [고치기]·[가기] 는 하나일 때, [지우기 (n)] 은 하나 이상일 때. 지우기는 건수(남의 메모 수)를 보이고 한 번 묻는다(설계 §14.1 ② — 남의 메모는 묻고 허용).
import { ref, computed, watch, nextTick } from 'vue'
import { useSnapshotStore } from '../../stores/snapshotStore'
import { memoOptions, filterMemos, isMine } from '../../editor/snapshotMemo'
import { expiryDays } from '../../editor/snapshotList'
import { t } from '../../messages'
import ModalShell from '../ModalShell.vue'
import MemoDialog from './MemoDialog.vue'
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
const checked = ref(new Set()) // 고른 줄의 키(통째로 갈아 끼운다)
const anchor = ref('') // Shift 범위의 기준 줄
const editing = ref(null) // 메모 창에서 고치는 줄
const confirming = ref(false) // 지울지 묻는 중
const busy = ref(false) // 지우는 중
const progress = ref({ done: 0, total: 0 })
const notice = ref(null) // { text, warn } — 지운 결과·그 사이 지워짐
const confirmBox = ref(null)
const removeBtn = ref(null)
const keyOf = (m) => `${m.eqpId}\n${m.fileName}`

watch(() => props.modelValue, (open) => {
  if (!open) return
  process.value = ''
  model.value = ''
  eqpId.value = ''
  mine.value = false
  checked.value = new Set()
  anchor.value = ''
  editing.value = null
  confirming.value = false
  notice.value = null
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
// 보이는 줄에 없게 된 것은 고른 것에서 뺀다
watch(rows, (list) => {
  if (!checked.value.size) return
  const shown = new Set(list.map(keyOf))
  const kept = [...checked.value].filter((k) => shown.has(k))
  if (kept.length !== checked.value.size) checked.value = new Set(kept)
})
const selected = computed(() => rows.value.filter((m) => checked.value.has(keyOf(m))))
const one = computed(() => (selected.value.length === 1 ? selected.value[0] : null))
const allChecked = computed(() => rows.value.length > 0 && selected.value.length === rows.value.length)
const modal = computed(() => busy.value || confirming.value) // 묻는 중·지우는 중 — 거르기도 잠근다(묻는 사이 대상이 바뀌지 않게)
// 목록을 다시 받는 중에는 앞에 받은 줄이 보여도 잠근다 — 옛 글을 보고 고른 것을 새 글에 대고 지우거나 고치지 않게
const locked = computed(() => modal.value || snap.memoList.status === 'loading')

function onRow(m, e) {
  if (locked.value) return
  const key = keyOf(m)
  const keys = rows.value.map(keyOf)
  const from = keys.indexOf(anchor.value)
  if (e?.shiftKey && from >= 0) {
    const to = keys.indexOf(key)
    checked.value = new Set(keys.slice(Math.min(from, to), Math.max(from, to) + 1)) // 기준 줄은 그대로
    return
  }
  if (e?.ctrlKey || e?.metaKey) { toggle(m); return }
  checked.value = new Set([key])
  anchor.value = key
}
function toggle(m) {
  if (locked.value) return
  const key = keyOf(m)
  const next = new Set(checked.value)
  if (!next.delete(key)) next.add(key)
  checked.value = next
  anchor.value = key
}
// Shift+누르기가 줄의 글자를 범위로 칠하지 않게(그냥 끌어 메모 글을 고르는 것은 된다)
const noTextRange = (e) => { if (e.shiftKey) e.preventDefault() }
function toggleAll() {
  if (locked.value) return
  checked.value = allChecked.value ? new Set() : new Set(rows.value.map(keyOf))
}

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

const close = () => { if (!busy.value) emit('update:modelValue', false) }
function go(m = one.value) {
  if (!m || locked.value) return
  emit('update:modelValue', false)
  snap.goToMemo(m)
}
function edit() {
  if (!one.value || locked.value) return
  notice.value = null
  editing.value = one.value
}
const others = computed(() => selected.value.filter((m) => !isMine(m.memo, props.me)).length)
async function askRemove() {
  if (!selected.value.length || locked.value) return
  confirming.value = true
  await nextTick()
  confirmBox.value?.querySelector('button')?.focus?.() // [취소] 에 초점 — Enter 로 바로 지워지지 않게
}
async function cancelRemove() {
  confirming.value = false
  await nextTick()
  removeBtn.value?.focus?.()
}
// 묻는 창: Esc 는 취소, Tab 은 창 안의 단추에서만 돈다(뒤의 거르기·목록으로 나가지 않게)
function onConfirmKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); cancelRemove(); return }
  if (e.key !== 'Tab' || !confirmBox.value) return
  const stops = [...confirmBox.value.querySelectorAll('button')]
  const i = stops.indexOf(document.activeElement)
  e.preventDefault()
  stops[e.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : (i < 0 || i === stops.length - 1 ? 0 : i + 1)]?.focus()
}
async function remove() {
  const targets = selected.value.slice() // 물을 때 보인 줄 — 본 글도 이 줄들의 것으로 보낸다
  confirming.value = false
  if (!targets.length || busy.value) return
  busy.value = true
  notice.value = null
  progress.value = { done: 0, total: targets.length }
  const out = await snap.removeMemos(targets, (done, total) => { progress.value = { done, total } })
  busy.value = false
  const parts = [out.error ? t('SEW_SNAP_MEMO_LIST_REMOVE_STOPPED', { n: out.removed, reason: out.error }) : t('SEW_SNAP_MEMO_LIST_REMOVED', { n: out.removed })]
  if (out.changed.length) parts.push(t('SEW_SNAP_MEMO_LIST_CHANGED_NOTE', { k: out.changed.length }))
  if (out.older) parts.push(t('SEW_SNAP_MEMO_LIST_OLDER_NOTE', { k: out.older }))
  notice.value = { text: parts.join(' '), warn: parts.length > 1 || !!out.error }
  await nextTick()
  removeBtn.value?.focus?.()
}
const btnS = 'h-8 px-3 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:enabled:bg-gray-300 dark:hover:enabled:bg-gray-600 disabled:opacity-50'
const btnP = 'h-8 px-3 rounded-lg text-sm bg-primary-500 hover:enabled:bg-primary-600 text-white font-medium disabled:opacity-50'
const btnD = 'h-8 px-3 rounded-lg text-sm bg-red-600 hover:enabled:bg-red-700 text-white font-medium disabled:opacity-50'
</script>

<template>
  <ModalShell :model-value="modelValue" :title="t('SEW_SNAP_MEMO_LIST')" :width="900" :height="540" :closable="!busy" testid="se-memo-list" @update:model-value="close">
    <div class="relative h-full flex flex-col min-h-0 text-gray-800 dark:text-gray-100">
      <div class="px-5 py-2.5 flex flex-wrap items-center gap-2 border-b border-gray-200 dark:border-dark-border shrink-0 text-xs">
        <select v-model="process" class="se-inp se-memo-filter" :disabled="modal" :aria-label="t('SEW_SNAP_EQP_ALL_PROCESS')" data-testid="se-memo-list-process">
          <option value="">{{ t('SEW_SNAP_EQP_ALL_PROCESS') }}</option>
          <option v-for="p in options.processes" :key="p" :value="p">{{ p }}</option>
        </select>
        <select v-model="model" class="se-inp se-memo-filter" :disabled="modal" :aria-label="t('SEW_SNAP_EQP_ALL_MODEL')" data-testid="se-memo-list-model">
          <option value="">{{ t('SEW_SNAP_EQP_ALL_MODEL') }}</option>
          <option v-for="m in options.models" :key="m" :value="m">{{ m }}</option>
        </select>
        <select v-model="eqpId" class="se-inp se-memo-filter se-memo-filter-wide" :disabled="modal" :aria-label="t('SEW_SNAP_MEMO_LIST_ALL_EQP')" data-testid="se-memo-list-eqp">
          <option value="">{{ t('SEW_SNAP_MEMO_LIST_ALL_EQP') }}</option>
          <option v-for="e in options.eqpIds" :key="e" :value="e">{{ e }}</option>
        </select>
        <label class="flex items-center gap-1.5 select-none"><input v-model="mine" type="checkbox" :disabled="modal" data-testid="se-memo-list-mine" />{{ t('SEW_SNAP_MEMO_LIST_MINE') }}</label>
        <span v-if="snap.memoList.items.length" class="ml-auto tabular-nums text-gray-500 dark:text-gray-400" data-testid="se-memo-list-count">{{ t('SEW_SNAP_MEMO_LIST_COUNT', { n: filtered.length }) }}</span>
      </div>
      <p v-if="snap.memoList.truncated" class="px-5 py-1.5 text-[11px] bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 shrink-0" data-testid="se-memo-list-truncated">{{ t('SEW_SNAP_MEMO_LIST_TRUNCATED') }}</p>
      <p v-if="notice" class="px-5 py-1.5 text-xs shrink-0" :class="notice.warn ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200' : 'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200'" role="status" data-testid="se-memo-list-notice">{{ notice.text }}</p>
      <div class="flex-1 min-h-0 overflow-auto">
        <div v-if="state" class="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-gray-500 dark:text-gray-400">
          <p data-testid="se-memo-list-state">{{ state.text }}</p>
          <button v-if="state.retry" type="button" :class="btnS" data-testid="se-memo-list-retry" @click="snap.loadMemoList()">{{ t('SEW_UI_RETRY') }}</button>
        </div>
        <table v-else class="se-memo-table w-full text-xs">
          <thead>
            <tr>
              <th class="se-memo-check" @click="toggleAll"><input type="checkbox" :checked="allChecked" :indeterminate.prop="!allChecked && selected.length > 0" :disabled="locked" :aria-label="t('SEW_SNAP_MEMO_LIST_PICK_ALL')" :title="t('SEW_SNAP_MEMO_LIST_PICK_ALL')" data-testid="se-memo-list-check-all" /></th>
              <th>{{ t('SEW_SNAP_MEMO_LIST_COL_AUTHOR') }}</th><th>{{ t('SEW_SNAP_MEMO_LIST_COL_EQP') }}</th><th>{{ t('SEW_SNAP_MEMO_LIST_COL_TIME') }}</th>
              <th class="w-full">{{ t('SEW_SNAP_MEMO_LIST_COL_MEMO') }}</th><th>{{ t('SEW_SNAP_MEMO_LIST_COL_WRITTEN') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in rows" :key="keyOf(m)" :aria-selected="checked.has(keyOf(m)) ? 'true' : 'false'" data-testid="se-memo-list-row" @mousedown="noTextRange" @click="onRow(m, $event)" @dblclick="go(m)">
              <!-- 칸 전체가 누르는 자리다(체크 칸의 누름이 칸으로 올라온다) -->
              <td class="se-memo-check" @click.stop="toggle(m)" @dblclick.stop><input type="checkbox" :checked="checked.has(keyOf(m))" :disabled="locked" :aria-label="t('SEW_SNAP_MEMO_LIST_PICK', { eqp: m.eqpId, time: whenOf(m) })" data-testid="se-memo-list-check" /></td>
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
      <!-- 지울지 묻기 — 목록을 가리고 한 번 묻는다 -->
      <div v-if="confirming" class="absolute inset-0 z-10 bg-black/30 flex items-center justify-center" @click.self="cancelRemove">
        <div ref="confirmBox" class="w-[420px] max-w-[calc(100%-40px)] bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-2xl p-[18px]" role="alertdialog" aria-modal="true"
          aria-labelledby="se-memo-list-confirm-title" :aria-describedby="others ? 'se-memo-list-confirm-others' : undefined" data-testid="se-memo-list-confirm" @keydown="onConfirmKey">
          <p id="se-memo-list-confirm-title" class="text-sm">{{ t('SEW_SNAP_MEMO_LIST_CONFIRM', { n: selected.length }) }}</p>
          <p v-if="others" id="se-memo-list-confirm-others" class="mt-1.5 text-xs text-amber-700 dark:text-amber-300" data-testid="se-memo-list-confirm-others">{{ t('SEW_SNAP_MEMO_LIST_CONFIRM_OTHERS', { n: others }) }}</p>
          <div class="mt-3.5 flex justify-end gap-2">
            <button type="button" :class="btnS" data-testid="se-memo-list-confirm-cancel" @click="cancelRemove">{{ t('SEW_SNAP_MEMO_CANCEL') }}</button>
            <button type="button" :class="btnD" data-testid="se-memo-list-confirm-ok" @click="remove">{{ t('SEW_SNAP_MEMO_LIST_REMOVE') }}</button>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <span v-if="busy" class="mr-auto self-center text-xs tabular-nums text-gray-600 dark:text-gray-300" role="status" data-testid="se-memo-list-busy">{{ t('SEW_SNAP_MEMO_LIST_REMOVING', progress) }}</span>
      <span v-else-if="selected.length" class="mr-auto self-center text-xs tabular-nums text-gray-600 dark:text-gray-300" data-testid="se-memo-list-picked">{{ t('SEW_SNAP_MEMO_LIST_PICKED', { n: selected.length }) }}</span>
      <button type="button" :class="btnS" :disabled="busy" data-testid="se-memo-list-close" @click="close">{{ t('SEW_SNAP_MEMO_LIST_CLOSE') }}</button>
      <button type="button" :class="btnS" :disabled="!one || locked" :title="t('SEW_SNAP_MEMO_LIST_EDIT_HINT')" data-testid="se-memo-list-edit" @click="edit">{{ t('SEW_SNAP_MEMO_LIST_EDIT') }}</button>
      <button ref="removeBtn" type="button" :class="btnS" :disabled="!selected.length || locked" data-testid="se-memo-list-remove" @click="askRemove">{{ selected.length ? t('SEW_SNAP_MEMO_LIST_REMOVE_N', { n: selected.length }) : t('SEW_SNAP_MEMO_LIST_REMOVE') }}</button>
      <button type="button" :class="btnP" :disabled="!one || locked" data-testid="se-memo-list-go" @click="go()">{{ t('SEW_SNAP_MEMO_LIST_GO') }}</button>
    </template>
  </ModalShell>
  <MemoDialog :model-value="!!editing" :entry="editing" mode="edit" :me="me" @update:model-value="(v) => { if (!v) editing = null }" @gone="notice = { text: t('SEW_ERR_MEMO_GONE'), warn: true }" />
</template>
