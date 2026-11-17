<script setup>
// 큰 화면 위 시험 결과(P4 설계 §4.2 "큰 화면") — 시험이 찾은 곳마다 찾을 그림 크기의 사각형과 이름표, 첫 결과에 누를 곳 점(깜빡임은 스냅샷 클릭 점과 같다).
// 결과는 시험한 화면의 모드에서만 그린다(기준 화면 → 스텝 그림, 지금 스냅샷 → 스냅샷). 시험할 화면이 "지금 스냅샷" 인 동안에는
// 스냅샷 모드에 시험 줄이 보이는 스텝의 검색 영역 테두리를 그린다(결과가 없어도 — 스텝 그림은 영역을 이미 그린다).
// 그림과 같은 변환 상자 안에 둔다: 좌표는 그림 픽셀, 선 굵기·점·이름표만 배율로 나눠 화면에서 같게 보인다. 누름은 받지 않는다.
import { computed } from 'vue'
import { useVisionTestStore } from '../stores/visionTestStore'
import { hitsOf } from '../editor/visionTest'
import { t } from '../messages'
import './snapshot/snapshot.css'
import './testLayer.css'

defineOptions({ name: 'TestLayer' })
const props = defineProps({
  natural: { type: Object, required: true }, // 그림 크기 { w, h }
  scale: { type: Number, default: 1 },
  mode: { type: String, required: true } // 이 층이 붙은 보기: 'step' | 'snapshot'
})
const store = useVisionTestStore()
const k = computed(() => 1 / (props.scale > 0 ? props.scale : 1))
const hits = computed(() => hitsOf(store.run, props.mode))
const area = computed(() => (props.mode === 'snapshot' && store.screen === 'snapshot' ? store.target : null))
const DOT = 12
const box = (r, width) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, borderWidth: `${width * k.value}px` })
const tag = computed(() => ({ transform: `scale(${k.value})` }))
const dot = computed(() => {
  const c = hits.value?.click
  return c && { left: `${c.x}px`, top: `${c.y}px`, width: `${DOT * k.value}px`, height: `${DOT * k.value}px`, marginLeft: `${-DOT / 2 * k.value}px`, marginTop: `${-DOT / 2 * k.value}px`, borderWidth: `${2 * k.value}px` }
})
</script>

<template>
  <div v-if="hits || area" class="se-test-layer absolute left-0 top-0 pointer-events-none" :style="{ width: `${natural.w}px`, height: `${natural.h}px` }"
    data-testid="se-test-layer" :data-stale="hits?.stale ? 'true' : 'false'">
    <div v-if="area" class="se-test-area absolute" :style="box(area.area, 2)" data-testid="se-test-area" :data-kind="area.kind">
      <span class="se-test-tag" :style="tag">{{ t('SEW_TEST_TAG_AREA') }}</span>
    </div>
    <div v-if="hits" :class="hits.stale ? 'opacity-40' : ''">
      <div v-for="r in hits.rects" :key="r.no" class="se-test-hit absolute" :style="box(r, r.picked ? 4 : 2)" data-testid="se-test-hit" :data-picked="r.picked ? 'true' : 'false'">
        <span class="se-test-tag" :style="tag">{{ t('SEW_TEST_TAG_FOUND', { n: r.no }) }}</span>
      </div>
      <div v-if="dot" class="se-snap-dot absolute rounded-full bg-red-600 border-solid border-white" :style="dot" :title="t('SEW_TEST_TAG_CLICK')"
        data-testid="se-test-click" :data-x="hits.click.x" :data-y="hits.click.y" />
    </div>
  </div>
</template>
