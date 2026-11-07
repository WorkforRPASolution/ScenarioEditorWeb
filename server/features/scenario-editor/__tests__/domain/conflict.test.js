import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { detectConflict, propertyDiff, PROPERTY_DIFF_KEYS } from '../../domain/conflict.js'
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
