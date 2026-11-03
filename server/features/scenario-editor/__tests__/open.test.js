import { describe, it, expect } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOpenService, versionKey } from '../service/openService'
import { createImageCache } from '../repo/imageCache'

const LONG_B64 = Buffer.from('fake-png-bytes-xxxxxxxx').toString('base64')
const body = { RevisionNo: 0, TriggerType: 2, ID: 'P-M-N', Text: '', Description: 'd', TimeoutLimit: 240, HidingWindowConditionList: [], Compensation: null,
  TargetWindowCondition: { Text: 'X*', ClassName: 'C', IsCheckRectEqual: false, Left: 0, Top: 0, Right: 0, Bottom: 0 },
  Step: [{ Operation: 1, Script: { Type: 1, Value: '1:1', NativeFunction: null }, RetryInterval: 2000, RetryLimit: 2, NextStepIfTrue: 10000, NextStepIfFalse: -1,
    DescriptionToEmail: 's', DescriptionToDialog: '', IsShowDialog: true,
    Metadata: { SearchArea: { X: 1, Y: 1, Width: 5, Height: 5 }, ConditionExpression: '',
      ImageSearchParam: { TrainImageMap: { 0: { BinaryImage: LONG_B64, Type: true } }, AcceptThreshold: 0.9, MaximumNumberToFind: 1, TimeoutEnabled: true, Timeout: 1000 },
      OcrParamInfo: { Type: 0, Operation: 0, TextValue: '1-0', NumberValue: -218, NumberRangeMin: -218, NumberRangeMax: -218, MinMatchingValue: 5 } } }] }

function setup(over = {}) {
  let reads = 0
  let fileReads = 0
  let fileId = 'f1' // 이 판의 최신 파일. 같은 crtime 으로 다시 올라오면 바뀐다
  const OTHER_B64 = Buffer.from('other-png-bytes-yyyyyyyyy').toString('base64')
  const biOf = { f1: LONG_B64, f2: OTHER_B64 }
  let property = { Priority: 10, Type: 1 }
  const deps = {
    repo: { findScenarioKeyDocs: async () => over.keyDocs ?? [{ property, performance: {} }] },
    hash: { hkeys: async () => ['N.1730000000100'] },
    gridfs: {
      findVersionId: async (p, m, n, crtime) => (crtime === 1730000000100 ? fileId : null),
      findFile: async (id) => { fileReads++; return { _id: id, metadata: { body } } },
      readContent: async (id) => { reads++; await new Promise((r) => setTimeout(r, 20)); return JSON.stringify({ ID: 'BI.P-M-N', TargetSnapshotList: [biOf[id]] }) }
    },
    scopes: { assertAllowed: async () => {} },
    imageCache: createImageCache({ dir: mkdtempSync(join(tmpdir(), 'sew-open-')), maxBytes: 1e9 }),
    log: { info() {}, warn() {} }
  }
  return { svc: createOpenService(deps), deps, reads: () => reads, fileReads: () => fileReads, setFile: (id) => { fileId = id }, biOf, setProperty: (p) => { property = p; deps.repo.findScenarioKeyDocs = async () => [{ property, performance: {} }] } }
}

describe('openService', () => {
  it('current 를 열고 이미지 URL 은 API 기준 경로', async () => {
    const { svc } = setup()
    const { skeleton, stats } = await svc.open({}, 'P', 'M', 'N', 'current')
    expect(skeleton.version).toEqual({ crtime: 1730000000100, isCurrent: true })
    expect(skeleton.steps[0].baseImage.url).toBe('/scenario-editor/scenarios/P/M/N/versions/1730000000100/files/f1/images/s0-bi')
    expect(stats.fromCache).toBe(false)
  })
  it('같은 버전 동시 열기는 한 번만 풀고, 두 번째부터는 캐시', async () => {
    const t = setup()
    await Promise.all([t.svc.open({}, 'P', 'M', 'N', '1730000000100'), t.svc.open({}, 'P', 'M', 'N', '1730000000100')])
    expect(t.reads()).toBe(1)
    const again = await t.svc.open({}, 'P', 'M', 'N', '1730000000100')
    expect(again.stats.fromCache).toBe(true)
    expect(t.reads()).toBe(1)
    expect(t.fileReads()).toBe(1) // 캐시가 맞으면 본문(최대 16MB)이 든 파일 문서를 읽지 않는다
  })
  it('캐시가 있어도 운영 속성은 현재 값', async () => {
    const t = setup()
    await t.svc.open({}, 'P', 'M', 'N', 'current')
    t.setProperty({ Priority: 5, Type: 1 })
    expect((await t.svc.open({}, 'P', 'M', 'N', 'current')).skeleton.property.Priority).toBe(5)
  })
  it('같은 키 2건은 422, 없으면 404, 버전 없으면 404', async () => {
    await expect(setup({ keyDocs: [{ property: {} }, { property: {} }] }).svc.open({}, 'P', 'M', 'N', 'current')).rejects.toMatchObject({ statusCode: 422, code: 'DATA_INVALID' })
    await expect(setup({ keyDocs: [] }).svc.open({}, 'P', 'M', 'N', 'current')).rejects.toMatchObject({ statusCode: 404 })
    await expect(setup({ keyDocs: [{ scname: 'N' }] }).svc.open({}, 'P', 'M', 'N', 'current')).rejects.toMatchObject({ statusCode: 404 })
    await expect(setup().svc.open({}, 'P', 'M', 'N', '1730000000999')).rejects.toMatchObject({ statusCode: 404 })
    await expect(setup().svc.open({}, 'P', 'M', 'N', 'abc')).rejects.toMatchObject({ statusCode: 400 })
  })
  it('이미지 캐시가 지워졌으면 이미지 요청 때 다시 푼다', async () => {
    const t = setup()
    await t.svc.open({}, 'P', 'M', 'N', 'current')
    await t.deps.imageCache.clear()
    const p = await t.svc.imagePath({}, 'P', 'M', 'N', 1730000000100, 'f1', 's0-bi')
    expect(p).toMatch(/s0-bi\.png$/)
    expect(t.reads()).toBe(2)
    await expect(t.svc.imagePath({}, 'P', 'M', 'N', 1730000000100, 'f1', 'zz')).rejects.toMatchObject({ statusCode: 404 })
  })

  describe('같은 crtime 으로 파일이 다시 올라오면 (캐시 정체성 = fs.files._id)', () => {
    const bytesOf = (b64) => Buffer.from(b64, 'base64').toString()
    it('새 파일로 다시 풀고, URL 과 이미지도 새 파일 것이다', async () => {
      const t = setup()
      await t.svc.open({}, 'P', 'M', 'N', 'current')
      t.setFile('f2')
      const { skeleton, stats } = await t.svc.open({}, 'P', 'M', 'N', 'current')
      expect(stats.fromCache).toBe(false)
      expect(t.reads()).toBe(2)
      expect(skeleton.steps[0].baseImage.url).toContain('/files/f2/images/s0-bi')
      expect(readFileSync(await t.svc.imagePath({}, 'P', 'M', 'N', 1730000000100, 'f2', 's0-bi')).toString()).toBe(bytesOf(t.biOf.f2))
    })
    it('옛 파일 URL 은 캐시가 남아 있으면 옛 내용을 그대로 준다(1년 캐시 URL 의 내용이 바뀌면 안 된다)', async () => {
      const t = setup()
      await t.svc.open({}, 'P', 'M', 'N', 'current')
      t.setFile('f2')
      await t.svc.open({}, 'P', 'M', 'N', 'current')
      expect(readFileSync(await t.svc.imagePath({}, 'P', 'M', 'N', 1730000000100, 'f1', 's0-bi')).toString()).toBe(bytesOf(t.biOf.f1))
    })
    it('옛 파일 URL 은 캐시가 지워졌으면 404 이고 아무것도 풀지 않는다', async () => {
      const t = setup()
      await t.svc.open({}, 'P', 'M', 'N', 'current')
      t.setFile('f2')
      await t.deps.imageCache.clear()
      await expect(t.svc.imagePath({}, 'P', 'M', 'N', 1730000000100, 'f1', 's0-bi')).rejects.toMatchObject({ statusCode: 404 })
      expect(t.reads()).toBe(1)
    })
    it('판이 없어졌으면 이미지도 404', async () => {
      const t = setup()
      await expect(t.svc.imagePath({}, 'P', 'M', 'N', 1730000000999, 'f1', 's0-bi')).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('캐시 키는 공정·모델·이름·crtime 조합마다 다르다', () => {
    it("(P,'M.A','B') 와 (P,'M','A.B') 는 키가 다르다 — '.' 으로 이어 붙이지 않는다", () => {
      expect(versionKey('P', 'M.A', 'B', 1, 'f')).not.toBe(versionKey('P', 'M', 'A.B', 1, 'f'))
      expect(versionKey('P.M', 'A', 'B', 1, 'f')).not.toBe(versionKey('P', 'M.A', 'B', 1, 'f'))
      expect(versionKey('P', 'M/A', 'B', 1, 'f')).not.toBe(versionKey('P', 'M', 'A/B', 1, 'f'))
      expect(versionKey('P', 'M', 'N', 1730000000100, 'f')).toBe(versionKey('P', 'M', 'N', '1730000000100', 'f'))
      expect(versionKey('P', 'M', 'N', 1, 'f1')).not.toBe(versionKey('P', 'M', 'N', 1, 'f2'))
    })
    it('겹치는 두 조합을 열면 서로 다른 디렉터리에 풀고, 이미지도 제 것만 준다', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sew-open-key-'))
      const png = (tag) => Buffer.from(`fake-png-${tag}-xxxxxxxxxxxx`).toString('base64')
      const bodyOf = (desc, b64) => ({ ...body, Description: desc, Step: [{ ...body.Step[0], Metadata: { ...body.Step[0].Metadata,
        ImageSearchParam: { ...body.Step[0].Metadata.ImageSearchParam, TrainImageMap: { 0: { BinaryImage: b64, Type: true } } } } }] })
      const files = { 'M.A|B': { desc: 'one', b64: png('one') }, 'M|A.B': { desc: 'two', b64: png('two') } }
      let reads = 0
      const svc = createOpenService({
        repo: { findScenarioKeyDocs: async () => [{ property: { Priority: 10 }, performance: {} }] },
        hash: { hkeys: async () => [] },
        gridfs: {
          findVersionId: async (p, m, n) => (files[`${m}|${n}`] ? `${m}|${n}` : null),
          findFile: async (id) => ({ _id: id, metadata: { body: bodyOf(files[id].desc, files[id].b64) } }),
          readContent: async (id) => { reads++; return JSON.stringify({ TargetSnapshotList: [files[id].b64] }) }
        },
        scopes: { assertAllowed: async () => {} },
        imageCache: createImageCache({ dir, maxBytes: 1e9 }),
        log: { info() {}, warn() {} }
      })
      const one = await svc.open({}, 'P', 'M.A', 'B', '1')
      const two = await svc.open({}, 'P', 'M', 'A.B', '1')
      expect(one.skeleton.header.description).toBe('one')
      expect(two.stats.fromCache).toBe(false)
      expect(two.skeleton.header.description).toBe('two')
      expect(reads).toBe(2)
      expect(readdirSync(dir)).toHaveLength(2)
      const p1 = await svc.imagePath({}, 'P', 'M.A', 'B', 1, 'M.A|B', 's0-bi')
      const p2 = await svc.imagePath({}, 'P', 'M', 'A.B', 1, 'M|A.B', 's0-bi')
      expect(p1).not.toBe(p2)
      expect(readFileSync(p1).toString()).toContain('one')
      expect(readFileSync(p2).toString()).toContain('two')
    })
  })
})
