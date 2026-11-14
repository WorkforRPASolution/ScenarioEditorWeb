// 설비 고르기 규칙 (P3 설계 §4.2)
import { describe, it, expect } from 'vitest'
import { processesOf, modelsOf, filterEquipment, searchEquipment, filterOptions, stepActive } from '../editor/snapshotEquipment'

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

describe('searchEquipment — 설비 ID·IP 의 부분 글자', () => {
  const ip = (eqpId, ipAddr, ipAddrL = '') => ({ eqpId, process: 'P', model: 'M', line: 'L', ipAddr, ipAddrL })
  const LIST = [ip('SEWT_A01', '10.99.1.1'), ip('SEWT_B01', '10.99.2.1'), ip('SEWT_PRX01', '10.99.11.1', '192.168.0.11'), ip('SEWT_PRX02', '10.99.11.1', '192.168.0.12')]
  const found = (q) => searchEquipment(LIST, q).map((e) => e.eqpId)
  it('설비 ID 의 일부(대소문자 없이, 앞뒤 공백 지움)', () => {
    expect(found(' prx ')).toEqual(['SEWT_PRX01', 'SEWT_PRX02'])
    expect(found('b01')).toEqual(['SEWT_B01'])
  })
  it('IP 의 일부 — 바깥 IP 와 안쪽 IP 둘 다 본다', () => {
    expect(found('10.99.2')).toEqual(['SEWT_B01'])
    expect(found('10.99.11.1')).toEqual(['SEWT_PRX01', 'SEWT_PRX02'])
    expect(found('192.168.0.12')).toEqual(['SEWT_PRX02'])
    expect(found('172.')).toEqual([])
  })
  it('검색어가 비면 받은 배열 그대로(새로 만들지 않는다), 목록이 아니면 빈 배열', () => {
    expect(searchEquipment(LIST, '')).toBe(LIST)
    expect(searchEquipment(LIST, '   ')).toBe(LIST)
    expect(searchEquipment(null, 'a')).toEqual([])
  })
  it('IP 칸이 없는 설비(옛 응답)도 설비 ID 로는 찾는다', () => {
    expect(searchEquipment([{ eqpId: 'OLD_01', process: 'P', model: 'M' }], 'old').map((e) => e.eqpId)).toEqual(['OLD_01'])
    expect(searchEquipment([{ eqpId: 'OLD_01', process: 'P', model: 'M' }], '10.')).toEqual([])
  })
  it('filterEquipment 의 검색어도 IP 를 본다', () => {
    expect(filterEquipment(LIST, { q: '192.168' }).items.map((e) => e.eqpId)).toEqual(['SEWT_PRX01', 'SEWT_PRX02'])
  })
  it('좁혀진 설비로 공정·모델 목록을 만들 수 있다', () => {
    const hit = searchEquipment(ITEMS, 'photo')
    expect(processesOf(hit)).toEqual(['SEWPHOTO'])
    expect(modelsOf(hit, '')).toEqual(['SEWMODELA', 'SEWMODELB'])
  })
})

describe('filterOptions — 선택 상자 항목을 글자 일부로', () => {
  const OPTS = ['SEWCVD', 'SEWETCH', 'SEWPHOTO']
  it('빈 검색어면 모두, 치면 부분 글자(대소문자 없이)', () => {
    expect(filterOptions(OPTS, '')).toEqual({ items: OPTS, total: 3 })
    expect(filterOptions(OPTS, ' etc ')).toEqual({ items: ['SEWETCH'], total: 1 })
    expect(filterOptions(OPTS, 'zzz')).toEqual({ items: [], total: 0 })
  })
  it('그리는 수를 넘으면 앞에서 그만큼만 주고 전체 수를 알린다', () => {
    const many = Array.from({ length: 130 }, (_, i) => `M${String(i).padStart(3, '0')}`)
    const r = filterOptions(many, 'm')
    expect(r.items).toHaveLength(100)
    expect(r.total).toBe(130)
    expect(filterOptions(many, '', 10).items).toHaveLength(10)
  })
  it('목록이 아니면 빈 결과', () => expect(filterOptions(null, 'a')).toEqual({ items: [], total: 0 }))
})

describe('stepActive — ↑↓ 로 목록 안 줄 옮기기', () => {
  it('아래로·위로 한 줄씩, 끝에서 멈춘다', () => {
    expect(stepActive(0, 1, 3)).toBe(1)
    expect(stepActive(2, 1, 3)).toBe(2)
    expect(stepActive(1, -1, 3)).toBe(0)
    expect(stepActive(0, -1, 3)).toBe(0)
  })
  it('고른 줄이 없으면(-1) 아래는 첫 줄, 위는 마지막 줄', () => {
    expect(stepActive(-1, 1, 3)).toBe(0)
    expect(stepActive(-1, -1, 3)).toBe(2)
  })
  it('줄이 없으면 -1', () => expect(stepActive(0, 1, 0)).toBe(-1))
})
