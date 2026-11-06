import { describe, it, expect } from 'vitest'
import { bodySha256, newVersionFields, pickMine, propertyRev, setScenarioTimeoutMs } from '../../domain/deployIdentity.js'

describe('deployIdentity', () => {
  it('새 필드는 이름 + 마지막 점 뒤 숫자만, 내림차순', () => {
    expect(newVersionFields('N', ['N.100'], ['N.100', 'N.200', 'N.300', 'N.X.400', 'N.5x'])).toEqual([{ field: 'N.300', crtime: 300 }, { field: 'N.200', crtime: 200 }])
    expect(newVersionFields('N.X', [], ['N.X.400', 'N.400'])).toEqual([{ field: 'N.X.400', crtime: 400 }])
  })
  it('내 판은 새 필드 중 지문이 같은 것', async () => {
    const values = { 'N.200': 'B', 'N.300': 'A', 'N.X.400': 'A' }
    const r = await pickMine({ name: 'N', fieldsBefore: ['N.100'], fieldsNow: ['N.100', 'N.200', 'N.300', 'N.X.400'], valueOf: async (f) => values[f], sha: bodySha256('A') })
    expect(r).toBe(300)
    const none = await pickMine({ name: 'N', fieldsBefore: [], fieldsNow: ['N.1'], valueOf: async () => null, sha: bodySha256('A') })
    expect(none).toBe(null)
  })
  it('시간 제한', () => { expect(setScenarioTimeoutMs(0)).toBe(15000); expect(setScenarioTimeoutMs(3 * 1048576 + 1)).toBe(17000); expect(setScenarioTimeoutMs(1e9)).toBe(120000) })
  it('운영 속성 지문은 값이 같으면 같다', () => {
    expect(propertyRev({ A: 1, B: 'x' })).toBe(propertyRev({ A: 1, B: 'x' }))
    expect(propertyRev({ A: 1 })).not.toBe(propertyRev({ A: 2 }))
    expect(propertyRev({ A: 1 })).toHaveLength(16)
    expect(propertyRev(undefined)).toBe(propertyRev(null))
  })
  it('지문은 UTF-8 sha256', () => {
    expect(bodySha256('A')).toBe('559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd')
  })
})
