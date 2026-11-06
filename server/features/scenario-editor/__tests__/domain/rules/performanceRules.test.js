import { describe, it, expect } from 'vitest'
import { checkPerformance, isPerformanceComplete, PERFORMANCE_CODES } from '../../../domain/rules/performanceRules'
import { RULES } from '../../../domain/rules/codes'

const perf = {
  PerformType: 1, Group: 'A_1', Grade: 2, SupervisorComment: 'abcde', ScenarioDescription: 'd', ManWorkLoss: 10, EqpStopLoss: 0,
  WaferLoss: 0, InvestCostLoss: 0, AccidentType: 0, AccidentInfo: '', AdditionalEffect: '', Trigger: 1, TriggerInfo: ''
}
const ctxP = { previous: null, registeredIds: new Set(['a', 'b', 'c']) }
const codes = (i, c = ctxP) => checkPerformance(i, c).map((x) => x.code)
const dev = (KnoxId, Contribution) => ({ KnoxId, Name: KnoxId.toUpperCase(), Contribution })

describe('checkPerformance', () => {
  it('정상은 빈 목록, 코드는 RULES 에 넣지 않는다', () => {
    expect(codes(perf)).toEqual([])
    for (const c of PERFORMANCE_CODES) expect(RULES[c]).toBeUndefined()
    expect(PERFORMANCE_CODES).toEqual(expect.arrayContaining(['TRIGGER_REQUIRED', 'DEV_TOTAL', 'GROUP_FORMAT']))
  })
  it('사내 문구가 요구하던 세 가지를 검사', () => {
    const c = codes({ ...perf, Trigger: 0, Grade: 0, SupervisorComment: 'abc' })
    expect(c).toEqual(expect.arrayContaining(['TRIGGER_REQUIRED', 'GRADE_REQUIRED', 'COMMENT_SHORT']))
  })
  it('COMMENT_SHORT 경계: trim 뒤 4 막힘, 5 통과', () => {
    expect(codes({ ...perf, SupervisorComment: ' abcd ' })).toEqual(['COMMENT_SHORT'])
    expect(codes({ ...perf, SupervisorComment: ' abcde ' })).toEqual([])
    expect(codes({ ...perf, SupervisorComment: undefined })).toEqual(['COMMENT_SHORT'])
  })
  it('TRIGGER_NOT_SELECTABLE: RV(2)·EqState(3) 은 이전 값과 같을 때만', () => {
    expect(codes({ ...perf, Trigger: 2 })).toEqual(['TRIGGER_NOT_SELECTABLE'])
    expect(codes({ ...perf, Trigger: 3 })).toEqual(['TRIGGER_NOT_SELECTABLE'])
    expect(codes({ ...perf, Trigger: 2 }, { ...ctxP, previous: { Trigger: 2 } })).toEqual([])
    expect(codes({ ...perf, Trigger: 3 }, { ...ctxP, previous: { Trigger: 2 } })).toEqual(['TRIGGER_NOT_SELECTABLE'])
    expect(codes({ ...perf, Trigger: 1 }, { ...ctxP, previous: { Trigger: 2 } })).toEqual([])
  })
  it('효과 없음은 NotUsed 가 아니면 막는다', () => {
    const none = { ...perf, ManWorkLoss: 0, EqpStopLoss: 0, WaferLoss: 0, InvestCostLoss: 0, AccidentType: 0 }
    expect(codes({ ...none, Grade: 2 })).toContain('EFFECT_REQUIRED')
    expect(codes({ ...none, Grade: 6 })).not.toContain('EFFECT_REQUIRED')
    expect(codes({ ...none, Grade: 2, AccidentType: 1, AccidentInfo: 'x' })).not.toContain('EFFECT_REQUIRED')
    for (const k of ['ManWorkLoss', 'EqpStopLoss', 'WaferLoss', 'InvestCostLoss']) expect(codes({ ...none, Grade: 2, [k]: 1 })).not.toContain('EFFECT_REQUIRED')
  })
  it('EFFECT_VALUE 경계 -1/0/2147483647/2147483648·정수 아님', () => {
    for (const k of ['ManWorkLoss', 'EqpStopLoss', 'WaferLoss', 'InvestCostLoss']) {
      for (const v of [0, 1, 2147483647]) expect(codes({ ...perf, [k]: v })).not.toContain('EFFECT_VALUE')
      for (const v of [-1, 2147483648, 1.5, '3', null, NaN]) expect(codes({ ...perf, [k]: v })).toContain('EFFECT_VALUE')
    }
  })
  it('ACCIDENT_INFO_REQUIRED', () => {
    expect(codes({ ...perf, AccidentType: 1, AccidentInfo: '  ' })).toEqual(['ACCIDENT_INFO_REQUIRED'])
    expect(codes({ ...perf, AccidentType: 1, AccidentInfo: 'x' })).toEqual([])
    expect(codes({ ...perf, AccidentType: 0, AccidentInfo: '' })).toEqual([])
  })
  it('GROUP_FORMAT 는 PerformType 2 일 때만', () => {
    expect(codes({ ...perf, PerformType: 2, Group: 'AB_01' })).toEqual([])
    for (const g of ['ab', 'A-B', '', 'A B']) expect(codes({ ...perf, PerformType: 2, Group: g })).toEqual(['GROUP_FORMAT'])
    expect(codes({ ...perf, PerformType: 1, Group: 'ab' })).toEqual([])
  })
})

describe('원개발자', () => {
  const withDevs = (devs, c) => codes({ ...perf, CitizenDeveloper: devs }, c)
  it('입력에 없으면 보지 않는다', () => {
    expect(codes(perf, { ...ctxP, registeredIds: new Set() })).toEqual([])
  })
  it('원개발자 중복·합계', () => {
    expect(withDevs([dev('a', 60), dev('a', 50)])).toEqual(expect.arrayContaining(['DEV_DUPLICATE', 'DEV_TOTAL']))
  })
  it('DEV_DUPLICATE 는 두 번째 index', () => {
    const i = checkPerformance({ ...perf, CitizenDeveloper: [dev('a', 10), dev('b', 10), dev('a', 10)] }, ctxP).find((x) => x.code === 'DEV_DUPLICATE')
    expect(i.params).toEqual({ index: 2 })
  })
  it('DEV_UNKNOWN', () => {
    const i = checkPerformance({ ...perf, CitizenDeveloper: [dev('a', 50), dev('zzz', 50)] }, ctxP)
    expect(i.map((x) => x.code)).toEqual(['DEV_UNKNOWN'])
    expect(i[0].params).toEqual({ index: 1 })
  })
  it('기여도 경계 0/1/100/101', () => {
    expect(withDevs([dev('a', 1)])).toEqual([])
    expect(withDevs([dev('a', 100)])).toEqual([])
    expect(withDevs([dev('a', 0)])).toEqual(['DEV_CONTRIBUTION_RANGE'])
    expect(withDevs([dev('a', 101)])).toEqual(['DEV_CONTRIBUTION_RANGE', 'DEV_TOTAL'])
    expect(withDevs([dev('a', 50.5)])).toEqual(['DEV_CONTRIBUTION_RANGE'])
    const i = checkPerformance({ ...perf, CitizenDeveloper: [dev('a', 5), dev('b', 0)] }, ctxP)
    expect(i[0].params).toEqual({ index: 1 })
  })
  it('합계 100 통과 101 막힘', () => {
    expect(withDevs([dev('a', 60), dev('b', 40)])).toEqual([])
    expect(withDevs([dev('a', 60), dev('b', 41)])).toEqual(['DEV_TOTAL'])
  })
  it('빈 배열은 통과', () => {
    expect(withDevs([])).toEqual([])
  })
})

describe('isPerformanceComplete', () => {
  it('완료 판정은 하나', () => {
    expect(isPerformanceComplete({ ...perf, Grade: 6, Trigger: 0 })).toBe(true)
    expect(isPerformanceComplete({ ...perf, Grade: 0, ManWorkLoss: 100 })).toBe(false)
    expect(isPerformanceComplete({ ...perf, Grade: 2, Trigger: 1, ManWorkLoss: 0, EqpStopLoss: 0, WaferLoss: 0, InvestCostLoss: 0, AccidentType: 3 })).toBe(true)
    expect(isPerformanceComplete(null)).toBe(false)
  })
  it('각 조건 하나씩', () => {
    expect(isPerformanceComplete({ ...perf, Trigger: 0 })).toBe(false)
    expect(isPerformanceComplete({ ...perf, ManWorkLoss: 0 })).toBe(false)
    for (const k of ['ManWorkLoss', 'EqpStopLoss', 'WaferLoss', 'InvestCostLoss']) {
      expect(isPerformanceComplete({ ...perf, ManWorkLoss: 0, [k]: 1 })).toBe(true)
    }
    expect(isPerformanceComplete(undefined)).toBe(false)
    expect(isPerformanceComplete({ ...perf, ManWorkLoss: 'x', AccidentType: 0 })).toBe(false)
  })
})
