<script setup>
// 클릭한 곳·누를 곳 점 — 스냅샷의 클릭 점(SnapshotViewer), Vision 시험의 누를 곳(TestLayer), [누를 곳 보기](StepViewer)가 같은 점을 쓴다.
// 그림과 같은 변환 상자 안에 둔다: 자리는 그림 픽셀, 크기·테만 배율로 나눠 확대해도 화면에서 같은 크기(12px)다. 누름은 받지 않는다.
// 색·깜빡임·퍼지는 고리는 snapshot.css 의 .se-snap-dot — 어두운 가는 테는 --k(1 / 배율)로 굵기를 맞춘다.
import { computed } from 'vue'
import './snapshot/snapshot.css'

defineOptions({ name: 'ClickDot' })
const props = defineProps({
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  scale: { type: Number, default: 1 }
})
const DOT = 12
const style = computed(() => {
  const k = 1 / (props.scale > 0 ? props.scale : 1)
  return {
    left: `${props.x}px`, top: `${props.y}px`, width: `${DOT * k}px`, height: `${DOT * k}px`,
    marginLeft: `${-DOT / 2 * k}px`, marginTop: `${-DOT / 2 * k}px`, borderWidth: `${2 * k}px`, '--k': k
  }
})
</script>

<template>
  <div class="se-snap-dot absolute rounded-full pointer-events-none" :style="style" />
</template>
