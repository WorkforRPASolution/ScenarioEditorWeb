import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { detectConflict, propertyDiff, PROPERTY_DIFF_KEYS, PROPERTY_ALL_KEYS } from '../../domain/conflict.js'
const require = createRequire(import.meta.url)

describe('conflict', () => {
  const base = { sameScenario: true, docExists: true, headCrtime: 1, currentCrtime: 1, propertyRev: 'p', currentPropertyRev: 'p', owners: ['k@2026-11-06 09:00:00'] }
  it('충돌 순서', () => {
    expect(detectConflict(base)).toBe(null)
    expect(detectConflict({ ...base, docExists: false })).toEqual({ kind: 'deleted' })
    expect(detectConflict({ ...base, currentCrtime: 2 })).toEqual({ kind: 'newVersion', by: 'k', at: '2026-11-06 09:00:00' })
    expect(detectConflict({ ...base, currentPropertyRev: 'q' })).toEqual({ kind: 'property' })
    expect(detectConflict({ ...base, sameScenario: false, currentCrtime: 2 })).toBe(null)
  })
  it('새 시나리오(sameScenario false)는 문서가 있어도 본 적 없다', () => {
    expect(detectConflict({ ...base, sameScenario: false, headCrtime: null, currentCrtime: null })).toBe(null)
    expect(detectConflict({ ...base, sameScenario: false, headCrtime: null, currentCrtime: 5 })).toBe(null)
  })
  it('현재 판 없이 연 기존 시나리오도 충돌을 본다', () => {
    const nb = { ...base, headCrtime: null, currentCrtime: null }
    expect(detectConflict({ ...nb, currentCrtime: 5 })).toEqual({ kind: 'newVersion', by: 'k', at: '2026-11-06 09:00:00' })
    expect(detectConflict({ ...nb, docExists: false })).toEqual({ kind: 'deleted' })
    expect(detectConflict(nb)).toBe(null)
  })
  it('누가·언제 없으면 null', () => {
    expect(detectConflict({ ...base, currentCrtime: 2, owners: [] })).toEqual({ kind: 'newVersion', by: null, at: null })
  })
  it('운영 속성 차이', () => {
    expect(PROPERTY_DIFF_KEYS).toEqual(['IsEnabled', 'NextScenarioIfSuccess', 'NextScenarioIfFail', 'Type', 'StartDelay'])
    expect(propertyDiff({ IsEnabled: true, Type: 1, StartDelay: 0 }, { IsEnabled: false, Type: 1, StartDelay: 0 }))
      .toEqual([{ key: 'IsEnabled', from: true, to: false }])
  })
})

// 운영 속성 충돌 확인에 보일 차이(2026-11-10 사내 시험: 안내만으로는 배포하면 무엇이 어떻게 바뀌는지 알 수 없었다).
// 배포는 운영 속성을 통째로 바꾸므로(InterfaceServer $set property) 다섯 칸이 아니라 전부를 본다. ID 는 대상이 정하고 Owners 는 배포가 잇는다.
describe('propertyDiff — 전체 키(PROPERTY_ALL_KEYS)', () => {
  it('ID·Owners 를 뺀 운영 속성 전부', () => {
    expect(PROPERTY_ALL_KEYS).toEqual(['ScenarioTriggerType', 'DoNotSendEmailWhenSuccess', 'DoNotSendEmailWhenStop', 'DoNotSendEmailWhenFail', 'StartDelay', 'RetryCnt', 'RetryInterval',
      'NextScenarioIfSuccess', 'NextScenarioIfFail', 'Type', 'DetailedDescriptionTitle', 'DetailedDescription', 'DescriptionFromConductor', 'EDMLink', 'IsEnabled', 'ExecutingLevel',
      'IsShowDialog', 'Priority', 'LcncType', 'LowcodeExtension'])
  })
  it('다섯 칸 밖의 값(재시도·메일·우선순위)도 차이로 낸다, ID·Owners 는 내지 않는다', () => {
    const cur = { ID: 'P-M-N', Owners: ['a@2026-11-10 10:00:00'], IsEnabled: false, RetryCnt: 2, DoNotSendEmailWhenFail: true, Priority: 5 }
    const mine = { ID: 'P-M-N2', Owners: [], IsEnabled: true, RetryCnt: 0, DoNotSendEmailWhenFail: false, Priority: 10 }
    expect(propertyDiff(cur, mine, PROPERTY_ALL_KEYS)).toEqual([
      { key: 'DoNotSendEmailWhenFail', from: true, to: false }, { key: 'RetryCnt', from: 2, to: 0 }, { key: 'IsEnabled', from: false, to: true }, { key: 'Priority', from: 5, to: 10 }
    ])
    expect(propertyDiff(cur, mine)).toEqual([{ key: 'IsEnabled', from: false, to: true }]) // 기본은 덮어쓰기 차이의 다섯 칸
  })
  it('값이 같으면(Owners 줄만 늘었으면) 빈 목록', () => {
    const cur = { Owners: ['a@1', 'b@2'], IsEnabled: true, Type: 1, RetryInterval: 10, Priority: 10, IsShowDialog: true }
    expect(propertyDiff(cur, { ...cur, Owners: ['a@1'] }, PROPERTY_ALL_KEYS)).toEqual([])
  })
})

// 지금 값은 열기와 같은 해석(propertyFromBson), 보낼 값은 조립과 같은 채움(withCsDefaults·후속 설명 null → "")으로 맞춘 뒤 값으로 비교한다
describe('propertyDiff — 정규화한 값 비교', () => {
  const follow = (Name, Text) => ({ Name, Text })
  it('같은 후속 시나리오 객체는 차이가 아니다', () => {
    const cur = { IsEnabled: true, Type: 1, StartDelay: 0, NextScenarioIfSuccess: follow('A', 'a'), NextScenarioIfFail: follow('B', '') }
    expect(propertyDiff(cur, structuredClone(cur))).toEqual([])
  })
  it('후속 이름이 바뀌면 차이 — from·to 는 정규화한 {Name, Text}', () => {
    const cur = { NextScenarioIfSuccess: { Name: 'A' } }
    expect(propertyDiff(cur, { NextScenarioIfSuccess: follow('B', 'b') }))
      .toEqual([{ key: 'NextScenarioIfSuccess', from: follow('A', ''), to: follow('B', 'b') }])
  })
  it('없는 키와 기본값(null·true·0)은 같다', () => {
    expect(propertyDiff({}, { IsEnabled: true, NextScenarioIfSuccess: null, NextScenarioIfFail: null, Type: 0, StartDelay: 0 })).toEqual([])
    expect(propertyDiff({ NextScenarioIfSuccess: null, NextScenarioIfFail: null, IsEnabled: true }, {})).toEqual([])
  })
  it('후속 설명 null 과 "", 빠진 Name 과 "" 는 같다(조립이 "" 로 보낸다)', () => {
    expect(propertyDiff({ NextScenarioIfFail: { Name: 'A', Text: null } }, { NextScenarioIfFail: { Name: 'A', Text: '' } })).toEqual([])
    expect(propertyDiff({ NextScenarioIfFail: { Text: 'x' } }, { NextScenarioIfFail: { Name: '', Text: 'x' } })).toEqual([])
  })
  it('저장 형(Int64 Type·정수 StartDelay)과 화면 값(숫자)이 같으면 차이가 아니다', () => {
    const { Long } = require('mongoose').mongo
    expect(propertyDiff({ Type: Long.fromNumber(2), StartDelay: Long.fromNumber(30) }, { Type: 2, StartDelay: 30 })).toEqual([])
  })
  it('켜짐이 없던 문서(기본 켜짐)를 끄면 true → false', () => {
    expect(propertyDiff({}, { IsEnabled: false })).toEqual([{ key: 'IsEnabled', from: true, to: false }])
  })
  it('from·to 는 undefined 가 아니다 — 지금 property 가 문서가 아니면 from 은 null(JSON 에 남는다)', () => {
    const d = propertyDiff(null, { Type: 1 })
    expect(d.map((x) => x.key)).toEqual(['IsEnabled', 'Type', 'StartDelay'])
    for (const x of d) expect(x.from).toBeNull()
    expect(JSON.parse(JSON.stringify(d))).toEqual(d)
  })
  it('한 칸이 해석되지 않아도(Type null) 다른 칸은 정규화하고, 그 칸은 저장값 그대로', () => {
    expect(propertyDiff({ Type: null, Owners: 'broken', IsEnabled: false }, { Type: 1, IsEnabled: false }))
      .toEqual([{ key: 'Type', from: null, to: 1 }])
  })
})
