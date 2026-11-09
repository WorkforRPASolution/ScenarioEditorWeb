import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Long } = require('mongoose').mongo
const { createPerformanceService } = require('../service/performanceService')
const { seError } = require('../errors')

const NOW = new Date('2026-11-07T01:02:03Z')
const admin = { singleid: 'adm', authorityManager: 1 }
const key = { process: 'P', model: 'M1', name: 'N' }
const GOOD = { Group: '', Trigger: 1, TriggerInfo: null, Grade: 2, Supervisor: 'old', SupervisorComment: '충분히 긴 의견', CitizenDeveloper: [], PerformType: 1, ScenarioDescription: '', ManWorkLoss: 5, EqpPerfornmanceLoss: 7, EqpStopLoss: 0, WaferLoss: 0, InvestCostLoss: 0, AdditionalEffect: '', AccidentType: 0, AccidentInfo: '', UpdateDate: '2026-01-01' }
const fail = async (p) => { try { await p } catch (e) { return e } throw new Error('통과하면 안 됨') }

// docs: 'P|모델|이름' → 문서 배열. 쓰기는 문서에 반영한다.
function setup(o = {}) {
  const calls = { review: [], perf: [], allowed: [], users: [] }
  const docs = new Map(Object.entries(o.docs || { 'P|M1|N': [{ scname: 'N', property: {}, performance: { ...GOOD } }] }))
  const apply = (k, fields) => {
    const d = docs.get(`${k.process}|${k.model}|${k.name}`)
    for (const [f, v] of Object.entries(fields)) d[0].performance[f.replace('performance.', '')] = v
  }
  const repo = {
    findScenarioKeyDocs: async (p, m, n) => docs.get(`${p}|${m}|${n}`) || [],
    findPerformanceRaw: async (k) => o.raw !== undefined ? o.raw : ((docs.get(`${k.process}|${k.model}|${k.name}`) || [{}])[0].performance || null),
    setReview: async (k, f) => { calls.review.push([k, f]); apply(k, f); return { matched: 1 } },
    setPerformanceFields: async (k, f) => {
      calls.perf.push([k.model, f])
      if (o.writeFails === k.model) throw seError(504, 'UPSTREAM_TIMEOUT', 'x')
      apply(k, f); return { matched: 1 }
    },
    findUsers: async (id) => { calls.users.push(id); return (o.users || { dev1: [{ singleid: 'dev1', name: 'D1', process: 'AA:BB' }] })[id] || [] },
    searchUsers: async (q) => { calls.q = q; return [{ singleid: 'a', name: 'b', process: 'x' }, { singleid: 'c', name: 'b' }] },
    findSameNameModels: async () => ['M1', 'M2', 'M9'],
    hasNameRule: async () => o.rule === true,
    findNameRule: async () => [{ pattern: 'x' }]
  }
  const scopes = {
    assertAllowed: async (u, p, m) => { calls.allowed.push(m); if (m === 'FORBID' || (o.deny || []).includes(m)) throw seError(403, 'PROCESS_FORBIDDEN', 'x') },
    scopeFor: async () => ({ pairs: [{ process: 'P', models: [{ model: 'M1' }, { model: 'M2' }] }] })
  }
  return { svc: createPerformanceService({ repo, scopes, now: () => NOW.getTime() }), calls, docs }
}

describe('review', () => {
  it('등급 3 은 403 GRADE_FORBIDDEN, 아무것도 쓰지 않는다', async () => {
    const { svc, calls } = setup()
    const e = await fail(svc.review({ singleid: 'x', authorityManager: 3 }, key, { grade: 3, comment: 'zzzzzz' }))
    expect([e.statusCode, e.code]).toEqual([403, 'GRADE_FORBIDDEN'])
    expect(calls.review).toEqual([])
  })
  it('등급을 바꾸면 Grade·Supervisor 만 쓰고 다시 읽은 performance 를 돌려준다', async () => {
    const { svc, calls } = setup()
    const out = await svc.review(admin, key, { grade: 3, comment: '충분히 긴 의견' })
    expect(calls.review).toEqual([[key, { 'performance.Grade': 3, 'performance.Supervisor': 'adm' }]])
    expect(out.performance).toMatchObject({ grade: 3, supervisor: 'adm' })
  })
  it('바뀐 것이 없으면 쓰지 않는다', async () => {
    const { svc, calls } = setup()
    await svc.review(admin, key, { grade: 2, comment: '충분히 긴 의견' })
    expect(calls.review).toEqual([])
  })
  it('문서 0건 404, 2건 422, 권한 밖 403', async () => {
    expect((await fail(setup({ docs: {} }).svc.review(admin, key, { grade: 1 }))).statusCode).toBe(404)
    const two = setup({ docs: { 'P|M1|N': [{ property: {} }, { property: {} }] } })
    expect((await fail(two.svc.review(admin, key, { grade: 1 }))).code).toBe('DATA_INVALID')
    expect((await fail(setup({ deny: ['M1'] }).svc.review(admin, key, { grade: 1 }))).code).toBe('PROCESS_FORBIDDEN')
  })
  it('등급 범위·의견 형식이 틀리면 400', async () => {
    expect((await fail(setup().svc.review(admin, key, { grade: 99 }))).statusCode).toBe(400)
    expect((await fail(setup().svc.review(admin, key, { grade: 2, comment: 5 }))).statusCode).toBe(400)
  })
})

describe('savePerformance', () => {
  it('등급 3 은 403, 쓰지 않는다', async () => {
    const { svc, calls } = setup()
    expect((await fail(svc.savePerformance({ singleid: 'x', authorityManager: 3 }, key, { fields: { ManWorkLoss: 9 }, alsoModels: [] }))).code).toBe('GRADE_FORBIDDEN')
    expect(calls.perf).toEqual([])
  })
  it('바뀐 필드만 $set(UpdateDate 포함, EqpPerfornmanceLoss 없음)', async () => {
    const { svc, calls } = setup()
    const out = await svc.savePerformance(admin, key, { fields: { ManWorkLoss: 9, EqpPerfornmanceLoss: 1, WaferLoss: 0 }, alsoModels: [] })
    expect(calls.perf).toEqual([['M1', { 'performance.ManWorkLoss': 9, 'performance.UpdateDate': '2026-11-07' }]])
    expect(out.performance.manWorkLoss).toBe(9)
    expect(out.applied).toEqual([])
  })
  it('검사에 막히면 422 VALIDATION_FAILED details.blocks, 쓰지 않는다', async () => {
    const { svc, calls } = setup()
    const e = await fail(svc.savePerformance(admin, key, { fields: { Trigger: 0 }, alsoModels: [] }))
    expect([e.statusCode, e.code]).toEqual([422, 'VALIDATION_FAILED'])
    expect(e.details.blocks.map((b) => b.code)).toContain('TRIGGER_REQUIRED')
    expect(calls.perf).toEqual([])
  })
  it('원개발자: 등록된 사용자만, Sdwt·Name 을 채우고 새 원소는 Long, 기존 Int32 원소는 Int32 로 쓴다', async () => {
    const { svc, calls } = setup({ raw: { ...GOOD, CitizenDeveloper: [{ KnoxId: 'dev1', Sdwt: 'AA', Name: 'D1', Contribution: 30 }] } })
    await svc.savePerformance(admin, key, { fields: {}, citizenDevelopers: [{ KnoxId: 'dev1', Contribution: 40 }], alsoModels: [] })
    const dev = calls.perf[0][1]['performance.CitizenDeveloper']
    expect(dev).toEqual([{ KnoxId: 'dev1', Sdwt: 'AA', Name: 'D1', Contribution: 40 }])
    expect(typeof dev[0].Contribution).toBe('number')
    const n = setup({ raw: GOOD })
    await n.svc.savePerformance(admin, key, { fields: {}, citizenDevelopers: [{ KnoxId: 'dev1', Contribution: 40 }], alsoModels: [] })
    expect(Long.isLong(n.calls.perf[0][1]['performance.CitizenDeveloper'][0].Contribution)).toBe(true)
  })
  it('기존 Int64 원소는 Long 으로 쓴다', async () => {
    const { svc, calls } = setup({ raw: { ...GOOD, CitizenDeveloper: [{ KnoxId: 'dev1', Contribution: Long.fromNumber(30) }] } })
    await svc.savePerformance(admin, key, { fields: {}, citizenDevelopers: [{ KnoxId: 'dev1', Contribution: 40 }], alsoModels: [] })
    expect(Long.isLong(calls.perf[0][1]['performance.CitizenDeveloper'][0].Contribution)).toBe(true)
  })
  it('등록되지 않은 원개발자는 DEV_UNKNOWN 으로 막힌다', async () => {
    const { svc } = setup()
    const e = await fail(svc.savePerformance(admin, key, { fields: {}, citizenDevelopers: [{ KnoxId: 'ghost', Contribution: 10 }], alsoModels: [] }))
    expect(e.details.blocks.map((b) => b.code)).toContain('DEV_UNKNOWN')
  })
  it('일괄 적용: 두 번째 모델 0건 → 그 모델만 NOT_FOUND, 세 번째는 저장되고 원개발자 필드는 없다', async () => {
    const mk = () => [{ scname: 'N', property: {}, performance: { ...GOOD } }]
    const { svc, calls } = setup({ docs: { 'P|M1|N': mk(), 'P|M3|N': mk() }, raw: GOOD })
    const out = await svc.savePerformance(admin, key, { fields: { ManWorkLoss: 9 }, citizenDevelopers: [{ KnoxId: 'dev1', Contribution: 10 }], alsoModels: ['M2', 'M3'] })
    expect(out.applied).toEqual([{ model: 'M2', ok: false, code: 'NOT_FOUND' }, { model: 'M3', ok: true }])
    expect(calls.perf.map((c) => c[0])).toEqual(['M1', 'M3'])
    expect(calls.perf[0][1]).toHaveProperty(['performance.CitizenDeveloper'])
    expect(calls.perf[1][1]).toEqual({ 'performance.ManWorkLoss': 9, 'performance.UpdateDate': '2026-11-07' })
  })
  it('일괄 대상이 2건이면 DATA_INVALID, 권한 밖이면 PROCESS_FORBIDDEN, 쓰기 실패는 그 모델만 실패로 기록하고 계속한다', async () => {
    const mk = () => [{ scname: 'N', property: {}, performance: { ...GOOD } }]
    const { svc, calls } = setup({
      docs: { 'P|M1|N': mk(), 'P|M2|N': [{ property: {} }, { property: {} }], 'P|M3|N': mk(), 'P|M4|N': mk() }, deny: ['M5'], writeFails: 'M3'
    })
    const out = await svc.savePerformance(admin, key, { fields: { ManWorkLoss: 9 }, alsoModels: ['M2', 'M5', 'M3', 'M4', 'M1'] })
    expect(out.applied).toEqual([
      { model: 'M2', ok: false, code: 'DATA_INVALID' }, { model: 'M5', ok: false, code: 'PROCESS_FORBIDDEN' },
      { model: 'M3', ok: false, code: 'UPSTREAM_TIMEOUT' }, { model: 'M4', ok: true }
    ]) // 원래 모델(M1)이 alsoModels 에 또 있어도 두 번 쓰지 않는다
    expect(calls.perf.map((c) => c[0])).toEqual(['M1', 'M3', 'M4'])
  })
  it('원래 모델 문서가 0건이면 404', async () => {
    expect((await fail(setup({ docs: {} }).svc.savePerformance(admin, key, { fields: {}, alsoModels: [] }))).statusCode).toBe(404)
  })
  it('옛 문서에 없는 성과 키는 읽을 때처럼 빈 값으로 보고 검사한다 — 없는 키를 쓰지 않는다', async () => {
    // 효과 하나·사고 유형·트리거 정보가 없는 옛 문서(시드 BAD_PERFORMANCE 처럼). 화면은 0·빈 값으로 읽어 고치지 않은 칸을 보내지 않는다.
    const { WaferLoss: _w, AccidentType: _a, AccidentInfo: _i, ...legacy } = GOOD
    const { svc, calls } = setup({ docs: { 'P|M1|N': [{ scname: 'N', property: {}, performance: { ...legacy, InvestCostLoss: null } }] } })
    await svc.savePerformance(admin, key, { fields: { Grade: 1 }, alsoModels: [] })
    expect(calls.perf).toEqual([['M1', { 'performance.Grade': 1, 'performance.Supervisor': 'adm' }]])
  })
})

describe('savePerformance — 칸 형·범위(400, 어떤 모델에도 쓰지 않는다)', () => {
  it.each([
    [{ Grade: 'x' }, 'fields.Grade'], [{ Grade: 99 }, 'fields.Grade'], [{ Trigger: 'abc' }, 'fields.Trigger'], [{ PerformType: {} }, 'fields.PerformType'],
    [{ AccidentType: 'z' }, 'fields.AccidentType'], [{ TriggerInfo: 5 }, 'fields.TriggerInfo'], [{ ManWorkLoss: '3' }, 'fields.ManWorkLoss'],
    [{ Group: 5 }, 'fields.Group'], [{ SupervisorComment: 3 }, 'fields.SupervisorComment'], [{ AccidentInfo: [] }, 'fields.AccidentInfo']
  ])('%j → 400 BAD_REQUEST path %s', async (fields, path) => {
    const mk = () => [{ scname: 'N', property: {}, performance: { ...GOOD } }]
    const { svc, calls } = setup({ docs: { 'P|M1|N': mk(), 'P|M2|N': mk() } })
    const e = await fail(svc.savePerformance(admin, key, { fields, alsoModels: ['M2'] }))
    expect([e.statusCode, e.code, e.details.path]).toEqual([400, 'BAD_REQUEST', path])
    expect(calls.perf).toEqual([])
  })
  it('review 의 등급도 같은 검사(path grade)', async () => {
    const e = await fail(setup().svc.review(admin, key, { grade: 99 }))
    expect([e.statusCode, e.details.path]).toEqual([400, 'grade'])
  })
  it('올바른 값은 그대로 저장된다', async () => {
    const { svc, calls } = setup()
    await svc.savePerformance(admin, key, { fields: { Trigger: 4, TriggerInfo: null, AccidentInfo: '' }, alsoModels: [] })
    expect(calls.perf[0][1]).toMatchObject({ 'performance.Trigger': 4 })
  })
})

describe('sameName·searchUsers·nameRule', () => {
  it('sameName: 같은 이름 모델 중 내 권한 안만', async () => {
    expect(await setup().svc.sameName(admin, 'P', 'N')).toEqual(['M1', 'M2'])
  })
  it('sameName: 권한 밖 공정이면 403', async () => {
    expect((await fail(setup().svc.sameName(admin, 'Q', 'N'))).code).toBe('PROCESS_FORBIDDEN')
  })
  it('searchUsers: 2자 미만 400, 아니면 {singleid, name, process} — 공정으로 동명이인을 가린다', async () => {
    const { svc, calls } = setup()
    expect((await fail(svc.searchUsers(admin, ' a '))).statusCode).toBe(400)
    expect((await fail(svc.searchUsers(admin, undefined))).statusCode).toBe(400)
    expect(await svc.searchUsers(admin, ' ab ')).toEqual([{ singleid: 'a', name: 'b', process: 'x' }, { singleid: 'c', name: 'b', process: '' }])
    expect(calls.q).toBe('ab')
  })
  it('registeredUsers: 아이디 목록 중 등록된 사람만 {singleid, name, process}(입력 순서, 같은 아이디는 한 번) — 저장 때 DEV_UNKNOWN 과 같은 조회', async () => {
    const { svc, calls } = setup({ users: { dev1: [{ singleid: 'dev1', name: 'D1', process: 'AA:BB', password: 'x' }], dev2: [{ singleid: 'dev2', name: 'D2' }] } })
    expect(await svc.registeredUsers(admin, ' dev2, ghost ,dev1,dev2,, ')).toEqual([
      { singleid: 'dev2', name: 'D2', process: '' }, { singleid: 'dev1', name: 'D1', process: 'AA:BB' }
    ])
    expect(calls.users).toEqual(['dev2', 'ghost', 'dev1'])
    expect(await svc.registeredUsers(admin, '')).toEqual([])
  })
  it('registeredUsers: 등급 1·2 가 아니면 403 이고 찾지 않는다, 문자열이 아니거나 50명을 넘으면 400', async () => {
    const { svc, calls } = setup()
    const e = await fail(svc.registeredUsers({ singleid: 'x', authorityManager: 3 }, 'dev1'))
    expect([e.statusCode, e.code]).toEqual([403, 'GRADE_FORBIDDEN'])
    expect((await fail(svc.registeredUsers(admin, ['dev1']))).statusCode).toBe(400)
    const many = Array.from({ length: 51 }, (_, i) => `u${i}`).join(',')
    expect((await fail(svc.registeredUsers(admin, many))).statusCode).toBe(400)
    expect(calls.users).toEqual([])
  })
  it('searchUsers: 등급 1·2 가 아니면 403 GRADE_FORBIDDEN 이고 찾지 않는다(원개발자 찾기는 성과 입력 창 몫)', async () => {
    const { svc, calls } = setup()
    const e = await fail(svc.searchUsers({ singleid: 'x', authorityManager: 3 }, 'ab'))
    expect([e.statusCode, e.code]).toEqual([403, 'GRADE_FORBIDDEN'])
    expect(calls.q).toBeUndefined()
  })
  it('nameRule: 컬렉션이 없으면 { exists:false, rules:[] }', async () => {
    expect(await setup().svc.nameRule(admin)).toEqual({ exists: false, rules: [] })
    expect(await setup({ rule: true }).svc.nameRule(admin)).toEqual({ exists: true, rules: [{ pattern: 'x' }] })
  })
})
