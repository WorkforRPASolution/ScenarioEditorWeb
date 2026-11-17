<script setup>
// 큰 화면 위 찾은 그림·누를 곳(목업 overlay 의 찾을 그림 테두리·누를 곳 + ·tagSvg). 누를 곳이 없는 스텝(마우스 클릭이 아닌 동작)은 찾은 그림만 그린다.
// 저장값에는 찾을 그림의 기준 화면 위치가 없어
// 기준 화면에서 찾은 자리(useTrainSpot, 한 곳일 때만)에 그린다. 잡기 밖에서만 쓰고(StepViewer), 누름은 받지 않는다(아래 잡기 층 손잡이가 받는다).
// 좌표는 기준 화면 픽셀, 선 굵기·이름표만 scale 로 나눠 화면에서 같게 보인다(CaptureLayer 와 같다). 이름표는 누를 곳을 가리지 않는다.
import { computed } from 'vue'
import { clickTagBox, trainTagBox } from '../editor/capture'
import './capture.css'

defineOptions({ name: 'SpotLayer' })
const props = defineProps({
  natural: { type: Object, required: true }, // 기준 화면 크기 { w, h }
  scale: { type: Number, default: 1 },
  train: { type: Object, required: true }, // 찾은 그림 { x, y, w, h }
  click: { type: Object, default: null }, // 누를 곳 { x, y } — 없으면 찾은 그림만
  labels: { type: Object, required: true } // { train, click } 이름표 문구
})
const k = computed(() => 1 / (props.scale > 0 ? props.scale : 1))
const trainTag = computed(() => trainTagBox(props.train, props.click, props.labels.train, k.value))
const clickTag = computed(() => (props.click ? clickTagBox(props.train, props.click, props.labels.click, k.value) : null))
const cross = computed(() => { if (!props.click) return ''; const { x, y } = props.click; const r = 9 * k.value; return `M${x - r} ${y}h${2 * r}M${x} ${y - r}v${2 * r}` })
</script>

<template>
  <svg class="se-cap absolute left-0 top-0 overflow-visible" :width="natural.w" :height="natural.h" :viewBox="`0 0 ${natural.w} ${natural.h}`"
    pointer-events="none" data-testid="se-spot">
    <rect data-testid="se-spot-train" :x="train.x" :y="train.y" :width="train.w" :height="train.h" :style="{ fill: 'rgba(13, 148, 136, .10)', stroke: 'var(--cap-train)', strokeWidth: 2 * k }" />
    <g>
      <rect :x="trainTag.x" :y="trainTag.y" :width="trainTag.w" :height="trainTag.h" :rx="trainTag.rx" style="fill: var(--cap-train)" />
      <text :x="trainTag.tx" :y="trainTag.ty" :font-size="trainTag.fs" fill="#fff" font-family="system-ui, sans-serif">{{ trainTag.text }}</text>
    </g>
    <g v-if="click" data-testid="se-spot-click" :data-x="click.x" :data-y="click.y">
      <path :d="cross" :style="{ stroke: 'var(--cap-click)', strokeWidth: 2 * k }" />
      <rect :x="clickTag.x" :y="clickTag.y" :width="clickTag.w" :height="clickTag.h" :rx="clickTag.rx" style="fill: var(--cap-click)" />
      <text :x="clickTag.tx" :y="clickTag.ty" :font-size="clickTag.fs" fill="#fff" font-family="system-ui, sans-serif">{{ clickTag.text }}</text>
    </g>
  </svg>
</template>
