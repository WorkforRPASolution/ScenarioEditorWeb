// 날짜 글자('YYYY-MM-DD') 계산 — 시간대 없이 (P3 설계 §4.2 날짜·달력)
import { describe, it, expect } from 'vitest'
import { isDate, addDays, laterOf, clampDate, weekdayOf, calendarWeeks } from '../editor/snapshotDates'

describe('isDate', () => {
  it('있는 날짜만', () => {
    expect(isDate('2026-11-11')).toBe(true)
    expect(isDate('2026-02-30')).toBe(false)
    expect(isDate('2026-1-1')).toBe(false)
    expect(isDate('abc')).toBe(false)
    expect(isDate(null)).toBe(false)
  })
})

describe('addDays', () => {
  it('월·해 경계를 넘는다', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-11-11', -15)).toBe('2026-10-27')
    expect(addDays('2026-11-11', 0)).toBe('2026-11-11')
  })
})

describe('laterOf · clampDate · weekdayOf', () => {
  it('laterOf 는 늦은 날, null 은 건너뛴다', () => {
    expect(laterOf('2026-11-11', '2026-11-12')).toBe('2026-11-12')
    expect(laterOf('2026-11-11', null)).toBe('2026-11-11')
    expect(laterOf(null, '2026-11-12')).toBe('2026-11-12')
    expect(laterOf(null, null)).toBeNull()
  })
  it('clampDate 는 범위 안으로', () => {
    expect(clampDate('2026-10-01', '2026-10-27', '2026-11-11')).toBe('2026-10-27')
    expect(clampDate('2026-12-01', '2026-10-27', '2026-11-11')).toBe('2026-11-11')
    expect(clampDate('2026-11-01', '2026-10-27', '2026-11-11')).toBe('2026-11-01')
  })
  it('요일 — 0 은 일요일', () => {
    expect(weekdayOf('2026-11-11')).toBe(3)
    expect(weekdayOf('2026-11-08')).toBe(0)
  })
})

describe('calendarWeeks — 보관 기간만 고르는 달력', () => {
  it('처음 날이 든 주의 일요일부터 끝 날이 든 주의 토요일까지', () => {
    const weeks = calendarWeeks('2026-10-27', '2026-11-11')
    expect(weeks).toHaveLength(3)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks[0][0]).toEqual({ date: '2026-10-25', day: 25, inRange: false })
    expect(weeks[0][2]).toEqual({ date: '2026-10-27', day: 27, inRange: true })
    expect(weeks[2][3]).toEqual({ date: '2026-11-11', day: 11, inRange: true })
    expect(weeks[2][4]).toEqual({ date: '2026-11-12', day: 12, inRange: false })
    expect(weeks[2][6].date).toBe('2026-11-14')
    expect(weeks.flat().filter((d) => d.inRange)).toHaveLength(16)
  })
  it('하루뿐이어도 한 주', () => {
    const weeks = calendarWeeks('2026-11-11', '2026-11-11')
    expect(weeks).toHaveLength(1)
    expect(weeks[0].filter((d) => d.inRange).map((d) => d.date)).toEqual(['2026-11-11'])
  })
  it('날짜 꼴이 아니거나 거꾸로면 빈 달력', () => {
    expect(calendarWeeks(null, '2026-11-11')).toEqual([])
    expect(calendarWeeks('2026-11-12', '2026-11-11')).toEqual([])
  })
})
