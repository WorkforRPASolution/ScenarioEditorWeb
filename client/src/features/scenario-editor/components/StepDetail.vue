<script setup>
import { ref, computed, watch } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { imageSrc } from '../editor/display'
import { t, LABELS, noteMessage } from '../messages'
import { targetLabel, targetKind, multiLabel, actionDetails, conditionLabel, actionLabel, intervalSec } from '../format'
import CropView from './CropView.vue'
import '../pills.css'

defineOptions({ name: 'StepDetail' })
const KINDS = ['image', 'ocr', 'none', 'eqpState']
const store = useEditorStore()
const s = computed(() => store.selectedStep)
const c = computed(() => s.value?.condition)
const clickOutside = ref(false)
watch(() => s.value?.uid, () => { clickOutside.value = false })
// 깨진 저장 값에서 undefined·NaN 글자가 화면에 나오지 않게 한다
const show = (v) => (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v)) ? '—' : String(v))
const areaText = (a) => (a && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(a[k])) ? `X ${a.x} · Y ${a.y} · W ${a.w} · H ${a.h}` : '—')
const acceptText = (v) => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—')
const ocrValue = (o) => (o.op >= 1 && o.op <= 4 ? show(o.text) : o.op === 7 || o.op === 8 ? `${show(o.min)} ~ ${show(o.max)}` : show(o.number))
// 클릭 마커는 0번 학습 이미지에만 얹는다(그 이미지 기준 좌표)
const markerFor = (ti) => (ti.key === 0 && s.value?.action.click?.basis === 'trainImage' ? s.value.action.click : null)
const retryText = computed(() => {
  const r = s.value?.retry ?? {}
  return `${show(r.limit)}회 · ${Number.isFinite(r.intervalMs) ? `${intervalSec(r.intervalMs)}초` : '—'}`
})
const go = (target) => { if (target?.kind === 'step') store.select(target.uid) }
const raw = computed(() => s.value?.raw ?? {})
const extra = computed(() => {
  const isp = raw.value.Metadata?.ImageSearchParam ?? {}
  const ocr = raw.value.Metadata?.OcrParamInfo ?? {}
  const train = c.value?.image?.trainImages ?? []
  return [
    ['MaximumNumberToFind', show(isp.MaximumNumberToFind)], ['Timeout', show(isp.Timeout)], ['TimeoutEnabled', show(isp.TimeoutEnabled)], ['MinMatchingValue', show(ocr.MinMatchingValue)],
    ['학습 이미지(키·Type)', train.map((x) => `${x.key}:${show(x.type)}`).join(', ') || '—'], ['DescriptionToDialog', s.value?.descriptionToDialog || '—'], ['IsShowDialog', show(s.value?.isShowDialog)]
  ]
})
const sec = 'px-3 py-2.5 border-b border-gray-200 dark:border-dark-border'
const lab = 'text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-2'
</script>

<template>
  <div class="h-full overflow-auto text-sm" data-testid="se-detail">
    <div v-if="!s" class="h-full flex items-center justify-center text-gray-400 px-6 text-center">{{ t('SEW_UI_DETAIL_EMPTY') }}</div>
    <template v-else>
      <div :class="sec" class="flex items-start gap-2 sticky top-0 bg-white dark:bg-dark-card z-10">
        <span class="w-6 h-6 rounded bg-primary-500 text-white text-xs font-bold flex items-center justify-center shrink-0">{{ s.no }}</span>
        <div class="min-w-0">
          <div class="font-semibold text-gray-900 dark:text-white break-all">{{ s.descriptionToEmail || '(설명 없음)' }}</div>
          <div class="text-[11px] text-gray-500">{{ conditionLabel(c.kind) }} → {{ actionLabel(s.action.typeName) }}</div>
        </div>
      </div>
      <div v-if="s.notes.length" class="mx-3 mt-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-2.5 text-xs text-amber-900 dark:text-amber-200 space-y-1">
        <div v-for="(n, i) in s.notes" :key="`${n.code}-${i}`">{{ n.level === 'warning' ? '⚠' : 'ⓘ' }} {{ noteMessage(n) }}</div>
      </div>

      <div :class="sec">
        <div :class="lab">조건</div>
        <!-- 사내 화면의 조건 종류 탭을 읽기 전용으로 보인다 -->
        <div class="flex gap-1 mb-2.5 text-[11px]" data-testid="se-detail-kind">
          <span v-for="k in KINDS" :key="k" class="px-2 py-0.5 rounded-md border"
            :class="c.kind === k ? 'bg-primary-500 border-primary-500 text-white font-semibold' : 'border-gray-200 dark:border-dark-border text-gray-400'">{{ conditionLabel(k) }}</span>
          <span v-if="c.kind === 'unknown'" class="px-2 py-0.5 rounded-md bg-amber-500 text-white font-semibold">{{ conditionLabel('unknown') }}</span>
        </div>
        <template v-if="c.kind === 'image' && c.image">
          <div class="flex gap-2 items-start mb-2">
            <div v-if="s.baseImage.state === 'present'"><div class="text-[11px] text-gray-500 mb-0.5">기준 화면</div><CropView :src="imageSrc(s.baseImage)" :width="100" /></div>
            <div v-if="s.baseImage.state === 'present' && c.searchArea"><div class="text-[11px] text-gray-500 mb-0.5">검색 영역</div><CropView :src="imageSrc(s.baseImage)" :rect="c.searchArea" :width="100" /></div>
            <div v-for="ti in c.image.trainImages.filter((x) => x.url || x.src)" :key="ti.key">
              <div class="text-[11px] text-gray-500 mb-0.5">학습 이미지{{ ti.key !== 0 ? ` (${ti.key})` : '' }}{{ markerFor(ti) ? ' + 클릭' : '' }}</div>
              <CropView :src="imageSrc(ti)" :width="100" :marker="markerFor(ti)" @outside="clickOutside = $event" />
            </div>
          </div>
          <p v-if="clickOutside && s.action.click" class="text-[11px] text-amber-600 mb-1">{{ t('SEW_UI_CLICK_OUTSIDE', { x: s.action.click.x, y: s.action.click.y }) }}</p>
          <dl class="grid grid-cols-[110px_1fr] gap-y-1 text-xs">
            <dt class="text-gray-500">검색 영역</dt><dd>{{ areaText(c.searchArea) }}</dd>
            <dt class="text-gray-500">정확도</dt><dd>{{ acceptText(c.image.accept) }}</dd>
            <dt class="text-gray-500">다중 검사</dt><dd>{{ multiLabel(c.image.multi) }}</dd>
          </dl>
        </template>
        <template v-else-if="c.kind === 'ocr' && c.ocr">
          <div v-if="s.baseImage.state === 'present' && c.searchArea" class="mb-2"><div class="text-[11px] text-gray-500 mb-0.5">OCR 영역</div><CropView :src="imageSrc(s.baseImage)" :rect="c.searchArea" :width="160" /></div>
          <dl class="grid grid-cols-[110px_1fr] gap-y-1 text-xs">
            <dt class="text-gray-500">OCR 영역</dt><dd>{{ areaText(c.searchArea) }}</dd>
            <dt class="text-gray-500">비교</dt><dd>{{ LABELS.ocrOp[c.ocr.opName] ?? c.ocr.op }} ({{ c.ocr.opName ?? c.ocr.op }})</dd>
            <dt class="text-gray-500">값</dt><dd class="font-mono">{{ ocrValue(c.ocr) }}</dd>
            <dt class="text-gray-500">다중 검사</dt><dd>{{ multiLabel(c.ocr.multi) }}</dd>
            <dt class="text-gray-500">저장 값</dt><dd class="font-mono break-all">{{ c.ocr.raw }}</dd>
          </dl>
        </template>
        <template v-else-if="c.kind === 'eqpState'">
          <dl v-if="c.eqpState" class="grid grid-cols-[110px_1fr] gap-y-1 text-xs">
            <dt class="text-gray-500">대상</dt><dd>{{ LABELS.eqpTarget[c.eqpState.targetKind] }} ({{ c.eqpState.target }})</dd>
            <dt class="text-gray-500">상태</dt><dd>{{ c.eqpState.state || '(비움)' }}</dd>
            <dt class="text-gray-500">상태 코드</dt><dd>{{ c.eqpState.code || '(비움)' }}</dd>
            <dt class="text-gray-500">저장 값</dt><dd class="font-mono">{{ c.eqpState.raw }}</dd>
          </dl>
        </template>
        <p v-else-if="c.kind === 'image' || c.kind === 'ocr'" class="text-xs text-amber-700 dark:text-amber-300">{{ t('SEW_UI_CONDITION_DETAIL_MISSING') }}</p>
        <p v-else-if="c.kind === 'none'" class="text-xs text-gray-600 dark:text-gray-300">{{ t('SEW_UI_CONDITION_NONE_HINT') }}</p>
        <p v-else class="text-xs text-gray-600 dark:text-gray-300">{{ t('SEW_UI_CONDITION_UNKNOWN_HINT', { op: show(c.operationRaw) }) }}</p>
      </div>

      <div :class="sec">
        <div :class="lab">동작</div>
        <dl class="grid grid-cols-[110px_1fr] gap-y-1 text-xs">
          <template v-for="[k, v] in actionDetails(s.action)" :key="k"><dt class="text-gray-500">{{ k }}</dt><dd class="break-all" :class="k === '저장 값' ? 'font-mono' : ''">{{ v }}</dd></template>
        </dl>
      </div>

      <div :class="sec">
        <div :class="lab">흐름</div>
        <dl class="grid grid-cols-[110px_1fr] gap-y-1.5 text-xs items-center">
          <template v-for="b in ['onTrue', 'onFalse']" :key="b">
            <dt class="text-gray-500">{{ b === 'onTrue' ? '성공하면' : '실패하면' }}</dt>
            <dd><span class="se-pill" :class="`se-pill-${targetKind(s.next[b])}`" :data-testid="`se-detail-${b}`" @click="go(s.next[b])">{{ targetLabel(s.next[b]) }}</span></dd>
          </template>
          <dt class="text-gray-500">재시도</dt><dd>{{ retryText }}</dd>
          <dt class="text-gray-500">전처리 스킵</dt><dd>{{ LABELS.skipPreprocessing[c.skipPreprocessing === null ? 'na' : c.skipPreprocessing ? 'yes' : 'no'] }}</dd>
          <dt class="text-gray-500">설명 (메일)</dt><dd class="break-all">{{ s.descriptionToEmail || '—' }}</dd>
        </dl>
      </div>

      <details class="px-3 py-2.5">
        <summary class="cursor-pointer text-xs text-primary-600 dark:text-primary-400">자세히 (사내 화면에 안 보이던 값 · 원본 JSON)</summary>
        <dl class="grid grid-cols-[150px_1fr] gap-y-1 text-xs mt-2">
          <template v-for="[k, v] in extra" :key="k"><dt class="text-gray-500">{{ k }}</dt><dd class="font-mono">{{ v }}</dd></template>
        </dl>
        <pre class="mt-2 p-2 rounded bg-gray-50 dark:bg-dark-bg text-[11px] leading-4 overflow-auto text-gray-700 dark:text-gray-300">{{ JSON.stringify(s.raw, null, 2) }}</pre>
      </details>
    </template>
  </div>
</template>
