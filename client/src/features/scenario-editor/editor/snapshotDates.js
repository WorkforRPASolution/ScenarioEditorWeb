// 날짜 글자('YYYY-MM-DD') 계산(P3 설계 §4.2 날짜·달력). 시간대를 쓰지 않는다 — 어느 날이 오늘인지는 서버가 정한다(GET /snapshots/days).
const DAY = 86400000
const RE = /^(\d{4})-(\d{2})-(\d{2})$/
const toMs = (date) => { const m = RE.exec(date); return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) }
const toDate = (ms) => new Date(ms).toISOString().slice(0, 10)

export function isDate(s) {
  return typeof s === 'string' && RE.test(s) && toDate(toMs(s)) === s
}
export const addDays = (date, n) => toDate(toMs(date) + n * DAY)
export const laterOf = (a, b) => (!a ? b ?? null : !b ? a : a > b ? a : b)
export const clampDate = (date, min, max) => (date < min ? min : date > max ? max : date)
// 0 = 일요일
export const weekdayOf = (date) => new Date(toMs(date)).getUTCDay()

// min 이 든 주의 일요일부터 max 가 든 주의 토요일까지 — 주마다 일곱 칸 { date, day, inRange }
export function calendarWeeks(min, max) {
  if (!isDate(min) || !isDate(max) || min > max) return []
  const start = addDays(min, -weekdayOf(min))
  const end = addDays(max, 6 - weekdayOf(max))
  const weeks = []
  for (let d = start; d <= end; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const date = addDays(d, i)
      return { date, day: Number(date.slice(8)), inRange: date >= min && date <= max }
    }))
  }
  return weeks
}
