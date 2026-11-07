<script setup>
// 휠(목업 actionBody MouseMove): 방향(사내: 위로 = 음수 칸 수)·칸 수·쉬는 초.
import { computed } from 'vue'
import { numIn, numOut } from '../../../editor/panel'
import { t } from '../../../messages'
import FieldError from '../FieldError.vue'
import '../panel.css'

defineOptions({ name: 'WheelAction' })
const props = defineProps({ action: { type: Object, required: true }, errs: { type: Object, default: () => ({}) } })
const emit = defineEmits(['update'])
const wheel = computed(() => props.action.wheel ?? { notches: 3, delaySec: 1 })
const up = computed(() => typeof wheel.value.notches === 'number' && wheel.value.notches < 0)
const count = computed(() => (typeof wheel.value.notches === 'number' ? numOut(Math.abs(wheel.value.notches)) : numOut(wheel.value.notches)))
const put = (w) => emit('update', { ...props.action, wheel: { ...wheel.value, ...w } })
function setDir(toUp) {
  const n = wheel.value.notches
  if (typeof n === 'number' && toUp !== up.value) put({ notches: -n })
}
function setCount(text) {
  const v = numIn(text)
  put({ notches: typeof v === 'number' ? (up.value ? -Math.abs(v) : v) : v })
}
const bad = computed(() => props.errs.wheel?.level === 'error')
</script>

<template>
  <div>
    <div class="flex items-center gap-1.5 flex-wrap text-xs text-gray-500 dark:text-gray-400">
      <div class="se-seg" role="group" :aria-label="t('SEW_PANEL_WHEEL_DIR')">
        <button type="button" data-wheel-dir="up" :aria-pressed="up ? 'true' : 'false'" @click="setDir(true)">{{ t('SEW_PANEL_WHEEL_UP') }}</button>
        <button type="button" data-wheel-dir="down" :aria-pressed="up ? 'false' : 'true'" @click="setDir(false)">{{ t('SEW_PANEL_WHEEL_DOWN') }}</button>
      </div>
      <input class="se-inp se-inp-n !w-11" :class="{ 'se-inp-bad': bad }" inputmode="numeric" data-field="wheel" :value="count" :aria-label="t('SEW_PANEL_WHEEL_COUNT')" @change="setCount($event.target.value)">{{ t('SEW_PANEL_WHEEL_COUNT_UNIT') }}
      <input class="se-inp se-inp-n !w-11" :class="{ 'se-inp-bad': bad }" inputmode="numeric" data-testid="se-wheel-delay" :value="numOut(wheel.delaySec)" :aria-label="t('SEW_PANEL_WHEEL_DELAY')" @change="put({ delaySec: numIn($event.target.value) })">{{ t('SEW_PANEL_WHEEL_DELAY_UNIT') }}
    </div>
    <FieldError :errs="errs" field="wheel" />
  </div>
</template>
