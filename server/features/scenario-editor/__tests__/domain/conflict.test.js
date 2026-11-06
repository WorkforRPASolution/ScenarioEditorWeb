import { describe, it, expect } from 'vitest'
import { detectConflict, propertyDiff, PROPERTY_DIFF_KEYS } from '../../domain/conflict.js'

describe('conflict', () => {
  const base = { sameScenario: true, docExists: true, headCrtime: 1, currentCrtime: 1, propertyRev: 'p', currentPropertyRev: 'p', owners: ['k@2026-11-06 09:00:00'] }
  it('충돌 순서', () => {
    expect(detectConflict(base)).toBe(null)
    expect(detectConflict({ ...base, docExists: false })).toEqual({ kind: 'deleted' })
    expect(detectConflict({ ...base, currentCrtime: 2 })).toEqual({ kind: 'newVersion', by: 'k', at: '2026-11-06 09:00:00' })
    expect(detectConflict({ ...base, currentPropertyRev: 'q' })).toEqual({ kind: 'property' })
    expect(detectConflict({ ...base, sameScenario: false, currentCrtime: 2 })).toBe(null)
  })
  it('새 시나리오는 문서가 있어도 deleted 가 아니다', () => {
    expect(detectConflict({ ...base, headCrtime: null, currentCrtime: null })).toBe(null)
    expect(detectConflict({ ...base, headCrtime: null, currentCrtime: null, docExists: false })).toBe(null)
  })
  it('누가·언제 없으면 null', () => {
    expect(detectConflict({ ...base, currentCrtime: 2, owners: [] })).toEqual({ kind: 'newVersion', by: null, at: null })
  })
  it('운영 속성 차이', () => {
    expect(PROPERTY_DIFF_KEYS).toEqual(['IsEnabled', 'NextScenarioIfSuccess', 'NextScenarioIfFail', 'Type', 'StartDelay'])
    expect(propertyDiff({ IsEnabled: true, Type: 'a', StartDelay: 0 }, { IsEnabled: false, Type: 'a', StartDelay: 0 }))
      .toEqual([{ key: 'IsEnabled', from: true, to: false }])
    expect(propertyDiff(null, { Type: 'a' })).toEqual([{ key: 'Type', from: undefined, to: 'a' }])
  })
})
