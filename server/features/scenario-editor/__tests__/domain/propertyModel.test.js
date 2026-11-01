import { describe, it, expect } from 'vitest'
import { propertyFromBson, lastOwner } from '../../domain/propertyModel'
import { SCHEMAS } from '../../domain/csharpJson'

describe('propertyFromBson (C# ScenarioProperty(BsonDocument), 조사 §5)', () => {
  it('빈 문서는 C# 기본값, 키 순서는 직렬화 스키마와 같다', () => {
    const r = propertyFromBson({})
    expect(r.ok).toBe(true)
    expect(Object.keys(r.value)).toEqual(SCHEMAS.ScenarioProperty.map(([k]) => k))
    expect(r.value).toMatchObject({ ID: '', Owners: [], RetryInterval: 10, IsEnabled: true, IsShowDialog: true, Priority: 10, NextScenarioIfSuccess: null })
  })
  it('Int64·Double·숫자 문자열은 정수로(소수는 버림)', () => {
    const long = { toNumber: () => 30, _bsontype: 'Long' }
    const r = propertyFromBson({ StartDelay: long, RetryCnt: 2.7, Priority: '5' })
    expect(r.value).toMatchObject({ StartDelay: 30, RetryCnt: 2, Priority: 5 })
  })
  it('null 문자열은 "BsonNull", null bool 은 false (사내와 같음)', () => {
    const r = propertyFromBson({ EDMLink: null, IsEnabled: null })
    expect(r.value).toMatchObject({ EDMLink: 'BsonNull', IsEnabled: false })
  })
  it('bool 은 C# ToBoolean: 문자열은 빈 값이 아니면 true, 숫자는 0 이 아니면 true', () => {
    expect(propertyFromBson({ IsEnabled: 'false' }).value.IsEnabled).toBe(true)
    expect(propertyFromBson({ IsEnabled: 0 }).value.IsEnabled).toBe(false)
  })
  it('정수 자리 null 은 실패(사내 목록은 그 문서를 건너뜀)', () => {
    expect(propertyFromBson({ Priority: null })).toMatchObject({ ok: false })
  })
  it('후속 시나리오: {} → 빈 문자열 둘, 값이 문자열이면 실패', () => {
    expect(propertyFromBson({ NextScenarioIfSuccess: {} }).value.NextScenarioIfSuccess).toEqual({ Name: '', Text: '' })
    expect(propertyFromBson({ NextScenarioIfFail: { Name: 'X', Text: null } }).value.NextScenarioIfFail).toEqual({ Name: 'X', Text: null })
    expect(propertyFromBson({ NextScenarioIfFail: 'X' }).ok).toBe(false)
  })
  it('Owners 원소는 문자열로, null 원소는 "BsonNull"', () => {
    expect(propertyFromBson({ Owners: ['a', 5, null] }).value.Owners).toEqual(['a', '5', 'BsonNull'])
  })
})

describe('lastOwner', () => {
  it('"아이디@yyyy-MM-dd HH:mm:ss[@메모]" 의 마지막 항목', () => {
    expect(lastOwner(['a@2026-10-01 10:00:00', 'b@2026-11-01 09:00:00@Scenario Deactivated']))
      .toEqual({ singleid: 'b', at: '2026-11-01 09:00:00', note: 'Scenario Deactivated' })
    expect(lastOwner([])).toBe(null)
  })
})
