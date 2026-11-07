<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { imageSrc } from '../editor/display'
import { t } from '../messages'
import { safeStorage } from '../composables/useSafeStorage'

defineOptions({ name: 'StepViewer' })
const store = useEditorStore()
const step = computed(() => store.selectedStep)
const src = computed(() => (step.value?.baseImage.state === 'present' ? imageSrc(step.value.baseImage) : null))
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
const areaValid = computed(() => !!area.value && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(area.value[k])))
const areaStyle = computed(() => areaValid.value && { left: `${area.value.x}px`, top: `${area.value.y}px`, width: `${area.value.w}px`, height: `${area.value.h}px`, borderWidth: `${2 / view.scale}px` })
const closeHint = () => { showHint.value = false; safeStorage.set(HINT, '1') }
defineExpose({ onLoad, fit })
</script>

<template>
  <div class="h-full flex flex-col" data-testid="se-viewer">
    <div class="h-10 px-3 flex items-center gap-2 border-b border-gray-200 dark:border-dark-border text-xs shrink-0">
      <span v-if="step" class="font-semibold text-gray-800 dark:text-gray-100">스텝 {{ step.no }} 기준 화면</span>
      <span v-if="step && step.condition.kind === 'image'" class="text-gray-500">{{ t('SEW_UI_TRAIN_NOT_STORED') }}</span>
      <span v-if="step && step.condition.kind === 'ocr'" class="text-gray-500">{{ t('SEW_UI_OCR_AREA_HINT') }}</span>
      <div class="ml-auto flex gap-1">
        <button class="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-700" title="확대" @click="zoomButton(1.25)">＋</button>
        <button class="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-700" title="축소" @click="zoomButton(0.8)">－</button>
        <button class="h-7 px-2 rounded-lg bg-gray-200 dark:bg-gray-700" @click="fit">맞춤</button>
      </div>
    </div>
    <div v-if="showHint && src" class="px-3 py-1.5 text-[11px] bg-primary-50 dark:bg-primary-900/20 text-primary-800 dark:text-primary-300 flex items-center gap-2">
      {{ t('SEW_UI_BASE_IMAGE_HINT') }}<button class="ml-auto underline" data-testid="se-hint-close" @click="closeHint">닫기</button>
    </div>
    <div ref="box" class="flex-1 min-h-0 relative overflow-hidden bg-gray-50 dark:bg-dark-bg select-none" @wheel.prevent="onWheel" @mousedown="onDown">
      <div v-if="!step" class="h-full" />
      <div v-else-if="step.baseImage.state === 'notNeeded'" class="h-full flex items-center justify-center text-sm text-gray-400 px-6 text-center">{{ t('SEW_UI_BASE_IMAGE_NOT_NEEDED') }}</div>
      <div v-else-if="step.baseImage.state === 'missing'" class="h-full flex items-center justify-center text-sm text-gray-400 px-6 text-center">{{ biUnreadable ? t('SEW_UI_BASE_IMAGE_UNREADABLE') : t('SEW_UI_BASE_IMAGE_MISSING') }}</div>
      <div v-else-if="failed" class="h-full flex items-center justify-center text-sm text-gray-400">{{ t('SEW_UI_IMAGE_LOAD_FAILED') }}</div>
      <div v-if="src && !failed" class="absolute left-0 top-0 origin-top-left"
        :style="{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, width: natural ? `${natural.w}px` : 'auto', height: natural ? `${natural.h}px` : 'auto' }">
        <img :src="src" alt="" class="block max-w-none shadow-md" data-testid="se-base-image" draggable="false" @load="onLoad" @error="failed = true" />
        <div v-if="natural && areaStyle" class="absolute" :class="step.condition.kind === 'ocr' ? 'border-solid border-violet-600 bg-violet-500/10' : 'border-dashed border-primary-500 bg-primary-500/5'"
          :style="areaStyle" data-testid="se-search-area" />
      </div>
    </div>
  </div>
</template>
