'use strict'
// 시험 설비의 에이전트 상태(Redis DB0) — 실제 에이전트가 쓰는 두 가지를 흉내 낸다(ARSAgent actor/RedisActor.scala):
//   AgentMetaInfo:{공정}-{모델} 해시의 설비 ID 칸 = "{버전}:{HTTP 포트}:{설비 IP}:{로컬 주소}:{명령 방식}"  (뜰 때 한 번)
//   AgentRunning:{공정}-{모델}-{설비 ID} = 뜬 뒤 지난 초                                              (주기마다, 만료 시간과 함께)
// 시험 데이터는 만료 없이 넣는다(시험이 도는 동안 사라지지 않게). 공유 Redis 라 SEW 공정·SEWT_ 설비의 키만 넣고 지운다.
// 주소는 곧바로 거절되는 곳(127.0.0.1 의 닫힌 포트 9)으로 적는다 — InterfaceServer 는 시나리오를 저장할 때 그 공정·모델의 실행 중인 에이전트마다
// 시나리오를 보내려 한다(actor/ScenarioWorker.scala RunActionForModel). 닿지 않는 설비 IP 를 적으면 에이전트마다 연결 시간 제한 5초를 기다려
// 저장이 시간 초과로 끝난다(2026-11-18 로컬에서 겪음). 거절은 바로 끝나고 InterfaceServer 로그에 경고만 남는다.
const AGENT_ADDR = '9:127.0.0.1:_'
const AGENT_PATTERNS = ['AgentRunning:SEW*', 'AgentMetaInfo:SEW*']

// states[설비 ID] = 'off'(정보만) | 'noInfo'(아무것도 없음). 적지 않은 설비는 실행 중.
function agentEntries(equipment, states) {
  const metas = []
  const runnings = []
  for (const e of equipment) {
    if (!/^SEWT_/.test(e.eqpId)) throw new Error(`agent seed refuses a non-SEWT_ equipment: ${e.eqpId}`)
    if (!/^SEW/.test(e.process)) throw new Error(`agent seed refuses a non-SEW process: ${e.process}`)
    const state = states[e.eqpId] ?? 'on'
    if (state === 'noInfo') continue
    metas.push({ key: `AgentMetaInfo:${e.process}-${e.eqpModel}`, field: e.eqpId, value: `7.0.0.1:${AGENT_ADDR}:http` })
    if (state === 'on') runnings.push({ key: `AgentRunning:${e.process}-${e.eqpModel}-${e.eqpId}`, value: '60' })
  }
  return { metas, runnings }
}

async function seedAgents(ctx, equipment, states) {
  const { metas, runnings } = agentEntries(equipment, states)
  for (const m of metas) await ctx.redis.hset(m.key, m.field, m.value)
  for (const r of runnings) await ctx.redis.set(r.key, r.value)
  return { metas: metas.length, runnings: runnings.length }
}

async function cleanAgents(ctx) {
  const keys = []
  for (const pattern of AGENT_PATTERNS) {
    let cursor = '0'
    do {
      const [next, batch] = await ctx.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500)
      cursor = next
      keys.push(...batch)
    } while (cursor !== '0')
  }
  if (keys.length) await ctx.redis.del(...keys)
  return keys.length
}

module.exports = { AGENT_PATTERNS, agentEntries, seedAgents, cleanAgents }
