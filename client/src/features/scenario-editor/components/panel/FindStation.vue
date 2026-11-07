<script setup>
// 레일 둘째 구역 — 찾는 것(목업 findStation, 조작판 1·2·8): 이미지 = 찾을 그림·정확도·다중 검사, OCR = 비교 방법·값·다중 검사,
// 설비 상태 = 보기만(새로 만들 수 없는 옛 조건). 조건 종류는 바꾸지 못한다(설계 §4.2).
// 찾을 그림 [잡기]/[다시 잡기] = 큰 화면의 검색 영역 안에서 그림부터 끌어 잡기(마우스 클릭이면 누를 곳까지, 목업 findStation).
import { computed } from 'vue'
import { useEditStore } from '../../stores/editStore'
import { CLICK_TYPES, numIn, numOut } from '../../editor/panel'
import { captureFlow, isRect, isRef } from '../../editor/capture'
import { t, LABELS } from '../../messages'
import CropView from '../CropView.vue'
import FieldError from './FieldError.vue'
import './panel.css'

defineOptions({ name: 'FindStation' })
const props = defineProps({
  draft: { type: Object, required: true },
  errs: { type: Object, default: () => ({}) },
  changed: { type: Array, default: () => [] },
  trainPics: { type: Array, default: () => [] } // [{ key, src }]
})
const emit = defineEmits(['outside'])
const edit = useEditStore()
const OCR_OPS = ['None', 'TextEqual', 'TextNotEqual', 'TextContain', 'TextNotContain', 'NumberEqual', 'NumberNotEqual', 'NumberInRange', 'NumberOutOfRange', 'NumberLessThan', 'NumberGreaterThan']
const c = computed(() => props.draft.condition ?? {})
const kind = computed(() => c.value.kind)
const img = computed(() => c.value.image ?? {})
const ocr = computed(() => c.value.ocr ?? {})
const multi = computed(() => (kind.value === 'image' ? img.value.multi : ocr.value.multi) ?? { count: '1', op: 0 })
const bad = (f) => props.errs[f]?.level === 'error'
const ch = (f) => props.changed.includes(f)

const setCond = (fn) => edit.updateDraft((d) => ({ ...d, condition: fn(d.condition) }))
const setImage = (v) => setCond((cd) => ({ ...cd, image: { ...cd.image, ...v } }))
const setOcr = (v) => setCond((cd) => ({ ...cd, ocr: { ...cd.ocr, ...v } }))
const setMulti = (v) => (kind.value === 'image' ? setImage({ multi: { ...multi.value, ...v } }) : setOcr({ multi: { ...multi.value, ...v } }))

// 정확도: 칸은 숫자 두 자리로 보이고, 끌기는 0.5~1
const acceptText = computed(() => (typeof img.value.accept === 'number' && Number.isFinite(img.value.accept) ? img.value.accept.toFixed(2) : numOut(img.value.accept)))
const acceptRange = computed(() => (typeof img.value.accept === 'number' && img.value.accept >= 0.5 && img.value.accept <= 1 ? img.value.accept : 0.5))
const setAcceptRange = (v) => setImage({ accept: Math.round(Number(v) * 100) / 100 })

const hasClick = computed(() => CLICK_TYPES.includes(props.draft.action?.type) && Number.isInteger(props.draft.action?.click?.x) && Number.isInteger(props.draft.action?.click?.y))
const markerFor = (p) => (hasClick.value && p.key === '0' ? props.draft.action.click : null)

const ocrKind = computed(() => (ocr.value.op >= 1 && ocr.value.op <= 4 ? 'text' : ocr.value.op === 7 || ocr.value.op === 8 ? 'range' : ocr.value.op >= 5 && ocr.value.op <= 10 ? 'number' : null))
const setOp = (v) => { const op = v === '' ? 0 : Number(v); setOcr({ op, opName: OCR_OPS[op] ?? null }) }
const multiLabels = computed(() => [0, 1, 2].map((i) => t(`SEW_PANEL_MULTI_${kind.value === 'image' ? 'IMAGE' : 'OCR'}_${i}`)))
const eqp = computed(() => c.value.eqpState)
const hasArea = computed(() => isRect(c.value.searchArea))
const hasTrain = computed(() => Object.values(props.draft.images?.train ?? {}).some(isRef))
const grab = () => edit.startCapture(captureFlow(props.draft, 'find'))
const pic = 'text-[11px] text-gray-500 dark:text-gray-400 mb-0.5 whitespace-nowrap'
const row = 'flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 flex-wrap'
</script>

<template>
  <div v-if="kind === 'image'" class="se-st se-st-train" data-station="find">
    <div class="flex items-center gap-2 mb-1.5 min-h-[18px]">
      <span class="text-xs font-semibold text-gray-700 dark:text-gray-200 outline-none" tabindex="-1" data-field="train">{{ t('SEW_PANEL_FIND') }}</span>
      <button type="button" class="ml-auto text-xs font-medium text-primary-700 dark:text-primary-300 hover:enabled:underline disabled:text-gray-400 disabled:opacity-60" data-testid="se-cap-find"
        :disabled="!hasArea || !edit.canCapture" :title="edit.canCapture ? undefined : t('SEW_CAP_NO_BASE_IMAGE')" @click="grab">{{ hasTrain ? t('SEW_CAP_REGRAB') : t('SEW_CAP_GRAB') }}</button>
    </div>
    <div class="flex gap-2 items-start flex-wrap" :class="ch('train') ? 'ring-2 ring-primary-300 rounded' : ''">
      <div v-for="p in trainPics" :key="p.key">
        <div :class="pic">{{ markerFor(p) ? t('SEW_PANEL_TRAIN_CLICK') : t('SEW_PANEL_TRAIN') }}{{ p.key !== '0' ? ` (${p.key})` : '' }}</div>
        <CropView :src="p.src" :width="110" :marker="markerFor(p)" @outside="emit('outside', $event)" />
      </div>
      <div v-if="!trainPics.length">
        <div :class="pic">{{ t('SEW_PANEL_TRAIN') }}</div>
        <div class="w-[92px] h-[58px] border-2 border-dashed border-gray-300 dark:border-dark-border rounded flex items-center justify-center text-[11px] text-gray-400 text-center p-0.5">{{ t('SEW_PANEL_TRAIN_EMPTY') }}</div>
      </div>
    </div>
    <FieldError :errs="errs" field="train" />
    <div class="mt-2 flex items-center gap-2">
      <label for="se-panel-accept" class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{{ t('SEW_PANEL_ACCEPT') }}</label>
      <input type="range" min="0.5" max="1" step="0.01" class="flex-1 min-w-0 h-4 accent-teal-600" data-testid="se-accept-range" :value="acceptRange" :aria-label="t('SEW_PANEL_ACCEPT_SLIDER')" @input="setAcceptRange($event.target.value)">
      <input id="se-panel-accept" class="se-inp se-inp-n" :class="{ 'se-inp-bad': bad('accept'), 'se-inp-ch': !bad('accept') && ch('accept') }" inputmode="decimal" data-field="accept" :value="acceptText"
        @change="setImage({ accept: numIn($event.target.value) })">
    </div>
    <FieldError :errs="errs" field="accept" />
    <div :class="row" class="mt-2">
      <label>{{ t('SEW_PANEL_MULTI') }}</label>
      <input class="se-inp se-inp-n !w-[42px]" :class="{ 'se-inp-bad': bad('multi'), 'se-inp-ch': !bad('multi') && ch('multi') }" inputmode="numeric" data-field="multi" :value="multi.count ?? ''" :aria-label="t('SEW_PANEL_MULTI_COUNT')"
        @change="setMulti({ count: String($event.target.value).trim() })">{{ t('SEW_PANEL_MULTI_UNIT') }}
      <div class="se-seg" role="group" :aria-label="t('SEW_PANEL_MULTI_OPS')">
        <button v-for="(l, i) in multiLabels" :key="i" type="button" :data-multi-op="i" :aria-pressed="multi.op === i ? 'true' : 'false'" @click="setMulti({ op: i })">{{ l }}</button>
      </div>
    </div>
    <FieldError :errs="errs" field="multi" />
  </div>

  <div v-else-if="kind === 'ocr'" class="se-st se-st-ocr" data-station="find">
    <div class="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1.5 min-h-[18px]">{{ t('SEW_PANEL_OCR_CMP') }}</div>
    <select class="se-inp" :class="{ 'se-inp-bad': bad('ocrOp') }" data-field="ocrOp" :value="ocr.op >= 1 && ocr.op <= 10 ? String(ocr.op) : ''" :aria-label="t('SEW_PANEL_OCR_OP')" @change="setOp($event.target.value)">
      <option value="">{{ t('SEW_PANEL_OCR_PICK') }}</option>
      <optgroup :label="t('SEW_PANEL_OCR_GROUP_TEXT')"><option v-for="op in [1, 2, 3, 4]" :key="op" :value="String(op)">{{ LABELS.ocrOp[OCR_OPS[op]] }}</option></optgroup>
      <optgroup :label="t('SEW_PANEL_OCR_GROUP_NUMBER')"><option v-for="op in [5, 6, 7, 8, 9, 10]" :key="op" :value="String(op)">{{ LABELS.ocrOp[OCR_OPS[op]] }}</option></optgroup>
    </select>
    <FieldError :errs="errs" field="ocrOp" />
    <div v-if="ocrKind" class="mt-1.5 flex items-center gap-1.5 text-xs text-gray-500">
      <template v-if="ocrKind === 'range'">
        <input class="se-inp" :class="{ 'se-inp-bad': bad('ocrVal') }" inputmode="decimal" data-field="ocrVal" :value="numOut(ocr.min)" :aria-label="t('SEW_PANEL_OCR_MIN')" @change="setOcr({ min: numIn($event.target.value) })">~
        <input class="se-inp" :class="{ 'se-inp-bad': bad('ocrVal') }" inputmode="decimal" data-testid="se-ocr-max" :value="numOut(ocr.max)" :aria-label="t('SEW_PANEL_OCR_MAX')" @change="setOcr({ max: numIn($event.target.value) })">
      </template>
      <input v-else-if="ocrKind === 'number'" class="se-inp" :class="{ 'se-inp-bad': bad('ocrVal') }" inputmode="decimal" data-field="ocrVal" :value="numOut(ocr.number)" :placeholder="t('SEW_PANEL_OCR_NUMBER')" :aria-label="t('SEW_PANEL_OCR_NUMBER')" @change="setOcr({ number: numIn($event.target.value) })">
      <input v-else class="se-inp" :class="{ 'se-inp-bad': bad('ocrVal') }" data-field="ocrVal" :value="ocr.text ?? ''" :placeholder="t('SEW_PANEL_OCR_TEXT')" :aria-label="t('SEW_PANEL_OCR_TEXT')" @input="setOcr({ text: $event.target.value })">
    </div>
    <FieldError :errs="errs" field="ocrVal" />
    <div :class="row" class="mt-2">
      <label>{{ t('SEW_PANEL_MULTI') }}</label>
      <input class="se-inp se-inp-n !w-[42px]" :class="{ 'se-inp-bad': bad('multi') }" inputmode="numeric" data-field="multi" :value="multi.count ?? ''" :aria-label="t('SEW_PANEL_MULTI_COUNT')"
        @change="setMulti({ count: String($event.target.value).trim() })">{{ t('SEW_PANEL_MULTI_UNIT') }}
      <div class="se-seg" role="group" :aria-label="t('SEW_PANEL_MULTI_OPS')">
        <button v-for="(l, i) in multiLabels" :key="i" type="button" :data-multi-op="i" :aria-pressed="multi.op === i ? 'true' : 'false'" @click="setMulti({ op: i })">{{ l }}</button>
      </div>
    </div>
    <FieldError :errs="errs" field="multi" />
  </div>

  <div v-else-if="kind === 'eqpState'" class="se-st se-st-wire" data-station="find">
    <div class="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1.5 min-h-[18px]">{{ t('SEW_PANEL_EQP') }} <small class="font-normal text-gray-500">{{ t('SEW_PANEL_EQP_SUB') }}</small></div>
    <dl v-if="eqp" class="grid grid-cols-[70px_1fr] gap-y-0.5 text-xs">
      <dt class="text-gray-500">{{ t('SEW_PANEL_EQP_TARGET') }}</dt><dd>{{ eqp.target ?? '—' }}</dd>
      <dt class="text-gray-500">{{ t('SEW_PANEL_EQP_STATE') }}</dt><dd>{{ eqp.state || t('SEW_PANEL_EQP_BLANK') }}</dd>
      <dt class="text-gray-500">{{ t('SEW_PANEL_EQP_CODE') }}</dt><dd>{{ eqp.code || t('SEW_PANEL_EQP_BLANK') }}</dd>
    </dl>
    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ t('SEW_PANEL_EQP_HELP') }}</p>
  </div>

  <div v-else-if="kind === 'unknown'" class="se-st se-st-wire" data-station="find">
    <p class="text-xs text-gray-600 dark:text-gray-300">{{ t('SEW_PANEL_KIND_UNKNOWN') }}</p>
  </div>
</template>
