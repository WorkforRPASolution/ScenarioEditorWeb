import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { okSource, fresh, newStep, codesOf } from './domain/rules/helpers'
const require = createRequire(import.meta.url)
const { createDeployService, requestChunks } = require('../service/deployService')
const { createCheckService } = require('../service/checkService')
const realClient = require('../clients/interfaceClient')
const { countUtf8Bytes } = realClient
const { propertyRev, bodySha256, setScenarioTimeoutMs } = require('../domain/deployIdentity')
const { emptyPerformance } = require('../domain/performanceEdit')
const { seError } = require('../errors')

const CUR = 1730000000000
const NEW = 1730000099000
const NOW = new Date('2026-11-07T01:02:03Z') // KST 10:02:03
const LINE = 'sew_x@2026-11-07 10:02:03'
const RID = '11111111-2222-4333-8444-555555555555'
const RID2 = '11111111-2222-4333-8444-666666666666'
const RID3 = '11111111-2222-4333-8444-777777777777'
const PERF = { Group: 'G1', Grade: 2, Supervisor: 'boss', CitizenDeveloper: [{ KnoxId: 'k', Sdwt: 's', Name: 'n', Contribution: 100 }] }
const propertyDoc = { IsEnabled: true, Type: 1, StartDelay: 0, Owners: ['kim@2026-11-01 10:00:00'], NextScenarioIfSuccess: { Name: '' }, NextScenarioIfFail: { Name: '' } }
const otherDoc = { scname: 'OTHER', property: { ...propertyDoc, IsEnabled: false, Owners: ['lee@2026-10-01 09:00:00'] }, performance: { Group: 'OTHERS' } }
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7])
const PNG2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 8, 9])
const b64 = (s) => Buffer.from(s).toString('base64')
const imgOf = (id) => b64(`img:${id}`)
const user = { singleid: 'sew_x', authorityManager: 3 }
const fail = async (p) => { try { await p } catch (e) { return e } throw new Error('통과하면 안 됨') }
const until = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 0)); if (!cond()) throw new Error('기다리던 상태가 오지 않음') }

// 기준 판 = helpers 의 P-M-N (crtime CUR, 스텝 2개, 기준 화면 s0-bi·s1-bi). 검사는 실제 checkService(prepare·checkScenario), 조립·흘려 쓰기는 실제 P2-A 함수.
function setup(o = {}) {
  const calls = { stream: [], sent: [], insert: [], update: [], finish: [], delDraft: [], delImages: [], resolve: [], source: [], getDeploy: [] }
  const src = okSource()
  const docs = new Map(Object.entries(o.docs || { 'P|M|N': { scname: 'N', property: propertyDoc, performance: PERF } }))
  const redis = new Map(o.fields || [[`N.${CUR}`, 'old body'], ['OTHER.1', 'x']])
  const records = new Map(o.records || [])
  const reads = new Map()
  let mode = o.finish
  const repo = {
    findScenarioKeyDocs: async (p, m, n) => (docs.has(`${p}|${m}|${n}`) ? [docs.get(`${p}|${m}|${n}`)] : []),
    findScenarioDocs: async (p, m) => [...docs.entries()].filter(([k]) => k.startsWith(`${p}|${m}|`)).map(([, d]) => d),
    finishDeploy: async (key, finish) => {
      calls.finish.push([key, finish])
      if (mode === 'throw') throw seError(504, 'UPSTREAM_TIMEOUT', 'EARS DB 응답이 늦습니다')
      return { matched: mode === 'zero' ? 0 : 1 }
    }
  }
  const hash = {
    hkeys: async (key) => (key === 'P-M' ? [...redis.keys()] : []),
    hget: async (key, field) => (key === 'P-M' && redis.has(field) ? redis.get(field) : null)
  }
  const scopes = {
    assertAllowed: async (u, p, m) => { if (m === 'FORBID') throw seError(403, 'PROCESS_FORBIDDEN', 'x') },
    scopeFor: async () => ({ pairs: [{ process: 'P', models: [{ model: 'M', eqpCount: 3 }, { model: 'M2', eqpCount: 1 }] }] })
  }
  const opener = {
    source: async (u, v) => { calls.source.push(`${v.process}-${v.model}-${v.name}-${v.crtime}`); return o.sourceGone ? { gone: true } : { skeleton: src, propertyDoc, performanceDoc: PERF } },
    resolveImage: async (v, id) => {
      calls.resolve.push([`${v.process}-${v.model}-${v.name}-${v.crtime}-${v.fileId}`, id])
      const n = (reads.get(id) || 0) + 1
      reads.set(id, n)
      if (o.failImage && o.failImage.id === id && o.failImage.nth === n) throw o.failImage.error
      return imgOf(id)
    }
  }
  const web = {
    getDeploy: async (rid) => { calls.getDeploy.push(rid); return records.get(rid) || null },
    insertDeploy: async (r) => { if (o.insertError) throw o.insertError; calls.insert.push(structuredClone(r)); records.set(r.requestId, structuredClone(r)) },
    updateDeploy: async (rid, f) => { calls.update.push([rid, f]); if (o.updateFails) throw new Error('web db'); Object.assign(records.get(rid), f) },
    findDraftFor: async (owner, p, m, n) => (o.draft && o.draft.key === `${owner}|${p}|${m}|${n}` ? o.draft.doc : null),
    readDraftImage: async (gridId) => (o.draft.images || new Map()).get(gridId),
    deleteDraftFor: async (owner, p, m, n) => {
      calls.delDraft.push(`${owner}|${p}|${m}|${n}`)
      if (o.deleteDraftFails) throw new Error('web db')
      return { deleted: true, gridIds: [`g-${m}-${n}`] }
    },
    deleteDraftImages: async (ids) => { calls.delImages.push(ids) }
  }
  // 실제 setScenarioStream 처럼 조각을 끝까지 읽는다(조각 생성기가 던지면 그 오류가 그대로 나간다). 성공이면 InterfaceServer 처럼 본문을 Redis 필드에 쓴다.
  const interfaceClient = o.realStream ? { countUtf8Bytes, setScenarioStream: realClient.setScenarioStream } : {
    countUtf8Bytes,
    setScenarioStream: async ({ chunks, contentLength }, { timeoutMs }) => {
      calls.stream.push({ contentLength, timeoutMs })
      if (o.gate) await o.gate
      let text = ''
      for await (const c of chunks()) text += c
      if (Buffer.byteLength(text, 'utf8') !== contentLength) throw Object.assign(new Error('길이 다름'), { code: 'CONTENT_LENGTH_MISMATCH' })
      const req = JSON.parse(text)
      calls.sent.push(req)
      if (o.streamError) throw o.streamError
      if (!o.noRedisWrite) redis.set(`${req.SCName}.${NEW}`, req.Body)
      for (const [f, v] of o.alsoWrite || []) redis.set(f, v) // 그 사이 남이 저장한 판
    }
  }
  const check = createCheckService({ repo, hash, scopes, opener, env: o.env || {} })
  const logs = []
  const log = { info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]), error: (m) => logs.push(['error', m]) }
  const svc = createDeployService({ check, opener, web, repo, hash, scopes, interfaceClient, log, now: () => NOW })
  const edited = () => ({ ...fresh(src), headCrtime: CUR })
  const meta = (over = {}) => ({
    target: { process: 'P', model: 'M', name: 'N' }, propertyRev: propertyRev(propertyDoc), scenario: edited(),
    requestId: RID, overwrite: false, force: false, restoredFrom: null, ...over
  })
  const repoOk = () => { mode = undefined }
  const setOwners = (list) => { docs.set('P|M|N', { ...docs.get('P|M|N'), property: { ...propertyDoc, Owners: list } }) }
  return { svc, calls, meta, edited, records, redis, logs, src, repoOk, setOwners }
}

describe('deployService.deploy — 성공', () => {
  it('setscenario 한 번, Owners 끝 줄은 내 배포 줄, 이미 있는 대상이라 성과 null, 초안 지움, ok·crtime', async () => {
    const { svc, calls, meta, records } = setup()
    const r = await svc.deploy(user, meta(), new Map())
    expect(r).toEqual({ result: 'ok', crtime: NEW, partialFailed: [], requestId: RID })
    expect(calls.stream).toHaveLength(1)
    const sent = calls.sent[0]
    expect(sent).toMatchObject({ Process: 'P', Model: 'M', SCName: 'N' })
    expect(JSON.parse(sent.Body).ID).toBe('P-M-N')
    expect(calls.stream[0].timeoutMs).toBe(setScenarioTimeoutMs(calls.stream[0].contentLength))

    expect(calls.insert).toHaveLength(1)
    expect(calls.insert[0]).toMatchObject({
      requestId: RID, user: 'sew_x', source: { process: 'P', model: 'M', name: 'N', crtime: CUR, fileId: 'F' }, target: { process: 'P', model: 'M', name: 'N' },
      headCrtime: CUR, restoredFrom: null, fieldsBefore: [`N.${CUR}`], bodySha256: bodySha256(sent.Body), result: 'pending', crtime: null, error: null
    })
    expect(calls.insert[0].startedAt).toEqual(NOW)
    expect(calls.insert[0].finish).toEqual({ owners: [...propertyDoc.Owners, LINE], scCategory: 1, performance: null })

    expect(calls.finish).toEqual([[{ process: 'P', model: 'M', name: 'N' }, calls.insert[0].finish]])
    expect(calls.finish[0][1].owners.at(-1)).toBe(LINE)
    expect(calls.delDraft).toEqual(['sew_x|P|M|N'])
    expect(calls.delImages).toEqual([['g-M-N']])
    expect(records.get(RID)).toMatchObject({ result: 'ok', crtime: NEW, steps: ['setscenario', 'finish'] })
    expect(records.get(RID).finishedAt).toBeInstanceOf(Date)
  })
  it('보내는 property 의 Owners 는 작업본 목록이 아니라 대상 문서의 지금 목록, ID 는 시나리오 ID', async () => {
    const { svc, calls, meta, edited } = setup()
    const e = edited()
    e.property.Owners = ['stale@2020-01-01 00:00:00']
    await svc.deploy(user, meta({ scenario: e }), new Map())
    expect(JSON.parse(calls.sent[0].Property)).toMatchObject({ ID: 'P-M-N', Owners: propertyDoc.Owners })
  })
  it('scCategory 는 보낸 property 의 Type — 작업본에 Type 이 빠져 C# 기본값으로 채워져도 같은 값', async () => {
    const { svc, calls, meta, edited } = setup()
    const e = edited()
    e.property.Type = 7
    await svc.deploy(user, meta({ scenario: e }), new Map())
    expect(calls.finish[0][1].scCategory).toBe(7)
    const { svc: svc2, calls: calls2, meta: meta2, edited: edited2 } = setup()
    const e2 = edited2()
    delete e2.property.Type
    await svc2.deploy(user, meta2({ scenario: e2 }), new Map())
    const sentType = JSON.parse(calls2.sent[0].Property).Type
    expect(Number.isInteger(sentType)).toBe(true)
    expect(calls2.finish[0][1].scCategory).toBe(sentType)
  })
  it('R3: BI 는 "BI." + 시나리오 ID 로 흘려 쓰고, 기준 판 그림을 다시 읽어 싣는다', async () => {
    const { svc, calls, meta } = setup()
    await svc.deploy(user, meta(), new Map())
    const bi = calls.sent[0].BI
    expect(bi.startsWith('{"ID":"BI.P-M-N"')).toBe(true)
    expect(JSON.parse(bi)).toEqual({ ID: 'BI.P-M-N', TargetSnapshotList: [imgOf('s0-bi'), imgOf('s1-bi')] })
    // 길이 세기 한 번 + 보내기 한 번, 둘 다 기준 판(scenario.source)에서
    expect(calls.resolve.filter(([, id]) => id === 's0-bi')).toEqual([['P-M-N-1730000000000-F', 's0-bi'], ['P-M-N-1730000000000-F', 's0-bi']])
  })
  it('새 그림은 요청 파일에서, 없으면 그 사용자 초안의 같은 tempId 그림에서 읽는다(다른 판 그림은 그 판에서)', async () => {
    const draft = { key: 'sew_x|P|M|N', doc: { images: [{ tempId: 'dr1', gridId: 'gd1' }] }, images: new Map([['gd1', PNG2]]) }
    const { svc, calls, meta, edited } = setup({ draft })
    const e = edited()
    e.steps[0].images.base = { from: 'upload', tempId: 'up1' }
    e.steps[1].images.base = { from: 'upload', tempId: 'dr1' }
    e.steps[1].images.train = { 0: { from: 'other', process: 'P', model: 'M', name: 'OTHER', crtime: 5, fileId: 'F2', id: 's3-train-0' } }
    const r = await svc.deploy(user, meta({ scenario: e }), new Map([['up1', PNG]]))
    expect(r.result).toBe('ok')
    expect(JSON.parse(calls.sent[0].BI).TargetSnapshotList).toEqual([PNG.toString('base64'), PNG2.toString('base64')])
    expect(calls.resolve).toContainEqual(['P-M-OTHER-5-F2', 's3-train-0']) // 조건 없음 스텝이라 본문에는 실리지 않지만 그 판에서 읽는다
    expect(calls.resolve.some(([v]) => v.startsWith('P-M-N-'))).toBe(false) // 기준 판 그림은 이제 하나도 쓰지 않는다
  })
})

describe('deployService.deploy — 잠금', () => {
  it('같은 대상 동시 두 번 → 두 번째는 409 SAVE_IN_PROGRESS, setscenario 는 한 번, 끝나면 잠금이 풀린다', async () => {
    let open
    const gate = new Promise((r) => { open = r })
    const { svc, calls, meta } = setup({ gate })
    const first = svc.deploy(user, meta(), new Map())
    await until(() => calls.stream.length === 1)
    const err = await fail(svc.deploy(user, meta({ requestId: RID2 }), new Map()))
    expect(err).toMatchObject({ statusCode: 409, code: 'SAVE_IN_PROGRESS' })
    open()
    expect((await first).result).toBe('ok')
    expect(calls.stream).toHaveLength(1)
    expect(calls.insert).toHaveLength(1)
    // 풀렸다: 다음 배포는 잠금이 아니라 충돌(방금 새 판)로 멈춘다
    expect(await fail(svc.deploy(user, meta({ requestId: RID3 }), new Map()))).toMatchObject({ statusCode: 409, code: 'SAVE_CONFLICT' })
  })
  it('동시에 시작해도(권한 확인 전) 같은 대상은 하나만 보낸다', async () => {
    let open
    const gate = new Promise((r) => { open = r })
    const { svc, calls, meta } = setup({ gate })
    const a = svc.deploy(user, meta(), new Map())
    const b = fail(svc.deploy(user, meta({ requestId: RID2 }), new Map()))
    expect(await b).toMatchObject({ statusCode: 409, code: 'SAVE_IN_PROGRESS' })
    open()
    await a
    expect(calls.stream).toHaveLength(1)
  })
  it('같은 requestId 의 배포 기록이 이미 있으면(재전송) 409 SAVE_IN_PROGRESS 이고 보내지 않는다', async () => {
    const { svc, calls, meta } = setup({ records: [[RID, { requestId: RID, user: 'sew_x', result: 'ok' }]] })
    expect(await fail(svc.deploy(user, meta(), new Map()))).toMatchObject({ statusCode: 409, code: 'SAVE_IN_PROGRESS' })
    expect(calls.insert).toHaveLength(0)
    expect(calls.stream).toHaveLength(0)
  })
  it('기록을 넣다가 requestId 가 겹치면(E11000) 409 SAVE_IN_PROGRESS', async () => {
    const { svc, calls, meta } = setup({ insertError: Object.assign(new Error('E11000 duplicate key'), { code: 11000 }) })
    expect(await fail(svc.deploy(user, meta(), new Map()))).toMatchObject({ statusCode: 409, code: 'SAVE_IN_PROGRESS' })
    expect(calls.stream).toHaveLength(0)
  })
  it('오류로 끝나도 잠금이 풀린다', async () => {
    const { svc, meta } = setup({ docs: { 'P|M|N': { scname: 'N', property: propertyDoc, performance: PERF }, 'P|M|OTHER': otherDoc } })
    const target = { process: 'P', model: 'M', name: 'OTHER' }
    expect(await fail(svc.deploy(user, meta({ target }), new Map()))).toMatchObject({ code: 'TARGET_EXISTS' })
    expect((await svc.deploy(user, meta({ target, overwrite: true, requestId: RID2 }), new Map())).result).toBe('ok')
  })
  it('대상 공정·모델 권한이 없으면 403 이고 기록을 읽지도 않는다', async () => {
    const { svc, calls, meta } = setup()
    expect(await fail(svc.deploy(user, meta({ target: { process: 'P', model: 'FORBID', name: 'N' } }), new Map()))).toMatchObject({ statusCode: 403, code: 'PROCESS_FORBIDDEN' })
    expect(calls.getDeploy).toEqual([])
    expect(calls.source).toEqual([])
  })
})

describe('deployService.deploy — 요청 모양', () => {
  it.each([
    ['requestId 없음', { requestId: undefined }, 'requestId'],
    ['requestId 가 uuid 가 아님', { requestId: 'abc' }, 'requestId'],
    ['overwrite 가 참거짓이 아님', { overwrite: 'yes' }, 'overwrite'],
    ['force 가 참거짓이 아님', { force: 1 }, 'force'],
    ['restoredFrom 이 숫자·null 이 아님', { restoredFrom: '5' }, 'restoredFrom'],
    ['target 없음', { target: null }, 'target']
  ])('%s → 400 BAD_REQUEST, 아무것도 읽거나 쓰지 않는다', async (_, over, path) => {
    const { svc, calls, meta } = setup()
    const err = await fail(svc.deploy(user, meta(over), new Map()))
    expect(err).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST', details: { path } })
    expect(calls.getDeploy).toEqual([])
    expect(calls.insert).toEqual([])
  })
  it('overwrite·force·restoredFrom 은 빠져도 된다(false·false·null)', async () => {
    const { svc, calls, meta } = setup()
    const m = meta()
    delete m.overwrite; delete m.force; delete m.restoredFrom
    expect((await svc.deploy(user, m, new Map())).result).toBe('ok')
    expect(calls.insert[0].restoredFrom).toBeNull()
  })
  it('restoredFrom 은 기록에 남는다', async () => {
    const { svc, calls, meta } = setup()
    await svc.deploy(user, meta({ restoredFrom: 1720000000000 }), new Map())
    expect(calls.insert[0].restoredFrom).toBe(1720000000000)
  })
  it('새 그림 tempId 가 요청 파일에도 초안에도 없으면 400 이고 기록·전송 없음', async () => {
    const { svc, calls, meta, edited } = setup()
    const e = edited()
    e.steps[0].images.base = { from: 'upload', tempId: 'nope' }
    const err = await fail(svc.deploy(user, meta({ scenario: e }), new Map()))
    expect(err).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST', details: { path: 'img:nope' } })
    expect(calls.insert).toEqual([])
    expect(calls.stream).toEqual([])
  })
  it('어떤 그림 참조도 가리키지 않는 파일이 오면 400', async () => {
    const { svc, calls, meta } = setup()
    const err = await fail(svc.deploy(user, meta(), new Map([['zzz', PNG]])))
    expect(err).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST', details: { path: 'img:zzz' } })
    expect(calls.insert).toEqual([])
  })
  it('기준 판이 없는 새 시나리오가 기준 판 그림(from source)을 가리키면 400', async () => {
    const { svc, calls, meta } = setup({ docs: {} })
    const e = { ...meta().scenario, source: null, headCrtime: null, steps: [newStep('a')] }
    const err = await fail(svc.deploy(user, meta({ scenario: e, target: { process: 'P', model: 'M2', name: 'NEWONE' } }), new Map()))
    expect(err).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' })
    expect(calls.insert).toEqual([])
  })
})

describe('deployService.deploy — 검사·확인', () => {
  it('막힘이 있으면 422 VALIDATION_FAILED(details.blocks)이고 기록하지 않는다', async () => {
    const { svc, calls, meta, edited } = setup()
    const e = edited()
    e.header.description = ''
    const err = await fail(svc.deploy(user, meta({ scenario: e }), new Map()))
    expect(err).toMatchObject({ statusCode: 422, code: 'VALIDATION_FAILED' })
    expect(codesOf(err.details.blocks)).toContain('MAIL_TITLE_EMPTY')
    expect(calls.insert).toEqual([])
    expect(calls.stream).toEqual([])
  })
  it('기준 판이 없어졌으면(SOURCE_GONE) 422', async () => {
    const { svc, calls, meta } = setup({ sourceGone: true })
    const err = await fail(svc.deploy(user, meta(), new Map()))
    expect(err).toMatchObject({ statusCode: 422, code: 'VALIDATION_FAILED' })
    expect(err.details.blocks).toContainEqual({ code: 'SOURCE_GONE' })
    expect(calls.insert).toEqual([])
  })
  it('조립한 요청이 크기 한도를 넘으면 422(REQUEST_TOO_LARGE)이고 기록하지 않는다', async () => {
    const { svc, calls, meta } = setup({ env: { EARS_INTERFACE_MAX_REQUEST_MB: '0.0001' } })
    const err = await fail(svc.deploy(user, meta(), new Map()))
    expect(err).toMatchObject({ statusCode: 422, code: 'VALIDATION_FAILED' })
    expect(codesOf(err.details.blocks)).toContain('REQUEST_TOO_LARGE')
    expect(calls.insert).toEqual([])
    expect(calls.stream).toEqual([])
  })
  it('다른 이름 대상이 이미 있고 overwrite 가 없으면 409 TARGET_EXISTS(details.diff)', async () => {
    const { svc, calls, meta } = setup({ docs: { 'P|M|N': { scname: 'N', property: propertyDoc, performance: PERF }, 'P|M|OTHER': otherDoc } })
    const err = await fail(svc.deploy(user, meta({ target: { process: 'P', model: 'M', name: 'OTHER' } }), new Map()))
    expect(err).toMatchObject({ statusCode: 409, code: 'TARGET_EXISTS' })
    expect(err.details.diff).toContainEqual({ key: 'IsEnabled', from: false, to: true })
    expect(calls.insert).toEqual([])
    expect(calls.stream).toEqual([])
  })
  it('overwrite 면 덮어쓴다: Owners 는 대상의 지금 목록, 대상 성과는 그대로(null)', async () => {
    const { svc, calls, meta } = setup({ docs: { 'P|M|N': { scname: 'N', property: propertyDoc, performance: PERF }, 'P|M|OTHER': otherDoc } })
    const r = await svc.deploy({ ...user, authorityManager: 1 }, meta({ target: { process: 'P', model: 'M', name: 'OTHER' }, overwrite: true }), new Map())
    expect(r.result).toBe('ok')
    expect(JSON.parse(calls.sent[0].Property)).toMatchObject({ ID: 'P-M-OTHER', Owners: otherDoc.property.Owners })
    expect(calls.finish[0]).toEqual([{ process: 'P', model: 'M', name: 'OTHER' }, { owners: [...otherDoc.property.Owners, LINE], scCategory: 1, performance: null }])
  })
  it('열어 둔 사이 새 판이 있고 force 가 없으면 409 SAVE_CONFLICT(details.conflict), force 면 배포', async () => {
    const fields = [[`N.${CUR + 5}`, 'someone'], ['OTHER.1', 'x']]
    const { svc, calls, meta } = setup({ fields })
    const err = await fail(svc.deploy(user, meta(), new Map()))
    expect(err).toMatchObject({ statusCode: 409, code: 'SAVE_CONFLICT' })
    expect(err.details.conflict).toMatchObject({ kind: 'newVersion' })
    expect(calls.insert).toEqual([])
    const r = await svc.deploy(user, meta({ force: true, requestId: RID2 }), new Map())
    expect(r).toMatchObject({ result: 'ok', crtime: NEW })
    expect(calls.insert[0].fieldsBefore).toEqual([`N.${CUR + 5}`])
  })
})

describe('deployService.deploy — 새 대상 성과', () => {
  const docs = { 'P|M|N': { scname: 'N', property: propertyDoc, performance: PERF } }
  it.each([[3], [0]])('등급 %i 은 빈 성과(emptyPerformance)', async (grade) => {
    const { svc, calls, meta } = setup({ docs })
    await svc.deploy({ ...user, authorityManager: grade }, meta({ target: { process: 'P', model: 'M', name: 'N2' } }), new Map())
    expect(calls.finish[0][1].performance).toEqual(emptyPerformance())
  })
  it.each([[1], [2]])('등급 %i 은 기준 판 문서의 성과를 복사', async (grade) => {
    const { svc, calls, meta } = setup({ docs })
    await svc.deploy({ ...user, authorityManager: grade }, meta({ target: { process: 'P', model: 'M', name: 'N2' } }), new Map())
    expect(calls.finish[0][1].performance).toEqual(PERF)
  })
  it('새 대상의 Owners 는 기준 판 문서의 지금 목록, 기준 키·대상 키 초안을 모두 지운다', async () => {
    const { svc, calls, meta } = setup({ docs })
    const r = await svc.deploy(user, meta({ target: { process: 'P', model: 'M', name: 'N2' } }), new Map())
    expect(r.result).toBe('ok')
    expect(JSON.parse(calls.sent[0].Property)).toMatchObject({ ID: 'P-M-N2', Owners: propertyDoc.Owners })
    expect(calls.finish[0][0]).toEqual({ process: 'P', model: 'M', name: 'N2' })
    expect(calls.finish[0][1].owners).toEqual([...propertyDoc.Owners, LINE])
    expect(calls.delDraft).toEqual(['sew_x|P|M|N', 'sew_x|P|M|N2'])
  })
  it('기준 판 문서에 성과가 없으면 등급 1 도 빈 성과', async () => {
    const { svc, calls, meta } = setup({ docs: { 'P|M|N': { scname: 'N', property: propertyDoc } } })
    await svc.deploy({ ...user, authorityManager: 1 }, meta({ target: { process: 'P', model: 'M', name: 'N2' } }), new Map())
    expect(calls.finish[0][1].performance).toEqual(emptyPerformance())
  })
  it('기준 판이 없는 새 시나리오: Owners 는 빈 목록에 내 줄, 성과는 빈 값', async () => {
    const { svc, calls, meta } = setup({ docs: {} })
    const s = newStep('a', { images: { train: {}, base: { from: 'upload', tempId: 'up1' } } })
    const e = { ...meta().scenario, source: null, headCrtime: null, steps: [s] }
    const r = await svc.deploy({ ...user, authorityManager: 1 }, meta({ scenario: e, target: { process: 'P', model: 'M2', name: 'NEWONE' } }), new Map([['up1', PNG]]))
    expect(r.result).toBe('ok')
    expect(JSON.parse(calls.sent[0].Property)).toMatchObject({ ID: 'P-M2-NEWONE', Owners: [] })
    expect(JSON.parse(calls.sent[0].BI)).toEqual({ ID: 'BI.P-M2-NEWONE', TargetSnapshotList: [PNG.toString('base64')] })
    expect(calls.insert[0]).toMatchObject({ source: null, headCrtime: null, fieldsBefore: [] })
    expect(calls.finish[0][1]).toEqual({ owners: [LINE], scCategory: 1, performance: emptyPerformance() })
    expect(calls.delDraft).toEqual(['sew_x|P|M2|NEWONE'])
  })
})

describe('deployService.deploy — InterfaceServer 결과', () => {
  const upstream = (status, code) => Object.assign(seError(status, code, 'InterfaceServer'), { upstream: { status: 0, text: 'x' } })
  it('504 → 기록 unknown, 응답 504 UPSTREAM_TIMEOUT 에 details.requestId, 마무리·초안 지우기 없음', async () => {
    const { svc, calls, meta, records } = setup({ streamError: upstream(504, 'UPSTREAM_TIMEOUT') })
    const err = await fail(svc.deploy(user, meta(), new Map()))
    expect(err).toMatchObject({ statusCode: 504, code: 'UPSTREAM_TIMEOUT', details: { requestId: RID } })
    expect(records.get(RID)).toMatchObject({ result: 'unknown', error: { code: 'UPSTREAM_TIMEOUT', status: 504, upstreamText: 'x' } }) // 감사용 원문
    expect(calls.finish).toEqual([])
    expect(calls.delDraft).toEqual([])
  })
  it('503 → 기록 failed·error(감사용 upstreamText 포함) 후 같은 오류를 다시 던진다 — 응답 details 에 upstreamText 없음', async () => {
    const e = Object.assign(seError(503, 'UPSTREAM_DOWN', 'InterfaceServer 에 연결하지 못했습니다'), { upstream: { status: 0, text: 'TypeError: fetch failed (ECONNREFUSED)' } })
    const { svc, calls, meta, records } = setup({ streamError: e })
    const err = await fail(svc.deploy(user, meta(), new Map()))
    expect(err).toBe(e)
    expect(err.details ?? null).toBeNull()
    expect(records.get(RID)).toMatchObject({ result: 'failed', error: { code: 'UPSTREAM_DOWN', status: 503, upstreamText: 'TypeError: fetch failed (ECONNREFUSED)' } })
    expect(records.get(RID).finishedAt).toBeInstanceOf(Date)
    expect(calls.finish).toEqual([])
    expect(calls.delDraft).toEqual([])
  })
  it('502(거절) → 같은 code·문구에 details.upstreamText(InterfaceServer 문구), 기록 error 에도 같은 문구', async () => {
    const text = '{"success":"false","message":"X"}'
    const e = Object.assign(seError(502, 'UPSTREAM_FAILED', 'InterfaceServer 가 요청을 처리하지 못했습니다'), { upstream: { status: 200, text } })
    const { svc, calls, meta, records } = setup({ streamError: e })
    const err = await fail(svc.deploy(user, meta(), new Map()))
    expect(err).toMatchObject({ statusCode: 502, code: 'UPSTREAM_FAILED', message: 'InterfaceServer 가 요청을 처리하지 못했습니다', details: { upstreamText: text } })
    expect(Object.keys(err.details)).toEqual(['upstreamText']) // 서버 주소 등 다른 내부 정보는 싣지 않는다
    const failedUpdate = calls.update.find(([, f]) => f.result === 'failed')
    expect(failedUpdate[1].error).toMatchObject({ code: 'UPSTREAM_FAILED', status: 502, upstreamText: text })
    expect(records.get(RID)).toMatchObject({ result: 'failed' })
    expect(calls.finish).toEqual([])
    expect(calls.delDraft).toEqual([])
  })
  it('502 에 upstream 원문이 없으면 details.upstreamText 는 null', async () => {
    const { svc, meta } = setup({ streamError: seError(502, 'UPSTREAM_FAILED', 'InterfaceServer 가 요청을 처리하지 못했습니다') })
    expect(await fail(svc.deploy(user, meta(), new Map()))).toMatchObject({ statusCode: 502, code: 'UPSTREAM_FAILED', details: { upstreamText: null } })
  })
  it('보내는 도중 그림 읽기가 실패하면(요청이 끊겨 저장 안 됨) 기록 failed, 500 으로 던진다 — 503·504 가 아니다', async () => {
    // 길이 세기에서 한 번 읽고, 보내는 도중 두 번째 읽기에서 실패. Mongo 시간 초과(504 로 매핑된 값)여도 결과 모름이 아니다.
    const failImage = { id: 's1-bi', nth: 2, error: seError(504, 'UPSTREAM_TIMEOUT', 'EARS DB 응답이 늦습니다') }
    const { svc, calls, meta, records } = setup({ failImage })
    const err = await fail(svc.deploy(user, meta(), new Map()))
    expect(err.statusCode).toBe(500)
    expect(err.code).toBeUndefined()
    expect(records.get(RID)).toMatchObject({ result: 'failed', error: { code: 'UPSTREAM_TIMEOUT', status: 500 } })
    expect(calls.finish).toEqual([])
    expect(calls.sent).toEqual([])
  })
  it('setscenario 의 뜻밖 오류(조각 생성 밖, code 없음)는 실패라고 단정하지 않는다 — 기록 unknown·504·requestId', async () => {
    const { svc, meta, records, logs } = setup({ streamError: new TypeError('boom') })
    const err = await fail(svc.deploy(user, meta(), new Map()))
    expect(err).toMatchObject({ statusCode: 504, code: 'UPSTREAM_TIMEOUT', details: { requestId: RID } })
    expect(records.get(RID)).toMatchObject({ result: 'unknown', error: { code: 'TypeError', status: 504 } })
    expect(logs.some(([lv, m]) => lv === 'warn' && m.includes('boom'))).toBe(true)
  })
  it('CONTENT_LENGTH_MISMATCH(로컬 오류)도 기록 failed, 500', async () => {
    const { svc, meta, records } = setup({ streamError: Object.assign(new Error('길이 다름'), { code: 'CONTENT_LENGTH_MISMATCH' }) })
    const err = await fail(svc.deploy(user, meta(), new Map()))
    expect(err.statusCode).toBe(500)
    expect(records.get(RID)).toMatchObject({ result: 'failed', error: { code: 'CONTENT_LENGTH_MISMATCH', status: 500 } })
  })
  it('길이를 세다가 그림 읽기가 실패하면 기록도 전송도 없이 그 오류', async () => {
    const failImage = { id: 's0-bi', nth: 1, error: seError(404, 'NOT_FOUND', '이미지가 없습니다') }
    const { svc, calls, meta } = setup({ failImage })
    expect(await fail(svc.deploy(user, meta(), new Map()))).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' })
    expect(calls.insert).toEqual([])
    expect(calls.stream).toEqual([])
  })
})

describe('deployService.deploy — 마무리', () => {
  it('finishDeploy 가 실패하면 partial(partialFailed finish), 초안은 지운다', async () => {
    const { svc, calls, meta, records } = setup({ finish: 'throw' })
    const r = await svc.deploy(user, meta(), new Map())
    expect(r).toEqual({ result: 'partial', crtime: NEW, partialFailed: ['finish'], requestId: RID })
    expect(records.get(RID)).toMatchObject({ result: 'partial', crtime: NEW, steps: ['setscenario'] })
    expect(calls.delDraft).toEqual(['sew_x|P|M|N'])
  })
  it('finishDeploy 가 0건이면 partial', async () => {
    const { svc, meta } = setup({ finish: 'zero' })
    expect(await svc.deploy(user, meta(), new Map())).toMatchObject({ result: 'partial', partialFailed: ['finish'] })
  })
  it('내 판을 찾지 못하면 crtime null(결과는 ok)', async () => {
    const { svc, meta } = setup({ noRedisWrite: true })
    expect(await svc.deploy(user, meta(), new Map())).toMatchObject({ result: 'ok', crtime: null })
  })
  it('그 사이 남이 저장한 더 새 판(지문 다름)은 고르지 않고 내 판을 고른다', async () => {
    const { svc, meta } = setup({ alsoWrite: [[`N.${NEW + 1}`, 'someone else']] })
    expect((await svc.deploy(user, meta(), new Map())).crtime).toBe(NEW)
  })
  it('초안 지우기·기록 마무리 실패는 결과에 영향 없음(로그만)', async () => {
    const { svc, meta, logs } = setup({ deleteDraftFails: true, updateFails: true })
    expect(await svc.deploy(user, meta(), new Map())).toEqual({ result: 'ok', crtime: NEW, partialFailed: [], requestId: RID })
    expect(logs.filter(([lv]) => lv === 'warn').length).toBeGreaterThanOrEqual(2)
  })
})

// 결과 모름·마무리 실패 기록에서 시작하는 확인·다시 쓰기. 기록은 실제 deploy 가 남긴 것을 쓴다.
async function unknownCase(o = {}) {
  const s = setup({ streamError: seError(504, 'UPSTREAM_TIMEOUT', 'x'), ...o })
  await fail(s.svc.deploy(user, s.meta(), new Map()))
  expect(s.records.get(RID).result).toBe('unknown')
  s.calls.finish.length = 0
  return s
}

describe('deployService.verify — 결과 모름 확인', () => {
  it('새 필드(지문 같음)가 있으면 mine·ok, finishDeploy 한 번, 다시 눌러도 같고 더 부르지 않는다', async () => {
    const s = await unknownCase()
    const body = s.calls.sent.length ? s.calls.sent[0].Body : null
    expect(body).not.toBeNull()
    s.redis.set(`N.${NEW}`, body) // 보냈는데 응답만 못 받은 경우
    const r = await s.svc.verify(user, RID)
    expect(r).toEqual({ found: 'mine', crtime: NEW, result: 'ok', partialFailed: [] })
    expect(s.calls.finish).toHaveLength(1)
    expect(s.records.get(RID)).toMatchObject({ result: 'ok', crtime: NEW, steps: ['setscenario', 'finish'] })
    expect(await s.svc.verify(user, RID)).toEqual(r)
    expect(s.calls.finish).toHaveLength(1)
  })
  it('새 필드가 없으면 none, 기록은 unknown 그대로, 쓰지 않는다', async () => {
    const s = await unknownCase()
    expect(await s.svc.verify(user, RID)).toEqual({ found: 'none', crtime: null })
    expect(s.records.get(RID).result).toBe('unknown')
    expect(s.calls.finish).toEqual([])
  })
  it('지문이 다른 새 필드(남의 저장)는 내 판이 아니다', async () => {
    const s = await unknownCase()
    s.redis.set(`N.${NEW}`, 'someone else')
    expect((await s.svc.verify(user, RID)).found).toBe('none')
  })
  it('기록이 없거나 다른 사용자 것이면 404', async () => {
    const s = await unknownCase()
    expect(await fail(s.svc.verify(user, RID2))).toMatchObject({ statusCode: 404 })
    expect(await fail(s.svc.verify({ ...user, singleid: 'other' }, RID))).toMatchObject({ statusCode: 404 })
  })
  it('찾았는데 마무리가 실패하면 partial 로 기록한다', async () => {
    const s = await unknownCase({ finish: 'throw' })
    s.redis.set(`N.${NEW}`, s.calls.sent[0].Body)
    expect(await s.svc.verify(user, RID)).toEqual({ found: 'mine', crtime: NEW, result: 'partial', partialFailed: ['finish'] })
    expect(s.records.get(RID)).toMatchObject({ result: 'partial', crtime: NEW, steps: ['setscenario'] })
  })
  it('그 사이 남의 줄이 생겼으면 지키고 내 줄은 한 번만(대상 문서 지금 목록 기준)', async () => {
    const other = 'lee@2026-11-07 11:00:00'
    const s = await unknownCase()
    s.setOwners([...propertyDoc.Owners, other])
    s.redis.set(`N.${NEW}`, s.calls.sent[0].Body)
    await s.svc.verify(user, RID)
    expect(s.calls.finish[0][1].owners).toEqual([...propertyDoc.Owners, other, LINE])
    expect(s.records.get(RID).finish.owners).toEqual([...propertyDoc.Owners, other, LINE])
  })
  it('내 줄이 이미 목록에 있으면 다시 넣지 않는다', async () => {
    const owners = [...propertyDoc.Owners, LINE, 'lee@2026-11-07 11:00:00']
    const s = await unknownCase()
    s.setOwners(owners)
    s.redis.set(`N.${NEW}`, s.calls.sent[0].Body)
    await s.svc.verify(user, RID)
    expect(s.calls.finish[0][1].owners).toEqual(owners)
  })
})

describe('deployService.finish — 마무리 다시 쓰기', () => {
  it('다시 쓰기도 실패하면 partial 그대로(기록 안 바뀜)', async () => {
    const s = setup({ finish: 'throw' })
    await s.svc.deploy(user, s.meta(), new Map())
    s.calls.finish.length = 0
    expect(await s.svc.finish(user, RID)).toEqual({ result: 'partial', crtime: NEW, partialFailed: ['finish'] })
    expect(s.calls.finish).toHaveLength(1)
    expect(s.records.get(RID).result).toBe('partial')
  })
  it('다시 쓰기가 되면 ok·steps 마무리, 한 번 더 눌러도 아무것도 쓰지 않는다', async () => {
    const s = setup({ finish: 'zero' })
    await s.svc.deploy(user, s.meta(), new Map())
    expect(s.records.get(RID).result).toBe('partial')
    s.calls.finish.length = 0
    s.repoOk()
    expect(await s.svc.finish(user, RID)).toEqual({ result: 'ok', crtime: NEW, partialFailed: [] })
    expect(s.records.get(RID)).toMatchObject({ result: 'ok', steps: ['setscenario', 'finish'] })
    expect(s.calls.finish).toHaveLength(1)
    expect(await s.svc.finish(user, RID)).toEqual({ result: 'ok', crtime: NEW, partialFailed: [] })
    expect(s.calls.finish).toHaveLength(1)
  })
  it('partial 이 아닌 기록(unknown)은 아무것도 쓰지 않고 지금 결과를 돌려준다', async () => {
    const s = await unknownCase()
    expect(await s.svc.finish(user, RID)).toMatchObject({ result: 'unknown', crtime: null })
    expect(s.calls.finish).toEqual([])
  })
  it('남의 줄이 그 사이 생겼으면 지키고 내 줄은 한 번만, 내 줄이 이미 있으면 더하지 않는다', async () => {
    const other = 'lee@2026-11-07 11:00:00'
    const s = setup({ finish: 'zero' })
    await s.svc.deploy(user, s.meta(), new Map())
    s.calls.finish.length = 0
    s.repoOk()
    s.setOwners([...propertyDoc.Owners, other])
    await s.svc.finish(user, RID)
    expect(s.calls.finish[0][1].owners).toEqual([...propertyDoc.Owners, other, LINE])
    const s2 = setup({ finish: 'zero' })
    await s2.svc.deploy(user, s2.meta(), new Map())
    s2.calls.finish.length = 0
    s2.repoOk()
    s2.setOwners([...propertyDoc.Owners, LINE, other])
    await s2.svc.finish(user, RID)
    expect(s2.calls.finish[0][1].owners).toEqual([...propertyDoc.Owners, LINE, other])
  })
  it('기록이 없거나 다른 사용자 것이면 404', async () => {
    const s = setup({ finish: 'zero' })
    await s.svc.deploy(user, s.meta(), new Map())
    expect(await fail(s.svc.finish({ ...user, singleid: 'other' }, RID))).toMatchObject({ statusCode: 404 })
    expect(await fail(s.svc.finish(user, RID2))).toMatchObject({ statusCode: 404 })
  })
})

describe('requestChunks', () => {
  const parts = { id: 'P-M-N', process: 'P', model: 'M', name: 'N', biEntries: [{ kind: 'literal', value: null }], bodyString: '{}', propertyString: '{}' }
  it('BI 는 {"ID":"BI.<시나리오 ID>" 로 시작한다', async () => {
    let text = ''
    for await (const c of requestChunks(parts, async () => 'QUJD')()) text += c
    const req = JSON.parse(text)
    expect(req.BI.startsWith('{"ID":"BI.P-M-N"')).toBe(true)
    expect(req).toMatchObject({ Process: 'P', Model: 'M', SCName: 'N', Body: '{}', Property: '{}' })
  })
  it.each(['id', 'process', 'model', 'name', 'bodyString', 'propertyString'])('%s 가 문자열이 아니면 프로그램 오류로 던진다', (k) => {
    expect(() => requestChunks({ ...parts, [k]: undefined }, async () => 'QUJD')).toThrow(/문자열/)
  })
})

describe('실제 setScenarioStream(가짜 fetch)과 함께', () => {
  afterEach(() => realClient._setDeps({ fetch: globalThis.fetch }))
  // 본문 스트림을 끝까지 읽는 fetch. 다 받으면 InterfaceServer 처럼 Redis 에 본문을 쓰고 success 를 준다.
  const fetchInto = (redis, seen) => async (url, init) => {
    const reader = init.body.getReader()
    const parts = []
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(Buffer.from(value)) }
    const buf = Buffer.concat(parts)
    seen.push({ contentLength: Number(init.headers['Content-Length']), bytes: buf.length })
    const req = JSON.parse(buf.toString('utf8'))
    seen.push({ bi: req.BI.slice(0, 20) })
    redis.set(`${req.SCName}.${NEW}`, req.Body)
    return { status: 200, text: async () => '{"success":"true"}' }
  }
  it('성공: Content-Length 가 받은 바이트와 같고, BI 는 BI.P-M-N, 결과 ok·crtime', async () => {
    const seen = []
    const ctx = setup({ realStream: true })
    realClient._setDeps({ fetch: fetchInto(ctx.redis, seen) })
    expect(await ctx.svc.deploy(user, ctx.meta(), new Map())).toEqual({ result: 'ok', crtime: NEW, partialFailed: [], requestId: RID })
    expect(seen[0].contentLength).toBe(seen[0].bytes)
    expect(seen[1].bi).toBe('{"ID":"BI.P-M-N","Ta')
  })
  it('보내는 도중 그림 읽기 실패: 요청이 끊기고(서버는 완전한 본문을 받지 못함) 기록 failed·500', async () => {
    const seen = []
    const failImage = { id: 's1-bi', nth: 2, error: seError(404, 'NOT_FOUND', '이미지가 없습니다') }
    const ctx = setup({ realStream: true, failImage })
    realClient._setDeps({ fetch: fetchInto(ctx.redis, seen) })
    const err = await fail(ctx.svc.deploy(user, ctx.meta(), new Map()))
    expect(err.statusCode).toBe(500)
    expect(seen).toEqual([]) // 본문을 끝까지 읽지 못했다
    expect(ctx.records.get(RID)).toMatchObject({ result: 'failed', error: { code: 'NOT_FOUND', status: 500 } })
    expect(ctx.calls.finish).toEqual([])
  })
})
