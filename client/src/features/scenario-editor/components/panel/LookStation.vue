<script setup>
// 레일 첫 구역 — 보는 곳(목업 lookStation, 조작판 1): 기준 화면·검색(OCR) 영역 그림과 좌표. 조건 없음·설비 상태는 없다.
// 좌표 X·Y·W·H 는 입력 칸이다(2026-11-17 사내 요청 — 숫자로 넣기, 규칙 editor/areaInput.js). 정수는 초안의 영역에 바로 들어가 큰 화면이 따라오고,
// 영역에 넣을 수 없는 글자(소수점·글자·비움)는 영역을 둔 채 따로 쥔다(condition.areaTyped) — 오타 하나로 영역 그림·큰 화면의 사각형이 사라지지 않는다.
// 칸 검사(errs.area)가 걸린 칸(params.keys)을 붉히며 [적용]을 막는다: 빈 칸·정수 아님·폭 높이 1 미만·음수·기준 화면 밖.
// 영역이 없어도(새 스텝) 칸은 보인다 — 네 칸을 치면 영역이 된다. 큰 화면에서 잡는 동안에는 잠근다(잡기가 영역을 쓰고 취소하면 되돌린다).
// [잡기]/[다시 잡기] = 큰 화면에서 영역부터 끌어 잡기(마우스 클릭이면 그림·누를 곳까지). 영역 그림을 누르면 큰 화면을 영역에 맞추고,
// 기준 화면 그림을 누르면 전체를 보인다(목업 focusArea·viewAll). 새 스텝은 기준 화면 그림이 큰 화면에 이미 있어 따로 보이지 않는다.
// 기준 화면 그림이 없으면(저장되지 않은 옛 스텝) 잡을 화면이 없으므로 [잡기]를 끄고 이유를 보인다(editStore.canCapture).
import { computed } from 'vue'
import { useEditStore } from '../../stores/editStore'
import { captureFlow } from '../../editor/capture'
import { AREA_KEYS, typeArea, areaText } from '../../editor/areaInput'
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
  baseOther: { type: Boolean, default: false }, // 기준 화면이 다른 시나리오 판의 그림(붙여 온 스텝)
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
// 숫자 칸: 쥔 글자가 있으면 그 글자, 없으면 영역의 값. 걸린 칸 = 칸 오류의 params.keys, 없으면(영역 없음) 네 칸 모두.
const areaErr = computed(() => (props.errs.area?.level === 'error' ? props.errs.area : null))
const badKeys = computed(() => (areaErr.value ? areaErr.value.params?.keys ?? AREA_KEYS : []))
const locked = computed(() => !!edit.capture)
const setField = (k, text) => {
  if (typeArea(props.draft.condition, k, text) !== props.draft.condition) edit.updateDraft((d) => ({ ...d, condition: typeArea(d.condition, k, text) }))
}
// [적용]이 막혀 초점을 받을 칸: 걸린 첫 칸, 없으면 X
const focusKey = computed(() => badKeys.value[0] ?? 'x')
const failText = computed(() => (props.baseOther ? t('SEW_EDIT_IMAGE_SOURCE_GONE') : null))
const pic = 'text-[11px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap'
</script>

<template>
  <div class="se-st" :class="ocr ? 'se-st-ocr' : 'se-st-area'" data-station="look">
    <div class="flex items-center gap-2 mb-1.5 min-h-[18px]">
      <span class="text-xs font-semibold text-gray-700 dark:text-gray-200">{{ t('SEW_PANEL_LOOK') }}</span>
      <button type="button" class="ml-auto text-xs font-medium text-primary-700 dark:text-primary-300 hover:enabled:underline disabled:text-gray-400 disabled:opacity-60" data-testid="se-cap-look"
        :disabled="!edit.canCapture" :title="edit.canCapture ? undefined : t('SEW_CAP_NO_BASE_IMAGE')" @click="grab">{{ area ? t('SEW_CAP_REGRAB') : t('SEW_CAP_GRAB') }}</button>
    </div>
    <p v-if="!edit.canCapture" class="mb-1.5 text-xs leading-snug text-gray-500 dark:text-gray-400" data-testid="se-cap-look-why">{{ t('SEW_CAP_NO_BASE_IMAGE') }}</p>
    <div class="flex gap-2 items-start">
      <button v-if="baseSrc && !ocr && !isNew" type="button" class="text-left" data-testid="se-look-base" :title="t('SEW_CAP_VIEW_ALL')" @click="edit.requestView('all')">
        <div :class="pic">{{ t('SEW_PANEL_BASE') }}</div><CropView :src="baseSrc" :width="92" :fail-text="failText" />
      </button>
      <button v-if="baseSrc && area" type="button" class="text-left" :class="changed.includes('area') ? 'ring-2 ring-primary-300 rounded' : ''" data-testid="se-look-area" :title="t('SEW_CAP_FOCUS_AREA')" @click="edit.requestView('area')">
        <div :class="pic">{{ name }}</div><CropView :src="baseSrc" :rect="area" :width="ocr ? 200 : 112" :fail-text="failText" />
      </button>
      <div v-else-if="!area">
        <div :class="pic">{{ name }}</div>
        <div class="w-[92px] h-[58px] border-2 border-dashed border-gray-300 dark:border-dark-border rounded flex items-center justify-center text-[11px] text-gray-400 text-center p-0.5">{{ t('SEW_PANEL_AREA_EMPTY') }}</div>
      </div>
    </div>
    <div class="mt-1.5 flex items-center gap-x-2 gap-y-1 flex-wrap text-xs text-gray-500 dark:text-gray-400 tabular-nums" data-testid="se-area-inputs">
      <label v-for="k in AREA_KEYS" :key="k" class="inline-flex items-center gap-0.5">
        <span>{{ k.toUpperCase() }}</span>
        <input class="se-inp se-inp-n" :class="{ 'se-inp-bad': badKeys.includes(k), 'se-inp-ch': !badKeys.includes(k) && changed.includes('area') }" inputmode="numeric" autocomplete="off"
          :data-area="k" :data-field="k === focusKey ? 'area' : undefined" :value="areaText(draft.condition, k)" :disabled="locked" :title="locked ? t('SEW_PANEL_AREA_LOCKED') : undefined"
          :aria-label="t(`SEW_PANEL_AREA_${k.toUpperCase()}`, { name })" :aria-invalid="badKeys.includes(k) ? 'true' : undefined" @change="setField(k, $event.target.value)">
      </label>
      <span v-if="edit.screenSize" class="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap" data-testid="se-area-screen">{{ t('SEW_PANEL_AREA_SCREEN', edit.screenSize) }}</span>
    </div>
    <FieldError :errs="errs" field="area" />
  </div>
</template>
