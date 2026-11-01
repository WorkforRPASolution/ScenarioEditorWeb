import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { waitNewField, setScenarioPayload } = require('../lib/loader')

describe('loader', () => {
  it('setscenario 본문은 세 JSON 을 문자열로 담는다', () => {
    const p = JSON.parse(setScenarioPayload({ process: 'P', model: 'M', name: 'N', body: '{"a":1}', bi: '{"b":2}', property: '{}' }))
    expect(p).toEqual({ Process: 'P', Model: 'M', SCName: 'N', BI: '{"b":2}', Body: '{"a":1}', Property: '{}' })
  })
  it('새로 생긴 정확한 이름의 필드 crtime 을 찾는다(앞부분이 같은 이름은 무시)', async () => {
    let calls = 0
    const redis = { hkeys: async () => (++calls < 3 ? ['N.1730000000000'] : ['N.1730000000000', 'N_2.1730000000999', 'N.1730000000500']) }
    expect(await waitNewField(redis, 'P-M', 'N', new Set(['N.1730000000000']), 2000, 5)).toBe(1730000000500)
  })
  it('시간 안에 안 생기면 null', async () => {
    const redis = { hkeys: async () => [] }
    expect(await waitNewField(redis, 'P-M', 'N', new Set(), 30, 5)).toBe(null)
  })
})
