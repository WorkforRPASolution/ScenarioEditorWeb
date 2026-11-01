import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOpenService } from '../service/openService'
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
  let property = { Priority: 10, Type: 1 }
  const deps = {
    repo: { findScenarioKeyDocs: async () => over.keyDocs ?? [{ property, performance: {} }] },
    hash: { hkeys: async () => ['N.1730000000100'] },
    gridfs: {
      findVersion: async (p, m, n, crtime) => (crtime === 1730000000100 ? { _id: 'f1', metadata: { body } } : null),
      readContent: async () => { reads++; await new Promise((r) => setTimeout(r, 20)); return JSON.stringify({ ID: 'BI.P-M-N', TargetSnapshotList: [LONG_B64] }) }
    },
    scopes: { assertAllowed: async () => {} },
    imageCache: createImageCache({ dir: mkdtempSync(join(tmpdir(), 'sew-open-')), maxBytes: 1e9 }),
    log: { info() {}, warn() {} }
  }
  return { svc: createOpenService(deps), deps, reads: () => reads, setProperty: (p) => { property = p; deps.repo.findScenarioKeyDocs = async () => [{ property, performance: {} }] } }
}

describe('openService', () => {
  it('current 를 열고 이미지 URL 은 API 기준 경로', async () => {
    const { svc } = setup()
    const { skeleton, stats } = await svc.open({}, 'P', 'M', 'N', 'current')
    expect(skeleton.version).toEqual({ crtime: 1730000000100, isCurrent: true })
    expect(skeleton.steps[0].baseImage.url).toBe('/scenario-editor/scenarios/P/M/N/versions/1730000000100/images/s0-bi')
    expect(stats.fromCache).toBe(false)
  })
  it('같은 버전 동시 열기는 한 번만 풀고, 두 번째부터는 캐시', async () => {
    const t = setup()
    await Promise.all([t.svc.open({}, 'P', 'M', 'N', '1730000000100'), t.svc.open({}, 'P', 'M', 'N', '1730000000100')])
    expect(t.reads()).toBe(1)
    const again = await t.svc.open({}, 'P', 'M', 'N', '1730000000100')
    expect(again.stats.fromCache).toBe(true)
    expect(t.reads()).toBe(1)
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
    const p = await t.svc.imagePath({}, 'P', 'M', 'N', 1730000000100, 's0-bi')
    expect(p).toMatch(/s0-bi\.png$/)
    expect(t.reads()).toBe(2)
    await expect(t.svc.imagePath({}, 'P', 'M', 'N', 1730000000100, 'zz')).rejects.toMatchObject({ statusCode: 404 })
  })
})
