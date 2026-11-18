// 결과 메일 수신인(P5 설계 §5.5) — 고른 설비들의 수신 묶음과 주소. 읽기만 한다.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createRecipientService } = require('../service/recipientService')
const { seError } = require('../errors')

const eqp = (eqpId, over = {}) => ({ eqpId, process: 'P', eqpModel: 'M', line: 'L1', emailcategory: 'CAT-A', ...over })
const caught = async (p) => { try { await p } catch (e) { return e } throw new Error('던지지 않았다') }
function setup(over = {}) {
  const calls = []
  const state = { valid: [eqp('E1'), eqp('E2', { line: 'L2' }), eqp('E3', { eqpModel: 'OTHER' })], rules: [], infos: [{ category: 'CAT-A', accounts: ['a@x.com'] }], allowed: true, ...over }
  const repo = {
    findEmailRules: async (name) => { calls.push(['rules', name]); return state.rules },
    findEmailInfos: async (cats) => { calls.push(['infos', cats]); return state.infos }
  }
  const scopes = {
    assertAllowed: async () => { if (!state.allowed) throw seError(403, 'PROCESS_FORBIDDEN', 'x') },
    scopeFor: async () => ({ valid: state.valid })
  }
  return { service: createRecipientService({ repo, scopes, env: {} }), calls, state }
}
const BODY = { process: 'P', model: 'M', name: 'RUN_A', eqpIds: ['E2', 'E1'] }

describe('recipientService.forEquipment', () => {
  it('고른 설비를 묶음마다 — 규칙은 시나리오 이름으로, 주소는 묶음 이름들로 한 번에 읽는다', async () => {
    const t = setup({ rules: [{ process: 'P', model: 'M', line: 'L2', emailCategory: 'NIGHT' }], infos: [{ category: 'CAT-A', accounts: ['a@x.com'] }, { category: 'NIGHT', accounts: ['n@x.com', ''] }] })
    expect(await t.service.forEquipment({ singleid: 'u' }, BODY)).toEqual({ groups: [
      { category: 'CAT-A', source: 'equipment', eqpIds: ['E1'], accounts: ['a@x.com'], problem: null },
      { category: 'NIGHT', source: 'rule', eqpIds: ['E2'], accounts: ['n@x.com'], problem: null }
    ] })
    expect(t.calls).toEqual([['rules', 'RUN_A'], ['infos', ['CAT-A', 'NIGHT']]])
  })
  it('내 범위의 그 공정·모델 설비가 아닌 것은 뺀다(없는 설비·다른 모델)', async () => {
    const t = setup()
    const out = await t.service.forEquipment({ singleid: 'u' }, { ...BODY, eqpIds: ['E1', 'E3', 'NOPE'] })
    expect(out.groups.map((g) => g.eqpIds)).toEqual([['E1']])
  })
  it('같은 묶음의 EMAILINFO 가 둘이면 INFO_MANY, 없으면 INFO_MISSING', async () => {
    const many = setup({ infos: [{ category: 'CAT-A', accounts: ['a'] }, { category: 'CAT-A', accounts: ['b'] }] })
    expect((await many.service.forEquipment({ singleid: 'u' }, BODY)).groups[0].problem).toBe('INFO_MANY')
    expect((await setup({ infos: [] }).service.forEquipment({ singleid: 'u' }, BODY)).groups[0].problem).toBe('INFO_MISSING')
  })
  it('묶음 이름이 없으면 주소를 묻지 않는다. 고른 설비가 없으면 빈 목록', async () => {
    const t = setup({ valid: [eqp('E1', { emailcategory: '' })] })
    expect((await t.service.forEquipment({ singleid: 'u' }, { ...BODY, eqpIds: ['E1'] })).groups).toEqual([{ category: '', source: 'equipment', eqpIds: ['E1'], accounts: [], problem: 'NO_CATEGORY' }])
    expect(t.calls).toEqual([['rules', 'RUN_A']])
    const none = setup()
    expect(await none.service.forEquipment({ singleid: 'u' }, { ...BODY, eqpIds: [] })).toEqual({ groups: [] })
    expect(none.calls).toEqual([])
  })
  it('입력 꼴이 틀리면 400, 공정 권한 밖이면 403, 설비 수가 한도를 넘으면 400', async () => {
    const t = setup()
    for (const [body, path] of [[null, ''], [{ ...BODY, process: '' }, 'process'], [{ ...BODY, name: 3 }, 'name'], [{ ...BODY, eqpIds: 'E1' }, 'eqpIds'], [{ ...BODY, eqpIds: ['E1', 2] }, 'eqpIds'], [{ ...BODY, eqpIds: Array(201).fill('E1') }, 'eqpIds']]) {
      expect(await caught(t.service.forEquipment({ singleid: 'u' }, body))).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST', details: { path } })
    }
    expect(await caught(setup({ allowed: false }).service.forEquipment({ singleid: 'u' }, BODY))).toMatchObject({ statusCode: 403, code: 'PROCESS_FORBIDDEN' })
  })
})
