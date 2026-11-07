<script setup>
// 대기(목업 actionBody Wait): 초. 60초 이상이면 분으로도 보인다.
import { computed } from 'vue'
import { numIn, numOut } from '../../../editor/panel'
import { t } from '../../../messages'
import FieldError from '../FieldError.vue'
import '../panel.css'

defineOptions({ name: 'WaitAction' })
const props = defineProps({ action: { type: Object, required: true }, errs: { type: Object, default: () => ({}) } })
const emit = defineEmits(['update'])
const minutes = computed(() => {
  const s = props.action.waitSec
  if (typeof s !== 'number' || s < 60) return ''
  const m = Math.floor(s / 60)
  return s % 60 ? t('SEW_PANEL_WAIT_MIN', { m, s: s % 60 }) : t('SEW_PANEL_WAIT_MIN_ONLY', { m })
})
</script>

<template>
  <div>
    <div class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
      <input class="se-inp se-inp-n" :class="{ 'se-inp-bad': errs.wait?.level === 'error' }" inputmode="numeric" data-field="wait" :value="numOut(action.waitSec)" :aria-label="t('SEW_PANEL_WAIT_SEC')"
        @change="emit('update', { ...action, waitSec: numIn($event.target.value) })">{{ t('SEW_PANEL_WAIT_UNIT') }} <span v-if="minutes">{{ minutes }}</span>
    </div>
    <FieldError :errs="errs" field="wait" />
  </div>
</template>
