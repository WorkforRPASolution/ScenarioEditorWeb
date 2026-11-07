<script setup>
// 레일 넷째 구역 — 갈 곳(목업 flowStation·targetBtn, 조작판 1·2): 성공·실패 갈 곳(TargetPicker), 실패 전에 다시 보는 간격·횟수.
import { ref, computed } from 'vue'
import { useEditStore } from '../../stores/editStore'
import { CAN_FAIL, numIn, numOut } from '../../editor/panel'
import { targetLabel, targetKind } from '../../format'
import { t } from '../../messages'
import TargetPicker from '../TargetPicker.vue'
import FieldError from './FieldError.vue'
import '../../pills.css'
import './panel.css'

defineOptions({ name: 'FlowStation' })
const props = defineProps({
  draft: { type: Object, required: true },
  errs: { type: Object, default: () => ({}) },
  changed: { type: Array, default: () => [] },
  isNew: { type: Boolean, default: false }
})
const edit = useEditStore()
const steps = computed(() => edit.session?.working?.steps ?? [])
const idx = computed(() => (props.isNew ? -1 : steps.value.findIndex((s) => s.uid === props.draft.uid)))
const kind = computed(() => props.draft.condition?.kind)
const type = computed(() => props.draft.action?.type)
const okLabel = computed(() => t(kind.value === 'none' ? 'SEW_PANEL_OK_NONE' : kind.value === 'image' ? 'SEW_PANEL_OK_IMAGE' : 'SEW_PANEL_OK_MATCH'))
const failLabel = computed(() => t(kind.value === 'none' ? 'SEW_PANEL_FAIL_NONE' : kind.value === 'image' ? 'SEW_PANEL_FAIL_IMAGE' : 'SEW_PANEL_FAIL_MATCH'))
const END_INFO = { SUCCESS: 'SEW_EDIT_PICK_SUCCESS', FAIL: 'SEW_EDIT_PICK_FAIL', SKIP: 'SEW_EDIT_PICK_SKIP' }

// 표시용 대상(번호 = 작업본 위치). 없는 스텝은 미해결로 보인다.
function shown(tg) {
  if (tg?.kind !== 'step') return tg
  const n = steps.value.findIndex((s) => s.uid === tg.uid) + 1
  return n > 0 ? { kind: 'step', uid: tg.uid, no: n } : { kind: 'unresolved' }
}
function desc(key) {
  const tg = props.draft.next?.[key]
  if (!tg) return ''
  if (tg.kind === 'end') return t(END_INFO[tg.value] ?? 'SEW_PANEL_NONE')
  if (tg.kind === 'next') {
    if (key === 'onFalse' && kind.value === 'none' && CAN_FAIL.has(type.value)) return t('SEW_PANEL_TARGET_NO_RESULT')
    const nx = idx.value >= 0 ? steps.value[idx.value + 1] : null
    if (nx) return t('SEW_PANEL_TARGET_NEXT_NOW', { no: idx.value + 2, desc: nx.descriptionToEmail ?? '' })
    return t(props.isNew ? 'SEW_EDIT_PICK_NEXT' : 'SEW_PANEL_TARGET_NEXT_NONE')
  }
  if (tg.kind === 'unresolved') return tg.value === undefined || tg.value === null ? t('SEW_PANEL_TARGET_PICK') : t('SEW_PANEL_TARGET_UNRESOLVED', { value: tg.value })
  if (tg.kind === 'step') return steps.value.find((s) => s.uid === tg.uid)?.descriptionToEmail ?? t('SEW_PANEL_TARGET_PICK')
  return ''
}

// 고르기 창: 작업본 스텝에서 이 스텝만 초안으로 바꿔 넘긴다(실패 쪽 NEXT 경고가 고치는 중인 동작을 따른다).
const picker = ref(null)
const pickerSteps = computed(() => steps.value.map((s) => (s.uid === props.draft.uid ? props.draft : s)))
function openPicker(key, e) {
  const r = e.currentTarget.getBoundingClientRect()
  const vw = window.innerWidth || 1280
  const vh = window.innerHeight || 800
  const x = Math.min(Math.max(r.left, 8), Math.max(8, vw - 312))
  const y = r.bottom + 4 + 410 > vh ? Math.max(8, vh - 410) : r.bottom + 4
  picker.value = { key, x, y }
}
function onPick(target) {
  const key = picker.value?.key
  picker.value = null
  if (key) edit.updateDraft((d) => ({ ...d, next: { ...d.next, [key]: target } }))
}

const retry = computed(() => props.draft.retry ?? {})
const secText = computed(() => (typeof retry.value.intervalMs === 'number' ? numOut(retry.value.intervalMs / 1000) : numOut(retry.value.intervalMs)))
function setSec(text) {
  const v = numIn(text)
  edit.updateDraft((d) => ({ ...d, retry: { ...d.retry, intervalMs: typeof v === 'number' ? Math.round(v * 1000) : v } }))
}
const setLimit = (text) => edit.updateDraft((d) => ({ ...d, retry: { ...d.retry, limit: numIn(text) } }))
const retryCls = computed(() => (props.errs.retry?.level === 'error' ? 'se-inp-bad' : props.changed.includes('retry') ? 'se-inp-ch' : ''))
const targetCls = (key) => (props.errs[key]?.level === 'error' ? 'border-red-500 ring-2 ring-red-100 dark:ring-red-900/40' : props.changed.includes(key) ? 'se-inp-ch' : 'border-gray-300 dark:border-dark-border')
const lab = 'w-[52px] shrink-0 text-xs font-semibold'
const btn = 'flex-1 min-w-0 h-7 flex items-center gap-1.5 px-2 border rounded-md bg-white dark:bg-dark-card text-left text-xs hover:border-primary-500'
</script>

<template>
  <div class="se-st se-st-wire se-st-last" data-station="flow">
    <div class="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1.5 min-h-[18px]">{{ t('SEW_PANEL_FLOW') }}</div>
    <div class="flex flex-col gap-2">
      <div>
        <div class="flex items-center gap-1.5">
          <span :class="lab" class="text-green-700 dark:text-green-300">{{ okLabel }}</span>
          <button type="button" :class="[btn, targetCls('onTrue')]" data-target="onTrue" data-field="onTrue" @click="openPicker('onTrue', $event)">
            <span class="se-pill shrink-0" :class="`se-pill-${targetKind(shown(draft.next?.onTrue))}`">{{ targetLabel(shown(draft.next?.onTrue)) }}</span>
            <span class="flex-1 min-w-0 truncate text-gray-500 dark:text-gray-400">{{ desc('onTrue') }}</span>
          </button>
        </div>
        <div class="ml-[58px]"><FieldError :errs="errs" field="onTrue" /></div>
      </div>
      <div>
        <div class="flex items-center gap-1.5">
          <span :class="lab" class="text-red-700 dark:text-red-300">{{ failLabel }}</span>
          <button type="button" :class="[btn, targetCls('onFalse')]" data-target="onFalse" data-field="onFalse" @click="openPicker('onFalse', $event)">
            <span class="se-pill shrink-0" :class="`se-pill-${targetKind(shown(draft.next?.onFalse))}`">{{ targetLabel(shown(draft.next?.onFalse)) }}</span>
            <span class="flex-1 min-w-0 truncate text-gray-500 dark:text-gray-400">{{ desc('onFalse') }}</span>
          </button>
        </div>
        <div class="ml-[58px]">
          <FieldError :errs="errs" field="onFalse" />
          <div class="mt-1.5 flex items-center gap-1 flex-wrap text-xs text-gray-500 dark:text-gray-400">
            <span>{{ t('SEW_PANEL_RETRY_BEFORE') }}</span>
            <input class="se-inp se-inp-n !w-10" :class="retryCls" inputmode="numeric" data-field="retry" :value="secText" :aria-label="t('SEW_PANEL_RETRY_SEC')" @change="setSec($event.target.value)">{{ t('SEW_PANEL_RETRY_SEC_UNIT') }}
            <input class="se-inp se-inp-n !w-10" :class="retryCls" inputmode="numeric" data-testid="se-retry-n" :value="numOut(retry.limit)" :aria-label="t('SEW_PANEL_RETRY_N')" @change="setLimit($event.target.value)">{{ t('SEW_PANEL_RETRY_N_UNIT') }}
          </div>
          <FieldError :errs="errs" field="retry" />
          <p v-if="kind !== 'none' && type !== 0" class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('SEW_PANEL_FAIL_AFTER_ACTION') }}</p>
        </div>
      </div>
    </div>
    <Teleport to="body">
      <TargetPicker v-if="picker" :steps="pickerSteps" :self-uid="draft.uid" :which="picker.key" :current="draft.next?.[picker.key] ?? null" :is-new="isNew"
        :x="picker.x" :y="picker.y" @pick="onPick" @close="picker = null" />
    </Teleport>
  </div>
</template>
