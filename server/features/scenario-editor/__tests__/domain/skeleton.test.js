import { describe, it, expect } from 'vitest'
import { buildSkeleton } from '../../domain/skeleton'

const md = (op, train = {}) => ({
  SearchArea: op === 0 ? { X: -18, Y: -18, Width: -18, Height: -18 } : { X: 10, Y: 20, Width: 300, Height: 200 },
  ImageSearchParam: { TrainImageMap: train, AcceptThreshold: 0.9, MaximumNumberToFind: 1, TimeoutEnabled: true, Timeout: 1000 },
  ConditionExpression: '',
  OcrParamInfo: { Type: op === 2 ? 1 : 0, Operation: op === 2 ? 1 : 0, TextValue: op === 2 ? 'IDLE@@@@1-0' : '1-0', NumberValue: -218, NumberRangeMin: -218, NumberRangeMax: -218, MinMatchingValue: op === 2 ? 10 : 5 }
})
const LONG_B64 = 'iVBORw0KGgoAAAANSUhEUg=='
const body = {
  RevisionNo: 0, TriggerType: 2, ID: 'P-M-N', Text: '', Description: '메일 제목',
  Step: [
    { Operation: 1, Metadata: md(1, { 0: { BinaryImage: LONG_B64, Type: true } }), Script: { Type: 1, Value: '24:12', NativeFunction: null },
      RetryInterval: 2000, RetryLimit: 2, NextStepIfTrue: 10002, NextStepIfFalse: -1, DescriptionToEmail: '누르기', DescriptionToDialog: '', IsShowDialog: true },
    { Operation: 2, Metadata: md(2), Script: { Type: 0, Value: '', NativeFunction: null },
      RetryInterval: 2000, RetryLimit: 5, NextStepIfTrue: 10002, NextStepIfFalse: 0, DescriptionToEmail: 'OCR', DescriptionToDialog: '', IsShowDialog: true },
    { Operation: 0, Metadata: md(0), Script: { Type: 6, Value: '30000', NativeFunction: null },
      RetryInterval: 2000, RetryLimit: 0, NextStepIfTrue: 10000, NextStepIfFalse: -1, DescriptionToEmail: '대기', DescriptionToDialog: '', IsShowDialog: true }
  ],
  TargetWindowCondition: { Text: 'EQ Control*', ClassName: 'WF', IsCheckRectEqual: false, Left: 0, Top: 0, Right: 0, Bottom: 0 },
  HidingWindowConditionList: [], Compensation: null, TimeoutLimit: 240
}
const base = { process: 'P', model: 'M', name: 'N', crtime: 1730000000000, isCurrent: true, body, propertyDoc: { Priority: 10, Type: 1 },
  performanceDoc: { ScenarioDescription: '설명' }, imageBaseUrl: '/img' }

describe('buildSkeleton', () => {
  it('스텝을 구조화하고 이미지를 떼어 URL 로 바꾼다', () => {
    const { skeleton, images } = buildSkeleton({ ...base, biText: JSON.stringify({ ID: 'BI.P-M-N', TargetSnapshotList: [LONG_B64, 'AA==', 'AA=='] }) })
    expect(skeleton).toMatchObject({ process: 'P', model: 'M', name: 'N', id: 'P-M-N', version: { crtime: 1730000000000, isCurrent: true } })
    expect(skeleton.header).toMatchObject({ description: '메일 제목', timeoutLimit: 240, targetWindow: { agentFinds: true, matchMode: 'partial' } })
    const [s0, s1, s2] = skeleton.steps
    expect(s0).toMatchObject({ uid: 's0', no: 1, baseImage: { state: 'present', url: '/img/s0-bi' }, next: { onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } } })
    expect(s0.condition.image.trainImages).toEqual([{ key: 0, type: true, url: '/img/s0-train-0' }])
    expect(s0.raw.Metadata.ImageSearchParam.TrainImageMap['0'].BinaryImage).toBe('/img/s0-train-0')
    expect(s1.baseImage).toEqual({ state: 'missing' })
    expect(s1.notes.map((n) => n.code)).toEqual(['BASE_IMAGE_MISSING'])
    expect(s1.next.onFalse).toEqual({ kind: 'step', uid: 's0', no: 1 })
    expect(s2).toMatchObject({ baseImage: { state: 'notNeeded' }, action: { waitSec: 30 } })
    expect(images.map((i) => i.id)).toEqual(['s0-train-0', 's0-bi'])
    expect(skeleton.baseImageSummary).toEqual({ needed: 2, present: 1 })
    expect(skeleton.property).toMatchObject({ Priority: 10, Type: 1 })
    expect(skeleton.performance).toMatchObject({ scenarioDescription: '설명' })
    expect(skeleton.notes).toEqual([])
  })
  it('기준 화면이 아예 없는 버전(BI "")도 연다 — 알림만', () => {
    const { skeleton, images } = buildSkeleton({ ...base, biText: '' })
    expect(skeleton.steps[0].baseImage).toEqual({ state: 'missing' })
    expect(images.map((i) => i.id)).toEqual(['s0-train-0'])
  })
  it('운영 속성 해석 실패는 시나리오 경고, 속성은 null', () => {
    const { skeleton } = buildSkeleton({ ...base, biText: '', propertyDoc: { Priority: null } })
    expect(skeleton.property).toBe(null)
    expect(skeleton.notes.map((n) => n.code)).toEqual(['PARSE_FAILED'])
  })

  describe('깨진 저장 값은 던지지 않고 알림으로 낮춘다', () => {
    const codes = (ns) => ns.map((n) => n.code)
    const withStep = (step) => ({ ...base, biText: '', body: { ...body, Step: [step] } })

    it('본문이 객체가 아니면 빈 뼈대와 본문 해석 실패 경고', () => {
      for (const bad of [null, undefined, 'x', 5]) {
        const { skeleton, images } = buildSkeleton({ ...base, body: bad, biText: '' })
        expect(skeleton.steps).toEqual([])
        expect(images).toEqual([])
        expect(skeleton.notes).toContainEqual({ level: 'warning', code: 'PARSE_FAILED', params: { field: 'body' } })
        expect(skeleton.notes.filter((n) => n.params.field === 'steps')).toEqual([])
      }
    })
    it('Step 이 배열이 아니면 스텝 없음 + 해석 실패 경고', () => {
      const { skeleton } = buildSkeleton({ ...base, body: { ...body, Step: 'abc' }, biText: '' })
      expect(skeleton.steps).toEqual([])
      expect(skeleton.notes).toContainEqual({ level: 'warning', code: 'PARSE_FAILED', params: { field: 'steps' } })
    })
    it('객체가 아닌 스텝은 그 스텝만 경고하고 raw 는 빈 객체', () => {
      for (const bad of [null, 'x', 5]) {
        const { skeleton } = buildSkeleton({ ...base, body: { ...body, Step: [bad, body.Step[2]] }, biText: '' })
        const [s0, s1] = skeleton.steps
        expect(s0.condition.kind).toBe('unknown')
        expect(s0.baseImage).toEqual({ state: 'notNeeded' })
        expect(s0.raw).toEqual({})
        expect(codes(s0.notes).filter((c) => c === 'PARSE_FAILED')).toEqual(['PARSE_FAILED'])
        expect(s1.condition.kind).toBe('none')
      }
    })
    it('이미지 조건인데 ImageSearchParam 이 없거나 null 이면 학습 이미지 없이 연다', () => {
      for (const isp of [undefined, null, 'x']) {
        const step = { ...body.Step[0], Metadata: { ...md(1), ImageSearchParam: isp } }
        const { skeleton, images } = buildSkeleton(withStep(step))
        expect(skeleton.steps[0].condition.image.trainImages).toEqual([])
        expect(images).toEqual([])
      }
    })
    it('TrainImageMap 항목이 객체가 아니면 그 이미지만 URL 없이 알린다', () => {
      for (const bad of ['abc', 5, true, null]) {
        const train = { 0: bad, 1: { BinaryImage: LONG_B64, Type: false } }
        const step = { ...body.Step[0], Metadata: md(1, train) }
        const { skeleton, images } = buildSkeleton(withStep(step))
        const s0 = skeleton.steps[0]
        expect(s0.condition.image.trainImages.map((t) => [t.key, t.url])).toEqual([[0, null], [1, '/img/s0-train-1']])
        expect(s0.notes).toContainEqual({ level: 'warning', code: 'PARSE_FAILED', params: { field: 'trainImage', key: 0 } })
        expect(s0.raw.Metadata.ImageSearchParam.TrainImageMap['0']).toBe(bad)
        expect(s0.raw.Metadata.ImageSearchParam.TrainImageMap['1'].BinaryImage).toBe('/img/s0-train-1')
        expect(images.map((i) => i.id)).toEqual(['s0-train-1'])
      }
    })
    it('기준 화면 항목이 문자열이 아니거나 BI 가 깨졌으면 없는 것으로 본다', () => {
      for (const bad of [5, {}, null, ['AAAAAAAA']]) {
        const { skeleton, images } = buildSkeleton({ ...base, biText: JSON.stringify({ TargetSnapshotList: [bad, bad, bad] }) })
        expect(skeleton.steps[0].baseImage).toEqual({ state: 'missing' })
        expect(skeleton.baseImageSummary).toEqual({ needed: 2, present: 0 })
        expect(images.map((i) => i.id)).toEqual(['s0-train-0'])
      }
      for (const bad of ['{깨짐', 'null', '5']) {
        const { skeleton } = buildSkeleton({ ...base, biText: bad })
        expect(skeleton.steps[0].baseImage).toEqual({ state: 'missing' })
        expect(skeleton.baseImageSummary).toEqual({ needed: 2, present: 0 })
      }
      expect(buildSkeleton({ ...base, biText: '{깨짐' }).skeleton.notes).toContainEqual({ level: 'warning', code: 'PARSE_FAILED', params: { field: 'bi' } })
    })
  })

  it('보정 기준 이미지는 떼어 URL 로 바꾸고, 이미지가 아니면 URL 없이 좌표만 둔다', () => {
    const withComp = (comp) => buildSkeleton({ ...base, biText: '', body: { ...body, Compensation: comp } })
    const a = withComp({ X: 3, Y: 4, RefImage: LONG_B64 })
    expect(a.skeleton.header.compensation).toEqual({ x: 3, y: 4, refImage: '/img/ref' })
    expect(a.images.at(-1)).toEqual({ id: 'ref', base64: LONG_B64 }) // 디코드하지 않은 base64 그대로
    const b = withComp({ X: 3, Y: 4, RefImage: 'AA==' })
    expect(b.skeleton.header.compensation).toEqual({ x: 3, y: 4, refImage: null })
    expect(b.images.map((i) => i.id)).not.toContain('ref')
    expect(buildSkeleton({ ...base, biText: '' }).skeleton.header.compensation).toBe(null)
  })
})
