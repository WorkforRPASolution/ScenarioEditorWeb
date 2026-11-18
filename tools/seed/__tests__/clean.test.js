import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { clean } = require('../lib/clean')

// 공유 로컬 EARS 를 지우는 도구라서 SEW 접두사 밖으로 번지지 않는 것을 가짜 연결로 확인한다.
function fakeCtx() {
  const calls = { deleteMany: [], find: [], bucketDelete: [], scan: [], del: [] }
  const db = {
    collection: (name) => ({
      deleteMany: async (filter) => { calls.deleteMany.push({ name, filter }); return { deletedCount: 1 } },
      find: (filter) => { calls.find.push({ name, filter }); return (async function* () { yield { _id: 'f1' }; yield { _id: 'f2' } })() }
    })
  }
  const bucket = { delete: async (id) => { calls.bucketDelete.push(id) } }
  const redis = {
    scan: async (cursor, ...args) => { calls.scan.push(args); return cursor === '0' ? ['7', ['SEWCVD-SEWMODELA']] : ['0', ['SEWETCH-SEWMODELB']] },
    del: async (...keys) => { calls.del.push(keys) }
  }
  return { ctx: { db, bucket, redis }, calls }
}

describe('clean', () => {
  it('SEW 접두사 조건으로만 지운다', async () => {
    const { ctx, calls } = fakeCtx()
    const r = await clean(ctx)
    const f = (name) => calls.deleteMany.find((c) => c.name === name).filter
    expect(calls.deleteMany.map((c) => c.name).sort()).toEqual(['AGENT_INFO', 'ARS_USER_INFO', 'ARS_USER_MEMO', 'EQP_AUTO_RECOVERY', 'EQP_INFO', 'SC_PROPERTY'])
    expect(String(f('SC_PROPERTY').process)).toBe('/^SEW/')
    expect(String(f('EQP_INFO').eqpId)).toBe('/^SEWT_/')
    expect(String(f('AGENT_INFO').eqpId)).toBe('/^SEWT_/')
    expect(String(f('ARS_USER_INFO').singleid)).toBe('/^sew_/')
    expect(String(f('ARS_USER_MEMO').eqpid)).toBe('/^SEWT_/') // 시험 설비의 스냅샷 메모(P3-C)
    expect(Object.keys(f('ARS_USER_MEMO'))).toEqual(['eqpid'])
    expect(String(f('EQP_AUTO_RECOVERY').eqpid)).toBe('/^SEWT_/') // 시험 설비의 실행 기록(P5 — CommandServer 흉내가 넣은 것)
    expect(Object.keys(f('EQP_AUTO_RECOVERY'))).toEqual(['eqpid'])
    expect(calls.find).toHaveLength(1)
    expect(calls.find[0].name).toBe('fs.files')
    expect(String(calls.find[0].filter['metadata.process'])).toBe('/^SEW/')
    expect(calls.bucketDelete).toEqual(['f1', 'f2'])
    expect(calls.scan.every((a) => a[0] === 'MATCH' && a[1] === 'SEW*-*')).toBe(true)
    expect(calls.del).toEqual([['SEWCVD-SEWMODELA', 'SEWETCH-SEWMODELB']])
    expect(r).toEqual({ scProperty: 1, gridfsFiles: 2, redisKeys: 2, eqpInfo: 1, agentInfo: 1, users: 1, memos: 1, recoveries: 1 })
  })
  it('지울 Redis 키가 없으면 del 을 부르지 않는다', async () => {
    const { ctx, calls } = fakeCtx()
    ctx.redis.scan = async () => ['0', []]
    await clean(ctx)
    expect(calls.del).toEqual([])
  })
})
