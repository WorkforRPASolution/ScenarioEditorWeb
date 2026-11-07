<script setup>
// 큰 화면: 고른 스텝의 기준 화면과 검색(OCR) 영역, 휠 확대·끌어 이동(P1).
// 쓸 수 있는 세션은 패널 초안(고른 스텝의 초안 또는 아직 표에 없는 새 스텝)을 그리고, 그 위의 잡기 층(CaptureLayer)이
// 영역 끌기·손잡이·끌어 잡기·누를 곳 찍기를 맡는다. 잡기 중에는 머리에 단계 띠와 [취소], 아래에 안내 줄(목업 renderViewer).
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { imageSrc } from '../editor/display'
import { refUrl } from '../editor/images'
import { areaView, isRect, isRef } from '../editor/capture'
import { t } from '../messages'
import { safeStorage } from '../composables/useSafeStorage'
import CaptureLayer from './CaptureLayer.vue'
import './capture.css'

defineOptions({ name: 'StepViewer' })
const store = useEditorStore()
const edit = useEditStore()
const step = computed(() => store.selectedStep)
// 고치는 중인 값(쓸 수 있는 세션만): 새 스텝 초안, 또는 보는 스텝과 같은 uid 의 패널 초안
const isNew = computed(() => edit.editable && edit.panel.isNew && !!edit.panel.draft)
const draft = computed(() => {
  const p = edit.panel
  if (!edit.editable || !p.draft) return null
  if (p.isNew) return p.draft
  return step.value && p.uid === step.value.uid ? p.draft : null
})
const shown = computed(() => isNew.value || !!step.value)
const kind = computed(() => (draft.value ?? step.value)?.condition?.kind)
const newSrc = computed(() => {
  const b = isNew.value ? edit.panel.draft.images?.base : null
  return isRef(b) ? refUrl(b, { session: edit.session, uploads: edit.uploads, draftId: null }) : null
})
const baseState = computed(() => {
  if (!isNew.value) return step.value?.baseImage.state
  return kind.value === 'image' || kind.value === 'ocr' ? (newSrc.value ? 'present' : 'missing') : 'notNeeded'
})
const src = computed(() => {
  if (isNew.value) return newSrc.value
  return step.value?.baseImage.state === 'present' ? imageSrc(step.value.baseImage) : null
})
const editLayer = computed(() => !!draft.value && (kind.value === 'image' || kind.value === 'ocr'))
const cap = computed(() => (draft.value ? edit.capture : null))
const capNow = computed(() => (cap.value ? cap.value.flow.indexOf(cap.value.stage) : -1))
// [그림은 그대로 두기]: 고른 스텝의 영역을 다시 잡고 그림 단계에 왔을 때만(목업 cap:keep)
const canKeep = computed(() => cap.value?.stage === 'train' && cap.value.flow[0] !== 'train' && !isNew.value
  && Object.values(draft.value?.images?.train ?? {}).some(isRef))
const capHint = computed(() => {
  const c = cap.value
  if (!c) return ''
  const why = c.why && c.stage === 'train' ? `${c.why} ` : ''
  return why + (c.flow.length === 1 && c.stage === 'click' ? t('SEW_CAP_HINT_repick') : t(`SEW_CAP_HINT_${c.stage}`))
})
// 버전의 기준 화면 데이터 자체를 해석하지 못했으면(시나리오 경고 PARSE_FAILED bi) "저장되어 있지 않음" 이 아니라 그 사실을 알린다.
const biUnreadable = computed(() => (store.skeleton?.notes ?? []).some((n) => n.code === 'PARSE_FAILED' && n.params?.field === 'bi'))
const natural = ref(null)
const failed = ref(false)
const box = ref(null)
const view = reactive({ scale: 1, tx: 0, ty: 0 })
const HINT = 'se-hint-base-image'
const showHint = ref(safeStorage.get(HINT) !== '1')

watch(src, () => { natural.value = null; failed.value = false })

// 사용자가 이 이미지에서 직접 확대·이동했는지(맞춤·새 이미지에서 해제). 상자 크기가 바뀔 때 다시 맞출지 정한다.
let userMoved = false
// 상자가 0×0(숨김)일 때 맞추기를 미뤄 둔 것 — 다음 0 아닌 크기에서 맞춘다.
let pendingFit = false
let lastW = 0
let lastH = 0
let observer = null
let stopDrag = null

function fit() {
  const el = box.value
  if (!el || !natural.value) return
  userMoved = false
  const w = el.clientWidth
  const h = el.clientHeight
  if (!(w > 0 && h > 0)) { pendingFit = true; return }
  pendingFit = false
  const s = Math.min(w / natural.value.w, h / natural.value.h) * 0.98
  view.scale = s > 0 ? s : 1
  view.tx = (w - natural.value.w * view.scale) / 2
  view.ty = (h - natural.value.h * view.scale) / 2
}
function onLoad(e) { natural.value = { w: e.target.naturalWidth, h: e.target.naturalHeight }; userMoved = false; fit() }
function onResize() {
  const el = box.value
  if (!el) return
  const w = el.clientWidth
  const h = el.clientHeight
  const wasZero = !(lastW > 0 && lastH > 0)
  lastW = w
  lastH = h
  if (!(w > 0 && h > 0)) return
  if (pendingFit || wasZero || !userMoved) fit()
}
onMounted(() => {
  const el = box.value
  if (!el) return
  lastW = el.clientWidth
  lastH = el.clientHeight
  if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(onResize); observer.observe(el) }
})
onBeforeUnmount(() => {
  if (observer) { observer.disconnect(); observer = null }
  if (stopDrag) stopDrag()
})
function zoomAt(factor, cx, cy) {
  userMoved = true
  const ns = Math.min(8, Math.max(0.05, view.scale * factor))
  view.tx = cx - ((cx - view.tx) * ns) / view.scale
  view.ty = cy - ((cy - view.ty) * ns) / view.scale
  view.scale = ns
}
function onWheel(e) {
  const rect = box.value.getBoundingClientRect()
  zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top)
}
const zoomButton = (f) => zoomAt(f, (box.value?.clientWidth || 0) / 2, (box.value?.clientHeight || 0) / 2)
function onDown(e) {
  if (e.button !== 0) return
  if (stopDrag) stopDrag()
  const sx = e.clientX
  const sy = e.clientY
  const tx = view.tx
  const ty = view.ty
  const move = (m) => { userMoved = true; view.tx = tx + m.clientX - sx; view.ty = ty + m.clientY - sy }
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); stopDrag = null }
  stopDrag = up
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
const area = computed(() => step.value?.condition.searchArea)
const adjustHint = computed(() => editLayer.value && !cap.value && isRect(draft.value?.condition?.searchArea))
// 패널 그림을 누르면 영역에 맞춰 확대·전체(목업 focusArea·viewAll), 잡기를 시작하면 전체(editStore.viewReq)
function focusArea(a) {
  const el = box.value
  if (!el || !natural.value || !(el.clientWidth > 0 && el.clientHeight > 0)) return
  const v = areaView(a, { w: el.clientWidth, h: el.clientHeight }, natural.value)
  userMoved = true
  view.scale = v.scale
  view.tx = v.tx
  view.ty = v.ty
}
watch(() => edit.viewReq, (r) => {
  if (!r) return
  if (r.kind === 'all') fit()
  else if (r.kind === 'area' && isRect(draft.value?.condition?.searchArea)) focusArea(draft.value.condition.searchArea)
})
const areaValid = computed(() => !!area.value && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(area.value[k])))
const areaStyle = computed(() => areaValid.value && { left: `${area.value.x}px`, top: `${area.value.y}px`, width: `${area.value.w}px`, height: `${area.value.h}px`, borderWidth: `${2 / view.scale}px` })
const closeHint = () => { showHint.value = false; safeStorage.set(HINT, '1') }
defineExpose({ onLoad, fit })
</script>

<template>
  <div class="se-cap h-full flex flex-col" data-testid="se-viewer">
    <div class="h-10 px-3 flex items-center gap-2 border-b border-gray-200 dark:border-dark-border text-xs shrink-0">
      <template v-if="cap">
        <ol class="se-cap-steps" data-testid="se-cap-bar" :aria-label="t('SEW_CAP_STEPS')">
          <li v-for="(s, i) in cap.flow" :key="s" :data-cap-stage="s" :class="i === capNow ? 'now' : i < capNow ? 'done' : ''" :style="{ '--c': `var(--cap-${s})` }">
            <i>{{ i < capNow ? '✓' : i + 1 }}</i>{{ t(`SEW_CAP_STAGE_${s}`) }}
          </li>
        </ol>
        <span class="flex-1" />
        <button v-if="canKeep" type="button" class="h-7 px-2 rounded-lg bg-gray-200 dark:bg-gray-700 whitespace-nowrap" data-testid="se-cap-keep" @click="edit.finishCapture()">{{ t('SEW_CAP_KEEP_TRAIN') }}</button>
        <button type="button" class="h-7 px-2 rounded-lg bg-gray-200 dark:bg-gray-700 whitespace-nowrap" data-testid="se-cap-cancel" @click="edit.cancelCapture()">
          {{ t('SEW_CAP_CANCEL') }} <span class="text-gray-400">Esc</span>
        </button>
      </template>
      <template v-else>
        <span v-if="isNew" class="font-semibold text-gray-800 dark:text-gray-100">{{ t('SEW_CAP_NEW_TITLE') }}</span>
        <span v-else-if="step" class="font-semibold text-gray-800 dark:text-gray-100">스텝 {{ step.no }} 기준 화면</span>
        <span v-if="adjustHint" class="text-gray-500 truncate">{{ t('SEW_CAP_ADJUST_HINT') }}</span>
        <span v-else-if="!draft && step && step.condition.kind === 'image'" class="text-gray-500 truncate">{{ t('SEW_UI_TRAIN_NOT_STORED') }}</span>
        <span v-else-if="!draft && step && step.condition.kind === 'ocr'" class="text-gray-500">{{ t('SEW_UI_OCR_AREA_HINT') }}</span>
      </template>
      <div class="ml-auto flex gap-1 shrink-0">
        <button class="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-700" title="확대" @click="zoomButton(1.25)">＋</button>
        <button class="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-700" title="축소" @click="zoomButton(0.8)">－</button>
        <button class="h-7 px-2 rounded-lg bg-gray-200 dark:bg-gray-700" @click="fit">맞춤</button>
      </div>
    </div>
    <div v-if="cap" class="px-3 py-1.5 text-xs bg-primary-50 dark:bg-primary-900/20 text-gray-700 dark:text-gray-200 border-b border-gray-200 dark:border-dark-border" data-testid="se-cap-hint">{{ capHint }}</div>
    <div v-else-if="showHint && src" class="px-3 py-1.5 text-[11px] bg-primary-50 dark:bg-primary-900/20 text-primary-800 dark:text-primary-300 flex items-center gap-2">
      {{ t('SEW_UI_BASE_IMAGE_HINT') }}<button class="ml-auto underline" data-testid="se-hint-close" @click="closeHint">닫기</button>
    </div>
    <div ref="box" class="flex-1 min-h-0 relative overflow-hidden bg-gray-50 dark:bg-dark-bg select-none" @wheel.prevent="onWheel" @mousedown="onDown">
      <div v-if="!shown" class="h-full" />
      <div v-else-if="baseState === 'notNeeded'" class="h-full flex items-center justify-center text-sm text-gray-400 px-6 text-center">{{ t('SEW_UI_BASE_IMAGE_NOT_NEEDED') }}</div>
      <div v-else-if="baseState === 'missing'" class="h-full flex items-center justify-center text-sm text-gray-400 px-6 text-center">{{ biUnreadable ? t('SEW_UI_BASE_IMAGE_UNREADABLE') : t('SEW_UI_BASE_IMAGE_MISSING') }}</div>
      <div v-else-if="failed" class="h-full flex items-center justify-center text-sm text-gray-400">{{ t('SEW_UI_IMAGE_LOAD_FAILED') }}</div>
      <div v-if="src && !failed" class="absolute left-0 top-0 origin-top-left"
        :style="{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, width: natural ? `${natural.w}px` : 'auto', height: natural ? `${natural.h}px` : 'auto' }">
        <img :src="src" alt="" class="block max-w-none shadow-md" data-testid="se-base-image" draggable="false" @load="onLoad" @error="failed = true" />
        <CaptureLayer v-if="natural && editLayer" :draft="draft" :natural="natural" :scale="view.scale" />
        <div v-else-if="natural && areaStyle && !draft" class="absolute" :class="step.condition.kind === 'ocr' ? 'border-solid border-violet-600 bg-violet-500/10' : 'border-dashed border-primary-500 bg-primary-500/5'"
          :style="areaStyle" data-testid="se-search-area" />
      </div>
    </div>
  </div>
</template>
