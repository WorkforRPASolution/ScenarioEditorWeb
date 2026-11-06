import { describe, it, expect } from 'vitest'
import { checkProperty } from '../../../domain/rules/propertyRules'
import { checkScenario } from '../../../domain/rules'
import { RULES } from '../../../domain/rules/codes'
import { ctx, codesOf, okSource, fresh } from './helpers'

const p = { StartDelay: 0, RetryCnt: 0, RetryInterval: 10, Priority: 10, ExecutingLevel: 0, NextScenarioIfSuccess: null, NextScenarioIfFail: null, Type: 1 }
const codes = (q, src = p) => codesOf(checkProperty(q, src))
// 값 q[key] 가 막히는지(옛 값은 p 의 기본값) / 옛 값 그대로면 안 막히는지
const blocked = (key, v, code) => expect(codes({ ...p, [key]: v })).toEqual([code])
const passes = (key, v) => expect(codes({ ...p, [key]: v })).toEqual([])
const oldValue = (key, v) => expect(codes({ ...p, [key]: v }, { ...p, [key]: v })).toEqual([])

describe('checkProperty 바뀐 키만', () => {
  it('바뀐 속성만 검사', () => {
    expect(checkProperty({ ...p, StartDelay: 5 }, p).map((i) => i.code)).toEqual(['START_DELAY_RANGE'])
    expect(checkProperty({ ...p, StartDelay: 5 }, { ...p, StartDelay: 5 })).toEqual([])
  })
  it('StartDelay 경계 0 | 10~14400', () => {
    for (const v of [0, 10, 14400]) passes('StartDelay', v)
    for (const v of [1, 9, 14401, -1, 10.5, '10', null]) blocked('StartDelay', v, 'START_DELAY_RANGE')
    oldValue('StartDelay', 5)
  })
  it('RetryInterval 경계 10~14400', () => {
    for (const v of [10, 14400]) passes('RetryInterval', v)
    for (const v of [9, 14401, 0, 10.5]) blocked('RetryInterval', v, 'RETRY_INTERVAL_RANGE')
    oldValue('RetryInterval', 5)
  })
  it('RetryCnt 경계 0~9', () => {
    for (const v of [0, 9]) passes('RetryCnt', v)
    for (const v of [-1, 10, 1.5]) blocked('RetryCnt', v, 'RETRY_CNT_RANGE')
    oldValue('RetryCnt', 10)
  })
  it('Priority 1·5·10 만', () => {
    for (const v of [1, 5]) passes('Priority', v)
    for (const v of [0, 2, 4, 6, 11]) blocked('Priority', v, 'PRIORITY_VALUE')
    expect(codes({ ...p, Priority: 10 }, { ...p, Priority: 5 })).toEqual([])
    oldValue('Priority', 2)
  })
  it('ExecutingLevel 0·1 만', () => {
    passes('ExecutingLevel', 1)
    for (const v of [2, -1]) blocked('ExecutingLevel', v, 'EXECUTING_LEVEL_VALUE')
    oldValue('ExecutingLevel', 2)
  })
  it('새 시나리오(기준 없음)는 모든 키가 바뀐 것', () => {
    expect(codes({ ...p, StartDelay: 5, Priority: 2 }, null)).toEqual(['START_DELAY_RANGE', 'PRIORITY_VALUE'])
    expect(checkProperty({ ...p, StartDelay: 5 }, undefined).map((i) => i.code)).toEqual(['START_DELAY_RANGE'])
  })
  it('Owners 는 보지 않는다', () => {
    expect(codes({ ...p, Owners: 'zzz' })).toEqual([])
  })
})

describe('후속 시나리오', () => {
  const f = (Name, Text) => ({ Name, Text })
  it('FOLLOW_NAME_REQUIRED', () => {
    expect(codes({ ...p, NextScenarioIfSuccess: f('', 'abc') })).toEqual(['FOLLOW_NAME_REQUIRED'])
    expect(codes({ ...p, NextScenarioIfSuccess: f('  ', 'abc') })).toEqual(['FOLLOW_NAME_REQUIRED'])
    expect(codes({ ...p, NextScenarioIfSuccess: f('A', 'abc') })).toEqual([])
    const old = { ...p, NextScenarioIfSuccess: f('', 'abc') }
    expect(codes(old, old)).toEqual([])
  })
  it('후속 설명은 성공·실패 양쪽 3자', () => {
    const q = { ...p, NextScenarioIfFail: { Name: 'B', Text: 'ab' } }
    expect(codes(q)).toContain('FOLLOW_DESC_SHORT')
  })
  it('양쪽 경계: 3자 통과, 2자 막힘 (성공 쪽·실패 쪽)', () => {
    const ok = f('A', 'abc'); const short = f('B', 'ab')
    expect(codes({ ...p, NextScenarioIfSuccess: ok, NextScenarioIfFail: ok })).toEqual([])
    expect(codes({ ...p, NextScenarioIfSuccess: short, NextScenarioIfFail: ok })).toEqual(['FOLLOW_DESC_SHORT'])
    expect(codes({ ...p, NextScenarioIfSuccess: ok, NextScenarioIfFail: short })).toEqual(['FOLLOW_DESC_SHORT'])
  })
  it('한쪽만 있으면 없는 쪽은 보지 않고, 둘 다 null 이면 통과 (SE-014: 있는 쪽 둘 다 3자)', () => {
    expect(codes({ ...p, NextScenarioIfSuccess: f('A', 'abc') })).toEqual([])
    expect(codes({ ...p, NextScenarioIfSuccess: f('A', 'ab') })).toEqual(['FOLLOW_DESC_SHORT'])
  })
  it('한쪽만 설정됐을 때 반대쪽은 null 이어도 된다 (Text 가 없는 쪽은 비교 대상 아님)', () => {
    expect(codes({ ...p, NextScenarioIfFail: f('A', 'abc') })).toEqual([])
  })
  it('후속 키가 안 바뀌면 옛 짧은 설명은 막지 않는다', () => {
    const old = { ...p, NextScenarioIfFail: f('B', 'ab') }
    expect(codes({ ...old, StartDelay: 0 }, old)).toEqual([])
    expect(codes({ ...old, Priority: 5 }, old)).toEqual([])
  })
  it('한쪽 후속을 바꾸면 반대쪽 옛 짧은 설명도 함께 본다', () => {
    const old = { ...p, NextScenarioIfFail: f('B', 'ab') }
    expect(codes({ ...old, NextScenarioIfSuccess: f('A', 'abc') }, old)).toEqual(['FOLLOW_DESC_SHORT'])
  })
})

describe('checkScenario 에 합쳐진다', () => {
  it('속성 코드는 RULES 에 always·block', () => {
    for (const c of ['START_DELAY_RANGE', 'RETRY_INTERVAL_RANGE', 'RETRY_CNT_RANGE', 'PRIORITY_VALUE', 'EXECUTING_LEVEL_VALUE', 'FOLLOW_NAME_REQUIRED', 'FOLLOW_DESC_SHORT']) {
      expect(RULES[c]).toEqual({ scope: 'always', level: 'block' })
    }
  })
  it('바꾼 키는 blocks, 안 바꾼 옛 값은 안 막는다', () => {
    const src = okSource()
    const e = fresh(src)
    expect(codesOf(checkScenario(e, src, ctx()).blocks)).not.toContain('START_DELAY_RANGE')
    e.property = { ...e.property, StartDelay: 5 }
    const r = checkScenario(e, src, ctx())
    expect(codesOf(r.blocks)).toContain('START_DELAY_RANGE')
    expect(codesOf(r.warns)).not.toContain('START_DELAY_RANGE')
  })
  it('원본에 이미 있던 범위 밖 값은 그대로면 통과', () => {
    const src = okSource()
    src.property = { ...src.property, StartDelay: 5 }
    const e = fresh(src)
    expect(codesOf(checkScenario(e, src, ctx()).blocks)).not.toContain('START_DELAY_RANGE')
  })
  it('새 시나리오(source 없음)는 모든 속성 키가 바뀐 것', () => {
    const src = okSource()
    const e = fresh(src)
    e.property = { ...e.property, Priority: 2 }
    expect(codesOf(checkScenario(e, null, ctx()).blocks)).toContain('PRIORITY_VALUE')
  })
})
