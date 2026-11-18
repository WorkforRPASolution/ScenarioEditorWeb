// 에이전트 상태 읽기(Redis DB0 — 읽기만). 설비 여러 대를 해시 한 번(HMGET)·키 여러 개 한 번(MGET)으로 읽는다.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createAgentStateRepository } = require('../repo/agentStateRepo')

const caught = async (p) => { try { await p } catch (e) { return e } throw new Error('던지지 않았다') }
function fakeRedis({ meta = {}, running = {}, fail = null } = {}) {
  const calls = []
  return {
    calls,
    hmget: async (key, ...fields) => { calls.push(['hmget', key, fields]); if (fail) throw fail; return fields.map((f) => (meta[key] && f in meta[key] ? meta[key][f] : null)) },
    mget: async (...keys) => { const list = keys.flat(); calls.push(['mget', list]); if (fail) throw fail; return list.map((k) => (k in running ? running[k] : null)) }
  }
}

describe('agentStateRepo.read', () => {
  it('설비마다 { meta, running } — 없는 것은 null. 조회는 HMGET 한 번·MGET 한 번', async () => {
    const r = fakeRedis({
      meta: { 'AgentMetaInfo:SEWCVD-SEWMODELA': { A01: '1:2:3:4', A02: '1:2:3:4:http' } },
      running: { 'AgentRunning:SEWCVD-SEWMODELA-A01': '120' }
    })
    const out = await createAgentStateRepository(() => r).read('SEWCVD', 'SEWMODELA', ['A01', 'A02', 'A03'])
    expect([...out]).toEqual([['A01', { meta: '1:2:3:4', running: '120' }], ['A02', { meta: '1:2:3:4:http', running: null }], ['A03', { meta: null, running: null }]])
    expect(r.calls).toEqual([
      ['hmget', 'AgentMetaInfo:SEWCVD-SEWMODELA', ['A01', 'A02', 'A03']],
      ['mget', ['AgentRunning:SEWCVD-SEWMODELA-A01', 'AgentRunning:SEWCVD-SEWMODELA-A02', 'AgentRunning:SEWCVD-SEWMODELA-A03']]
    ])
  })
  it('설비가 없으면 Redis 를 부르지 않는다', async () => {
    const r = fakeRedis()
    expect((await createAgentStateRepository(() => r).read('P', 'M', [])).size).toBe(0)
    expect(r.calls).toEqual([])
  })
  it('설비가 많으면 500대씩 나눠 읽는다', async () => {
    const r = fakeRedis()
    const ids = Array.from({ length: 1200 }, (_, i) => `E${i}`)
    const out = await createAgentStateRepository(() => r).read('P', 'M', ids)
    expect(out.size).toBe(1200)
    expect(r.calls.filter((c) => c[0] === 'hmget').map((c) => c[2].length)).toEqual([500, 500, 200])
    expect(r.calls.filter((c) => c[0] === 'mget').map((c) => c[1].length)).toEqual([500, 500, 200])
  })
  it('Redis 에 연결되지 않았거나 읽다 실패하면 503 UPSTREAM_DOWN', async () => {
    expect(await caught(createAgentStateRepository(() => null).read('P', 'M', ['A']))).toMatchObject({ statusCode: 503, code: 'UPSTREAM_DOWN' })
    const r = fakeRedis({ fail: new Error('boom') })
    expect(await caught(createAgentStateRepository(() => r).read('P', 'M', ['A']))).toMatchObject({ statusCode: 503, code: 'UPSTREAM_DOWN' })
  })
})
