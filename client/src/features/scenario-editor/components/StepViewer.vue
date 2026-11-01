<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { imageUrl } from '../api'
import { t } from '../messages'
import { safeStorage } from '../composables/useSafeStorage'

defineOptions({ name: 'StepViewer' })
const store = useEditorStore()
const step = computed(() => store.selectedStep)
const src = computed(() => (step.value?.baseImage.state === 'present' ? imageUrl(step.value.baseImage.url) : null))
const natural = ref(null)
const failed = ref(false)
const box = ref(null)
const view = reactive({ scale: 1, tx: 0, ty: 0 })
const HINT = 'se-hint-base-image'
const showHint = ref(safeStorage.get(HINT) !== '1')

watch(src, () => { natural.value = null; failed.value = false })

function fit() {
  const el = box.value
  if (!el || !natural.value) return
  const s = Math.min((el.clientWidth || natural.value.w) / natural.value.w, (el.clientHeight || natural.value.h) / natural.value.h) * 0.98
  view.scale = s > 0 ? s : 1
  view.tx = ((el.clientWidth || 0) - natural.value.w * view.scale) / 2
  view.ty = ((el.clientHeight || 0) - natural.value.h * view.scale) / 2
}
function onLoad(e) { natural.value = { w: e.target.naturalWidth, h: e.target.naturalHeight }; fit() }
function zoomAt(factor, cx, cy) {
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
  const sx = e.clientX
  const sy = e.clientY
  const tx = view.tx
  const ty = view.ty
  const move = (m) => { view.tx = tx + m.clientX - sx; view.ty = ty + m.clientY - sy }
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
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
      <div v-else-if="step.baseImage.state === 'missing'" class="h-full flex items-center justify-center text-sm text-gray-400 px-6 text-center">{{ t('SEW_UI_BASE_IMAGE_MISSING') }}</div>
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
