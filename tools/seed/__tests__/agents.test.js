// 시험 설비의 에이전트 상태(Redis DB0) — 시나리오 실행이 실행 중인 에이전트에만 보내는지 보는 시험 데이터
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { agentEntries, AGENT_PATTERNS } = require('../lib/agents')
const { equipment, agentStates } = require('../data/equipment')
const { readAgent, agentMetaKey, agentRunningKey } = require('../../../server/features/scenario-editor/domain/testRun')

describe('agentEntries', () => {
  const eqps = [
    { eqpId: 'SEWT_A', process: 'SEWCVD', eqpModel: 'SEWMODELA', ipAddr: '10.99.1.1' },
    { eqpId: 'SEWT_B', process: 'SEWCVD', eqpModel: 'SEWMODELA', ipAddr: '10.99.2.1' },
    { eqpId: 'SEWT_C', process: 'SEWETCH', eqpModel: 'SEWMODELB', ipAddr: '10.99.3.1' }
  ]
  it('실행 중(기본)은 정보 + 실행 신호, off 는 정보만, noInfo 는 아무것도 넣지 않는다 — 값은 에이전트가 쓰는 꼴', () => {
    const out = agentEntries(eqps, { SEWT_B: 'off', SEWT_C: 'noInfo' })
    expect(out.metas).toEqual([
      { key: 'AgentMetaInfo:SEWCVD-SEWMODELA', field: 'SEWT_A', value: '7.0.0.1:9:127.0.0.1:_:http' },
      { key: 'AgentMetaInfo:SEWCVD-SEWMODELA', field: 'SEWT_B', value: '7.0.0.1:9:127.0.0.1:_:http' }
    ])
    expect(out.runnings).toEqual([{ key: 'AgentRunning:SEWCVD-SEWMODELA-SEWT_A', value: '60' }])
  })
  it('에이전트 주소는 곧바로 거절되는 곳(루프백의 닫힌 포트)이다 — InterfaceServer 가 저장할 때 실행 중인 에이전트마다 시나리오를 보내려 한다', () => {
    // 닿지 않는 주소(설비 IP)를 넣으면 저장 한 번이 에이전트 수 × 연결 시간 제한(5초)만큼 늦어져 저장이 시간 초과로 끝난다(2026-11-18 로컬에서 겪음)
    for (const m of agentEntries(eqps, {}).metas) expect(m.value.split(':').slice(1, 4)).toEqual(['9', '127.0.0.1', '_'])
  })
  it('SEWT_ 설비가 아니거나 SEW 로 시작하지 않는 공정은 넣지 않는다(공유 Redis)', () => {
    expect(() => agentEntries([{ eqpId: 'REAL_01', process: 'SEWCVD', eqpModel: 'SEWMODELA', ipAddr: '1.1.1.1' }], {})).toThrow(/SEWT_/)
    expect(() => agentEntries([{ eqpId: 'SEWT_X', process: 'CVD', eqpModel: 'M', ipAddr: '1.1.1.1' }], {})).toThrow(/SEW/)
  })
  it('지울 때 훑는 무늬는 SEW 공정의 두 키뿐이다', () => {
    expect(AGENT_PATTERNS).toEqual(['AgentRunning:SEW*', 'AgentMetaInfo:SEW*'])
  })
})

describe('시험 설비의 에이전트 상태', () => {
  const { metas, runnings } = agentEntries(equipment, agentStates)
  const stateOf = (e) => readAgent({
    meta: metas.find((m) => m.key === agentMetaKey(e.process, e.eqpModel) && m.field === e.eqpId)?.value ?? null,
    running: runnings.find((r) => r.key === agentRunningKey(e.process, e.eqpModel, e.eqpId))?.value ?? null
  })
  it('SEWT_CVD_AGOFF 는 꺼짐, SEWT_CVD_NOAG 는 정보 없음, 나머지는 모두 실행 중 — 서버의 규칙(readAgent)으로 읽어서', () => {
    const not = equipment.filter((e) => stateOf(e) !== 'on').map((e) => [e.eqpId, stateOf(e)])
    expect(not).toEqual([['SEWT_CVD_AGOFF', 'off'], ['SEWT_CVD_NOAG', 'noInfo']])
    expect(Object.keys(agentStates).sort()).toEqual(['SEWT_CVD_AGOFF', 'SEWT_CVD_NOAG'])
  })
  it('두 설비는 자동조치가 켜진 유효 설비다 — 에이전트 때문에만 고를 수 없다', () => {
    for (const id of ['SEWT_CVD_AGOFF', 'SEWT_CVD_NOAG']) {
      const e = equipment.find((x) => x.eqpId === id)
      expect(e).toMatchObject({ process: 'SEWCVD', eqpModel: 'SEWMODELA', onoff: 1, category: 'Process' })
    }
  })
})
