import { describe, it, expect } from 'vitest'
import { targetLabel, targetKind, multiLabel, formatCrtime, intervalSec, actionLabel, conditionLabel, scenarioTypeLabel, enabledLabel } from '../format'

describe('format', () => {
  it('targetLabel·targetKind', () => {
    expect(targetLabel({ kind: 'next' })).toBe('NEXT')
    expect(targetLabel({ kind: 'end', value: 'SUCCESS' })).toBe('SUCCESS')
    expect(targetLabel({ kind: 'step', uid: 's2', no: 3 })).toBe('→3')
    expect(targetLabel({ kind: 'raw', value: -2 })).toBe('? -2')
    expect(targetKind({ kind: 'end', value: 'FAIL' })).toBe('end-fail')
    expect(targetKind({ kind: 'raw', value: 9 })).toBe('raw')
  })
  it('multiLabel: 개수 원문 + 연산 기호', () => {
    expect(multiLabel({ count: '1', op: 0 })).toBe('1개 ==')
    expect(multiLabel({ count: ' 5', op: 1 })).toBe(' 5개 >=')
    expect(multiLabel({ count: '2', op: null })).toBe('2개 ?')
    expect(multiLabel(null)).toBe('—')
  })
  it('formatCrtime 은 보는 사람 시간대', () => {
    const ms = new Date(2026, 9, 28, 14, 32, 5).getTime()
    expect(formatCrtime(ms)).toBe('2026-10-28 14:32:05')
  })
  it('intervalSec 은 정수 나눗셈(사내 표 INTERVAL 열)', () => {
    expect(intervalSec(2500)).toBe(2)
    expect(intervalSec(999)).toBe(0)
  })
  it('라벨', () => {
    expect(actionLabel('MouseLeftClick')).toBe('마우스 클릭')
    expect(actionLabel(null)).toBe('알 수 없는 동작')
    expect(conditionLabel('eqpState')).toBe('설비 상태')
    expect([scenarioTypeLabel(1), scenarioTypeLabel(99)]).toEqual(['알람자동조치', '99'])
    expect([enabledLabel(true), enabledLabel(false), enabledLabel(null)]).toEqual(['켜짐', '꺼짐', '?'])
  })
})
