<script setup>
// 스냅샷 목록(P3 설계 §4.2) — 보이는 줄만 그린다(10만 줄까지). 줄 높이는 고정 28px.
// 여러 날을 보면(사내 요청 2026-11-16) 날이 바뀌는 곳에 날짜 구분 줄(날짜·요일·그 날 줄 수)이 들어가고, 맨 위에 지금 보는 줄의 날짜가 붙어 있다.
// 한 번 누르면 고르고, ↑↓·Home·End 로 옮긴다. 고른 줄이 화면 밖이면(태그 이동·이전·다음 포함) 보이게 움직인다.
// 여러 줄 고르기(P3-D, 받기용): Ctrl(⌘)+누르기 = 더하기·빼기, Shift+누르기·Shift+↑↓ = 범위. aria-selected = 고른 줄, data-current = 큰 화면에 뜬 줄.
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useSnapshotStore } from '../../stores/snapshotStore'
import { rowWindow, scrollFor, expiryDays, dayRows, dayOfRow } from '../../editor/snapshotList'
import { weekdayOf } from '../../editor/snapshotDates'
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

// 화면에 그릴 줄 — 여러 날이면 날짜 구분 줄이 끼어 있다(view.at = 목록의 줄 → 화면 자리)
const view = computed(() => dayRows(snap.shown, snap.multiDay))
const win = computed(() => rowWindow(top.value, viewHeight.value, ROW, view.value.rows.length))
const rows = computed(() => view.value.rows.slice(win.value.start, win.value.end))
const dayText = (date) => `${date.slice(5)} (${t('SEW_SNAP_WEEKDAYS')[weekdayOf(date)]})`
// 맨 위에 붙여 둘 구분 줄 — 지금 맨 위에 걸린 줄의 날(구분 줄과 같은 내용이라 겹쳐도 줄 수가 가려지지 않는다)
const heads = computed(() => new Map(view.value.at ? view.value.rows.filter((r) => r.header).map((r) => [r.date, r]) : []))
const stickDay = computed(() => (view.value.at ? heads.value.get(dayOfRow(view.value.rows, Math.floor(top.value / ROW))) ?? null : null))

const measure = () => { if (box.value) viewHeight.value = box.value.clientHeight }
const onScroll = () => { top.value = box.value.scrollTop }
function scrollTo(value) {
  if (!box.value) return
  box.value.scrollTop = value
  top.value = value
}
function reveal() {
  if (snap.position < 0 || !box.value) return
  const now = box.value.scrollTop
  let next
  if (!view.value.at) next = scrollFor(snap.position, now, viewHeight.value, ROW)
  else {
    // 맨 위 한 줄은 붙여 둔 날짜가 덮는다 — 그 아래를 보이는 자리로 친다(위로 옮긴 줄이 그 밑에 숨지 않게)
    const index = view.value.at[snap.position]
    next = Math.max(0, scrollFor(index, now + ROW, viewHeight.value - ROW, ROW) - ROW)
  }
  if (next !== now) scrollTo(next)
}
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(() => { measure(); reveal() }); observer.observe(box.value) }
  reveal()
})
onBeforeUnmount(() => { if (observer) { observer.disconnect(); observer = null } })
watch(() => snap.position, () => nextTick(reveal))
// 설비·날짜·거르기가 바뀌면 맨 위부터(고른 줄이 있으면 그 줄이 보이게)
watch(() => [snap.eqpId, snap.date, snap.dateTo, snap.filter], () => nextTick(() => { scrollTo(0); reveal() }))

function pick(e, name) {
  if (e.shiftKey) snap.pickRange(name)
  else if (e.ctrlKey || e.metaKey) snap.togglePick(name)
  else snap.select(name)
  box.value?.focus?.({ preventScroll: true })
}
function onKey(e) {
  const list = snap.shown
  if (!list.length) return
  if (e.key === 'ArrowDown') e.shiftKey ? snap.moveRange(1) : snap.move(1)
  else if (e.key === 'ArrowUp') e.shiftKey ? snap.moveRange(-1) : snap.move(-1)
  else if (e.key === 'Home') snap.select(list[0].fileName)
  else if (e.key === 'End') snap.select(list[list.length - 1].fileName)
  else return
  e.preventDefault()
}
</script>

<template>
  <div ref="box" class="se-snap-list h-full overflow-y-auto outline-none" tabindex="0" role="listbox" aria-multiselectable="true" data-testid="se-snap-list" @scroll="onScroll" @keydown="onKey">
    <!-- 지금 보는 줄의 날짜 — 스크롤해도 맨 위에 붙어 있다(자리를 차지하지 않는다) -->
    <div v-if="stickDay" class="se-snap-day se-snap-day-stick" aria-hidden="true" data-testid="se-snap-day-stick">
      <span>{{ dayText(stickDay.date) }}</span><span class="se-snap-day-count">{{ t('SEW_SNAP_COUNT', { n: stickDay.count }) }}</span>
    </div>
    <div data-testid="se-snap-rows" :style="{ height: `${win.height}px`, position: 'relative' }">
      <div :style="{ transform: `translateY(${win.offset}px)` }">
        <template v-for="it in rows" :key="it.header ? `day:${it.date}` : it.fileName">
          <div v-if="it.header" class="se-snap-day" role="presentation" data-testid="se-snap-day" :data-date="it.date">
            <span>{{ dayText(it.date) }}</span><span class="se-snap-day-count">{{ t('SEW_SNAP_COUNT', { n: it.count }) }}</span>
          </div>
          <div v-else class="se-snap-row" role="option" data-testid="se-snap-row" :data-name="it.fileName"
            :aria-selected="snap.picked.has(it.fileName) ? 'true' : 'false'" :data-current="it.fileName === snap.selectedName ? 'true' : 'false'" @click="pick($event, it.fileName)">
            <span class="se-snap-time">{{ it.time }}</span>
            <span class="se-snap-shift">{{ it.shift }}</span>
            <span v-if="it.kind === 'tag'" class="se-pill" :class="`se-snap-tag-${it.tag}`" data-testid="se-snap-tag">{{ t(`SEW_SNAP_TAG_${it.tag}`) }}</span>
            <span v-if="it.memo" class="se-snap-memo-ic" :title="it.memo.text" :aria-label="t('SEW_SNAP_MEMO_MARK')" data-testid="se-snap-memo-mark">✎</span>
            <span v-if="expiryDays(it) !== null" class="se-snap-expires" data-testid="se-snap-expires">{{ t('SEW_SNAP_EXPIRES', { n: expiryDays(it) }) }}</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
