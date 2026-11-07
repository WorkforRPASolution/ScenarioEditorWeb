<script setup>
// 다음 스텝 고르기(목업 pickerHtml, 조작판 12 next): 끝 값 네 개 · 번호+Enter · 설명으로 찾기 · 자기 자신은 막음.
// steps 는 작업본 스텝(EditedStep). 번호는 위치다. 표 칸과 오른쪽 패널(Task 6)이 함께 쓴다.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { t, LABELS } from '../messages'
import '../pills.css'

defineOptions({ name: 'TargetPicker' })
const props = defineProps({
  steps: { type: Array, required: true },
  selfUid: { type: String, default: null },
  which: { type: String, required: true }, // 'onTrue' | 'onFalse'
  current: { type: Object, default: null },
  isNew: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 }
})
const emit = defineEmits(['pick', 'close'])

// 실패를 돌려줄 수 있는 동작(서버 CAN_FAIL_ACTIONS): O.I. Command·창 찾기·명령 실행·사용자 스크립트·FAP·ACS·에이전트 함수
const CAN_FAIL = new Set([8, 9, 11, 12, 13, 14, 15])
const END_INFO = { SUCCESS: 'SEW_EDIT_PICK_SUCCESS', FAIL: 'SEW_EDIT_PICK_FAIL', SKIP: 'SEW_EDIT_PICK_SKIP' }
const PILL = { NEXT: 'se-pill-next', SUCCESS: 'se-pill-end-success', FAIL: 'se-pill-end-fail', SKIP: 'se-pill-end-skip' }

const root = ref(null)
const input = ref(null)
const q = ref('')
const index = computed(() => (props.isNew ? -1 : props.steps.findIndex((s) => s.uid === props.selfUid)))
const self = computed(() => props.steps[index.value] ?? null)
const isLast = computed(() => index.value >= 0 && index.value === props.steps.length - 1)
const title = computed(() => t(props.which === 'onTrue' ? 'SEW_EDIT_PICK_ON_TRUE' : 'SEW_EDIT_PICK_ON_FALSE'))
const from = computed(() => (index.value < 0 ? t('SEW_EDIT_PICK_FROM_NEW') : t('SEW_EDIT_PICK_FROM', { no: index.value + 1 })))
const warnNext = computed(() => props.which === 'onFalse' && CAN_FAIL.has(self.value?.action?.type))

const ends = computed(() => ['NEXT', 'SUCCESS', 'FAIL', 'SKIP'].map((v) => {
  const cur = props.current
  if (v === 'NEXT') {
    const nx = index.value >= 0 ? props.steps[index.value + 1] : null
    return {
      v, target: { kind: 'next' }, pressed: cur?.kind === 'next', disabled: isLast.value,
      info: isLast.value ? t('SEW_EDIT_PICK_NEXT_LAST') : nx ? t('SEW_EDIT_PICK_NEXT_NOW', { no: index.value + 2 }) : t('SEW_EDIT_PICK_NEXT')
    }
  }
  return { v, target: { kind: 'end', value: v }, pressed: cur?.kind === 'end' && cur.value === v, disabled: false, info: t(END_INFO[v]) }
}))

const items = computed(() => {
  const qs = q.value.trim()
  return props.steps.map((s, k) => ({ s, no: k + 1, self: s.uid === props.selfUid }))
    .filter(({ s, no }) => !qs || String(no) === qs || (s.descriptionToEmail ?? '').includes(qs))
})
const pressedStep = (uid) => props.current?.kind === 'step' && props.current.uid === uid

const pickStep = (it) => { if (!it.self) emit('pick', { kind: 'step', uid: it.s.uid }) }
function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); emit('close'); return }
  if (e.key !== 'Enter') return
  e.preventDefault()
  const n = Number(q.value.trim())
  if (!Number.isInteger(n) || n < 1 || n > props.steps.length) return
  const s = props.steps[n - 1]
  if (s.uid !== props.selfUid) emit('pick', { kind: 'step', uid: s.uid })
}
function onDocDown(e) { if (root.value && !root.value.contains(e.target)) emit('close') }
function onDocKey(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => {
  input.value?.focus()
  document.addEventListener('mousedown', onDocDown, true)
  document.addEventListener('keydown', onDocKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onDocKey)
})
</script>

<template>
  <div ref="root" role="dialog" :aria-label="title" data-testid="se-picker"
    class="fixed z-40 w-[304px] max-h-[404px] flex flex-col bg-white dark:bg-dark-card border border-gray-300 dark:border-dark-border rounded-lg shadow-xl text-gray-800 dark:text-gray-100"
    :style="{ left: `${x}px`, top: `${y}px` }">
    <div class="px-3 pt-2 pb-1.5 text-xs font-semibold">{{ title }}<small class="block font-normal text-gray-500 dark:text-gray-400">{{ from }}</small></div>
    <div class="grid grid-cols-2 gap-1 px-2.5 pb-2">
      <button v-for="e in ends" :key="e.v" type="button" :data-end="e.v" :aria-pressed="e.pressed ? 'true' : 'false'" :disabled="e.disabled"
        class="border rounded-md px-2 py-1 text-left text-[11px] leading-tight text-gray-500 dark:text-gray-400 disabled:opacity-45 hover:enabled:border-primary-500"
        :class="e.pressed ? 'border-primary-500 ring-2 ring-primary-100 dark:ring-primary-900' : 'border-gray-200 dark:border-dark-border'"
        @click="emit('pick', e.target)">
        <span class="se-pill table mb-0.5" :class="PILL[e.v]">{{ e.v }}</span>{{ e.info }}
      </button>
    </div>
    <div v-if="warnNext" class="px-3 pb-2 text-xs leading-snug text-amber-700 dark:text-amber-300" data-testid="se-picker-next-warn">{{ t('SEW_EDIT_PICK_NEXT_WARN') }}</div>
    <div class="px-2.5 pb-1.5">
      <input ref="input" v-model="q" :placeholder="t('SEW_EDIT_PICK_FIND')" :aria-label="t('SEW_EDIT_PICK_FIND_LABEL')"
        class="w-full h-7 px-2 text-xs rounded-md border border-gray-300 dark:border-dark-border bg-white dark:bg-dark-bg focus:outline-none focus:border-primary-500"
        @keydown="onKey" />
    </div>
    <div class="flex-1 min-h-0 overflow-auto border-t border-gray-200 dark:border-dark-border p-1">
      <button v-for="it in items" :key="it.s.uid" type="button" :data-to="it.s.uid" :aria-pressed="pressedStep(it.s.uid) ? 'true' : 'false'" :disabled="it.self"
        :title="it.self ? t('SEW_EDIT_PICK_SELF') : undefined"
        class="w-full flex items-center gap-2 px-1.5 py-1 rounded text-left text-xs disabled:opacity-45 hover:enabled:bg-primary-50 dark:hover:enabled:bg-primary-900/30"
        :class="pressedStep(it.s.uid) ? 'bg-primary-100 dark:bg-primary-900/40' : ''" @click="pickStep(it)">
        <b class="w-5 text-right font-semibold shrink-0 tabular-nums">{{ it.no }}</b>
        <i class="not-italic w-14 shrink-0 text-[11px] text-gray-500 dark:text-gray-400">{{ LABELS.condition[it.s.condition?.kind] ?? it.s.condition?.kind }}</i>
        <span class="flex-1 min-w-0 truncate">{{ it.s.descriptionToEmail }}{{ it.self ? t('SEW_EDIT_PICK_SELF_TAG') : '' }}</span>
      </button>
      <div v-if="!items.length" class="p-2.5 text-xs text-gray-500">{{ t('SEW_EDIT_PICK_EMPTY', { n: steps.length }) }}</div>
    </div>
  </div>
</template>
