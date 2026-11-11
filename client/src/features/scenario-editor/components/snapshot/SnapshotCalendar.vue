<script setup>
// 날짜 고르기(P3 설계 §4.2) — 보관 기간(서버가 준 가장 이른 날~끝 날)만 고를 수 있고, 스냅샷이 있는 날에 점을 찍는다.
// 날짜별 개수는 달력을 열 때 받는다(저장소 openCalendar). 받지 못해도 날짜는 고를 수 있다.
import { computed } from 'vue'
import { useSnapshotStore } from '../../stores/snapshotStore'
import { calendarWeeks } from '../../editor/snapshotDates'
import { t } from '../../messages'
import './snapshot.css'

defineOptions({ name: 'SnapshotCalendar' })
const emit = defineEmits(['close'])
const snap = useSnapshotStore()
const weeks = computed(() => calendarWeeks(snap.minDate, snap.maxDate))
const weekdays = computed(() => [...t('SEW_SNAP_WEEKDAYS')])
const count = (date) => snap.calendar.days?.[date] ?? 0
// 달이 바뀌는 칸(첫 칸·1일)에는 월을 함께 적는다
const label = (d, first) => (first || d.day === 1 ? `${Number(d.date.slice(5, 7))}/${d.day}` : String(d.day))
function pick(date) {
  snap.setDate(date)
  emit('close')
}
</script>

<template>
  <div class="se-snap-cal" role="dialog" :aria-label="t('SEW_SNAP_DATE_PICK')" data-testid="se-snap-calendar">
    <div class="text-gray-700 dark:text-gray-200 font-semibold">{{ t('SEW_SNAP_CAL_TITLE') }}</div>
    <div class="se-snap-cal-grid se-snap-cal-head"><span v-for="c in weekdays" :key="c">{{ c }}</span></div>
    <div v-for="(week, wi) in weeks" :key="week[0].date" class="se-snap-cal-grid">
      <button v-for="(d, di) in week" :key="d.date" type="button" data-testid="se-snap-cal-day" :data-date="d.date" :data-has="count(d.date) > 0 ? '1' : undefined"
        :disabled="!d.inRange" :aria-pressed="d.date === snap.date ? 'true' : 'false'" :title="count(d.date) > 0 ? t('SEW_SNAP_CAL_COUNT', { n: count(d.date) }) : undefined" @click="pick(d.date)">
        {{ label(d, wi === 0 && di === 0) }}
      </button>
    </div>
    <p v-if="snap.minDate">{{ t('SEW_SNAP_CAL_NOTE', { date: snap.minDate }) }}</p>
    <p v-if="snap.calendar.status === 'loading'">{{ t('SEW_SNAP_CAL_LOADING') }}</p>
    <p v-else-if="snap.calendar.status === 'error'">{{ t('SEW_SNAP_CAL_FAILED') }}</p>
    <p v-else-if="snap.calendar.truncated">{{ t('SEW_SNAP_CAL_TRUNCATED') }}</p>
  </div>
</template>
