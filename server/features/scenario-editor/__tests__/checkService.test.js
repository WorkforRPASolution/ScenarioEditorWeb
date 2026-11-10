import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { okSource, fresh } from './domain/rules/helpers'
const require = createRequire(import.meta.url)
const { createCheckService } = require('../service/checkService')
const { propertyRev } = require('../domain/deployIdentity')
const { seError } = require('../errors')

const FILE = '5f0000000000000000000001'
const CUR = 1730000000000
const propertyDoc = { IsEnabled: true, Type: 1, StartDelay: 0, Owners: ['kim@2026-11-01 10:00:00'], NextScenarioIfSuccess: { Name: '' }, NextScenarioIfFail: { Name: '' } }

// 기준 판 = helpers 의 P-M-N (crtime 1730000000000). 편집본은 고치지 않은 상태(fresh)에 fileId 를 채운다.
// cached: 기준 판 파일이 지워졌어도(sourceGone) 디스크 캐시가 남아 cacheIfGone 이면 열린다
function setup({ keyDocs, docs, fields, gone = [], forbid = [], eqpCount = 7, sourceGone = false, cached = false } = {}) {
  const calls = { source: [], assert: [], sourceOpts: [] }
  const src = okSource()
  const deps = {
    repo: {
      findScenarioKeyDocs: async (p, m, n) => keyDocs ? keyDocs(p, m, n) : [{ scname: n, property: propertyDoc }],
      findScenarioDocs: async () => docs || [{ scname: 'N', property: propertyDoc }, { scname: 'OTHER', property: { ...propertyDoc, IsEnabled: false } }]
    },
    hash: { hkeys: async () => fields || [`N.${CUR}`, 'OTHER.1'] },
    scopes: {
      assertAllowed: async (u, p, m) => { calls.assert.push(`${p}-${m}`); if (forbid.includes(`${p}-${m}`)) throw seError(403, 'PROCESS_FORBIDDEN', 'x') },
      scopeFor: async () => ({ pairs: [{ process: 'P', models: [{ model: 'M', eqpCount }, { model: 'M2', eqpCount: 1 }] }] })
    },
    opener: {
      source: async (u, v, opts) => {
        calls.source.push(`${v.process}-${v.model}-${v.name}-${v.crtime}`)
        calls.sourceOpts.push(opts)
        if (sourceGone && v.name === 'N' && !(cached && opts && opts.cacheIfGone)) return { gone: true }
        if (gone.includes(v.name)) return { gone: true }
        return { skeleton: src, propertyDoc, performanceDoc: null }
      }
    }
  }
  const svc = createCheckService({ ...deps, env: {} })
  const edited = () => ({ ...fresh(src), headCrtime: CUR }) // 현재 판 = 기준 판
  const meta = (over = {}) => {
    const e = edited()
    return { source: e.source, target: { process: 'P', model: 'M', name: 'N' }, propertyRev: propertyRev(propertyDoc), scenario: e, ...over }
  }
  return { svc, deps, calls, meta, edited }
}
const user = { singleid: 'u', authorityManager: 3 }
const fail = async (p) => { try { await p } catch (e) { return e } throw new Error('통과하면 안 됨') }

describe('checkService.check', () => {
  it('고치지 않은 편집 시나리오는 막힘 없고 충돌 없음, 대상 상태를 낸다', async () => {
    const { svc, meta } = setup()
    const r = await svc.check(user, meta())
    expect(r.blocks).toEqual([])
    expect(r.conflict).toBeNull()
    expect(r.targetExists).toBeNull()
    expect(r.target).toEqual({ exists: true, eqpCount: 7 })
  })
  it('headCrtime 이 현재 판과 다르면 newVersion(마지막 Owners 줄 포함)', async () => {
    const { svc, meta } = setup({ fields: [`N.${CUR + 5}`] })
    const r = await svc.check(user, meta())
    expect(r.conflict).toMatchObject({ kind: 'newVersion', by: 'kim' })
  })
  // 지문(propertyRev)은 문서가 조금만 달라도 바뀐다(수정 이력 줄, 숫자 저장 형). 배포가 쓸 값과 지금 서버 값이 모든 칸에서 같으면
  // 덮어써도 잃는 것이 없으므로 묻지 않는다(2026-11-10 사용자 결정).
  it('지문이 달라도 값 차이가 없으면 충돌이 아니다 — 껐다 켠 뒤(수정 이력만 늘어남)·이름 없는 후속과 없음', async () => {
    const screen = setup().edited().property // 이 화면이 배포할 값
    const again = { ...screen, Owners: ['kim@2026-11-01 10:00:00', 'lee@2026-11-10 09:00:00@Scenario Deactivated', 'lee@2026-11-10 09:01:00@Scenario Activated'], NextScenarioIfFail: { Name: '', Text: '' } }
    const { svc, meta } = setup({ keyDocs: async (p, m, n) => [{ scname: n, property: again }] })
    expect((await svc.check(user, meta({ propertyRev: 'x' }))).conflict).toBeNull()
  })
  it('지문이 다르고 값도 다르면 property 충돌', async () => {
    const screen = setup().edited().property
    const { svc, meta } = setup({ keyDocs: async (p, m, n) => [{ scname: n, property: { ...screen, IsEnabled: screen.IsEnabled === false } }] })
    const c = (await svc.check(user, meta({ propertyRev: 'x' }))).conflict
    expect(c).toEqual({ kind: 'property', diff: [{ key: 'IsEnabled', from: screen.IsEnabled === false, to: screen.IsEnabled !== false }] })
  })
  it('property 충돌에는 배포하면 바뀌는 값(지금 서버 값 → 이 화면 값)을 전체 키로 싣는다', async () => {
    const screen = setup().edited().property
    const stored = { ...screen, IsEnabled: false, RetryCnt: 3, ID: 'OTHER-ID', Owners: ['kim@2026-11-01 10:00:00', 'lee@2026-11-10 09:00:00@Scenario Deactivated'] }
    const { svc, meta } = setup({ keyDocs: async (p, m, n) => [{ scname: n, property: stored }] })
    const r = await svc.check(user, meta()) // 화면은 켜짐·재시도 0 을 아는 판, 지문은 옛 문서의 것
    // 다섯 칸 밖(RetryCnt)도 속성 선언 순서로, ID·Owners 는 내지 않는다
    expect(r.conflict).toEqual({ kind: 'property', diff: [{ key: 'RetryCnt', from: 3, to: 0 }, { key: 'IsEnabled', from: false, to: true }] })
  })
  it('운영 문서가 없으면 deleted', async () => {
    const { svc, meta } = setup({ keyDocs: async () => [] })
    const r = await svc.check(user, meta())
    expect(r.conflict).toEqual({ kind: 'deleted' })
    expect(r.target.exists).toBe(false)
  })
  it('다른 이름 대상이 이미 있으면 targetExists.diff 에 IsEnabled 차이, 충돌은 null', async () => {
    const { svc, meta } = setup({ keyDocs: async (p, m, n) => [{ scname: n, property: { ...propertyDoc, IsEnabled: false } }] })
    const r = await svc.check(user, meta({ target: { process: 'P', model: 'M', name: 'OTHER' } }))
    expect(r.conflict).toBeNull()
    expect(r.targetExists.diff).toContainEqual({ key: 'IsEnabled', from: false, to: true })
  })
  it('targetExists.diff 는 정규화한 값 비교 — 같은 후속 시나리오({Name, Text})는 차이로 내지 않는다', async () => {
    const follow = { Name: 'F', Text: 't' }
    const { svc, meta } = setup({ keyDocs: async (p, m, n) => [{ scname: n, property: { ...propertyDoc, IsEnabled: false, NextScenarioIfSuccess: follow, NextScenarioIfFail: { Name: 'F', Text: null } } }] })
    const m = meta({ target: { process: 'P', model: 'M', name: 'OTHER' } })
    m.scenario.property = { ...m.scenario.property, NextScenarioIfSuccess: { ...follow }, NextScenarioIfFail: { Name: 'F', Text: '' } }
    const r = await svc.check(user, m)
    expect(r.targetExists.diff).toEqual([{ key: 'IsEnabled', from: false, to: true }])
  })
  it('새 이름 대상이 없으면 exists false·targetExists null', async () => {
    const { svc, meta } = setup({ keyDocs: async () => [] })
    const r = await svc.check(user, meta({ target: { process: 'P', model: 'M', name: 'NEWONE' } }))
    expect(r.target.exists).toBe(false)
    expect(r.targetExists).toBeNull()
    expect(r.conflict).toBeNull()
  })
  it('기준 판이 없는 새 시나리오(source null)도 검사된다', async () => {
    const { svc, meta, calls, edited } = setup({ keyDocs: async () => [] })
    const e = edited(); e.source = null; e.headCrtime = null
    const r = await svc.check(user, meta({ source: null, scenario: e, target: { process: 'P', model: 'M2', name: 'NEWONE' } }))
    expect(calls.source).toEqual([])
    expect(r.target.eqpCount).toBe(1)
    expect(r.conflict).toBeNull()
  })
  it('기준 판이 gone 이면 SOURCE_GONE(uid 없음)', async () => {
    const { svc, meta } = setup({ sourceGone: true })
    const r = await svc.check(user, meta())
    expect(r.blocks).toContainEqual({ code: 'SOURCE_GONE' })
  })
  // 2026-11-07 결정 (a): 디스크 캐시 대체는 force 일 때만, 기준 판에만(다른 판 그림은 그대로 IMAGE_SOURCE_GONE)
  it('force 가 아니면 기준 판 파일이 지워졌을 때 캐시를 쓰지 않는다 — 삭제 충돌(deleted)과 SOURCE_GONE', async () => {
    const { svc, meta, calls } = setup({ sourceGone: true, cached: true, keyDocs: async () => [] })
    for (const m of [meta(), meta({ force: false })]) {
      const r = await svc.check(user, m)
      expect(r.blocks).toContainEqual({ code: 'SOURCE_GONE' })
      expect(r.conflict).toEqual({ kind: 'deleted' })
    }
    expect(calls.sourceOpts.every((o) => !(o && o.cacheIfGone))).toBe(true)
  })
  it('force 면 기준 판을 cacheIfGone 으로 연다 — 캐시가 있으면 SOURCE_GONE 없이 그 판 기준으로 검사, 삭제 충돌은 그대로 알린다', async () => {
    const { svc, meta, calls, edited } = setup({ sourceGone: true, cached: true, gone: ['OTHER'], keyDocs: async () => [] })
    const e = edited()
    e.steps[0].images.train = { 0: { from: 'other', process: 'P', model: 'M', name: 'OTHER', crtime: 1, fileId: FILE, id: 's0-train-0' } }
    const r = await svc.check(user, meta({ scenario: e, force: true }))
    expect(r.blocks).not.toContainEqual({ code: 'SOURCE_GONE' })
    expect(r.blocks).toContainEqual({ code: 'IMAGE_SOURCE_GONE', uid: e.steps[0].uid })
    expect(r.conflict).toEqual({ kind: 'deleted' })
    expect(calls.sourceOpts).toEqual([{ cacheIfGone: true }, undefined]) // 기준 판만
    const p = await svc.prepare(user, meta({ force: true }))
    expect(p.sourceSkeleton).toBeTruthy()
    expect(p.extraBlocks).toEqual([])
  })
  it('force 여도 캐시가 없으면 SOURCE_GONE', async () => {
    const { svc, meta } = setup({ sourceGone: true, keyDocs: async () => [] })
    expect((await svc.check(user, meta({ force: true }))).blocks).toContainEqual({ code: 'SOURCE_GONE' })
  })
  it('force 가 참거짓이 아니면 400', async () => {
    const { svc, meta } = setup()
    expect(await fail(svc.check(user, meta({ force: 'yes' })))).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST', details: { path: 'force' } })
  })
  it('다른 판 그림이 가리키는 판이 없으면 그 스텝에 IMAGE_SOURCE_GONE', async () => {
    const { svc, meta, edited } = setup({ gone: ['OTHER'] })
    const e = edited()
    e.steps[0].images.train = { 0: { from: 'other', process: 'P', model: 'M', name: 'OTHER', crtime: 1, fileId: FILE, id: 's0-train-0' } }
    const r = await svc.check(user, meta({ scenario: e }))
    expect(r.blocks).toContainEqual({ code: 'IMAGE_SOURCE_GONE', uid: e.steps[0].uid })
  })
  it('다른 공정 그림 참조는 403 PROCESS_FORBIDDEN 이고 그 판을 열지 않는다', async () => {
    const { svc, meta, edited, calls } = setup({ forbid: ['Q-M'] })
    const e = edited()
    e.steps[1].images.base = { from: 'other', process: 'Q', model: 'M', name: 'X', crtime: 1, fileId: FILE, id: 's0-bi' }
    const err = await fail(svc.check(user, meta({ scenario: e })))
    expect(err).toMatchObject({ statusCode: 403, code: 'PROCESS_FORBIDDEN' })
    expect(calls.source.some((s) => s.startsWith('Q-'))).toBe(false)
    expect(calls.source).toEqual([]) // 기준 판도 열기 전에 권한부터
  })
  it('모양이 틀린 편집 시나리오는 400 BAD_REQUEST + details.path', async () => {
    const { svc, meta, edited } = setup()
    const e = edited(); e.steps = 'x'
    const err = await fail(svc.check(user, meta({ scenario: e })))
    expect(err).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST', details: { path: 'steps' } })
  })
  it('meta 모양이 틀리면 400 (대상 없음, 다른 공정 대상)', async () => {
    const { svc, meta } = setup()
    expect(await fail(svc.check(user, meta({ target: null })))).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' })
    expect(await fail(svc.check(user, meta({ target: { process: 'Z', model: 'M', name: 'N' } })))).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' })
    expect(await fail(svc.check(user, meta({ scenario: undefined })))).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' })
  })
  it('R2: meta.source 가 scenario.source 와 다르면 400 details.path source', async () => {
    const { svc, meta, edited } = setup()
    const other = { ...edited().source, crtime: 1 }
    const err = await fail(svc.check(user, meta({ source: other })))
    expect(err).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST', details: { path: 'source' } })
    expect(err.details.reason).toMatch(/crtime/)
  })
  it('R2: meta.source 를 생략해도(undefined) scenario.source 가 기준이다', async () => {
    const { svc, meta, calls } = setup()
    const m = meta(); delete m.source
    await svc.check(user, m)
    expect(calls.source).toEqual([`P-M-N-${CUR}`])
  })
  it('기준 판이 있는 공정에서 다른 공정 대상은 400, 모델 권한 검사는 기준·대상 쌍 모두', async () => {
    const { svc, meta, calls } = setup({ keyDocs: async () => [] })
    await svc.check(user, meta({ target: { process: 'P', model: 'M2', name: 'N' } }))
    expect(calls.assert).toEqual(expect.arrayContaining(['P-M', 'P-M2']))
  })
  it('운영 속성 문서가 둘 이상이면 422 DATA_INVALID', async () => {
    const { svc, meta } = setup({ keyDocs: async (p, m, n) => [{ scname: n, property: propertyDoc }, { scname: n, property: propertyDoc }] })
    expect(await fail(svc.check(user, meta()))).toMatchObject({ statusCode: 422, code: 'DATA_INVALID' })
  })
})

describe('checkService.prepare', () => {
  it('ctx: 대상 모델의 이름·후속 그래프(대상 자신 제외)·한도', async () => {
    const docs = [
      { scname: 'N', property: propertyDoc },
      { scname: 'A', property: { ...propertyDoc, NextScenarioIfSuccess: { Name: 'N' }, NextScenarioIfFail: { Name: 'B' } } },
      { scname: 'B', property: propertyDoc }
    ]
    const { svc, meta } = setup({ docs })
    const p = await svc.prepare(user, meta())
    expect([...p.ctx.targetNames].sort()).toEqual(['A', 'B', 'N'])
    expect(p.ctx.followGraph.get('A')).toEqual(['N', 'B'])
    expect(p.ctx.followGraph.has('N')).toBe(false)
    expect(p.ctx.limits).toEqual({ bodyMax: 15 * 1048576, requestMax: 100 * 1048576 })
    expect(p.ctx.target).toMatchObject({ process: 'P', model: 'M', name: 'N' })
    expect(p.target).toMatchObject({ process: 'P', model: 'M', name: 'N', exists: true, eqpCount: 7 })
    expect(p.target.doc.property).toEqual(propertyDoc)
    expect(p.sourceSkeleton).toBeTruthy()
    expect(p.extraBlocks).toEqual([])
  })
  it('requestMax 는 EARS_INTERFACE_MAX_REQUEST_MB 환경값', async () => {
    const { deps, meta } = setup()
    const s2 = createCheckService({ ...deps, env: { EARS_INTERFACE_MAX_REQUEST_MB: '50' } })
    expect((await s2.prepare(user, meta())).ctx.limits.requestMax).toBe(50 * 1048576)
  })
})
