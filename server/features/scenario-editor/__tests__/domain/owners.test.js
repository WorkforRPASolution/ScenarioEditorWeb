import { describe, it, expect } from 'vitest'
import { kstStamp, kstDate, deployLine, toggleLine, ownersWithLine } from '../../domain/owners.js'

describe('owners', () => {
  it('KST', () => {
    expect(kstStamp(new Date('2026-11-06T15:30:05Z'))).toBe('2026-11-07 00:30:05')
    expect(kstDate(new Date('2026-11-06T15:30:05Z'))).toBe('2026-11-07')
  })
  it('배포·켜기끄기 줄', () => {
    const d = new Date('2026-11-06T15:30:05Z')
    expect(deployLine('k', d)).toBe('k@2026-11-07 00:30:05')
    expect(toggleLine('k', d, true)).toBe('k@2026-11-07 00:30:05@Scenario Activated')
    expect(toggleLine('k', d, false)).toBe('k@2026-11-07 00:30:05@Scenario Deactivated')
  })
  it('같은 줄은 두 번 쌓지 않고, 50 이상이면 맨 앞 하나만 뺀다', () => {
    const l = 'a@2026-11-06 10:00:00'
    expect(ownersWithLine(['x', l], l)).toEqual(['x', l])
    const fifty = Array.from({ length: 50 }, (_, i) => `u${i}`)
    expect(ownersWithLine(fifty, l)).toEqual([...fifty.slice(1), l])
    const sixty = Array.from({ length: 60 }, (_, i) => `u${i}`)
    expect(ownersWithLine(sixty, l)).toHaveLength(60)
    expect(fifty).toHaveLength(50)
    expect(ownersWithLine(['x'], l)).toEqual(['x', l])
  })
})
