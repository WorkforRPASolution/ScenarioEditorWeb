import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { waitNewField, setScenario } = require('../lib/loader')
const { _setDeps } = require('../../../server/features/scenario-editor/clients/interfaceClient')

describe('loader', () => {
  // 저장 전에는 기존 필드만, 저장 뒤에는 새 판 필드까지 보이는 Redis
  const redisAfterSave = () => {
    let saved = false
    const redis = { hkeys: async () => (saved ? ['N.1730000000000', 'N.1730000000500'] : ['N.1730000000000']) }
    return { redis, markSaved: () => { saved = true } }
  }
  const scenario = { process: 'P', model: 'M', name: 'N', body: '{}', bi: '{}', property: '{}' }
  afterEach(() => _setDeps({ fetch: globalThis.fetch }))

  it('setscenario 가 성공하면 새로 생긴 판을 돌려준다', async () => {
    const { redis, markSaved } = redisAfterSave()
    _setDeps({ fetch: async () => { markSaved(); return new Response('{"success":"true","message":""}') } })
    expect(await setScenario({ redis }, scenario)).toEqual({ crtime: 1730000000500, httpStatus: 200, verifiedAfterError: false })
  })
  it('10초 askTimeout 의 500 이 와도 Redis 에 새 판이 생기면 저장된 것으로 본다', async () => {
    const { redis, markSaved } = redisAfterSave()
    _setDeps({ fetch: async () => { markSaved(); return new Response('There was an internal server error.', { status: 500 }) } })
    expect(await setScenario({ redis }, scenario)).toEqual({ crtime: 1730000000500, httpStatus: 500, verifiedAfterError: true })
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
