import { describe, it, expect } from 'vitest'
import { isPerformanceComplete, missingOf, checkPerformanceForm, atOf, groupOf } from '../editor/performanceRules'
import { formOf, savedFields, payloadOf, sentFields, changesOf, devsChanged, citizenDevelopersOf } from '../editor/performanceForm'

// 완료 판정 경우표 — 서버 판정(server …/__tests__/domain/rules/performanceRules.test.js)과 같은 값이다. 바꾸면 둘 다 바꾼다.
// [이름, 기본 값에 덮을 칸(null = 성과 없음), 완료]
const COMPLETE_BASE = { Grade: 2, Trigger: 1, ManWorkLoss: 10, EqpStopLoss: 0, WaferLoss: 0, InvestCostLoss: 0, AccidentType: 0 }
const COMPLETE_CASES = [
  ['값이 다 참', {}, true],
  ['NotUsed 는 트리거·효과가 없어도 완료', { Grade: 6, Trigger: 0, ManWorkLoss: 0 }, true],
  ['등급 N/A', { Grade: 0 }, false],
  ['등급 N/A 면 효과가 있어도 미완료', { Grade: 0, ManWorkLoss: 100 }, false],
  ['트리거 NA', { Trigger: 0 }, false],
  ['효과·사고 유형 없음', { ManWorkLoss: 0 }, false],
  ['사고 유형만', { ManWorkLoss: 0, AccidentType: 3 }, true],
  ['설비 정지 Loss 만', { ManWorkLoss: 0, EqpStopLoss: 1 }, true],
  ['Wafer 만', { ManWorkLoss: 0, WaferLoss: 1 }, true],
  ['투자비만', { ManWorkLoss: 0, InvestCostLoss: 1 }, true],
  ['숫자가 아닌 효과는 없음으로 셈', { ManWorkLoss: 'x' }, false],
  ['성과 없음', null, false]
]

describe('isPerformanceComplete — 경우표(서버와 같은 값)', () => {
  it.each(COMPLETE_CASES)('%s', (_name, over, expected) => {
    expect(isPerformanceComplete(over === null ? null : { ...COMPLETE_BASE, ...over })).toBe(expected)
  })
  it('남은 것: 등급·트리거·효과나 사고 유형(NotUsed 면 없음)', () => {
    expect(missingOf({ ...COMPLETE_BASE, Grade: 0, Trigger: 0, ManWorkLoss: 0 })).toEqual(['grade', 'trigger', 'effect'])
    expect(missingOf({ ...COMPLETE_BASE, Grade: 6, Trigger: 0, ManWorkLoss: 0 })).toEqual([])
    expect(missingOf(COMPLETE_BASE)).toEqual([])
  })
})

// 서버 performanceFromBson 모양
const VIEW = {
  group: '', trigger: 1, triggerName: 'Log', triggerInfo: 'E1234', grade: 2, gradeName: 'A', supervisor: 'kim_conductor', supervisorNotEntered: false,
  supervisorComment: '재발률이 낮아 A 로 판단', citizenDevelopers: [{ knoxId: 'minsu.park', sdwt: '', name: '박민수', contribution: 60 }, { knoxId: 'seoyeon.lee', sdwt: '', name: '이서연', contribution: 40 }],
  performType: 1, performTypeName: 'Active', scenarioDescription: '설명', manWorkLoss: 5400, eqpPerformanceLoss: 0, eqpStopLoss: 18000, waferLoss: 0, investCostLoss: 120,
  additionalEffect: '야간 호출 감소', accidentType: 0, accidentTypeName: 'None', accidentInfo: '', updateDate: '2026-10-28', rawKeys: []
}
const ctx = (over = {}) => ({ savedTrigger: 1, registered: () => true, devsChanged: false, ...over })
const codes = (f, c) => checkPerformanceForm(f, ctx(c)).map((x) => x.code)

describe('작업본(formOf·payloadOf·sentFields)', () => {
  it('저장된 성과 → 작업본: 효과는 체크 + 값(0 은 꺼짐), 원개발자는 아이디·기여도 글', () => {
    const f = formOf(VIEW)
    expect(f.type).toBe(1)
    expect(f.eff).toEqual({ ManWorkLoss: { on: true, v: '5400' }, EqpStopLoss: { on: true, v: '18000' }, WaferLoss: { on: false, v: '' }, InvestCostLoss: { on: true, v: '120' } })
    expect(f.devs).toEqual([{ id: 'minsu.park', name: '박민수', sdwt: '', p: '60' }, { id: 'seoyeon.lee', name: '이서연', sdwt: '', p: '40' }])
    expect(f).not.toHaveProperty('trigInfo') // 트리거 정보는 웹에서 받지 않는다(42 Q-122 결정)
  })
  it('효과 유형 None 이면 Active 를 골라 둔 채 열고(사내 :270), 저장하면 Active(1)로 간다', () => {
    const v = { ...VIEW, performType: 0 }
    const f = formOf(v)
    expect(f.type).toBe(1)
    expect(sentFields({ ...f, desc: '바꿈' }, savedFields(v))).toEqual({ PerformType: 1, ScenarioDescription: '바꿈' })
  })
  it('성과가 없으면(null) 빈 값으로 읽는다 — 화면 문구를 값으로 쓰지 않는다(SE-032)', () => {
    const f = formOf(null)
    expect(f).toMatchObject({ type: 1, group: '', grade: 0, comment: '', trig: 0, acc: 0, accInfo: '', devs: [] })
    expect(savedFields(null)).toMatchObject({ PerformType: 0, Grade: 0, Trigger: 0, ManWorkLoss: 0 })
  })
  it('체크를 끈 효과는 0, 바꾼 칸만 보낸다', () => {
    const saved = savedFields(VIEW)
    const f = formOf(VIEW)
    expect(sentFields(f, saved)).toEqual({})
    f.eff.InvestCostLoss = { on: false, v: '' }
    f.grade = 1
    expect(payloadOf(f, saved).InvestCostLoss).toBe(0)
    expect(sentFields(f, saved)).toEqual({ InvestCostLoss: 0, Grade: 1 })
  })
  it('트리거 정보는 보내지도 바뀐 것으로 세지도 않는다 — 저장된 값은 그대로 남는다(42 Q-122 결정 2026-11-09)', () => {
    for (const info of ['E1234', null, '']) {
      const v = { ...VIEW, triggerInfo: info }
      const saved = savedFields(v)
      const f = formOf(v)
      f.trig = 4
      expect(payloadOf(f, saved)).not.toHaveProperty('TriggerInfo')
      expect(sentFields(f, saved)).toEqual({ Trigger: 4 })
      expect(changesOf(formOf(v), f, saved)).toEqual([{ key: 'Trigger', from: 1, to: 4 }])
    }
  })
  it('Passive 에서 Active 로 바꾸면 그룹은 빈 값, 이미 Active 인 성과의 남은 그룹은 건드리지 않는다', () => {
    const passive = { ...VIEW, performType: 2, group: 'CVD_PUMP' }
    const f = formOf(passive)
    expect(f.group).toBe('CVD_PUMP')
    f.type = 1
    expect(sentFields(f, savedFields(passive))).toEqual({ PerformType: 1, Group: '' })
    const leftover = { ...VIEW, group: 'OLD' }
    expect(sentFields({ ...formOf(leftover), grade: 1 }, savedFields(leftover))).toEqual({ Grade: 1 })
  })
  it('효과 유형 없음(그 밖)에 창이 Active 를 골라 둔 것도 바뀐 것이다(저장하면 Active 가 된다) — 손대지 않은 채면 implicit(SEW-023)', () => {
    const none = { ...VIEW, performType: 0, group: 'OLD' }
    const saved = savedFields(none)
    const init = formOf(none)
    expect(changesOf(init, formOf(none), saved)).toEqual([
      { key: 'PerformType', from: 0, to: 1, implicit: true }, { key: 'Group', from: 'OLD', to: '', implicit: true }
    ])
    const f = formOf(none)
    f.grade = 1
    expect(changesOf(init, f, saved)).toEqual([
      { key: 'PerformType', from: 0, to: 1, implicit: true }, { key: 'Group', from: 'OLD', to: '', implicit: true }, { key: 'Grade', from: 2, to: 1 }
    ])
    expect(sentFields(f, saved)).toEqual({ PerformType: 1, Group: '', Grade: 1 }) // 같은 이름 모델에 쓰는 값과 같은 기준
    f.type = 2 // 사용자가 Passive 로 바꾸면 사용자가 바꾼 것
    expect(changesOf(init, f, saved)[0]).toEqual({ key: 'PerformType', from: 0, to: 2 })
  })
  it('사용자가 바꾼 것(changesOf)은 창을 연 뒤 기준, 원개발자는 아이디·기여도로 비교', () => {
    const init = formOf(VIEW)
    const f = formOf(VIEW)
    expect(changesOf(init, f, savedFields(VIEW))).toEqual([])
    f.grade = 1
    f.devs[0].p = '50'
    expect(devsChanged(init, f)).toBe(true)
    expect(changesOf(init, f, savedFields(VIEW))).toEqual([{ key: 'Grade', from: 2, to: 1 }, { key: 'CitizenDeveloper' }])
    expect(citizenDevelopersOf(f)).toEqual([{ KnoxId: 'minsu.park', Contribution: 50 }, { KnoxId: 'seoyeon.lee', Contribution: 40 }])
  })
})

describe('칸 검사(checkPerformanceForm) — 서버 checkPerformance 와 같은 code·params', () => {
  it('값이 다 차면 없음', () => {
    expect(codes(formOf(VIEW))).toEqual([])
  })
  it('의견 4자 → COMMENT_SHORT(앞뒤 공백 빼고 5자부터)', () => {
    expect(codes({ ...formOf(VIEW), comment: ' 좋음입니 ' })).toEqual(['COMMENT_SHORT'])
    expect(codes({ ...formOf(VIEW), comment: ' 좋음입니다 ' })).toEqual([])
  })
  it('트리거·등급 필수, RV·EqState 는 저장된 값일 때만', () => {
    const f = formOf(VIEW)
    expect(codes({ ...f, trig: 0, grade: 0 })).toEqual(['TRIGGER_REQUIRED', 'GRADE_REQUIRED'])
    expect(codes({ ...f, trig: 2 })).toEqual(['TRIGGER_NOT_SELECTABLE'])
    expect(codes({ ...f, trig: 2 }, { savedTrigger: 2 })).toEqual([])
    expect(codes({ ...f, trig: 3 }, { savedTrigger: 2 })).toEqual(['TRIGGER_NOT_SELECTABLE'])
  })
  it('효과·사고 유형이 하나도 없으면 EFFECT_REQUIRED — NotUsed 는 빼고, 사고 유형이 있으면 된다', () => {
    const off = { ManWorkLoss: { on: false, v: '' }, EqpStopLoss: { on: false, v: '' }, WaferLoss: { on: false, v: '' }, InvestCostLoss: { on: false, v: '' } }
    const f = { ...formOf(VIEW), eff: off }
    expect(codes(f)).toEqual(['EFFECT_REQUIRED'])
    expect(codes({ ...f, grade: 6 })).toEqual([])
    expect(codes({ ...f, acc: 1, accInfo: 'Blackout' })).toEqual([])
  })
  it('체크한 효과는 1~2147483647 정수(EFFECT_VALUE params.field), 끈 효과는 보지 않는다', () => {
    const f = formOf(VIEW)
    for (const v of ['', '0', '1.5', '-3', 'abc', '2147483648']) {
      const r = checkPerformanceForm({ ...f, eff: { ...f.eff, WaferLoss: { on: true, v } } }, ctx())
      expect(r, v).toEqual([{ code: 'EFFECT_VALUE', params: { field: 'WaferLoss' } }])
    }
    for (const v of ['1', ' 2147483647 ']) expect(codes({ ...f, eff: { ...f.eff, WaferLoss: { on: true, v } } }), v).toEqual([])
    expect(codes({ ...f, eff: { ...f.eff, WaferLoss: { on: false, v: 'x' } } })).toEqual([])
  })
  it('사고 유형이 있으면 사고 정보 필수, Passive 그룹은 영문 대문자·숫자·밑줄', () => {
    const f = formOf(VIEW)
    expect(codes({ ...f, acc: 2, accInfo: ' ' })).toEqual(['ACCIDENT_INFO_REQUIRED'])
    expect(codes({ ...f, type: 2, group: 'CVD_PUMP_1' })).toEqual([])
    for (const g of ['', 'cvd', 'CVD-PUMP', 'A B']) expect(codes({ ...f, type: 2, group: g }), g).toEqual(['GROUP_FORMAT'])
    expect(codes({ ...f, type: 1, group: 'cvd' })).toEqual([])
  })
  it('원개발자는 고쳤을 때만 본다(서버도 목록을 보낼 때만) — 옛 데이터의 같은 사람 두 줄은 고치지 않으면 막지 않는다', () => {
    const f = { ...formOf(VIEW), devs: [{ id: 'a', p: '50' }, { id: 'a', p: '30' }] }
    expect(codes(f)).toEqual([])
  })
  it('같은 사람 두 번 → DEV_DUPLICATE(뒤 줄), 기여도 합계 110 → DEV_TOTAL', () => {
    const f = { ...formOf(VIEW), devs: [{ id: 'a', p: '60' }, { id: 'b', p: '10' }, { id: 'a', p: '40' }] }
    expect(checkPerformanceForm(f, ctx({ devsChanged: true }))).toEqual([
      { code: 'DEV_DUPLICATE', params: { index: 2 } }, { code: 'DEV_TOTAL', params: { total: 110 } }
    ])
  })
  it('등록 안 된 사람 DEV_UNKNOWN, 기여도 1~100 정수(DEV_CONTRIBUTION_RANGE)', () => {
    const f = { ...formOf(VIEW), devs: [{ id: 'a', p: '' }, { id: 'ghost', p: '20' }, { id: 'b', p: '101' }, { id: 'c', p: '0' }] }
    const r = checkPerformanceForm(f, ctx({ devsChanged: true, registered: (id) => id !== 'ghost' }))
    expect(r).toEqual([
      { code: 'DEV_CONTRIBUTION_RANGE', params: { index: 0 } }, { code: 'DEV_UNKNOWN', params: { index: 1 } },
      { code: 'DEV_CONTRIBUTION_RANGE', params: { index: 2 } }, { code: 'DEV_CONTRIBUTION_RANGE', params: { index: 3 } },
      { code: 'DEV_TOTAL', params: { total: 121 } }
    ])
  })
  it('검사 결과(서버 blocks 도)의 자리: 효과는 칸마다, 원개발자는 줄마다', () => {
    expect(atOf({ code: 'EFFECT_VALUE', params: { field: 'WaferLoss' } })).toBe('eff:WaferLoss')
    expect(atOf({ code: 'DEV_DUPLICATE', params: { index: 2 } })).toBe('dev:2')
    expect(atOf({ code: 'DEV_UNKNOWN', params: { index: 0 } })).toBe('dev:0')
    expect(atOf({ code: 'DEV_CONTRIBUTION_RANGE', params: { index: 1 } })).toBe('devp:1')
    expect(atOf({ code: 'DEV_TOTAL', params: { total: 120 } })).toBe('devs')
    expect(atOf({ code: 'TRIGGER_NOT_SELECTABLE' })).toBe('trigger')
    expect(atOf({ code: 'COMMENT_SHORT' })).toBe('comment')
    expect(groupOf('devp:1')).toBe('devs')
    expect(groupOf('eff:WaferLoss')).toBe('eff:WaferLoss')
  })
})
