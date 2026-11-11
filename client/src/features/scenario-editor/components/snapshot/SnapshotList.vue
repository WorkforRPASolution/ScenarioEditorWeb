<script setup>
// 스냅샷 하루 목록(P3 설계 §4.2) — 보이는 줄만 그린다(하루 5만 줄까지). 줄 높이는 고정 28px.
// 한 번 누르면 고르고, ↑↓·Home·End 로 옮긴다. 고른 줄이 화면 밖이면(태그 이동·이전·다음 포함) 보이게 움직인다.
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useSnapshotStore } from '../../stores/snapshotStore'
import { rowWindow, scrollFor, expiryDays } from '../../editor/snapshotList'
import { t } from '../../messages'
import '../../pills.css'
import './snapshot.css'

defineOptions({ name: 'SnapshotList' })
const ROW = 28
const snap = useSnapshotStore()
const box = ref(null)
const top = ref(0)
const viewHeight = ref(0)
let observer = null

const win = computed(() => rowWindow(top.value, viewHeight.value, ROW, snap.shown.length))
const rows = computed(() => snap.shown.slice(win.value.start, win.value.end))

const measure = () => { if (box.value) viewHeight.value = box.value.clientHeight }
const onScroll = () => { top.value = box.value.scrollTop }
function scrollTo(value) {
  if (!box.value) return
  box.value.scrollTop = value
  top.value = value
}
function reveal() {
  if (snap.position < 0 || !box.value) return
  const next = scrollFor(snap.position, box.value.scrollTop, viewHeight.value, ROW)
  if (next !== box.value.scrollTop) scrollTo(next)
}
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(() => { measure(); reveal() }); observer.observe(box.value) }
  reveal()
})
onBeforeUnmount(() => { if (observer) { observer.disconnect(); observer = null } })
watch(() => snap.position, () => nextTick(reveal))
// 설비·날짜·거르기가 바뀌면 맨 위부터(고른 줄이 있으면 그 줄이 보이게)
watch(() => [snap.eqpId, snap.date, snap.filter], () => nextTick(() => { scrollTo(0); reveal() }))

function pick(name) {
  snap.select(name)
  box.value?.focus?.({ preventScroll: true })
}
function onKey(e) {
  const list = snap.shown
  if (!list.length) return
  if (e.key === 'ArrowDown') snap.move(1)
  else if (e.key === 'ArrowUp') snap.move(-1)
  else if (e.key === 'Home') snap.select(list[0].fileName)
  else if (e.key === 'End') snap.select(list[list.length - 1].fileName)
  else return
  e.preventDefault()
}
</script>

<template>
  <div ref="box" class="se-snap-list h-full overflow-y-auto outline-none" tabindex="0" role="listbox" data-testid="se-snap-list" @scroll="onScroll" @keydown="onKey">
    <div data-testid="se-snap-rows" :style="{ height: `${win.height}px`, position: 'relative' }">
      <div :style="{ transform: `translateY(${win.offset}px)` }">
        <div v-for="it in rows" :key="it.fileName" class="se-snap-row" role="option" data-testid="se-snap-row" :data-name="it.fileName"
          :aria-selected="it.fileName === snap.selectedName ? 'true' : 'false'" @click="pick(it.fileName)">
          <span class="se-snap-time">{{ it.time }}</span>
          <span class="se-snap-shift">{{ it.shift }}</span>
          <span v-if="it.kind === 'tag'" class="se-pill" :class="`se-snap-tag-${it.tag}`" data-testid="se-snap-tag">{{ t(`SEW_SNAP_TAG_${it.tag}`) }}</span>
          <span v-if="expiryDays(it) !== null" class="se-snap-expires" data-testid="se-snap-expires">{{ t('SEW_SNAP_EXPIRES', { n: expiryDays(it) }) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
