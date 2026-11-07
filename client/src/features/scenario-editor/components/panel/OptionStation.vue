<script setup>
// 레일 아래 선택(목업 optStation): 전처리 스킵, 자세히(사내 화면에 안 보이던 값·원본 JSON — 대화 상자 설명·보이기는 사내 편집기도 고치지 않아 보기만).
import { computed } from 'vue'
import { useEditStore } from '../../stores/editStore'
import { stepExtraRows } from '../../format'
import { t } from '../../messages'

defineOptions({ name: 'OptionStation' })
const props = defineProps({
  draft: { type: Object, required: true },
  shownStep: { type: Object, default: null }, // 표시 스텝(뼈대 모양) — 손대지 않은 스텝이면 저장된 raw 가 있다
  changed: { type: Array, default: () => [] }
})
const edit = useEditStore()
const skip = computed(() => props.draft.condition?.skipPreprocessing)
const canSkip = computed(() => props.draft.condition?.kind !== 'eqpState' && typeof skip.value === 'boolean')
const rows = computed(() => stepExtraRows({ ...(props.shownStep ?? {}), descriptionToDialog: props.draft.descriptionToDialog, isShowDialog: props.draft.isShowDialog }))
const setSkip = (v) => edit.updateDraft((d) => ({ ...d, condition: { ...d.condition, skipPreprocessing: v } }))
</script>

<template>
  <div class="mt-3 pt-2.5 border-t border-gray-200 dark:border-dark-border text-xs" data-station="option">
    <label v-if="canSkip" class="flex gap-1.5 items-start text-gray-700 dark:text-gray-200" :class="changed.includes('skip') ? 'font-semibold' : ''">
      <input type="checkbox" class="mt-0.5" data-testid="se-panel-skip" :checked="skip" @change="setSkip($event.target.checked)">
      <span>{{ t('SEW_PANEL_SKIP') }}<small class="block font-normal text-gray-500 dark:text-gray-400">{{ t('SEW_PANEL_SKIP_HELP') }}</small></span>
    </label>
    <details class="mt-2.5">
      <summary class="cursor-pointer text-primary-700 dark:text-primary-300">{{ t('SEW_PANEL_MORE') }}</summary>
      <dl class="grid grid-cols-[150px_1fr] gap-y-0.5 mt-1.5">
        <template v-for="[k, v] in rows" :key="k"><dt class="text-gray-500 dark:text-gray-400">{{ k }}</dt><dd class="font-mono break-all">{{ v }}</dd></template>
      </dl>
      <p class="mt-1 text-gray-500 dark:text-gray-400">{{ t('SEW_PANEL_MORE_HELP') }}</p>
      <pre v-if="shownStep?.raw" class="mt-1.5 p-2 rounded bg-gray-50 dark:bg-dark-bg text-[11px] leading-4 overflow-auto text-gray-700 dark:text-gray-300">{{ JSON.stringify(shownStep.raw, null, 2) }}</pre>
    </details>
  </div>
</template>
