<script setup>
// 클릭한 곳·누를 곳 점 — 스냅샷의 클릭 점(SnapshotViewer), Vision 시험의 누를 곳(TestLayer), [누를 곳 보기](StepViewer)가 같은 점을 쓴다.
// 그림과 같은 변환 상자 안에 둔다: 자리는 그림 픽셀이고, 화면에서 늘 같은 크기(12px)가 되게 점을 통째로 1 / 배율로 줄인다.
// 테 두께를 배율로 나눠 px 로 주지 않는다 — 브라우저는 1px 보다 가는 테를 1px 로 올려, 2배 넘게 확대하면 테가 점을 덮고 고리가 사라졌다(독립 검토 2026-11-17).
// 색·깜빡임·퍼지는 고리는 snapshot.css 의 .se-snap-dot. 누름은 받지 않는다.
import { computed } from 'vue'
import './snapshot/snapshot.css'

defineOptions({ name: 'ClickDot' })
const props = defineProps({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  scale: { type: Number, default: 1 }
})
const style = computed(() => ({ left: `${props.x}px`, top: `${props.y}px`, transform: `translate(-50%, -50%) scale(${1 / (props.scale > 0 ? props.scale : 1)})` }))
</script>

<template>
  <div class="se-snap-dot absolute pointer-events-none" :style="style" />
</template>
