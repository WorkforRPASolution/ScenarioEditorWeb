import { describe, it, expect } from 'vitest'
import { REQUIRED_FIELDS, joinEquipment, applyEquipmentRules, allowedPairs } from '../../domain/equipmentRules'
import { parseUser } from '../../domain/processPermission'

const eq = (eqpId, over = {}) => ({ eqpId, category: 'Process', process: 'P1', line: 'L1', lineDesc: 'Line 1', eqpModel: 'M1', ipAddr: `10.0.0.${eqpId.length}`,
  osVer: 'Windows 10', emailcategory: 'A-B-C-D', onoff: 1, webmanagerUse: 1, ...over })
const master = parseUser({ singleid: 'm', process: 'MASTER' })

describe('joinEquipment', () => {
  it('AGENT_INFO 에 있는 설비만, eqpId 오름차순, AGENT 중복은 두 번', () => {
    const r = joinEquipment([{ eqpId: 'B' }, { eqpId: 'A' }, { eqpId: 'A' }], [eq('A'), eq('B'), eq('C')])
    expect(r.map((e) => e.eqpId)).toEqual(['A', 'A', 'B'])
  })
})

describe('applyEquipmentRules (사내 05 §3.4 순서)', () => {
  it('중복 ID 는 첫 것만 남기고 기록(사내처럼 전체 실패하지 않음)', () => {
    const r = applyEquipmentRules([eq('A'), eq('A')], master)
    expect(r.valid.map((e) => e.eqpId)).toEqual(['A'])
    expect(r.duplicateEqpIds).toEqual(['A'])
  })
  it('첫 문서가 무효면 둘째 문서는 중복이 아니라 다시 검사한다', () => {
    const r = applyEquipmentRules([eq('A', { emailcategory: 'A-B-C' }), eq('A')], master)
    expect(r.valid.map((e) => e.eqpId)).toEqual(['A'])
    expect(r.invalid).toEqual([{ eqpId: 'A', reason: 'WRONG_EMAIL_CATEGORY' }])
    expect(r.duplicateEqpIds).toEqual([])
  })
  it('필수 필드 없음·빈 값', () => {
    const missing = eq('X'); delete missing.osVer
    const r = applyEquipmentRules([missing, eq('Y', { category: '' })], master)
    expect(r.invalid).toEqual([{ eqpId: 'X', reason: 'REQUIRED_MISSING', fields: ['osVer'] }, { eqpId: 'Y', reason: 'REQUIRED_EMPTY' }])
    expect(r.valid).toEqual([])
  })
  it('프록시 설비 IP 키가 겹치면 남기고 기록, 일반 IP 중복은 보지 않는다', () => {
    const r = applyEquipmentRules([
      eq('P1', { localpc: 1, ipAddr: '1.1.1.1', ipAddrL: '10.0.0.1' }), eq('P2', { localpc: 1, ipAddr: '1.1.1.1', ipAddrL: '10.0.0.1' }),
      eq('N1', { ipAddr: '2.2.2.2' }), eq('N2', { ipAddr: '2.2.2.2' })
    ], master)
    expect(r.valid.map((e) => e.eqpId)).toEqual(['P1', 'P2', 'N1', 'N2'])
    expect(r.proxyIpDuplicates).toEqual([{ eqpId: 'P2', sameAs: 'P1' }])
  })
  it('공정 거르기가 규칙보다 먼저다', () => {
    const r = applyEquipmentRules([eq('A', { process: 'P2', category: '' })], parseUser({ singleid: 'u', process: 'P1' }))
    expect(r).toEqual({ valid: [], duplicateEqpIds: [], invalid: [], proxyIpDuplicates: [] })
  })
})

describe('깨진 문서에도 예외 없이 건너뛰거나 무효로 기록한다', () => {
  it('joinEquipment: 객체가 아닌 항목·빈 입력은 무시', () => {
    expect(joinEquipment(null, [eq('A')])).toEqual([])
    expect(joinEquipment([null, { eqpId: 'A' }], [null, 'x', eq('A')]).map((e) => e.eqpId)).toEqual(['A'])
  })
  it('applyEquipmentRules: MASTER 는 깨진 항목을 REQUIRED_MISSING 으로, 일반 사용자는 공정 거르기에서 빠진다', () => {
    const r = applyEquipmentRules([null, eq('A')], master)
    expect(r.valid.map((e) => e.eqpId)).toEqual(['A'])
    expect(r.invalid).toEqual([{ eqpId: null, reason: 'REQUIRED_MISSING', fields: REQUIRED_FIELDS }])
    expect(applyEquipmentRules([null], parseUser({ singleid: 'u', process: 'P1' })).invalid).toEqual([])
  })
})

describe('allowedPairs', () => {
  it('공정 → 모델 → 설비 수, Unknown 공정 제외, 이름순', () => {
    const r = allowedPairs([eq('A', { process: 'P2', eqpModel: 'M2' }), eq('B', { process: 'P1' }), eq('C', { process: 'P1' }), eq('D', { process: 'Unknown' })])
    expect(r).toEqual([{ process: 'P1', models: [{ model: 'M1', eqpCount: 2 }] }, { process: 'P2', models: [{ model: 'M2', eqpCount: 1 }] }])
  })
  it('빈 입력이면 빈 목록', () => {
    expect(allowedPairs([])).toEqual([])
    expect(allowedPairs(undefined)).toEqual([])
  })
})
