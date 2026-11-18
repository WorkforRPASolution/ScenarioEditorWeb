// 결과 메일 수신 묶음(P5 설계 §5.5) — 실제 발송 규칙(HttpWebServer EmailWorker.getEmailCategory, EmailingAgent EmailActor._sendEmail)을 옮긴 순수 함수
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { categoryOf, groupRecipients } = require('../../domain/recipients')

const EQP = { eqpId: 'E1', process: 'P', eqpModel: 'M', line: 'L1', emailcategory: 'EQP-CAT' }
const rule = (process, model, line, emailCategory) => ({ process, model, line, emailCategory })

describe('categoryOf — 설비 한 대의 수신 묶음', () => {
  it('규칙 순서: (공정·모델·라인) → (공정·모델, 라인 all) → (공정, 모델·라인 all) → (셋 다 all)', () => {
    const rules = [rule('all', 'all', 'all', 'C4'), rule('P', 'all', 'all', 'C3'), rule('P', 'M', 'all', 'C2'), rule('P', 'M', 'L1', 'C1')]
    expect(categoryOf(rules, EQP)).toEqual({ category: 'C1', source: 'rule', problem: null })
    expect(categoryOf(rules.slice(0, 3), EQP)).toEqual({ category: 'C2', source: 'rule', problem: null })
    expect(categoryOf(rules.slice(0, 2), EQP)).toEqual({ category: 'C3', source: 'rule', problem: null })
    expect(categoryOf(rules.slice(0, 1), EQP)).toEqual({ category: 'C4', source: 'rule', problem: null })
  })
  it('맞는 줄이 없으면 설비의 emailcategory 그대로', () => {
    expect(categoryOf([rule('P', 'M', 'L9', 'X'), rule('P', 'OTHER', 'all', 'Y'), rule('all', 'M', 'all', 'Z')], EQP)).toEqual({ category: 'EQP-CAT', source: 'equipment', problem: null })
    expect(categoryOf([], EQP)).toEqual({ category: 'EQP-CAT', source: 'equipment', problem: null })
    expect(categoryOf(undefined, EQP).source).toBe('equipment')
  })
  it('맞는 줄이 있는데 묶음 이름이 비었으면 메일이 가지 않는다 — 설비 값으로 넘어가지 않는다', () => {
    expect(categoryOf([rule('P', 'M', 'L1', '')], EQP)).toEqual({ category: '', source: 'rule', problem: 'EMPTY_RULE' })
    expect(categoryOf([rule('P', 'M', 'L1', null)], EQP)).toEqual({ category: '', source: 'rule', problem: 'EMPTY_RULE' })
  })
  it('같은 단계의 줄이 여럿이면 처음 것', () => {
    expect(categoryOf([rule('P', 'M', 'L1', 'FIRST'), rule('P', 'M', 'L1', 'SECOND')], EQP).category).toBe('FIRST')
  })
  it('설비에도 묶음이 없으면 NO_CATEGORY', () => {
    expect(categoryOf([], { ...EQP, emailcategory: '' })).toEqual({ category: '', source: 'equipment', problem: 'NO_CATEGORY' })
    expect(categoryOf([], { ...EQP, emailcategory: undefined }).problem).toBe('NO_CATEGORY')
  })
})

describe('groupRecipients — 설비들을 묶음마다', () => {
  const eq = (eqpId, over = {}) => ({ ...EQP, eqpId, ...over })
  const infos = (map) => new Map(Object.entries(map))
  it('같은 묶음의 설비를 모으고 EMAILINFO 가 정확히 1건일 때만 주소를 준다(빈 글은 뺀다)', () => {
    const out = groupRecipients({
      rules: [rule('P', 'M', 'L2', 'NIGHT')],
      equipment: [eq('E1'), eq('E2', { line: 'L2' }), eq('E3'), eq('E4', { line: 'L2' })],
      infos: infos({ 'EQP-CAT': [{ accounts: ['a@x.com', '', 'b@x.com'] }], NIGHT: [{ accounts: ['n@x.com'] }] })
    })
    expect(out).toEqual([
      { category: 'EQP-CAT', source: 'equipment', eqpIds: ['E1', 'E3'], accounts: ['a@x.com', 'b@x.com'], problem: null },
      { category: 'NIGHT', source: 'rule', eqpIds: ['E2', 'E4'], accounts: ['n@x.com'], problem: null }
    ])
  })
  it('EMAILINFO 가 없거나 여럿이면 그 묶음으로는 메일이 가지 않는다', () => {
    const out = groupRecipients({ rules: [], equipment: [eq('E1'), eq('E2', { emailcategory: 'TWO' })], infos: infos({ TWO: [{ accounts: ['a'] }, { accounts: ['b'] }] }) })
    expect(out).toEqual([
      { category: 'EQP-CAT', source: 'equipment', eqpIds: ['E1'], accounts: [], problem: 'INFO_MISSING' },
      { category: 'TWO', source: 'equipment', eqpIds: ['E2'], accounts: [], problem: 'INFO_MANY' }
    ])
  })
  it('묶음 이름이 빈 규칙·묶음이 없는 설비는 문제와 함께 따로 묶는다. accounts 가 배열이 아니면 빈 목록', () => {
    const out = groupRecipients({
      rules: [rule('P', 'M', 'L2', '')],
      equipment: [eq('E1', { line: 'L2' }), eq('E2', { emailcategory: '' }), eq('E3')],
      infos: infos({ 'EQP-CAT': [{ accounts: 'a@x.com' }] })
    })
    expect(out).toEqual([
      { category: '', source: 'equipment', eqpIds: ['E2'], accounts: [], problem: 'NO_CATEGORY' },
      { category: '', source: 'rule', eqpIds: ['E1'], accounts: [], problem: 'EMPTY_RULE' },
      { category: 'EQP-CAT', source: 'equipment', eqpIds: ['E3'], accounts: [], problem: null }
    ])
  })
})
