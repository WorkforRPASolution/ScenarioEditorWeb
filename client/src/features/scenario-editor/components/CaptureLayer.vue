<script setup>
// 큰 화면 위 잡기 층(목업 overlay·onScreenDown·toImg, 조작판 1·3~7). 기준 화면과 같은 크기의 SVG 를 그림 위에 겹친다 —
// 좌표는 기준 화면 픽셀이고 확대·이동은 감싼 상자(StepViewer)의 transform 이 맡는다. 선 굵기·이름표 크기만 scale 로 나눠 화면에서 같게 보인다.
// - 잡기 중(editStore.capture): 검색(OCR) 영역 끌기 → 찾을 그림 끌기(영역 안) → 누를 곳 찍기(그림 밖도 됨). 받은 값은 editStore.captureNext 로 —
//   패널 초안만 바뀐다(Esc 취소는 큰 화면 StepViewer 가 듣는다 — 그림을 못 그려 이 층이 없을 때도 되게).
// - 잡기 밖: 영역 몸통을 끌어 옮기고 손잡이 여덟 곳으로 크기를 바꾼다(패널 초안). 끄는 동안은 editStore.areaDragging(찾을 그림 위치 찾기를 미룬다).
// 끌기·찍기는 큰 화면 끌어 이동(StepViewer mousedown)으로 번지지 않게 막는다. 쓸 수 있는 세션의 패널 초안에만 그린다(읽기 전용은 P1 표시).
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useEditStore } from '../stores/editStore'
import { isRect, normRect, moveRect, resizeRect, handlePoints, tagBox, clickTagBox } from '../editor/capture'
import { withArea } from '../editor/areaInput'
import { t } from '../messages'
import './capture.css'

defineOptions({ name: 'CaptureLayer' })
const props = defineProps({
  draft: { type: Object, required: true },
  natural: { type: Object, required: true }, // 기준 화면 크기 { w, h }
  scale: { type: Number, default: 1 } // 지금 화면 배율(선 굵기·이름표용)
})
const edit = useEditStore()
const svg = ref(null)
const live = ref(null) // 끄는 중인 사각형

const cap = computed(() => edit.capture)
const stage = computed(() => cap.value?.stage ?? null)
const W = computed(() => props.natural.w)
const H = computed(() => props.natural.h)
const k = computed(() => 1 / (props.scale > 0 ? props.scale : 1))
const ocr = computed(() => props.draft.condition?.kind === 'ocr')
const area = computed(() => (isRect(props.draft.condition?.searchArea) ? props.draft.condition.searchArea : null))
// 영역 단계에서는 끄는 사각형만, 그 밖에는 초안의 영역(목업 overlay)
const shownArea = computed(() => (stage.value === 'area' || stage.value === 'ocr' ? live.value : area.value))
const areaColor = computed(() => (ocr.value ? 'var(--cap-ocr)' : 'var(--cap-area)'))
const trainBox = computed(() => (stage.value === 'train' ? live.value : stage.value === 'click' ? cap.value.train : null))
// 누를 곳만 다시 찍을 때(흐름이 누를 곳 하나)만 지금 값이 뜻이 있다
const clickNow = computed(() => {
  if (stage.value !== 'click' || cap.value.flow.length !== 1) return null
  const c = props.draft.action?.click
  const tr = cap.value.train
  return tr && Number.isInteger(c?.x) && Number.isInteger(c?.y) ? { x: tr.x + c.x, y: tr.y + c.y } : null
})
const handles = computed(() => (!cap.value && area.value ? handlePoints(area.value) : []))
const maskPath = computed(() => {
  const a = shownArea.value
  return a ? `M0 0H${W.value}V${H.value}H0Z M${a.x} ${a.y}h${a.w}v${a.h}h${-a.w}Z` : ''
})
const maskFill = computed(() => `rgba(15, 23, 42, ${cap.value && stage.value !== 'click' ? 0.5 : 0.24})`)

// 이름표(목업 tagSvg, editor/capture tagBox)
const tag = (x, y, text) => tagBox(x, y, text, k.value)
const areaTag = computed(() => {
  const a = shownArea.value
  return a ? tag(a.x, a.y, t(ocr.value ? 'SEW_CAP_TAG_OCR' : 'SEW_CAP_TAG_AREA', { w: a.w, h: a.h })) : null
})
const trainTag = computed(() => {
  const b = trainBox.value
  return b ? tag(b.x, b.y + b.h + 20 * k.value, t('SEW_CAP_TAG_TRAIN', { w: b.w, h: b.h })) : null
})
const clickTag = computed(() => {
  const c = clickNow.value
  const b = cap.value?.train
  // 이름표가 찍을 자리를 가리지 않게: 그림 안이면 그림 위쪽, 밖이면 누를 곳 옆
  return c && b ? clickTagBox(b, c, t('SEW_CAP_TAG_CLICK_NOW'), k.value) : null
})

watch(stage, () => { live.value = null })

// 화면 좌표 → 기준 화면 픽셀: 그려진 크기(확대·이동이 들어간 사각형)에서 거꾸로 잰다(목업 toImg)
function toImg(e) {
  const r = svg.value.getBoundingClientRect()
  return { x: ((e.clientX - r.left) * W.value) / (r.width || 1), y: ((e.clientY - r.top) * H.value) / (r.height || 1) }
}
let stopDrag = null
// onEnd = 놓았거나 층이 사라져 끌기가 끝날 때(어느 쪽이든 한 번)
function track(start, onMove, onUp, onEnd) {
  stopDrag?.()
  let last = start
  const move = (e) => { last = toImg(e); onMove(last) }
  const up = () => { done(); onUp?.(last) }
  const done = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); stopDrag = null; onEnd?.() }
  stopDrag = done
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

// 잡기 중 누름: 누를 곳은 한 번 찍기, 그 밖은 끌어서 사각형(찾을 그림은 검색 영역 안만)
function onRootDown(e) {
  if (!cap.value || e.button !== 0) return
  e.stopPropagation()
  const p = toImg(e)
  if (stage.value === 'click') {
    if (p.x < 0 || p.y < 0 || p.x > W.value || p.y > H.value) { edit.notify(t('SEW_CAP_OUTSIDE')); return }
    edit.captureNext(p)
    return
  }
  const at = stage.value
  const bound = at === 'train' && area.value ? area.value : { x: 0, y: 0, w: W.value, h: H.value }
  live.value = normRect(p, p, bound)
  track(p, (q) => { live.value = normRect(p, q, bound) }, (q) => {
    if (cap.value?.stage !== at) { live.value = null; return }
    edit.captureNext(normRect(p, q, bound)).then((ok) => { if (!ok && cap.value?.stage === at) live.value = null })
  })
}

// 잡기 밖: 영역 몸통 = 옮기기, 손잡이 = 크기 바꾸기(목업 move·resize). 값은 패널 초안으로.
function onAreaDown(e, handle) {
  if (cap.value || e.button !== 0 || !area.value) return
  e.stopPropagation()
  const start = toImg(e)
  // 처음 값은 첫 움직임 때 잡는다 — 패널의 영역 칸에 치고 확정하지 않은 채 누르면 브라우저가 mousedown 뒤에 그 칸의 change 를 보낸다
  let orig = null
  track(start, (q) => {
    if (!area.value) return
    orig ??= { ...area.value }
    const r = handle === 'body' ? moveRect(orig, q.x - start.x, q.y - start.y, W.value, H.value) : resizeRect(orig, handle, q, W.value, H.value)
    const cur = props.draft.condition?.searchArea
    if (cur && cur.x === r.x && cur.y === r.y && cur.w === r.w && cur.h === r.h) return
    edit.updateDraft((d) => ({ ...d, condition: withArea(d.condition, r) })) // 패널에서 잘못 쳐 쥐고 있던 글자는 끌어 옮긴 영역이 대신한다
  }, null, () => edit.setAreaDrag(false))
  edit.setAreaDrag(true) // track 이 앞 끌기를 끝낸(끈) 뒤에 켠다
}

onBeforeUnmount(() => stopDrag?.())
</script>

<template>
  <svg ref="svg" class="se-cap absolute left-0 top-0 overflow-visible" :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`"
    data-testid="se-capture-layer" :data-stage="stage ?? undefined"
    :style="{ pointerEvents: cap ? 'auto' : 'none', cursor: cap ? 'crosshair' : 'default' }" @mousedown="onRootDown">
    <!-- 영역 바깥만 어둡게: 전체를 칠하고 영역을 파낸다 -->
    <path v-if="maskPath" :d="maskPath" fill-rule="evenodd" :fill="maskFill" pointer-events="none" />
    <template v-if="shownArea">
      <rect data-testid="se-search-area" :data-h="cap ? undefined : 'body'" :x="shownArea.x" :y="shownArea.y" :width="shownArea.w" :height="shownArea.h" fill="transparent"
        :style="{ stroke: areaColor, strokeWidth: 2 * k, pointerEvents: cap ? 'none' : 'auto', cursor: cap ? 'crosshair' : 'move' }" @mousedown="onAreaDown($event, 'body')" />
      <g v-if="areaTag" pointer-events="none">
        <rect :x="areaTag.x" :y="areaTag.y" :width="areaTag.w" :height="areaTag.h" :rx="areaTag.rx" :style="{ fill: areaColor }" />
        <text :x="areaTag.tx" :y="areaTag.ty" :font-size="areaTag.fs" fill="#fff" font-family="system-ui, sans-serif">{{ areaTag.text }}</text>
      </g>
      <rect v-for="hd in handles" :key="hd[0]" :data-h="hd[0]" :x="hd[1] - 4.5 * k" :y="hd[2] - 4.5 * k" :width="9 * k" :height="9 * k" fill="#fff"
        :style="{ stroke: areaColor, strokeWidth: 1.6 * k, cursor: hd[3], pointerEvents: 'auto' }" @mousedown="onAreaDown($event, hd[0])" />
    </template>
    <template v-if="trainBox">
      <rect data-testid="se-cap-train" :x="trainBox.x" :y="trainBox.y" :width="trainBox.w" :height="trainBox.h" pointer-events="none"
        :style="{ fill: 'rgba(13, 148, 136, .14)', stroke: 'var(--cap-train)', strokeWidth: 2 * k }" />
      <g v-if="trainTag" pointer-events="none">
        <rect :x="trainTag.x" :y="trainTag.y" :width="trainTag.w" :height="trainTag.h" :rx="trainTag.rx" style="fill: var(--cap-train)" />
        <text :x="trainTag.tx" :y="trainTag.ty" :font-size="trainTag.fs" fill="#fff" font-family="system-ui, sans-serif">{{ trainTag.text }}</text>
      </g>
    </template>
    <g v-if="clickNow" data-testid="se-cap-click-now" :data-x="clickNow.x" :data-y="clickNow.y" pointer-events="none">
      <path :d="`M${clickNow.x - 9 * k} ${clickNow.y}h${18 * k}M${clickNow.x} ${clickNow.y - 9 * k}v${18 * k}`" :style="{ stroke: 'var(--cap-click)', strokeWidth: 2 * k }" />
      <g v-if="clickTag">
        <rect :x="clickTag.x" :y="clickTag.y" :width="clickTag.w" :height="clickTag.h" :rx="clickTag.rx" style="fill: var(--cap-click)" />
        <text :x="clickTag.tx" :y="clickTag.ty" :font-size="clickTag.fs" fill="#fff" font-family="system-ui, sans-serif">{{ clickTag.text }}</text>
      </g>
    </g>
  </svg>
</template>
