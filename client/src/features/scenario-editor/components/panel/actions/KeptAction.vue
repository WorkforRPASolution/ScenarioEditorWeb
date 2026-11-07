<script setup>
// 보존 전용 동작(O.I. Command·FAP·ACS·에이전트 함수·변수, 설계 §4.3): 원래 값을 보이고 고치지 못한다.
import { t } from '../../../messages'

defineOptions({ name: 'KeptAction' })
defineProps({ action: { type: Object, required: true } })
</script>

<template>
  <div>
    <dl class="grid grid-cols-[60px_1fr] gap-x-2 text-xs">
      <dt class="text-gray-500 dark:text-gray-400">{{ t('SEW_PANEL_LOCKED_VALUE') }}</dt>
      <dd class="font-mono break-all">{{ action.raw || '—' }}</dd>
    </dl>
    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('SEW_PANEL_LOCKED_HELP') }}</p>
  </div>
</template>
