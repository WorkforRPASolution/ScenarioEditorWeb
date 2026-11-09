<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { t } from '../messages'

// canCreate = 쓰기 권한이 있어 빈 화면에서 [새 시나리오]도 보인다(P2-D Task 6)
const props = defineProps({ kind: { type: String, required: true }, message: { type: String, default: '' }, startedAt: { type: Number, default: 0 }, canCreate: { type: Boolean, default: false } })
defineEmits(['retry', 'load', 'new'])
const now = ref(Date.now())
let timer = null
onMounted(() => { if (props.kind === 'opening') timer = setInterval(() => { now.value = Date.now() }, 500) })
onUnmounted(() => clearInterval(timer))
const elapsed = computed(() => Math.max(0, Math.floor((now.value - props.startedAt) / 1000)))
</script>

<template>
  <div class="h-full flex items-center justify-center p-6 text-center">
    <div v-if="kind === 'empty' && canCreate" data-testid="se-empty" class="text-gray-500 dark:text-gray-400">
      <p class="text-lg mb-3">{{ t('SEW_UI_EMPTY_NEW') }}</p>
      <div class="flex justify-center gap-2">
        <button class="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-medium rounded-lg transition text-sm" @click="$emit('load')">{{ t('SEW_UI_LOAD') }}</button>
        <button class="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-lg transition text-sm" data-testid="se-empty-new" @click="$emit('new')">{{ t('SEW_NEW_OPEN') }}</button>
      </div>
    </div>
    <div v-else-if="kind === 'empty'" data-testid="se-empty" class="text-gray-400 dark:text-gray-500">
      <p class="text-lg mb-3">{{ t('SEW_UI_EMPTY') }}</p>
      <button class="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-lg transition text-sm" @click="$emit('load')">{{ t('SEW_UI_LOAD') }}</button>
    </div>
    <div v-else-if="kind === 'opening'" data-testid="se-opening" class="text-gray-600 dark:text-gray-300">
      <svg class="w-8 h-8 mx-auto mb-3 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
      <p>{{ t('SEW_UI_OPENING') }} · {{ t('SEW_UI_OPENING_ELAPSED', { s: elapsed }) }}</p>
      <p v-if="elapsed >= 5" class="text-sm text-gray-500 mt-1">{{ t('SEW_UI_OPENING_SLOW') }}</p>
    </div>
    <div v-else-if="kind === 'error'" data-testid="se-open-error" class="text-gray-700 dark:text-gray-200 max-w-lg">
      <p class="mb-3">{{ message }}</p>
      <button class="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm" @click="$emit('retry')">{{ t('SEW_UI_RETRY') }}</button>
    </div>
    <div v-else-if="kind === 'unregistered'" data-testid="se-unregistered" class="max-w-lg text-gray-700 dark:text-gray-200">
      <p class="text-lg font-semibold mb-2">{{ t('SEW_UI_TITLE') }}</p>
      <p>{{ message }}</p>
    </div>
  </div>
</template>
