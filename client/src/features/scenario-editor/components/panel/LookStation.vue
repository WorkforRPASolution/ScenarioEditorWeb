<script setup>
// 레일 첫 구역 — 보는 곳(목업 lookStation, 조작판 1): 기준 화면·검색(OCR) 영역 그림과 좌표. 조건 없음·설비 상태는 없다.
// [잡기]/[다시 잡기] = 큰 화면에서 영역부터 끌어 잡기(마우스 클릭이면 그림·누를 곳까지). 영역 그림을 누르면 큰 화면을 영역에 맞추고,
// 기준 화면 그림을 누르면 전체를 보인다(목업 focusArea·viewAll). 새 스텝은 기준 화면 그림이 큰 화면에 이미 있어 따로 보이지 않는다.
import { computed } from 'vue'
import { useEditStore } from '../../stores/editStore'
import { captureFlow } from '../../editor/capture'
import { t } from '../../messages'
import CropView from '../CropView.vue'
import FieldError from './FieldError.vue'
import './panel.css'

defineOptions({ name: 'LookStation' })
const props = defineProps({
  draft: { type: Object, required: true },
  errs: { type: Object, default: () => ({}) },
  changed: { type: Array, default: () => [] },
  baseSrc: { type: String, default: null },
  isNew: { type: Boolean, default: false }
})
const edit = useEditStore()
const grab = () => edit.startCapture(captureFlow(props.draft, 'look'))
const ocr = computed(() => props.draft.condition?.kind === 'ocr')
const area = computed(() => {
  const a = props.draft.condition?.searchArea
  return a && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(a[k])) && a.w > 0 && a.h > 0 ? a : null
})
const name = computed(() => t(ocr.value ? 'SEW_PANEL_OCR_AREA' : 'SEW_PANEL_AREA'))
const pic = 'text-[11px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap'
</script>

<template>
  <div class="se-st" :class="ocr ? 'se-st-ocr' : 'se-st-area'" data-station="look">
    <div class="flex items-center gap-2 mb-1.5 min-h-[18px]">
      <span class="text-xs font-semibold text-gray-700 dark:text-gray-200 outline-none" tabindex="-1" data-field="area">{{ t('SEW_PANEL_LOOK') }}</span>
      <button type="button" class="ml-auto text-xs font-medium text-primary-700 dark:text-primary-300 hover:underline" data-testid="se-cap-look" @click="grab">{{ area ? t('SEW_CAP_REGRAB') : t('SEW_CAP_GRAB') }}</button>
    </div>
    <div class="flex gap-2 items-start">
      <button v-if="baseSrc && !ocr && !isNew" type="button" class="text-left" data-testid="se-look-base" :title="t('SEW_CAP_VIEW_ALL')" @click="edit.requestView('all')">
        <div :class="pic">{{ t('SEW_PANEL_BASE') }}</div><CropView :src="baseSrc" :width="92" />
      </button>
      <button v-if="baseSrc && area" type="button" class="text-left" :class="changed.includes('area') ? 'ring-2 ring-primary-300 rounded' : ''" data-testid="se-look-area" :title="t('SEW_CAP_FOCUS_AREA')" @click="edit.requestView('area')">
        <div :class="pic">{{ name }}</div><CropView :src="baseSrc" :rect="area" :width="ocr ? 200 : 112" />
      </button>
      <div v-else-if="!area">
        <div :class="pic">{{ name }}</div>
        <div class="w-[92px] h-[58px] border-2 border-dashed border-gray-300 dark:border-dark-border rounded flex items-center justify-center text-[11px] text-gray-400 text-center p-0.5">{{ t('SEW_PANEL_AREA_EMPTY') }}</div>
      </div>
    </div>
    <div v-if="draft.condition?.searchArea" class="mt-1.5 flex gap-2.5 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
      <span>X<b class="ml-0.5 font-medium text-gray-700 dark:text-gray-200">{{ draft.condition.searchArea.x }}</b></span>
      <span>Y<b class="ml-0.5 font-medium text-gray-700 dark:text-gray-200">{{ draft.condition.searchArea.y }}</b></span>
      <span>W<b class="ml-0.5 font-medium text-gray-700 dark:text-gray-200">{{ draft.condition.searchArea.w }}</b></span>
      <span>H<b class="ml-0.5 font-medium text-gray-700 dark:text-gray-200">{{ draft.condition.searchArea.h }}</b></span>
    </div>
    <FieldError :errs="errs" field="area" />
  </div>
</template>
