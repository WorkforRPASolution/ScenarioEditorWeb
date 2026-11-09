import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rawStep, SUCCESS, FAIL } from './domain/rules/helpers'
const require = createRequire(import.meta.url)
const { createOpenService } = require('../service/openService')
const { createCheckService } = require('../service/checkService')
const { createDeployService } = require('../service/deployService')
const { createImageCache } = require('../repo/imageCache')
const { countUtf8Bytes } = require('../clients/interfaceClient')
const { emptyPerformance } = require('../domain/performanceEdit')

// 열어 둔 사이 지워진 시나리오의 [다시 만듭니다](force) — 2026-11-07 결정 (a), 설계 §6.5.
// delscenario 는 SC_PROPERTY 와 GridFS 판 파일을 지우고 Redis 판은 남긴다. 실제 openService·checkService·deployService·디스크 캐시에
// 가짜 repo·gridfs·Redis·웹 DB·InterfaceServer 를 붙인다.
const CRTIME = 1730000000100
const NEW = 1730000099000
const FILE = '0123456789abcdef01234567'
const b64 = (s) => Buffer.from(s).toString('base64')
const TRAIN = b64('train-png-bytes-0000')
const BI0 = b64('base-png-bytes-step0')
const BI1 = b64('base-png-bytes-step1')
const steps = [rawStep({ kind: 'image', next: [1, FAIL] }), rawStep({ next: [SUCCESS, FAIL] })]
steps[0].Metadata.ImageSearchParam.TrainImageMap = { 0: { BinaryImage: TRAIN, Type: true } }
const body = { RevisionNo: 0, TriggerType: 2, ID: 'P-M-N', Text: '', Description: '메일 제목', Step: steps, TimeoutLimit: 240 }
// 후속 시나리오 없음 — 문서가 없으면 운영 속성은 모든 키를 새 값으로 검사한다(새 시나리오 첫 저장과 같다)
const property = { IsEnabled: true, Type: 1, StartDelay: 0, Owners: ['kim@2026-11-01 10:00:00'], NextScenarioIfSuccess: null, NextScenarioIfFail: null }
const PERF = { Group: 'G1', Grade: 2 }
const user = { singleid: 'sew_x', authorityManager: 1 }
const fail = async (p) => { try { await p } catch (e) { return e } throw new Error('통과하면 안 됨') }
let rid = 0
const nextRid = () => `11111111-2222-4333-8444-${String(++rid).padStart(12, '0')}`

function setup() {
  const calls = { sent: [], insert: [], finish: [] }
  const docs = new Map([['P|M|N', { scname: 'N', property, performance: PERF }]])
  const redis = new Map([[`N.${CRTIME}`, 'old body']])
  const file = { exists: true }
  const meta = { _id: FILE, length: 1, metadata: { process: 'P', model: 'M', name: 'N', crtime: CRTIME, body } }
  const repo = {
    findScenarioKeyDocs: async (p, m, n) => (docs.has(`${p}|${m}|${n}`) ? [docs.get(`${p}|${m}|${n}`)] : []),
    findScenarioDocs: async (p, m) => [...docs.entries()].filter(([k]) => k.startsWith(`${p}|${m}|`)).map(([, d]) => d),
    findPerformanceRaw: async () => null,
    finishDeploy: async (key, finish) => { calls.finish.push([key, finish]); return { matched: 1 } }
  }
  const gridfs = {
    findVersionId: async (p, m, n, c) => (file.exists && c === CRTIME ? meta._id : null),
    findFile: async () => (file.exists ? meta : null),
    findFileMeta: async () => (file.exists ? meta : null),
    streamContent: async function* () { yield Buffer.from(JSON.stringify({ ID: 'BI.P-M-N', TargetSnapshotList: [BI0, BI1] })) }
  }
  const hash = { hkeys: async (key) => (key === 'P-M' ? [...redis.keys()] : []), hget: async (key, f) => (key === 'P-M' ? redis.get(f) ?? null : null) }
  const scopes = { assertAllowed: async () => {}, scopeFor: async () => ({ pairs: [{ process: 'P', models: [{ model: 'M', eqpCount: 3 }] }] }) }
  const imageCache = createImageCache({ dir: mkdtempSync(join(tmpdir(), 'sew-recreate-')), maxBytes: 1e9 })
  const log = { info() {}, warn() {}, error() {} }
  const records = new Map()
  const web = {
    getDeploy: async (r) => records.get(r) || null,
    insertDeploy: async (r) => { calls.insert.push(r); records.set(r.requestId, structuredClone(r)) },
    updateDeploy: async (r, f) => { Object.assign(records.get(r), f) },
    findDraftFor: async () => null,
    deleteDraftFor: async () => ({ deleted: false, gridIds: [] }),
    deleteDraftImages: async () => {}
  }
  // InterfaceServer 처럼: 본문을 Redis 새 필드에 쓰고 운영 속성 문서를 보낸 property 로 만든다
  const interfaceClient = {
    countUtf8Bytes,
    setScenarioStream: async ({ chunks, contentLength }) => {
      let text = ''
      for await (const c of chunks()) text += c
      expect(Buffer.byteLength(text, 'utf8')).toBe(contentLength)
      const req = JSON.parse(text)
      calls.sent.push(req)
      redis.set(`${req.SCName}.${NEW}`, req.Body)
      docs.set(`${req.Process}|${req.Model}|${req.SCName}`, { scname: req.SCName, property: JSON.parse(req.Property) })
    }
  }
  const opener = createOpenService({ repo, hash, gridfs, scopes, imageCache, log })
  const check = createCheckService({ repo, hash, scopes, opener, env: {} })
  const svc = createDeployService({ check, opener, web, repo, hash, scopes, interfaceClient, log, now: () => new Date('2026-11-09T01:00:00Z') })
  // delscenario: SC_PROPERTY·GridFS 판 파일을 지운다(Redis 판은 남는다)
  const delscenario = () => { docs.delete('P|M|N'); file.exists = false }
  return { svc, opener, imageCache, calls, docs, delscenario }
}

async function openedThenDeleted() {
  const s = setup()
  const { skeleton } = await s.opener.open(user, 'P', 'M', 'N', 'current') // 연 판이 디스크 캐시에 남는다
  s.delscenario()
  const metaOf = (over = {}) => ({ target: { process: 'P', model: 'M', name: 'N' }, propertyRev: skeleton.propertyRev, scenario: skeleton.edited, requestId: nextRid(), ...over })
  return { ...s, skeleton, metaOf }
}

describe('지워진 시나리오 다시 만들기 (force, 디스크 캐시)', () => {
  it('캐시가 있으면 force 배포가 그 판을 기준으로 다시 만든다 — 손대지 않은 그림(찾을 그림·기준 화면)도 캐시에서, 운영 속성·성과는 작업본 값으로 새로', async () => {
    const s = await openedThenDeleted()
    const r = await s.svc.deploy(user, s.metaOf({ force: true }), new Map())
    expect(r).toMatchObject({ result: 'ok', crtime: NEW })
    const req = s.calls.sent[0]
    expect(JSON.parse(req.BI)).toEqual({ ID: 'BI.P-M-N', TargetSnapshotList: [BI0, BI1] })
    const sentBody = JSON.parse(req.Body)
    expect(sentBody.Step).toHaveLength(2)
    expect(sentBody.Step[0].Metadata.ImageSearchParam.TrainImageMap['0'].BinaryImage).toBe(TRAIN)
    expect(sentBody.Step.map((x) => x.DescriptionToEmail)).toEqual(steps.map((x) => x.DescriptionToEmail))
    // 문서가 없으니 Owners 는 빈 목록에 내 줄, 성과는 빈 값(새 시나리오 첫 저장과 같은 길) — 지워진 성과는 돌아오지 않는다
    expect(JSON.parse(req.Property)).toMatchObject({ ID: 'P-M-N', IsEnabled: true, Owners: [] })
    expect(s.calls.finish[0][1]).toEqual({ owners: ['sew_x@2026-11-09 10:00:00'], scCategory: 1, performance: emptyPerformance() })
    expect(s.calls.insert[0].source).toEqual({ process: 'P', model: 'M', name: 'N', crtime: CRTIME, fileId: FILE })
  })
  it('force 가 아니면 지금처럼 SOURCE_GONE(422)이고 아무것도 쓰지 않는다', async () => {
    const s = await openedThenDeleted()
    const err = await fail(s.svc.deploy(user, s.metaOf(), new Map()))
    expect(err).toMatchObject({ statusCode: 422, code: 'VALIDATION_FAILED' })
    expect(err.details.blocks).toContainEqual({ code: 'SOURCE_GONE' })
    expect(s.calls.insert).toEqual([])
    expect(s.calls.sent).toEqual([])
  })
  it('캐시마저 없으면 force 여도 SOURCE_GONE(422)이고 아무것도 쓰지 않는다', async () => {
    const s = await openedThenDeleted()
    await s.imageCache.clear()
    const err = await fail(s.svc.deploy(user, s.metaOf({ force: true }), new Map()))
    expect(err).toMatchObject({ statusCode: 422, code: 'VALIDATION_FAILED' })
    expect(err.details.blocks).toContainEqual({ code: 'SOURCE_GONE' })
    expect(s.calls.insert).toEqual([])
    expect(s.calls.sent).toEqual([])
    expect(s.docs.has('P|M|N')).toBe(false)
  })
})
