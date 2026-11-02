import { describe, it, expect } from 'vitest'
import { performanceFromBson } from '../../domain/performanceModel'

describe('performanceFromBson (사내 이름 EqpPerfornmanceLoss·WaferLoss, Q-009)', () => {
  it('사내 C# 이름을 읽는다(WebManager 와 같다)', () => {
    const p = performanceFromBson({ Group: 'sew', Trigger: 1, Grade: 2, Supervisor: 'Not entered', EqpPerfornmanceLoss: 3, WaferLoss: 4, ScenarioDescription: '설명' })
    expect(p).toMatchObject({ group: 'SEW', triggerName: 'Log', gradeName: 'A', supervisorNotEntered: true, eqpPerformanceLoss: 3, waferLoss: 4, scenarioDescription: '설명' })
    expect(p.rawKeys).toContain('WaferLoss')
  })
  it('등급 이름은 사내 콤보 문구 그대로 — 0 은 "N/A"(enum 이름 NA 가 아님), 6 은 NotUsed (Q-008, 사내 XAML)', () => {
    expect(performanceFromBson({ Grade: 0 })).toMatchObject({ grade: 0, gradeName: 'N/A' })
    expect(performanceFromBson({ Grade: 6 })).toMatchObject({ grade: 6, gradeName: 'NotUsed' })
  })
  it('사본 이름(EqpPerformanceLoss·GlassLoss)은 운영에 없는 키라 읽지 않고 저장된 키로만 보인다', () => {
    const p = performanceFromBson({ EqpPerformanceLoss: 7, GlassLoss: 8, Supervisor: '홍길동' })
    expect(p).toMatchObject({ eqpPerformanceLoss: 0, waferLoss: 0, supervisor: '홍길동', supervisorNotEntered: false })
    expect(p).not.toHaveProperty('glassLoss')
    expect(p.rawKeys).toEqual(['EqpPerformanceLoss', 'GlassLoss', 'Supervisor'])
  })
  it('없으면 null, CitizenDeveloper 가 없으면 null', () => {
    expect(performanceFromBson(null)).toBe(null)
    expect(performanceFromBson({}).citizenDevelopers).toBe(null)
  })
})
