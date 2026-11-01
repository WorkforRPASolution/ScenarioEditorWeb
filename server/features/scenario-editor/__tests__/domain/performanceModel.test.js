import { describe, it, expect } from 'vitest'
import { performanceFromBson } from '../../domain/performanceModel'

describe('performanceFromBson (Q-009: 두 이름 다 읽기)', () => {
  it('사본 이름', () => {
    const p = performanceFromBson({ Group: 'sew', Trigger: 1, Grade: 2, Supervisor: 'Not entered', EqpPerformanceLoss: 3, GlassLoss: 4, ScenarioDescription: '설명' })
    expect(p).toMatchObject({ group: 'SEW', triggerName: 'Log', gradeName: 'A', supervisorNotEntered: true, eqpPerformanceLoss: 3, glassLoss: 4, scenarioDescription: '설명' })
    expect(p.rawKeys).toContain('GlassLoss')
  })
  it('WebManager 이름(EqpPerfornmanceLoss·WaferLoss)', () => {
    const p = performanceFromBson({ EqpPerfornmanceLoss: 7, WaferLoss: 8, Supervisor: '홍길동' })
    expect(p).toMatchObject({ eqpPerformanceLoss: 7, glassLoss: 8, supervisor: '홍길동', supervisorNotEntered: false })
  })
  it('없으면 null, CitizenDeveloper 가 없으면 null', () => {
    expect(performanceFromBson(null)).toBe(null)
    expect(performanceFromBson({}).citizenDevelopers).toBe(null)
  })
})
