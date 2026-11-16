// 날짜 글자('YYYY-MM-DD') 계산 — 시간대 없이 (P3 설계 §4.2 날짜·달력)
import { describe, it, expect } from 'vitest'
import { isDate, addDays, laterOf, clampDate, weekdayOf, calendarWeeks, orderDates, spanDays, clampRange, shiftRange } from '../editor/snapshotDates'

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

// 여러 날 고르기(사내 요청 2026-11-16)
describe('날짜 범위', () => {
  it('orderDates 는 이른 날·늦은 날 순으로, spanDays 는 양 끝을 넣은 날 수', () => {
    expect(orderDates('2026-11-16', '2026-11-10')).toEqual(['2026-11-10', '2026-11-16'])
    expect(orderDates('2026-11-10', '2026-11-10')).toEqual(['2026-11-10', '2026-11-10'])
    expect(spanDays('2026-11-10', '2026-11-16')).toBe(7)
    expect(spanDays('2026-11-16', '2026-11-16')).toBe(1)
    expect(spanDays('2026-10-30', '2026-11-02')).toBe(4)
  })
  it('clampRange 는 양 끝을 보관 기간 안으로 — 통째로 밖이면 가까운 끝 하루', () => {
    expect(clampRange('2026-11-05', '2026-11-08', '2026-11-02', '2026-11-16')).toEqual(['2026-11-05', '2026-11-08'])
    expect(clampRange('2026-10-28', '2026-11-04', '2026-11-02', '2026-11-16')).toEqual(['2026-11-02', '2026-11-04'])
    expect(clampRange('2026-11-14', '2026-11-20', '2026-11-02', '2026-11-16')).toEqual(['2026-11-14', '2026-11-16'])
    expect(clampRange('2026-10-20', '2026-10-25', '2026-11-02', '2026-11-16')).toEqual(['2026-11-02', '2026-11-02'])
    expect(clampRange('2026-11-18', '2026-11-20', '2026-11-02', '2026-11-16')).toEqual(['2026-11-16', '2026-11-16'])
  })
  it('shiftRange 는 길이를 둔 채 옮긴다 — 한쪽이라도 보관 기간을 벗어나면 null', () => {
    expect(shiftRange('2026-11-10', '2026-11-12', 1, '2026-11-02', '2026-11-16')).toEqual(['2026-11-11', '2026-11-13'])
    expect(shiftRange('2026-11-10', '2026-11-12', -1, '2026-11-02', '2026-11-16')).toEqual(['2026-11-09', '2026-11-11'])
    expect(shiftRange('2026-11-14', '2026-11-16', 1, '2026-11-02', '2026-11-16')).toBeNull()
    expect(shiftRange('2026-11-02', '2026-11-02', -1, '2026-11-02', '2026-11-16')).toBeNull()
    expect(shiftRange('2026-11-16', '2026-11-16', -1, '2026-11-02', '2026-11-16')).toEqual(['2026-11-15', '2026-11-15'])
  })
})
