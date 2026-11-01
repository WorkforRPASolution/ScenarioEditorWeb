import { describe, it, expect } from 'vitest'
import { createUserService } from '../service/userService'
import { createScopeService } from '../service/scopeService'

const eq = (eqpId, process, eqpModel, over = {}) => ({ eqpId, category: 'Process', process, line: 'L', lineDesc: 'L', eqpModel, ipAddr: eqpId,
  osVer: 'W', emailcategory: 'A-B-C-D', onoff: 1, webmanagerUse: 1, ...over })

describe('userService', () => {
  it('첫 문서를 쓰고 문서 수를 남기며 TTL 동안 캐시한다', async () => {
    let calls = 0
    let t = 0
    const repo = { findUsers: async () => { calls++; return [{ singleid: 'u', process: 'CVD', authority: 'WRITE' }, { singleid: 'u', process: 'X' }] } }
    const s = createUserService({ repo, ttlMs: 1000, now: () => t })
    const u = await s.getUser('u')
    expect(u).toMatchObject({ singleid: 'u', process: 'CVD', canWrite: true, duplicateUserDocs: 2 })
    t = 500; await s.getUser('u'); expect(calls).toBe(1)
    t = 1500; await s.getUser('u'); expect(calls).toBe(2)
    s.clear(); await s.getUser('u'); expect(calls).toBe(3)
  })
  it('없으면 null', async () => {
    const s = createUserService({ repo: { findUsers: async () => [] }, ttlMs: 1000, now: () => 0 })
    expect(await s.getUser('nobody')).toBe(null)
  })
})

describe('scopeService', () => {
  const repo = {
    findAgents: async () => [{ eqpId: 'A' }, { eqpId: 'B' }, { eqpId: 'C' }],
    findEquipment: async () => [eq('A', 'CVD', 'M1'), eq('B', 'ETCH', 'M2'), eq('C', 'CVD', 'M1', { emailcategory: 'X' })]
  }
  const user = { singleid: 'u', process: 'CVD', processes: ['CVD'], multiProcess: null, isMaster: false }
  it('허용 쌍과 뺀 설비', async () => {
    const s = createScopeService({ repo, ttlMs: 60000, now: () => 0 })
    const r = await s.scopeFor(user)
    expect(r.pairs).toEqual([{ process: 'CVD', models: [{ model: 'M1', eqpCount: 1 }] }])
    expect(r.invalid).toEqual([{ eqpId: 'C', reason: 'WRONG_EMAIL_CATEGORY' }])
  })
  it('허용 밖이면 403 PROCESS_FORBIDDEN', async () => {
    const s = createScopeService({ repo, ttlMs: 60000, now: () => 0 })
    await expect(s.assertAllowed(user, 'ETCH', 'M2')).rejects.toMatchObject({ statusCode: 403, code: 'PROCESS_FORBIDDEN' })
    await expect(s.assertAllowed(user, 'CVD', 'M1')).resolves.toBeUndefined()
  })
})
