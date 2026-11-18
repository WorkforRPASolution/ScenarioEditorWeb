'use strict'
// 에이전트 상태(Redis DB0, REDIS_URL — 시나리오 해시와 같은 연결). 읽기만.
// AgentMetaInfo:{공정}-{모델} 해시의 설비 ID 칸(에이전트가 뜰 때 적는 정보)과 AgentRunning:{공정}-{모델}-{설비 ID} 키(주기마다 만료 시간과 함께 쓰는 실행 신호).
// 판단은 domain/testRun.js 의 readAgent 가 한다 — 여기는 값만 읽는다.
const { seError } = require('../errors')
const { agentMetaKey, agentRunningKey } = require('../domain/testRun')

const CHUNK = 500

function createAgentStateRepository(getRedis) {
  return {
    // 한 공정·모델의 설비들 → Map(설비 ID → { meta, running }). 없는 값은 null.
    async read(process, model, eqpIds) {
      const out = new Map()
      if (!eqpIds.length) return out
      const r = getRedis()
      if (!r) throw seError(503, 'UPSTREAM_DOWN', 'Redis 에 연결되지 않았습니다')
      try {
        for (let i = 0; i < eqpIds.length; i += CHUNK) {
          const ids = eqpIds.slice(i, i + CHUNK)
          const metas = await r.hmget(agentMetaKey(process, model), ...ids)
          const runs = await r.mget(ids.map((id) => agentRunningKey(process, model, id)))
          ids.forEach((id, k) => out.set(id, { meta: metas[k] ?? null, running: runs[k] ?? null }))
        }
      } catch {
        throw seError(503, 'UPSTREAM_DOWN', 'Redis 를 읽지 못했습니다')
      }
      return out
    }
  }
}

module.exports = { createAgentStateRepository }
