import { describe, it, expect } from 'vitest'
import { checkPropertyFields, propertyFieldOf } from '../editor/propertyRules'

// 서버 domain/rules/propertyRules.js 와 같은 code·같은 "바뀐 키만" 규칙(서버 시험 propertyRules.test.js 의 경계를 그대로).
const p = { StartDelay: 0, RetryCnt: 0, RetryInterval: 10, Priority: 10, ExecutingLevel: 0, NextScenarioIfSuccess: null, NextScenarioIfFail: null, Type: 1, Owners: [] }
const codes = (q, prev = p) => Object.fromEntries(Object.entries(checkPropertyFields(q, prev)).map(([k, v]) => [k, v.code]))
const blocked = (key, v, code) => expect(codes({ ...p, [key]: v })).toEqual({ [key]: code })
const passes = (key, v) => expect(codes({ ...p, [key]: v })).toEqual({})
const oldValue = (key, v) => expect(codes({ ...p, [key]: v }, { ...p, [key]: v })).toEqual({})
const f = (Name, Text) => ({ Name, Text })

describe('checkPropertyFields — 바뀐 칸만', () => {
  it('시작 지연 0 | 10~14400, 옛 값은 그대로 둔다', () => {
    for (const v of [0, 10, 14400]) passes('StartDelay', v)
    for (const v of [1, 5, 9, 14401, -1, 10.5, '10', '', null]) blocked('StartDelay', v, 'START_DELAY_RANGE')
    oldValue('StartDelay', 5)
  })
  it('재시도 간격 10~14400', () => {
    for (const v of [10, 14400]) passes('RetryInterval', v)
    for (const v of [9, 14401, 0, 10.5, 'abc']) blocked('RetryInterval', v, 'RETRY_INTERVAL_RANGE')
    oldValue('RetryInterval', 5)
  })
  it('재시도 횟수 0~9', () => {
    for (const v of [0, 9]) passes('RetryCnt', v)
    for (const v of [-1, 10, 1.5]) blocked('RetryCnt', v, 'RETRY_CNT_RANGE')
    oldValue('RetryCnt', 10)
  })
  it('우선순위 1·5·10 만', () => {
    for (const v of [1, 5]) passes('Priority', v)
    for (const v of [0, 2, 3, 11]) blocked('Priority', v, 'PRIORITY_VALUE')
    oldValue('Priority', 3)
  })
  it('데스크탑 실행(ExecutingLevel) 0·1 만', () => {
    passes('ExecutingLevel', 1)
    for (const v of [2, -1]) blocked('ExecutingLevel', v, 'EXECUTING_LEVEL_VALUE')
    oldValue('ExecutingLevel', 2)
  })
  it('기준이 없으면(새 시나리오) 모든 키가 바뀐 것', () => {
    expect(codes({ ...p, StartDelay: 5, Priority: 2 }, null)).toEqual({ StartDelay: 'START_DELAY_RANGE', Priority: 'PRIORITY_VALUE' })
    expect(codes({ ...p, StartDelay: 5 }, undefined)).toEqual({ StartDelay: 'START_DELAY_RANGE' })
  })
  it('Owners 는 보지 않는다', () => {
    expect(codes({ ...p, Owners: 'zzz' })).toEqual({})
  })
})

describe('checkPropertyFields — 후속 시나리오(칸 = 키.Name·키.Text, params.which)', () => {
  it('이름이 비면 FOLLOW_NAME_REQUIRED(이름 칸)', () => {
    expect(checkPropertyFields({ ...p, NextScenarioIfSuccess: f('', 'abc') }, p)).toEqual({ 'NextScenarioIfSuccess.Name': { code: 'FOLLOW_NAME_REQUIRED', params: { which: 'success' } } })
    expect(codes({ ...p, NextScenarioIfFail: f('  ', 'abc') })).toEqual({ 'NextScenarioIfFail.Name': 'FOLLOW_NAME_REQUIRED' })
    expect(codes({ ...p, NextScenarioIfSuccess: f('A', 'abc') })).toEqual({})
  })
  it('저장된 빈 후속 {Name:""} 을 고치지 않으면 막지 않는다', () => {
    const old = { ...p, NextScenarioIfSuccess: f('', '') }
    expect(codes(old, old)).toEqual({})
  })
  it('설명은 성공·실패 양쪽 3자 — 한쪽만 바꿔도 있는 쪽 둘 다 본다(서버 SE-014)', () => {
    const prev = { ...p, NextScenarioIfFail: f('B', 'ab') }
    expect(checkPropertyFields({ ...prev, NextScenarioIfSuccess: f('A', 'abc') }, prev)).toEqual({ 'NextScenarioIfFail.Text': { code: 'FOLLOW_DESC_SHORT', params: { which: 'fail' } } })
    expect(codes({ ...p, NextScenarioIfSuccess: f('A', 'ab') })).toEqual({ 'NextScenarioIfSuccess.Text': 'FOLLOW_DESC_SHORT' })
    expect(codes(prev, prev)).toEqual({})
  })
  it('이름·설명이 함께 틀리면 두 칸 모두', () => {
    expect(codes({ ...p, NextScenarioIfSuccess: f('', '') })).toEqual({ 'NextScenarioIfSuccess.Name': 'FOLLOW_NAME_REQUIRED', 'NextScenarioIfSuccess.Text': 'FOLLOW_DESC_SHORT' })
  })
  it('null 로 빼면 막지 않는다', () => {
    const prev = { ...p, NextScenarioIfSuccess: f('', 'x') }
    expect(codes({ ...p, NextScenarioIfSuccess: null }, prev)).toEqual({})
  })
})

describe('propertyFieldOf — 저장 창의 운영 속성 줄 → 창의 칸', () => {
  it('범위 5종·유형 2종', () => {
    expect(propertyFieldOf({ code: 'START_DELAY_RANGE' })).toBe('StartDelay')
    expect(propertyFieldOf({ code: 'RETRY_INTERVAL_RANGE' })).toBe('RetryInterval')
    expect(propertyFieldOf({ code: 'RETRY_CNT_RANGE' })).toBe('RetryCnt')
    expect(propertyFieldOf({ code: 'PRIORITY_VALUE' })).toBe('Priority')
    expect(propertyFieldOf({ code: 'EXECUTING_LEVEL_VALUE' })).toBe('ExecutingLevel')
    expect(propertyFieldOf({ code: 'TYPE_UNSET' })).toBe('Type')
    expect(propertyFieldOf({ code: 'FAP_TYPE_MISMATCH' })).toBe('Type')
  })
  it('후속 5종은 params.which 쪽의 이름·설명 칸', () => {
    expect(propertyFieldOf({ code: 'FOLLOW_NAME_REQUIRED', params: { which: 'success' } })).toBe('NextScenarioIfSuccess.Name')
    expect(propertyFieldOf({ code: 'FOLLOW_DESC_SHORT', params: { which: 'fail' } })).toBe('NextScenarioIfFail.Text')
    for (const code of ['FOLLOW_MISSING', 'FOLLOW_SELF', 'FOLLOW_CYCLE']) expect(propertyFieldOf({ code, params: { which: 'fail', name: 'X' } })).toBe('NextScenarioIfFail.Name')
  })
  it('운영 속성 code 가 아니면 null', () => {
    expect(propertyFieldOf({ code: 'MAIL_TITLE_EMPTY' })).toBeNull()
    expect(propertyFieldOf(null)).toBeNull()
  })
})
