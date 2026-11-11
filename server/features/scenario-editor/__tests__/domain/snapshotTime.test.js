// 표시 시각·근무조·날짜 범위·걸치는 달 (P3 설계 §5.3·§7).
import { describe, it, expect } from 'vitest'
import {
  RETENTION_MS, timeDiffOf, displayOf, dayRange, monthsOf, partitionDays, nameBound, daysLeft, maxAgeOf
} from '../../domain/snapshotTime'

const KST = 'Asia/Seoul'
const HOUR = 3600000
const DAY = 86400000
// KST 벽시계 → ms (KST 는 늘 UTC+9)
const kst = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s, ms)

describe('snapshotTime.displayOf — 표시 시각', () => {
  it('파일 ms 를 표시 시간대로 읽는다', () => {
    expect(displayOf(Date.UTC(2026, 10, 11, 0, 13, 2, 4), 0, KST)).toEqual({ date: '2026-11-11', time: '09:13:02', milli: '004', shift: 'DAY' })
  })

  it('근무조 경계 — 시작 포함·끝 제외', () => {
    const table = [
      [[5, 59, 59], 'GY'], [[6, 0, 0], 'DAY'], [[13, 59, 59], 'DAY'], [[14, 0, 0], 'SWING'],
      [[21, 59, 59], 'SWING'], [[22, 0, 0], 'GY'], [[0, 0, 0], 'GY'], [[23, 59, 59], 'GY']
    ]
    for (const [[h, mi, s], shift] of table) {
      expect(displayOf(kst(2026, 11, 11, h, mi, s), 0, KST).shift, `${h}:${mi}:${s}`).toBe(shift)
    }
  })

  it('보정(분)만큼 늦거나 이르다 — 근무조·날짜도 함께 바뀐다', () => {
    expect(displayOf(kst(2026, 11, 11, 13, 45, 0), 30, KST)).toMatchObject({ time: '14:15:00', shift: 'SWING' })
    expect(displayOf(kst(2026, 11, 11, 6, 10, 0), -30, KST)).toMatchObject({ time: '05:40:00', shift: 'GY' })
    expect(displayOf(kst(2026, 11, 11, 23, 50, 0), 30, KST)).toMatchObject({ date: '2026-11-12', time: '00:20:00', shift: 'GY' })
    expect(displayOf(kst(2026, 11, 1, 0, 10, 0), -30, KST)).toMatchObject({ date: '2026-10-31', time: '23:40:00' })
  })

  it('다른 시간대', () => {
    expect(displayOf(Date.UTC(2026, 10, 11, 0, 13, 2, 4), 0, 'UTC')).toEqual({ date: '2026-11-11', time: '00:13:02', milli: '004', shift: 'GY' })
    expect(displayOf(Date.UTC(2026, 10, 11, 0, 13, 2, 4), 0, 'America/New_York')).toMatchObject({ date: '2026-11-10', time: '19:13:02', shift: 'SWING' })
  })
})

describe('snapshotTime.dayRange — 표시 날짜 하루의 원본 ms 범위', () => {
  it('그 날 0시부터 다음 날 0시 전까지', () => {
    expect(dayRange('2026-11-11', 0, KST)).toEqual({ from: Date.UTC(2026, 10, 10, 15), to: Date.UTC(2026, 10, 11, 15) })
  })

  it('보정이 있으면 범위가 그만큼 앞(양수)·뒤(음수)로 간다', () => {
    expect(dayRange('2026-11-11', 30, KST)).toEqual({ from: Date.UTC(2026, 10, 10, 14, 30), to: Date.UTC(2026, 10, 11, 14, 30) })
    expect(dayRange('2026-11-11', -30, KST)).toEqual({ from: Date.UTC(2026, 10, 10, 15, 30), to: Date.UTC(2026, 10, 11, 15, 30) })
  })

  it('범위 안의 ms 는 그 날로, 바로 밖은 다른 날로 보인다', () => {
    for (const diff of [0, 45, -45]) {
      const { from, to } = dayRange('2026-11-11', diff, KST)
      expect(displayOf(from, diff, KST)).toMatchObject({ date: '2026-11-11', time: '00:00:00' })
      expect(displayOf(to - 1, diff, KST)).toMatchObject({ date: '2026-11-11', time: '23:59:59', milli: '999' })
      expect(displayOf(from - 1, diff, KST).date).toBe('2026-11-10')
      expect(displayOf(to, diff, KST).date).toBe('2026-11-12')
    }
  })

  it('서머타임 시작일은 23시간, 끝나는 날은 25시간', () => {
    const start = dayRange('2026-03-08', 0, 'America/New_York')
    expect(start.to - start.from).toBe(23 * HOUR)
    expect(start.from).toBe(Date.UTC(2026, 2, 8, 5))
    const end = dayRange('2026-11-01', 0, 'America/New_York')
    expect(end.to - end.from).toBe(25 * HOUR)
  })

  it('월말·연말에서 다음 날로 넘어간다', () => {
    expect(dayRange('2026-11-30', 0, KST)).toEqual({ from: kst(2026, 11, 30), to: kst(2026, 12, 1) })
    expect(dayRange('2026-12-31', 0, KST)).toEqual({ from: kst(2026, 12, 31), to: kst(2027, 1, 1) })
    expect(dayRange('2028-02-29', 0, KST)).toEqual({ from: kst(2028, 2, 29), to: kst(2028, 3, 1) })
  })

  it('날짜 꼴이 아니면 null', () => {
    for (const v of ['2026-11-31', '2026-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '20261111', 'abc', '', ' 2026-11-11', '2026-11-11T00:00', null, undefined, 20261111]) {
      expect(dayRange(v, 0, KST), JSON.stringify(v)).toBeNull()
    }
  })
})

describe('snapshotTime.monthsOf — 범위를 ±14시간 넓혀 걸치는 달(UTC)', () => {
  const months = (date, tz = KST) => { const r = dayRange(date, 0, tz); return monthsOf(r.from, r.to) }

  it('월 중순은 그 달 하나', () => {
    expect(months('2026-11-11')).toEqual([{ year: 2026, month: 11 }])
  })

  it('1일은 앞 달과 그 달, 말일은 그 달과 다음 달', () => {
    expect(months('2026-11-01')).toEqual([{ year: 2026, month: 10 }, { year: 2026, month: 11 }])
    expect(months('2026-11-30')).toEqual([{ year: 2026, month: 11 }, { year: 2026, month: 12 }])
  })

  it('해가 바뀌는 곳', () => {
    expect(months('2026-01-01')).toEqual([{ year: 2025, month: 12 }, { year: 2026, month: 1 }])
    expect(months('2026-12-31')).toEqual([{ year: 2026, month: 12 }, { year: 2027, month: 1 }])
  })

  it('끝은 미포함 — 꼭 달 경계에서 끝나면 다음 달을 넣지 않는다', () => {
    const from = Date.UTC(2026, 10, 10)
    expect(monthsOf(from, Date.UTC(2026, 11, 1) - 14 * HOUR)).toEqual([{ year: 2026, month: 11 }])
    expect(monthsOf(from, Date.UTC(2026, 11, 1) - 14 * HOUR + 1)).toEqual([{ year: 2026, month: 11 }, { year: 2026, month: 12 }])
  })

  it('긴 범위는 사이의 달을 모두, 오름차순·중복 없이', () => {
    expect(monthsOf(Date.UTC(2026, 9, 20), Date.UTC(2027, 0, 5))).toEqual([
      { year: 2026, month: 10 }, { year: 2026, month: 11 }, { year: 2026, month: 12 }, { year: 2027, month: 1 }
    ])
  })
})

describe('snapshotTime.partitionDays — 그림 파티션(그 날·앞 날·뒷날)', () => {
  it('파티션 시간대로 본 그 날이 먼저', () => {
    expect(partitionDays(Date.UTC(2026, 10, 10, 15, 0, 0), KST)).toEqual([
      { year: 2026, month: 11, day: 11 }, { year: 2026, month: 11, day: 10 }, { year: 2026, month: 11, day: 12 }
    ])
    expect(partitionDays(Date.UTC(2026, 10, 10, 14, 59, 59), KST)[0]).toEqual({ year: 2026, month: 11, day: 10 })
  })

  it('월초·연말에서 앞뒤 날이 달·해를 넘는다', () => {
    expect(partitionDays(kst(2026, 11, 1, 12), KST)).toEqual([
      { year: 2026, month: 11, day: 1 }, { year: 2026, month: 10, day: 31 }, { year: 2026, month: 11, day: 2 }
    ])
    expect(partitionDays(kst(2026, 12, 31, 12), KST)).toEqual([
      { year: 2026, month: 12, day: 31 }, { year: 2026, month: 12, day: 30 }, { year: 2027, month: 1, day: 1 }
    ])
  })
})

describe('snapshotTime.timeDiffOf — 설비 보정값(분)', () => {
  it('정수는 그대로(음수 포함), 정수 글자도 받는다', () => {
    expect(timeDiffOf(5)).toBe(5)
    expect(timeDiffOf(-5)).toBe(-5)
    expect(timeDiffOf(0)).toBe(0)
    expect(timeDiffOf('7')).toBe(7)
    expect(timeDiffOf(' -7 ')).toBe(-7)
  })

  it('없거나 정수가 아니면 0', () => {
    for (const v of [null, undefined, '', '  ', 'abc', '1.5', '7분', 1.5, NaN, Infinity, -Infinity, true, {}, [], [5]]) {
      expect(timeDiffOf(v), JSON.stringify(v)).toBe(0)
    }
  })

  it('Long 꼴(toNumber)도 읽는다', () => {
    expect(timeDiffOf({ toNumber: () => 9 })).toBe(9)
    expect(timeDiffOf({ toNumber: () => 1.5 })).toBe(0)
    expect(timeDiffOf({ toNumber: () => { throw new Error('x') } })).toBe(0)
  })

  it('날짜 계산이 깨질 만큼 큰 값은 0', () => {
    expect(timeDiffOf(1e9)).toBe(1e9)
    expect(timeDiffOf(1e9 + 1)).toBe(0)
    expect(timeDiffOf(-1e9 - 1)).toBe(0)
    expect(timeDiffOf('99999999999999999999')).toBe(0)
  })
})

describe('snapshotTime — 이름 경계·보관 기간', () => {
  it('nameBound: 13자리, 0 채움, 음수는 0', () => {
    expect(nameBound(1762820000123)).toBe('1762820000123')
    expect(nameBound(5)).toBe('0000000000005')
    expect(nameBound(0)).toBe('0000000000000')
    expect(nameBound(-1)).toBe('0000000000000')
    expect(nameBound(1762820000123.7)).toBe('1762820000123')
    expect(nameBound(1e13)).toBe('9999999999999') // 14자리가 되면 이름 순서가 깨진다
  })

  it('보관 15일', () => {
    expect(RETENTION_MS).toBe(1296000 * 1000)
  })

  it('daysLeft: 올림, 0 아래로 가지 않는다', () => {
    const now = kst(2026, 11, 11, 9)
    expect(daysLeft(now, now)).toBe(15)
    expect(daysLeft(now - 14.5 * DAY, now)).toBe(1)
    expect(daysLeft(now - 14 * DAY, now)).toBe(1)
    expect(daysLeft(now - 14 * DAY + 1, now)).toBe(2)
    expect(daysLeft(now - 15 * DAY, now)).toBe(0)
    expect(daysLeft(now - 16 * DAY, now)).toBe(0)
  })

  it('maxAgeOf: 남은 보관 초(내림), 0 아래로 가지 않는다', () => {
    const now = kst(2026, 11, 11, 9)
    expect(maxAgeOf(now, now)).toBe(1296000)
    expect(maxAgeOf(now - 14.5 * DAY, now)).toBe(43200)
    expect(maxAgeOf(now - 15 * DAY + 1999, now)).toBe(1)
    expect(maxAgeOf(now - 15 * DAY + 999, now)).toBe(0)
    expect(maxAgeOf(now - 15 * DAY, now)).toBe(0)
    expect(maxAgeOf(now - 16 * DAY, now)).toBe(0)
  })
})
