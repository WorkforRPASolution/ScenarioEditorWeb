'use strict'
// 스냅샷 표시 시각·근무조·날짜 범위·걸치는 달 (P3 설계 §5.3·§7).
// - 표시 시각 = 파일 ms + 설비 보정(분)을 표시 시간대로 읽은 시각(결정 2026-11-03).
// - 시간대 계산은 Intl.DateTimeFormat 만 쓴다(새 의존성 없음).
const RETENTION_MS = 1296000 * 1000 // 보관 15일 (Cassandra TTL 1,296,000초)
const MINUTE = 60000
const HOUR = 3600000
const DAY = 86400000
const MONTH_MARGIN_MS = 14 * HOUR // 어느 시간대든 UTC 와 14시간 넘게 벌어지지 않는다
const MAX_DIFF_MIN = 1e9 // 이보다 크면 날짜 계산이 깨진다(약 1,900년)
const NAME_DIGITS = 13
const NAME_MAX = 9999999999999

const formatters = new Map()
function formatter(tz) {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
    formatters.set(tz, f)
  }
  return f
}

// ms 를 시간대 tz 의 벽시계로 읽는다 → { year, month, day, hour, minute, second } (모두 수)
function wall(ms, tz) {
  const out = {}
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return out
}

// 그 시각에 tz 가 UTC 보다 앞선 ms
function offsetAt(ms, tz) {
  const w = wall(ms, tz)
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000
}

// tz 의 그 날 0시 → ms. UTC 로 가정한 값에서 시간대 차이를 빼기를 두 번 한다(서머타임 날에도 맞는다).
function midnight(year, month, day, tz) {
  const guess = Date.UTC(year, month - 1, day)
  const first = guess - offsetAt(guess, tz)
  return guess - offsetAt(first, tz)
}

const pad = (n, width) => String(n).padStart(width, '0')

function shiftOf(hour) {
  if (hour >= 22 || hour < 6) return 'GY'
  return hour < 14 ? 'DAY' : 'SWING'
}

// 설비 보정값(분). 정수가 아니거나 없으면 0, 음수는 그대로.
function timeDiffOf(v) {
  let n = v
  if (n && typeof n === 'object' && typeof n.toNumber === 'function') {
    try { n = n.toNumber() } catch { return 0 }
  }
  if (typeof n === 'string' && /^\s*-?\d+\s*$/.test(n)) n = Number(n)
  if (typeof n !== 'number' || !Number.isInteger(n) || Math.abs(n) > MAX_DIFF_MIN) return 0
  return n
}

function displayOf(ms, diffMin, tz) {
  const t = ms + diffMin * MINUTE
  const w = wall(t, tz)
  return {
    date: `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)}`,
    time: `${pad(w.hour, 2)}:${pad(w.minute, 2)}:${pad(w.second, 2)}`,
    milli: pad(((t % 1000) + 1000) % 1000, 3),
    shift: shiftOf(w.hour)
  }
}

// 표시 날짜 하루의 원본 ms 범위 [from, to). 날짜 꼴이 아니면 null.
function dayRange(date, diffMin, tz) {
  const m = typeof date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null
  if (!m || date.includes('\n')) return null
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  const shift = diffMin * MINUTE
  return {
    from: midnight(year, month, day, tz) - shift,
    to: midnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz) - shift
  }
}

// [from − 14시간, to + 14시간) 을 UTC 로 본 달 — 스냅샷 서버 시간대가 무엇이든 그 범위의 파티션을 다 본다.
function monthsOf(from, to) {
  const first = new Date(from - MONTH_MARGIN_MS)
  const last = new Date(to + MONTH_MARGIN_MS - 1)
  const out = []
  let year = first.getUTCFullYear()
  let month = first.getUTCMonth() + 1
  const end = last.getUTCFullYear() * 12 + last.getUTCMonth() + 1
  while (year * 12 + month <= end) {
    out.push({ year, month })
    month++
    if (month > 12) { month = 1; year++ }
  }
  return out
}

// 그림 파티션 후보 — 파티션 시간대로 본 그 날, 앞 날, 뒷날 순.
function partitionDays(ms, tz) {
  const w = wall(ms, tz)
  return [0, -1, 1].map((delta) => {
    const d = new Date(Date.UTC(w.year, w.month - 1, w.day + delta))
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
  })
}

// 이름 범위 경계 — 파일 이름이 13자리 ms 로 시작하므로 같은 자릿수로 맞춘다.
function nameBound(ms) {
  const n = Math.min(NAME_MAX, Math.max(0, Math.floor(ms)))
  return pad(n, NAME_DIGITS)
}

const remaining = (ms, now) => ms + RETENTION_MS - now
const daysLeft = (ms, now) => Math.max(0, Math.ceil(remaining(ms, now) / DAY))
const maxAgeOf = (ms, now) => Math.max(0, Math.floor(remaining(ms, now) / 1000))

module.exports = { RETENTION_MS, timeDiffOf, displayOf, dayRange, monthsOf, partitionDays, nameBound, daysLeft, maxAgeOf }
