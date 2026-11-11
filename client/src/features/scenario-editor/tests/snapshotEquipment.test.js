// 설비 고르기 규칙 (P3 설계 §4.2)
import { describe, it, expect } from 'vitest'
import { processesOf, modelsOf, filterEquipment } from '../editor/snapshotEquipment'

const eq = (eqpId, process, model) => ({ eqpId, process, model, line: 'L1' })
const ITEMS = [
  eq('SEWT_PHOTO_B01', 'SEWPHOTO', 'SEWMODELB'), eq('SEWT_CVD_A02', 'SEWCVD', 'SEWMODELA'), eq('SEWT_PHOTO_A01', 'SEWPHOTO', 'SEWMODELA'),
  eq('SEWT_CVD_A01', 'SEWCVD', 'SEWMODELA'), eq('SEWT_CVD_B01', 'SEWCVD', 'SEWMODELB'), eq('SEWT_ETCH_C01', 'SEWETCH', 'SEWMODELC')
]
const ids = (r) => r.items.map((e) => e.eqpId)

describe('processesOf · modelsOf', () => {
  it('공정은 오름차순·중복 없이', () => expect(processesOf(ITEMS)).toEqual(['SEWCVD', 'SEWETCH', 'SEWPHOTO']))
  it('모델은 공정을 주면 그 공정 것만, 안 주면 전체', () => {
    expect(modelsOf(ITEMS, 'SEWCVD')).toEqual(['SEWMODELA', 'SEWMODELB'])
    expect(modelsOf(ITEMS)).toEqual(['SEWMODELA', 'SEWMODELB', 'SEWMODELC'])
    expect(modelsOf(ITEMS, 'NOPE')).toEqual([])
  })
})

describe('filterEquipment', () => {
  it('조건이 없으면 모두, 설비 ID 오름차순', () => {
    const r = filterEquipment(ITEMS, {})
    expect(ids(r)).toEqual(['SEWT_CVD_A01', 'SEWT_CVD_A02', 'SEWT_CVD_B01', 'SEWT_ETCH_C01', 'SEWT_PHOTO_A01', 'SEWT_PHOTO_B01'])
    expect(r.total).toBe(6)
  })
  it('검색어는 앞뒤 공백을 지우고 대소문자 없이 설비 ID 의 부분 글자', () => {
    expect(ids(filterEquipment(ITEMS, { q: ' photo_a ' }))).toEqual(['SEWT_PHOTO_A01'])
    expect(ids(filterEquipment(ITEMS, { q: 'zzz' }))).toEqual([])
  })
  it('공정·모델로 좁힌다', () => {
    expect(ids(filterEquipment(ITEMS, { process: 'SEWCVD' }))).toEqual(['SEWT_CVD_A01', 'SEWT_CVD_A02', 'SEWT_CVD_B01'])
    expect(ids(filterEquipment(ITEMS, { process: 'SEWCVD', model: 'SEWMODELB' }))).toEqual(['SEWT_CVD_B01'])
    expect(ids(filterEquipment(ITEMS, { model: 'SEWMODELA', q: 'cvd' }))).toEqual(['SEWT_CVD_A01', 'SEWT_CVD_A02'])
  })
  it('열린 시나리오의 공정·모델 설비가 먼저, 나머지는 ID 순', () => {
    const r = filterEquipment(ITEMS, { prefer: { process: 'SEWPHOTO', model: 'SEWMODELA' } })
    expect(ids(r)).toEqual(['SEWT_PHOTO_A01', 'SEWT_CVD_A01', 'SEWT_CVD_A02', 'SEWT_CVD_B01', 'SEWT_ETCH_C01', 'SEWT_PHOTO_B01'])
  })
  it('그리는 수를 넘으면 앞에서 그만큼만 주고 전체 수를 알린다', () => {
    const many = Array.from({ length: 60 }, (_, i) => eq(`E${String(i).padStart(3, '0')}`, 'P', 'M'))
    const r = filterEquipment(many, {}, 50)
    expect(r.items).toHaveLength(50)
    expect(r.items[49].eqpId).toBe('E049')
    expect(r.total).toBe(60)
    expect(filterEquipment(many, {}).items).toHaveLength(50)
  })
  it('빈 목록·목록이 아닌 값', () => {
    expect(filterEquipment([], { q: 'a' })).toEqual({ items: [], total: 0 })
    expect(filterEquipment(null, {})).toEqual({ items: [], total: 0 })
  })
  it('받은 배열을 바꾸지 않는다', () => {
    const before = ITEMS.map((e) => e.eqpId)
    filterEquipment(ITEMS, {})
    expect(ITEMS.map((e) => e.eqpId)).toEqual(before)
  })
})
