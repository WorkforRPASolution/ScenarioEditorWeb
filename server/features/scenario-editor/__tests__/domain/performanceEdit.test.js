import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { emptyPerformance } = require('../../domain/performanceEdit')
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
