<script setup>
// 칸 옆 검사 이유(서버 code 이름 → RULE_<code> 문구, 미해결 갈 곳은 원래 번호와 함께 — messages.fieldMessage). 안내(notice)는 패널 위 안내 줄이 보이므로 여기서는 오류만.
import { computed } from 'vue'
import { fieldMessage } from '../../messages'

defineOptions({ name: 'FieldError' })
const props = defineProps({ errs: { type: Object, default: () => ({}) }, field: { type: String, required: true } })
const e = computed(() => (props.errs?.[props.field]?.level === 'error' ? props.errs[props.field] : null))
</script>

<template>
  <p v-if="e" class="mt-0.5 text-xs leading-snug text-red-700 dark:text-red-300" :data-err="field" role="alert">{{ fieldMessage(e) }}</p>
</template>
