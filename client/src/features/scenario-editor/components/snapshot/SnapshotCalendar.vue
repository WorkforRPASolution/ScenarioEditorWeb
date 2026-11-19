<script setup>
// 날짜 고르기(P3 설계 §4.2) — 보관 기간(서버가 준 가장 이른 날~끝 날)만 고를 수 있고, 스냅샷이 있는 날에 점과 장 수를 보인다.
// 날짜별 개수는 달력을 열 때 받는다(저장소 openCalendar). 받지 못해도 날짜는 고를 수 있다.
// 여러 날(사내 요청 2026-11-16): 날짜를 누르면 그 하루, 날짜 위를 끌거나 Shift+누르기로 여러 날(목록에서 여러 줄을 고르는 방식과 같다).
// - 끄는 동안에는 칠하기만 하고 손을 뗄 때 한 번 받는다. Shift 의 기준 날은 마지막으로 그냥 누른 날이다.
// - [전체 n일]·[최근 7일]·[최근 3일] 로 한 번에, [초기화] 는 가장 늦은 날 하루로. 고른 뒤에도 열려 있다 — [닫기]·바깥 누름·Esc 로 닫는다.
import { SECONDARY } from '../buttonStyle'
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useSnapshotStore } from '../../stores/snapshotStore'
import { calendarWeeks, orderDates, spanDays, addDays } from '../../editor/snapshotDates'
import { t } from '../../messages'
import './snapshot.css'

defineOptions({ name: 'SnapshotCalendar' })
const emit = defineEmits(['close'])
const snap = useSnapshotStore()
const weeks = computed(() => calendarWeeks(snap.minDate, snap.maxDate))
const weekdays = computed(() => [...t('SEW_SNAP_WEEKDAYS')])
const count = (date) => snap.calendar.days?.[date] ?? 0
const countText = (date) => (count(date) > 0 ? count(date).toLocaleString('ko-KR') : '')
// 달이 바뀌는 칸(첫 칸·1일)에는 월을 함께 적는다
const label = (d, first) => (first || d.day === 1 ? `${Number(d.date.slice(5, 7))}/${d.day}` : String(d.day))

// ── 고르기 ──
let anchor = snap.date // Shift 범위의 기준 날
let dragFrom = null
const preview = ref(null) // 끄는 동안 칠할 범위 [이른 날, 늦은 날]
const range = computed(() => preview.value ?? (snap.date ? [snap.date, snap.dateTo ?? snap.date] : null))
const inRange = (date) => !!range.value && date >= range.value[0] && date <= range.value[1]
const isEdge = (date) => !!range.value && (date === range.value[0] || date === range.value[1])
const usable = (date) => !!date && !!snap.minDate && date >= snap.minDate && date <= snap.maxDate

function choose(date, shift) {
  if (shift && anchor) { snap.setDates(anchor, date); return }
  anchor = date
  snap.setDates(date, date)
}
// 포인터(마우스·터치): 누른 날부터 끌어 간 날까지. 제자리에서 떼면 그 하루.
function onDown(e, date) {
  // 꺼진 날(보관 기간 밖)에도 브라우저는 pointerdown 을 보낸다(click 만 막는다) — 여기서 거른다
  if (e.button || !usable(date)) return
  if (e.shiftKey && anchor) { snap.setDates(anchor, date); return }
  anchor = date
  dragFrom = date
  preview.value = [date, date]
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', stopDrag)
}
function onMove(e) {
  if (!dragFrom) return
  // 단추를 놓았는데 pointerup 을 받지 못했다(창 밖에서 뗌·메뉴가 뜸) — 끌기를 끝낸다(고르지 않는다)
  if (e.buttons === 0) { stopDrag(); return }
  // 터치는 누른 칸이 계속 target 이라 손가락 아래의 칸을 찾는다
  const under = (typeof document.elementFromPoint === 'function' && Number.isFinite(e.clientX) ? document.elementFromPoint(e.clientX, e.clientY) : null) || e.target
  const date = under?.closest?.('[data-date]')?.getAttribute('data-date')
  if (usable(date)) preview.value = orderDates(dragFrom, date)
}
function stopDrag() {
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', stopDrag)
  dragFrom = null
  preview.value = null
}
function onUp() {
  if (!dragFrom) return
  const [from, to] = preview.value ?? [dragFrom, dragFrom]
  stopDrag()
  snap.setDates(from, to)
}
// 키보드(Enter·Space)는 click 으로 온다 — 포인터로 누른 것(detail > 0)은 위에서 이미 처리했다
function onClick(e, date) { if (!e.detail) choose(date, e.shiftKey) }
onBeforeUnmount(stopDrag)
// 열려 있는 동안 새로 고침·설비 바꿈으로 날짜별 장 수가 비워지면 다시 받는다
watch(() => snap.calendar.status, (status) => { if (status === 'idle') snap.openCalendar() })

// ── 한 번에 고르기 ──
const total = computed(() => (snap.minDate && snap.maxDate ? spanDays(snap.minDate, snap.maxDate) : 0))
function recent(n) {
  if (!snap.maxDate) return
  anchor = addDays(snap.maxDate, 1 - n)
  snap.setDates(anchor, snap.maxDate)
}
function reset() {
  anchor = snap.range?.latest ?? snap.date
  snap.resetDates()
}
const btn = `h-6 px-2 rounded-md text-[11px] ${SECONDARY}`
</script>

<template>
  <div class="se-snap-cal" role="dialog" :aria-label="t('SEW_SNAP_DATE_PICK')" data-testid="se-snap-calendar">
    <div class="text-gray-700 dark:text-gray-200 font-semibold">{{ t('SEW_SNAP_CAL_TITLE') }}</div>
    <div class="se-snap-cal-grid se-snap-cal-head"><span v-for="c in weekdays" :key="c">{{ c }}</span></div>
    <div class="se-snap-cal-days" @pointermove="onMove">
      <div v-for="(week, wi) in weeks" :key="week[0].date" class="se-snap-cal-grid">
        <button v-for="(d, di) in week" :key="d.date" type="button" data-testid="se-snap-cal-day" :data-date="d.date" :data-has="count(d.date) > 0 ? '1' : undefined"
          :class="{ in: d.inRange && inRange(d.date), edge: d.inRange && isEdge(d.date) }"
          :disabled="!d.inRange" :aria-pressed="d.inRange && inRange(d.date) ? 'true' : 'false'" :title="count(d.date) > 0 ? t('SEW_SNAP_CAL_COUNT', { n: count(d.date) }) : undefined"
          @pointerdown="onDown($event, d.date)" @click="onClick($event, d.date)">
          {{ label(d, wi === 0 && di === 0) }}<small>{{ countText(d.date) }}</small>
        </button>
      </div>
    </div>
    <p>{{ t('SEW_SNAP_CAL_HINT') }}</p>
    <p v-if="snap.minDate">{{ t('SEW_SNAP_CAL_NOTE', { date: snap.minDate }) }}</p>
    <p v-if="snap.calendar.status === 'loading'">{{ t('SEW_SNAP_CAL_LOADING') }}</p>
    <p v-else-if="snap.calendar.status === 'error'">{{ t('SEW_SNAP_CAL_FAILED') }}</p>
    <p v-else-if="snap.calendar.truncated">{{ t('SEW_SNAP_CAL_TRUNCATED') }}</p>
    <div class="mt-2 flex flex-wrap gap-1">
      <button type="button" :class="btn" data-testid="se-snap-cal-all" @click="recent(total)">{{ t('SEW_SNAP_CAL_ALL', { n: total }) }}</button>
      <button v-if="total > 7" type="button" :class="btn" data-testid="se-snap-cal-recent-7" @click="recent(7)">{{ t('SEW_SNAP_CAL_RECENT', { n: 7 }) }}</button>
      <button v-if="total > 3" type="button" :class="btn" data-testid="se-snap-cal-recent-3" @click="recent(3)">{{ t('SEW_SNAP_CAL_RECENT', { n: 3 }) }}</button>
      <span class="flex-1" />
      <button type="button" :class="btn" :title="t('SEW_SNAP_CAL_RESET_HINT')" data-testid="se-snap-cal-reset" @click="reset">{{ t('SEW_SNAP_CAL_RESET') }}</button>
      <button type="button" class="h-6 px-2 rounded-md text-[11px] font-medium bg-primary-500 hover:bg-primary-600 text-white" data-testid="se-snap-cal-close" @click="emit('close')">{{ t('SEW_SNAP_CAL_CLOSE') }}</button>
    </div>
  </div>
</template>
