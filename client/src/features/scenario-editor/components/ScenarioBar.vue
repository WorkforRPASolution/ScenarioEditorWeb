<script setup>
import { ref, computed } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { t, LABELS } from '../messages'
import { formatCrtime, scenarioTypeLabel, enabledLabel } from '../format'
import PropertyDialog from './PropertyDialog.vue'
import DataCheckDialog from './DataCheckDialog.vue'

defineOptions({ name: 'ScenarioBar' })
defineEmits(['load'])
const store = useEditorStore()
const showProperty = ref(false)
const showDataCheck = ref(false)
const sk = computed(() => store.skeleton)
const tw = computed(() => sk.value?.header.targetWindow)
const twText = computed(() => {
  const w = tw.value
  if (!w) return ''
  if (w.agentFinds) return t('SEW_UI_TW_FINDS', { text: w.raw.Text, mode: LABELS.matchMode[w.matchMode], cls: w.raw.ClassName })
  return t('SEW_UI_TW_NOT_FINDS', { reason: t(`SEW_UI_TW_REASON_${w.reasonCode}`) })
})
const badge = 'px-2 py-0.5 rounded text-xs font-medium'
const btn = 'h-8 px-3 rounded-lg text-sm'
</script>

<template>
  <div class="bg-white dark:bg-dark-card rounded-lg border border-gray-200 dark:border-dark-border px-3 py-2 flex items-center gap-3 flex-wrap" data-testid="se-bar">
    <button :class="btn" class="bg-primary-500 hover:bg-primary-600 text-white font-medium" data-testid="se-load" @click="$emit('load')">{{ t('SEW_UI_LOAD') }}</button>
    <template v-if="sk">
      <div class="min-w-0">
        <div class="font-mono text-sm text-gray-900 dark:text-white truncate" data-testid="se-bar-id">{{ sk.id }}</div>
        <div class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ sk.header.description }} · 제한 {{ sk.header.timeoutLimit }}분</div>
      </div>
      <div class="flex items-center gap-1.5 flex-wrap text-xs">
        <span :class="badge" class="bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-400" data-testid="se-bar-version">
          {{ sk.version.isCurrent ? t('SEW_UI_CURRENT_VERSION') : t('SEW_UI_OLD_VERSION') }} · {{ formatCrtime(sk.version.crtime) }}</span>
        <template v-if="sk.property">
          <span :class="[badge, sk.property.IsEnabled ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400']">
            {{ enabledLabel(sk.property.IsEnabled) }}</span>
          <span :class="badge" class="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">{{ scenarioTypeLabel(sk.property.Type) }}</span>
        </template>
        <span v-if="sk.performance" :class="badge" class="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">등급 {{ sk.performance.gradeName }}</span>
      </div>
      <div class="text-xs text-gray-600 dark:text-gray-300 min-w-0" data-testid="se-bar-target-window">
        <div class="truncate">{{ twText }}</div>
        <div v-if="tw && tw.agentFinds !== tw.inHouseShowsSet" class="text-amber-600 dark:text-amber-400 truncate">{{ t('SEW_NOTE_TARGET_WINDOW_DIFFERS') }}</div>
      </div>
    </template>
    <div class="ml-auto flex items-center gap-1.5">
      <button v-if="sk && store.warningCount + store.infoCount" :class="btn" class="bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" data-testid="se-notes" @click="store.nextNoted()">
        경고 {{ store.warningCount }} · 알림 {{ store.infoCount }}</button>
      <!-- 데이터 점검은 열린 시나리오와 상관없는 내 권한 범위의 점검이라 늘 보인다(0 이면 숨김) -->
      <button v-if="store.dataCheckCount" :class="btn" class="bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" data-testid="se-data-check" @click="showDataCheck = true">
        {{ t('SEW_UI_DATA_CHECK') }} ⚠{{ store.dataCheckCount }}</button>
      <button v-if="sk" :class="btn" class="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300" data-testid="se-property" @click="showProperty = true">{{ t('SEW_UI_PROPERTY_ALL') }}</button>
    </div>
    <PropertyDialog v-model="showProperty" />
    <DataCheckDialog v-model="showDataCheck" />
  </div>
</template>
