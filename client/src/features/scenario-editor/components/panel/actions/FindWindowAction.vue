<script setup>
// 창 찾기(목업 actionBody FindWindow): 창 이름·클래스·옮길 위치 X·Y(둘 다 넣거나 둘 다 비움).
import { numIn, numOut } from '../../../editor/panel'
import { t } from '../../../messages'
import FieldError from '../FieldError.vue'
import '../panel.css'

defineOptions({ name: 'FindWindowAction' })
const props = defineProps({ action: { type: Object, required: true }, errs: { type: Object, default: () => ({}) } })
const emit = defineEmits(['update'])
const fw = () => props.action.findWindow ?? { title: '', className: '', x: null, y: null }
const put = (v) => emit('update', { ...props.action, findWindow: { ...fw(), ...v } })
</script>

<template>
  <div>
    <div class="flex gap-1.5">
      <input class="se-inp" :class="{ 'se-inp-bad': errs.fw?.level === 'error' && !action.findWindow?.title }" data-field="fw" :value="action.findWindow?.title ?? ''" :placeholder="t('SEW_PANEL_FW_TITLE')" :aria-label="t('SEW_PANEL_FW_TITLE')" @input="put({ title: $event.target.value })">
      <input class="se-inp font-mono" :class="{ 'se-inp-bad': errs.fw?.level === 'error' && !action.findWindow?.className }" data-testid="se-fw-class" :value="action.findWindow?.className ?? ''" :placeholder="t('SEW_PANEL_FW_CLASS')" :aria-label="t('SEW_PANEL_FW_CLASS')" @input="put({ className: $event.target.value })">
    </div>
    <div class="mt-1.5 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
      {{ t('SEW_PANEL_FW_MOVE') }} X <input class="se-inp se-inp-n" inputmode="numeric" data-testid="se-fw-x" :value="numOut(action.findWindow?.x)" placeholder="200" :aria-label="t('SEW_PANEL_FW_X')" @change="put({ x: numIn($event.target.value) })">
      Y <input class="se-inp se-inp-n" inputmode="numeric" data-testid="se-fw-y" :value="numOut(action.findWindow?.y)" placeholder="200" :aria-label="t('SEW_PANEL_FW_Y')" @change="put({ y: numIn($event.target.value) })">
    </div>
    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('SEW_PANEL_FW_HELP') }}</p>
    <FieldError :errs="errs" field="fw" />
  </div>
</template>
