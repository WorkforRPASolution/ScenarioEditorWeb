<script setup>
import { ref, computed, watch } from 'vue'
import { thumbView } from '../editor/trainView'
import { t } from '../messages'

// failText = 불러오지 못했을 때 그림 자리에 보일 문구(편집 패널이 다른 판 그림에 준다). 없으면 P1 처럼 "없음".
// marker = 표시 영역 왼쪽 위에서 잰 누를 곳. 표시 영역 밖이면 그 지점까지 넓혀 그린다(목업 trainThumb — 찾을 그림은 제자리에 테두리,
// 넓힌 곳은 저장된 화면이 없어 빗금, 크기는 editor/trainView thumbView). 안이면 지금과 같다(width 너비).
// around = 넓힌 곳을 채울 기준 화면 { src, x, y, bw, bh } — 기준 화면에서 찾을 그림을 한 곳 찾았을 때(editStore.findSpot). x·y = 찾은 자리.
const props = defineProps({
  src: { type: String, required: true }, rect: { type: Object, default: null }, width: { type: Number, default: 110 }, marker: { type: Object, default: null },
  failText: { type: String, default: null }, around: { type: Object, default: null }
})
const emit = defineEmits(['outside'])
const HATCH = 'repeating-linear-gradient(135deg, rgba(100, 116, 139, 0.28) 0 2px, transparent 2px 7px)'
// 상자 테두리(class border = 1px, border-box). 안쪽 그림·+ 는 테두리 안(padding box)에서 잘리므로, 넓힐 때 바깥 크기 = 보일 영역 + 테두리 두 줄,
// 바깥이 300×150 안에 들게 보일 영역은 298×148 안으로 줄인다.
const BORDER = 1
const EX_LIMIT = { maxW: 300 - 2 * BORDER, maxH: 150 - 2 * BORDER }
const ceilPx = (v) => Math.ceil(v - 1e-6)
const natural = ref(null)
const failed = ref(false)
const r = computed(() => props.rect ?? (natural.value ? { x: 0, y: 0, w: natural.value.w, h: natural.value.h } : null))
const k = computed(() => (r.value && r.value.w > 0 ? props.width / r.value.w : 1))
const failMsg = computed(() => (failed.value && props.failText ? props.failText : null))
const markerInside = computed(() => !!props.marker && !!r.value && props.marker.x >= 0 && props.marker.y >= 0 && props.marker.x <= r.value.w && props.marker.y <= r.value.h)
// 위치를 알 수 있을 때(표시 영역 + 클릭 지점)만 안/밖을 판정한다.
const outside = computed(() => (props.marker && r.value ? !markerInside.value : null))
watch(outside, (v) => { if (v !== null) emit('outside', v) }, { immediate: true })
watch(() => props.src, () => { natural.value = null; failed.value = false })
// 넓혀 그릴 때(누를 곳이 밖)의 보일 영역 { x1, y1, W, H, k } — 표시 영역 왼쪽 위 기준
const ex = computed(() => (outside.value && !failMsg.value ? thumbView({ w: r.value.w, h: r.value.h }, props.marker, EX_LIMIT) : null))
const fill = computed(() => (ex.value && props.around ? props.around : null))
const boxStyle = computed(() => {
  const v = ex.value
  // 빗금은 기준 화면으로 채울 때도 그 밑에 둔다 — 기준 화면 밖까지 넓힌 곳은 저장된 화면이 없다
  if (v) return { width: `${ceilPx(v.W * v.k) + 2 * BORDER}px`, height: `${ceilPx(v.H * v.k) + 2 * BORDER}px`, backgroundImage: HATCH }
  return { width: `${props.width}px`, height: failMsg.value ? 'auto' : r.value ? `${Math.max(8, r.value.h * k.value)}px` : '40px', minHeight: failMsg.value ? '40px' : undefined }
})
const imgStyle = computed(() => {
  const v = ex.value
  const rr = r.value
  const n = natural.value
  if (!rr || !n) return { opacity: 0 }
  if (!v) return { left: `${-rr.x * k.value}px`, top: `${-rr.y * k.value}px`, width: `${n.w * k.value}px` }
  // 넓힐 때는 상자가 자르지 않으므로 표시 영역(rect) 밖의 그림은 clip-path 로 가린다
  const clipPath = props.rect ? `inset(${rr.y * v.k}px ${(n.w - rr.x - rr.w) * v.k}px ${(n.h - rr.y - rr.h) * v.k}px ${rr.x * v.k}px)` : undefined
  return { left: `${(-v.x1 - rr.x) * v.k}px`, top: `${(-v.y1 - rr.y) * v.k}px`, width: `${n.w * v.k}px`, clipPath }
})
const trainStyle = computed(() => {
  const v = ex.value
  return v ? { left: `${-v.x1 * v.k}px`, top: `${-v.y1 * v.k}px`, width: `${r.value.w * v.k}px`, height: `${r.value.h * v.k}px` } : null
})
const aroundStyle = computed(() => {
  const v = ex.value
  const a = fill.value
  return a ? { left: `${(-a.x - r.value.x - v.x1) * v.k}px`, top: `${(-a.y - r.value.y - v.y1) * v.k}px`, width: `${a.bw * v.k}px` } : null
})
const markerStyle = computed(() => {
  const m = props.marker
  const v = ex.value
  return v ? { left: `${(m.x - v.x1) * v.k}px`, top: `${(m.y - v.y1) * v.k}px` } : { left: `${m.x * k.value}px`, top: `${m.y * k.value}px` }
})
function onLoad(e) {
  natural.value = { w: e.target.naturalWidth, h: e.target.naturalHeight }
}
defineExpose({ onLoad })
</script>

<template>
  <div class="relative overflow-hidden rounded border border-gray-300 dark:border-dark-border bg-gray-200 dark:bg-dark-bg" :class="{ 'border-dashed': ex }"
    :style="boxStyle" :data-expand="ex ? (fill ? 'base' : 'empty') : undefined" :title="ex ? t('SEW_UI_SPOT_EMPTY_TITLE') : undefined">
    <img v-if="fill" :src="fill.src" alt="" class="absolute max-w-none" :style="aroundStyle" data-testid="se-crop-around" />
    <img :src="src" alt="" class="absolute max-w-none" :style="imgStyle" @load="onLoad" @error="failed = true" />
    <div v-if="ex" class="absolute border-2 border-teal-600 dark:border-teal-400 pointer-events-none" :style="trainStyle" data-testid="se-crop-train" />
    <div v-if="markerInside || ex" class="absolute w-4 h-4 -ml-2 -mt-2" :style="markerStyle" data-testid="se-click-marker">
      <div class="absolute left-[7px] top-0 bottom-0 w-0.5 bg-red-600" /><div class="absolute top-[7px] left-0 right-0 h-0.5 bg-red-600" />
    </div>
    <div v-if="failMsg" class="relative px-1 py-1.5 text-center text-[10px] leading-snug text-gray-600 dark:text-gray-300" data-testid="se-crop-failed">{{ failMsg }}</div>
    <div v-else-if="failed" class="absolute inset-0 flex items-center justify-center text-[10px] text-gray-500">없음</div>
  </div>
</template>
