import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

let server
let base
const fake = {}
beforeAll(async () => {
  process.env.SE_USER_SINGLEID = 'sew_multi'
  process.env.SE_DEV_USER_OVERRIDE = '1'
  require('../deps')._setDeps(fake)
  const app = require('../../../app')
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}/api/scenario-editor`
})
afterAll(() => { require('../deps')._setDeps(null); return new Promise((r) => server.close(r)) })

const user = { singleid: 'sew_multi', name: 'M', processRaw: 'CVD;ETCH', processes: ['CVD', 'ETCH'], multiProcess: ['CVD', 'ETCH'], process: 'CVD',
  isMaster: false, authority: 'WRITE', canWrite: true, authorityManager: 3, authorityManagerValid: true, authorityName: 'Manager', duplicateUserDocs: 1 }
beforeEach(() => {
  let cleared = 0
  Object.assign(fake, {
    users: { getUser: async (id) => (id === 'sew_none' ? null : { ...user, singleid: id }), clear: () => { cleared++ } },
    scopes: {
      scopeFor: async () => ({ pairs: [{ process: 'CVD', models: [{ model: 'M1', eqpCount: 2 }] }], invalid: [{ eqpId: 'X', reason: 'REQUIRED_EMPTY' }], duplicateEqpIds: ['D'], proxyIpDuplicates: [], valid: [] }),
      assertAllowed: async () => {}, clear: () => { cleared++ }
    },
    imageCache: { clear: async () => { cleared += 10 } }
  })
  // Object.assign 은 getter 를 값으로 복사하므로 따로 정의한다
  Object.defineProperty(fake, 'cleared', { get: () => cleared, configurable: true })
})

describe('/me·/scopes·/cache/refresh', () => {
  it('/me', async () => {
    const res = await fetch(`${base}/me`)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ singleid: 'sew_multi', canWrite: true, authorityName: 'Manager', duplicateUserDocs: 1 })
  })
  it('미등록 사용자는 모든 API 가 403 USER_NOT_REGISTERED', async () => {
    for (const p of ['/me', '/scopes']) {
      const res = await fetch(`${base}${p}`, { headers: { 'X-SE-User': 'sew_none' } })
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ code: 'USER_NOT_REGISTERED' })
    }
  })
  it('/scopes: 허용 쌍과 뺀 설비 수(무효 + 중복)', async () => {
    const body = await (await fetch(`${base}/scopes`)).json()
    expect(body.data).toEqual({ processes: [{ process: 'CVD', models: [{ model: 'M1', eqpCount: 2 }] }], excludedEqpCount: 2 })
  })
  it('/cache/refresh 는 사용자·설비 캐시를, images=1 이면 이미지 캐시도 비운다', async () => {
    expect((await (await fetch(`${base}/cache/refresh`, { method: 'POST' })).json()).data).toEqual({ refreshed: true })
    expect(fake.cleared).toBe(2)
    await fetch(`${base}/cache/refresh?images=1`, { method: 'POST' })
    expect(fake.cleared).toBe(14)
  })
})
