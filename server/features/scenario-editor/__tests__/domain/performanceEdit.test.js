import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const mongoose = require('mongoose')
const { Long } = mongoose.mongo
const { emptyPerformance, reviewFields, performanceFields, citizenDevelopers, fieldShapeError, enumShapeError } = require('../../domain/performanceEdit')
const { performanceFromBson } = require('../../domain/performanceModel')

describe('emptyPerformance', () => {
  it('사내 new PerformanceItem() 의 필드·기본값·순서(01 §5.10), 키 이름은 C# 그대로', () => {
    const p = emptyPerformance()
    expect(p).toEqual({
      Group: '', Trigger: 0, TriggerInfo: null, Grade: 0, Supervisor: 'Not entered', SupervisorComment: '', CitizenDeveloper: [],
      PerformType: 0, ScenarioDescription: '', ManWorkLoss: 0, EqpPerfornmanceLoss: 0, EqpStopLoss: 0, WaferLoss: 0, InvestCostLoss: 0,
      AdditionalEffect: '', AccidentType: 0, AccidentInfo: '', UpdateDate: ''
    })
    expect(Object.keys(p)).toEqual(['Group', 'Trigger', 'TriggerInfo', 'Grade', 'Supervisor', 'SupervisorComment', 'CitizenDeveloper', 'PerformType',
      'ScenarioDescription', 'ManWorkLoss', 'EqpPerfornmanceLoss', 'EqpStopLoss', 'WaferLoss', 'InvestCostLoss', 'AdditionalEffect', 'AccidentType', 'AccidentInfo', 'UpdateDate'])
    expect(p).not.toHaveProperty('EqpPerformanceLoss') // 사본 철자가 아니다
    expect(p).not.toHaveProperty('GlassLoss')
  })
  it('부를 때마다 새 객체 — 고쳐도 다음 값에 새지 않는다', () => {
    const a = emptyPerformance()
    a.CitizenDeveloper.push({ KnoxId: 'x' })
    a.Group = 'G'
    expect(emptyPerformance().CitizenDeveloper).toEqual([])
    expect(emptyPerformance().Group).toBe('')
  })
  it('화면 읽기(performanceFromBson)로 보면 심의자 미입력·빈 기여자·NA 등급', () => {
    const v = performanceFromBson(emptyPerformance())
    expect(v).toMatchObject({ supervisorNotEntered: true, citizenDevelopers: [], triggerName: 'NA', gradeName: 'N/A', performTypeName: 'None', accidentTypeName: 'None', triggerInfo: null })
  })
})

const NOW = new Date('2026-11-07T01:02:03Z')
const cur = { Grade: 2, SupervisorComment: '좋음 좋음', Supervisor: 'old', Trigger: 1, ManWorkLoss: 5, EqpPerfornmanceLoss: 7, WaferLoss: 0, CitizenDeveloper: [{ KnoxId: 'a', Sdwt: 'X', Name: 'A', Contribution: 50 }], UpdateDate: '2026-01-01' }

describe('reviewFields', () => {
  it('등급만 바뀌면 Grade 와 Supervisor', () => {
    expect(reviewFields(cur, { grade: 3, comment: '좋음 좋음' }, 'me')).toEqual({ 'performance.Grade': 3, 'performance.Supervisor': 'me' })
  })
  it('의견만 바뀌면 SupervisorComment 와 Supervisor', () => {
    expect(reviewFields(cur, { grade: 2, comment: '새 의견입니다' }, 'me')).toEqual({ 'performance.SupervisorComment': '새 의견입니다', 'performance.Supervisor': 'me' })
  })
  it('같은 값이면 {}', () => {
    expect(reviewFields(cur, { grade: 2, comment: '좋음 좋음' }, 'me')).toEqual({})
  })
})

describe('performanceFields', () => {
  it('효과 값만 바꾸면 그 필드와 UpdateDate(KST), EqpPerfornmanceLoss 는 없다', () => {
    const f = performanceFields(cur, { ManWorkLoss: 9, WaferLoss: 0, EqpPerfornmanceLoss: 99 }, { singleid: 'me', now: NOW })
    expect(f).toEqual({ 'performance.ManWorkLoss': 9, 'performance.UpdateDate': '2026-11-07' })
  })
  it('바뀐 것이 없으면 {}', () => {
    expect(performanceFields(cur, { ManWorkLoss: 5 }, { singleid: 'me', now: NOW })).toEqual({})
  })
  it('등급·의견은 reviewFields 규칙(Supervisor), 그것만 바뀌면 UpdateDate 는 건드리지 않는다', () => {
    expect(performanceFields(cur, { Grade: 4 }, { singleid: 'me', now: NOW })).toEqual({ 'performance.Grade': 4, 'performance.Supervisor': 'me' })
  })
  it('입력에 없는 CitizenDeveloper 는 건드리지 않고, 있고 같으면(Long 이어도) 쓰지 않는다', () => {
    expect(performanceFields(cur, { ManWorkLoss: 6 }, { singleid: 'me', now: NOW })).not.toHaveProperty(['performance.CitizenDeveloper'])
    const same = [{ KnoxId: 'a', Sdwt: 'X', Name: 'A', Contribution: Long.fromNumber(50) }]
    expect(performanceFields(cur, { CitizenDeveloper: same }, { singleid: 'me', now: NOW })).toEqual({})
    const diff = [{ KnoxId: 'a', Sdwt: 'X', Name: 'A', Contribution: Long.fromNumber(60) }]
    expect(performanceFields(cur, { CitizenDeveloper: diff }, { singleid: 'me', now: NOW })).toEqual({ 'performance.CitizenDeveloper': diff, 'performance.UpdateDate': '2026-11-07' })
  })
  it('Supervisor·UpdateDate 입력은 무시한다(서버가 정한다)', () => {
    expect(performanceFields(cur, { Supervisor: 'x', UpdateDate: 'y' }, { singleid: 'me', now: NOW })).toEqual({})
  })
})

describe('citizenDevelopers', () => {
  const users = new Map([['a', { name: 'A', process: 'AA:BB' }], ['b', { name: 'B', process: 'CC' }]])
  it('Sdwt 는 process 의 ":" 앞부분, 없으면 빈 문자열. 순서는 입력 순서', () => {
    const r = citizenDevelopers([{ KnoxId: 'b', Contribution: 10 }, { KnoxId: 'a', Contribution: 20 }], users, [])
    expect(r.map((d) => [d.KnoxId, d.Sdwt, d.Name])).toEqual([['b', '', 'B'], ['a', 'AA', 'A']])
    expect(Object.keys(r[0])).toEqual(['KnoxId', 'Sdwt', 'Name', 'Contribution'])
  })
  it('기존 원소가 Int32 면 Int32(숫자), Int64 면 Long, 기존 없으면 Long', () => {
    const existing = [{ KnoxId: 'a', Contribution: 30 }, { KnoxId: 'b', Contribution: Long.fromNumber(40) }]
    const r = citizenDevelopers([{ KnoxId: 'a', Contribution: 31 }, { KnoxId: 'b', Contribution: 41 }, { KnoxId: 'c', Contribution: 5 }], new Map([...users, ['c', { name: 'C', process: '' }]]), existing)
    expect(typeof r[0].Contribution).toBe('number')
    expect(r[0].Contribution).toBe(31)
    expect(Long.isLong(r[1].Contribution)).toBe(true)
    expect(r[1].Contribution.toNumber()).toBe(41)
    expect(Long.isLong(r[2].Contribution)).toBe(true)
  })
  it('기존이 없을 때(undefined)도 Long', () => {
    expect(Long.isLong(citizenDevelopers([{ KnoxId: 'a', Contribution: 1 }], users)[0].Contribution)).toBe(true)
  })
})

describe('fieldShapeError — 칸마다 형·범위(저장 전 400 검사)', () => {
  it('좋은 값·빈 입력은 null', () => {
    expect(fieldShapeError({})).toBeNull()
    expect(fieldShapeError({ Grade: 6, Trigger: 6, PerformType: 2, AccidentType: 6, ManWorkLoss: 2147483647, TriggerInfo: null, Group: 'G', SupervisorComment: '', ScenarioDescription: 'x', AdditionalEffect: 'x', AccidentInfo: 'x' })).toBeNull()
    expect(fieldShapeError({ TriggerInfo: 'abc' })).toBeNull()
  })
  it.each([
    [{ Grade: 'x' }, 'Grade'], [{ Grade: 99 }, 'Grade'], [{ Grade: -1 }, 'Grade'], [{ Grade: 1.5 }, 'Grade'],
    [{ Trigger: 'abc' }, 'Trigger'], [{ Trigger: 7 }, 'Trigger'], [{ PerformType: {} }, 'PerformType'], [{ PerformType: 3 }, 'PerformType'],
    [{ AccidentType: 'z' }, 'AccidentType'], [{ AccidentType: 7 }, 'AccidentType'], [{ TriggerInfo: 5 }, 'TriggerInfo'],
    [{ ManWorkLoss: '3' }, 'ManWorkLoss'], [{ EqpStopLoss: 1.5 }, 'EqpStopLoss'], [{ WaferLoss: 2147483648 }, 'WaferLoss'], [{ InvestCostLoss: null }, 'InvestCostLoss'],
    [{ Group: 5 }, 'Group'], [{ ScenarioDescription: [] }, 'ScenarioDescription'], [{ AdditionalEffect: 1 }, 'AdditionalEffect'], [{ AccidentInfo: {} }, 'AccidentInfo'], [{ SupervisorComment: 3 }, 'SupervisorComment']
  ])('%j → path %s', (input, path) => {
    expect(fieldShapeError(input)).toMatchObject({ path })
    expect(fieldShapeError(input).reason).toEqual(expect.any(String))
  })
  it('enumShapeError(grade)는 등급 하나만 같은 규칙', () => {
    expect(enumShapeError('Grade', 3)).toBeNull()
    expect(enumShapeError('Grade', 7)).not.toBeNull()
  })
})
