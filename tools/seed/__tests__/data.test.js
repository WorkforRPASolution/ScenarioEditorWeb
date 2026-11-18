import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const D = '../../../server/features/scenario-editor/domain/'
const { parseUser } = require(D + 'processPermission')
const { joinEquipment, applyEquipmentRules, allowedPairs } = require(D + 'equipmentRules')
const { equipment, agents } = require('../data/equipment')
const users = require('../data/users')
const expected = require('../data/expected-scopes')

describe('시험 데이터 기대값', () => {
  const joined = joinEquipment(agents, equipment)
  it.each(users.map((u) => [u.singleid, u]))('%s', (id, u) => {
    const doc = { ...u, authorityManager: u.authorityManager && u.authorityManager.long !== undefined ? { toNumber: () => u.authorityManager.long } : u.authorityManager }
    const r = applyEquipmentRules(joined, parseUser(doc))
    expect(allowedPairs(r.valid)).toEqual(expected[id].processes)
    expect(r.invalid.length + r.duplicateEqpIds.length).toBe(expected[id].excludedEqpCount)
  })
})

describe('시험 실행(P5) 데이터', () => {
  it('자동조치 OFF 설비 SEWT_CVD_OFF 가 SEWCVD/SEWMODELA 에 있고 유효 설비다', () => {
    const off = equipment.find((e) => e.eqpId === 'SEWT_CVD_OFF')
    expect(off).toMatchObject({ process: 'SEWCVD', eqpModel: 'SEWMODELA', onoff: 0, line: 'SEWLINE1' })
    const r = applyEquipmentRules(joinEquipment(agents, equipment), parseUser(users.find((u) => u.singleid === 'sew_master')))
    expect(r.valid.map((e) => e.eqpId)).toContain('SEWT_CVD_OFF')
    expect(equipment.filter((e) => e.onoff === 0).map((e) => e.eqpId)).toEqual(['SEWT_CVD_OFF'])
  })
  it('운영 속성이 기본값이 아닌 시나리오 RUN_PROPS 와 유형이 Int32 인 RUN_BAD_CATEGORY', () => {
    const basic = require('../../scenario-gen/scenarios/basic')
    const anomaly = require('../../scenario-gen/scenarios/anomaly')
    const run = basic.find((s) => s.name === 'RUN_PROPS')
    expect(run).toMatchObject({ process: 'SEWCVD', model: 'SEWMODELA' })
    const w = { sc: { property: {} }, targetWindow() {}, none() {} }
    run.build(w)
    expect(w.sc.property).toEqual({
      StartDelay: 30, RetryCnt: 2, RetryInterval: 10, Priority: 5, DoNotSendEmailWhenSuccess: true, DoNotSendEmailWhenStop: true,
      NextScenarioIfSuccess: { Name: 'ALL_ACTIONS', Text: '동작 16종' }, NextScenarioIfFail: { Name: 'ALL_CONDITIONS', Text: '조건 4종' }
    })
    expect(anomaly.find((s) => s.name === 'RUN_BAD_CATEGORY')).toMatchObject({ process: 'SEWCVD', model: 'SEWMODELA', load: 'badCategory' })
  })
})

describe('시험 실행(P5) 수신인 데이터', () => {
  const { emailInfos, emailRules } = require('../data/emails')
  it('묶음 이름은 SEW- 로 시작하고(정리가 이것으로 지운다) 규칙은 SEW 공정 것만', () => {
    expect(emailInfos.length).toBeGreaterThanOrEqual(2)
    for (const d of emailInfos) expect([d.project, d.category.startsWith('SEW-'), Array.isArray(d.accounts)]).toEqual(['ARS', true, true])
    for (const r of emailRules) expect([r.app, r.process.startsWith('SEW'), r.emailCategory.startsWith('SEW-')]).toEqual(['ARS', true, true])
  })
  it('RUN_PROPS 는 규칙(라인 all)으로 SEW-RUN-NIGHT, 그 밖의 시나리오는 설비의 묶음 — SEWT_DUP01 의 묶음은 주소가 등록돼 있지 않다', () => {
    const { categoryOf } = require(D + 'recipients')
    const a01 = equipment.find((e) => e.eqpId === 'SEWT_CVD_A01')
    const dup = equipment.find((e) => e.eqpId === 'SEWT_DUP01')
    const rulesOf = (name) => emailRules.filter((r) => r.code === name)
    expect(categoryOf(rulesOf('RUN_PROPS'), a01)).toMatchObject({ category: 'SEW-RUN-NIGHT', source: 'rule' })
    expect(categoryOf(rulesOf('ALL_CONDITIONS'), a01)).toMatchObject({ category: 'SEW-SEWCVD-SEWMODELA-MAIL', source: 'equipment' })
    expect(categoryOf(rulesOf('ALL_CONDITIONS'), dup).category).toBe('SEW-SEWCVD-SEWMODELA-NONE')
    const names = emailInfos.map((d) => d.category)
    expect(names).toContain('SEW-RUN-NIGHT')
    expect(names).toContain('SEW-SEWCVD-SEWMODELA-MAIL')
    expect(names).not.toContain('SEW-SEWCVD-SEWMODELA-NONE')
  })
})
