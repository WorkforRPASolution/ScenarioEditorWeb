<script setup>
// 명령 실행(목업 actionBody RunCommand): 한 줄. 빈 값은 실행 때 실패하므로 칸 검사가 막는다.
import { t } from '../../../messages'
import FieldError from '../FieldError.vue'
import '../panel.css'

defineOptions({ name: 'CommandAction' })
defineProps({ action: { type: Object, required: true }, errs: { type: Object, default: () => ({}) } })
const emit = defineEmits(['update'])
</script>

<template>
  <div>
    <input class="se-inp font-mono" :class="{ 'se-inp-bad': errs.cmd?.level === 'error' }" data-field="cmd" :value="action.command ?? ''" :placeholder="t('SEW_PANEL_CMD')" :aria-label="t('SEW_PANEL_CMD')"
      @input="emit('update', { ...action, command: $event.target.value })">
    <FieldError :errs="errs" field="cmd" />
  </div>
</template>
