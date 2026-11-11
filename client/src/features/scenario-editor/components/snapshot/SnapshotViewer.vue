<script setup>
// 큰 화면 스냅샷 모드(P3 설계 §4.3) — 고른 스냅샷의 그림·클릭 점·정보 줄, 확대·이동·맞춤·1:1, 이전·다음·태그 이동.
// 그림은 저장소가 받은 것(object URL)을 띄운다. 번호·클릭 점은 그림과 같은 스냅샷의 것이다 —
// 고른 것이 바뀌면 그림 크기를 지워, 새 그림이 불러와질 때까지 점·크기를 그리지 않는다(DC-034).
// 메모 줄·[이력 보기]·[받기]·[새 스텝] 은 P3-C~E 에서 더한다.
import { ref, computed, watch } from 'vue'
import { useSnapshotStore } from '../../stores/snapshotStore'
import { usePanZoom } from '../../composables/usePanZoom'
import { clickPoint } from '../../editor/snapshotList'
import { t } from '../../messages'
import ViewerModeTabs from './ViewerModeTabs.vue'
import '../../pills.css'
import './snapshot.css'

defineOptions({ name: 'SnapshotViewer' })
const snap = useSnapshotStore()
const box = ref(null)
const natural = ref(null)
const broken = ref(false) // 받았는데 브라우저가 그림으로 읽지 못했다
const { view, fit, actual, zoomButton, onWheel, onDown } = usePanZoom(box, natural)

const item = computed(() => snap.selected)
const src = computed(() => (snap.image.status === 'ready' && !broken.value ? snap.image.url : null))
watch(() => [snap.image.name, snap.image.url], () => { natural.value = null; broken.value = false })
function onLoad(e) { natural.value = { w: e.target.naturalWidth, h: e.target.naturalHeight }; fit() }

const point = computed(() => (src.value ? clickPoint(item.value, natural.value) : null))
// 점은 그림과 같은 변환 상자 안에 있다 — 확대해도 화면에서 같은 크기가 되게 배율로 나눈다
const DOT = 12
const dotStyle = computed(() => point.value && {
  left: `${point.value.x}px`, top: `${point.value.y}px`, width: `${DOT / view.scale}px`, height: `${DOT / view.scale}px`,
  marginLeft: `${-DOT / 2 / view.scale}px`, marginTop: `${-DOT / 2 / view.scale}px`, borderWidth: `${2 / view.scale}px`
})
const error = computed(() => (snap.image.status === 'error' ? snap.image.error : broken.value ? t('SEW_SNAP_IMAGE_FAILED') : ''))

const count = computed(() => snap.shown.length)
const atFirst = computed(() => !count.value || snap.position === 0)
const atLast = computed(() => !count.value || snap.position === count.value - 1)
const noList = computed(() => !snap.list.items.length)
const btn = 'h-7 px-2 rounded-lg text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:enabled:bg-gray-300 dark:hover:enabled:bg-gray-600 disabled:opacity-50 whitespace-nowrap'
defineExpose({ onLoad, fit })
</script>

<template>
  <div class="h-full flex flex-col" data-testid="se-snap-viewer">
    <div class="h-10 px-3 flex items-center gap-2 border-b border-gray-200 dark:border-dark-border text-xs shrink-0">
      <ViewerModeTabs />
      <div class="ml-auto flex gap-1 shrink-0">
        <button type="button" class="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-700" :title="t('SEW_SNAP_ZOOM_IN')" data-testid="se-snap-zoom-in" @click="zoomButton(1.25)">＋</button>
        <button type="button" class="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-700" :title="t('SEW_SNAP_ZOOM_OUT')" data-testid="se-snap-zoom-out" @click="zoomButton(0.8)">－</button>
        <button type="button" class="h-7 px-2 rounded-lg bg-gray-200 dark:bg-gray-700" data-testid="se-snap-zoom-fit" @click="fit">{{ t('SEW_SNAP_ZOOM_FIT') }}</button>
        <button type="button" class="h-7 px-2 rounded-lg bg-gray-200 dark:bg-gray-700" :title="t('SEW_SNAP_ZOOM_ACTUAL_HINT')" data-testid="se-snap-zoom-actual" @click="actual">{{ t('SEW_SNAP_ZOOM_ACTUAL') }}</button>
      </div>
    </div>
    <!-- 정보 줄: 머리 줄에 함께 넣으면 패널을 펼친 화면에서 좌표·크기·순번이 잘려 제 줄에 둔다 -->
    <div v-if="item" class="px-3 py-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-dark-border shrink-0" data-testid="se-snap-info">
      <b class="text-gray-800 dark:text-gray-100">{{ snap.eqpId }}</b>
      <span class="tabular-nums">{{ snap.date }} <b class="text-gray-800 dark:text-gray-100">{{ item.time }}</b></span>
      <span>{{ item.shift }}</span>
      <span v-if="item.kind === 'tag'" class="se-pill" :class="`se-snap-tag-${item.tag}`" data-testid="se-snap-tag">{{ t(`SEW_SNAP_TAG_${item.tag}`) }}</span>
      <span v-else class="tabular-nums">{{ t('SEW_SNAP_INFO_CLICK', { x: item.x, y: item.y }) }}</span>
      <span v-if="natural && src" class="tabular-nums">{{ t('SEW_SNAP_INFO_SIZE', { w: natural.w, h: natural.h }) }}</span>
      <span v-if="snap.position >= 0" class="tabular-nums">{{ t('SEW_SNAP_INFO_POS', { i: snap.position + 1, n: count }) }}</span>
    </div>
    <div ref="box" class="flex-1 min-h-0 relative overflow-hidden bg-gray-50 dark:bg-dark-bg select-none" @wheel.prevent="onWheel" @mousedown="onDown">
      <div v-if="!item" class="h-full flex items-center justify-center text-sm text-gray-400 px-6 text-center" data-testid="se-snap-empty">{{ snap.open ? t('SEW_SNAP_VIEW_EMPTY') : t('SEW_SNAP_VIEW_NO_PANEL') }}</div>
      <div v-else-if="error" class="h-full flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 px-6 text-center" data-testid="se-snap-error">{{ error }}</div>
      <div v-else-if="snap.image.status === 'loading'" class="h-full flex items-center justify-center text-sm text-gray-400 px-6 text-center" data-testid="se-snap-loading">{{ t('SEW_SNAP_VIEW_LOADING') }}</div>
      <div v-if="item && src" class="absolute left-0 top-0 origin-top-left"
        :style="{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, width: natural ? `${natural.w}px` : 'auto', height: natural ? `${natural.h}px` : 'auto' }">
        <img :key="src" :src="src" alt="" class="block max-w-none shadow-md" data-testid="se-snap-image" draggable="false" @load="onLoad" @error="broken = true" />
        <div v-if="dotStyle" class="absolute rounded-full bg-red-600 border-solid border-white pointer-events-none" :style="dotStyle" :title="t('SEW_SNAP_DOT')" data-testid="se-snap-dot" />
      </div>
    </div>
    <div class="h-10 px-3 flex items-center gap-1.5 border-t border-gray-200 dark:border-dark-border shrink-0">
      <button type="button" :class="btn" :disabled="atFirst" data-testid="se-snap-prev" @click="snap.move(-1)">{{ t('SEW_SNAP_PREV') }}</button>
      <button type="button" :class="btn" :disabled="atLast" data-testid="se-snap-next" @click="snap.move(1)">{{ t('SEW_SNAP_NEXT') }}</button>
      <span class="w-2" />
      <button type="button" :class="btn" :disabled="noList" data-testid="se-snap-tag-prev" @click="snap.moveTag(-1)">{{ t('SEW_SNAP_TAG_PREV') }}</button>
      <button type="button" :class="btn" :disabled="noList" data-testid="se-snap-tag-next" @click="snap.moveTag(1)">{{ t('SEW_SNAP_TAG_NEXT') }}</button>
      <span v-if="snap.notice" class="ml-3 text-xs text-amber-700 dark:text-amber-300 truncate" role="status" data-testid="se-snap-notice">{{ snap.notice }}</span>
    </div>
  </div>
</template>
