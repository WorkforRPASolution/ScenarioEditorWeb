<script setup>
// 레일 셋째 구역 — 찾으면(맞으면) 하는 일(목업 actionStation·actionBody, 조작판 1·8·9·10·17).
// 동작 종류 바꾸기(사내 콤보 11개) + 동작별 입력. 이미지가 아니면 마우스 클릭 셋은 고를 수 없고 이유를 보인다(옛 값은 그대로 두고 안내만).
// 보존 전용 동작은 원래 값을 보이고 고치지 못한다(목록에도 없다 — 다른 동작을 고르면 바뀐다).
import { ref, computed, watch } from 'vue'
import { useEditStore } from '../../stores/editStore'
import { ACTION_ORDER, CLICK_TYPES, PRESERVE_ONLY, newAction, actionBlocked, actionName } from '../../editor/panel'
import { typeNameOf } from '../../editor/display'
import { t, LABELS } from '../../messages'
import FieldError from './FieldError.vue'
import ClickAction from './actions/ClickAction.vue'
import WheelAction from './actions/WheelAction.vue'
import KeyboardAction from './actions/KeyboardAction.vue'
import WaitAction from './actions/WaitAction.vue'
import FindWindowAction from './actions/FindWindowAction.vue'
import CommandAction from './actions/CommandAction.vue'
import CustomScriptAction from './actions/CustomScriptAction.vue'
import KeptAction from './actions/KeptAction.vue'
import './panel.css'

defineOptions({ name: 'ActionStation' })
const props = defineProps({
  draft: { type: Object, required: true },
  errs: { type: Object, default: () => ({}) },
  changed: { type: Array, default: () => [] },
  clickOutside: { type: Boolean, default: false }
})
const edit = useEditStore()
const open = ref(false)
watch(() => props.draft.uid, () => { open.value = false })

const kind = computed(() => props.draft.condition?.kind)
const action = computed(() => props.draft.action ?? {})
const type = computed(() => action.value.type)
const kept = computed(() => PRESERVE_ONLY.has(type.value) || typeNameOf(type.value) === null)
const title = computed(() => t(kind.value === 'none' ? 'SEW_PANEL_DO_NONE' : kind.value === 'image' ? 'SEW_PANEL_DO_IMAGE' : 'SEW_PANEL_DO_MATCH'))
const tiles = computed(() => ACTION_ORDER.map((tp) => {
  const why = actionBlocked(tp, props.draft.condition)
  return { type: tp, label: LABELS.action[typeNameOf(tp)], why: why ? t(why) : null }
}))
const clickWhy = computed(() => (kind.value !== 'image' ? t(actionBlocked(1, props.draft.condition)) : null))
const BODY = { 4: WheelAction, 5: KeyboardAction, 6: WaitAction, 9: FindWindowAction, 11: CommandAction, 12: CustomScriptAction }

function pick(tp) {
  edit.updateDraft((d) => ({ ...d, action: newAction(tp, d, edit.panel.base) }))
  open.value = false
}
const update = (a) => edit.updateDraft((d) => ({ ...d, action: a }))
</script>

<template>
  <div class="se-st se-st-wire" data-station="action">
    <div class="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1.5 min-h-[18px]">{{ title }}</div>
    <button type="button" data-testid="se-panel-act-now" data-field="action" :aria-expanded="open ? 'true' : 'false'"
      class="w-full flex items-center gap-2 h-[34px] px-2.5 border rounded-lg bg-white dark:bg-dark-card text-left text-sm font-medium text-gray-800 dark:text-gray-100 hover:border-primary-500"
      :class="errs.action?.level === 'error' ? 'border-red-500' : changed.includes('action') ? 'se-inp-ch border-primary-500' : 'border-gray-300 dark:border-dark-border'"
      @click="open = !open">
      <span class="flex-1 min-w-0 truncate">{{ actionName(action) }}</span>
      <small class="font-normal text-xs text-primary-700 dark:text-primary-300">{{ open ? t('SEW_PANEL_ACT_CLOSE') : t('SEW_PANEL_ACT_CHANGE') }}</small>
    </button>
    <div v-if="open" role="group" :aria-label="t('SEW_PANEL_ACT_PICK')" class="mt-1.5 grid grid-cols-3 gap-1 p-1.5 border border-gray-200 dark:border-dark-border rounded-lg bg-gray-50 dark:bg-dark-bg">
      <button v-for="tl in tiles" :key="tl.type" type="button" :data-act="tl.type" :aria-pressed="tl.type === type ? 'true' : 'false'" :disabled="!!tl.why" :title="tl.why ?? undefined"
        class="h-10 px-0.5 rounded-md border border-transparent text-[11px] text-gray-700 dark:text-gray-200 disabled:opacity-45 disabled:text-gray-400 hover:enabled:bg-white dark:hover:enabled:bg-dark-card hover:enabled:border-gray-300"
        :class="tl.type === type ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-800 dark:text-primary-200 font-semibold' : ''"
        @click="pick(tl.type)">{{ tl.label }}</button>
      <div v-if="clickWhy" class="col-span-3 px-1 pt-0.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400" data-testid="se-panel-act-why">{{ clickWhy }}</div>
    </div>
    <FieldError :errs="errs" field="action" />
    <div class="mt-2" data-testid="se-panel-act-body">
      <KeptAction v-if="kept" :action="action" />
      <ClickAction v-else-if="CLICK_TYPES.includes(type)" :action="action" :errs="errs" :kind="kind" :outside="clickOutside" @update="update" />
      <component :is="BODY[type]" v-else-if="BODY[type]" :action="action" :errs="errs" @update="update" />
      <p v-else-if="type === 10" class="text-xs leading-snug text-gray-500 dark:text-gray-400">{{ t('SEW_PANEL_SEND_EMAIL_HELP') }}</p>
      <p v-else-if="type === 0 && kind === 'none'" class="text-xs text-amber-700 dark:text-amber-300">{{ t('SEW_PANEL_NONE_ACTION_NONE') }}</p>
      <p v-else-if="type === 0" class="text-xs text-gray-500 dark:text-gray-400">{{ t('SEW_PANEL_NONE_ACTION') }}</p>
    </div>
  </div>
</template>
