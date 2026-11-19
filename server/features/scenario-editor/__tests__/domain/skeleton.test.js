import { describe, it, expect } from 'vitest'
import { buildSkeleton, isImage, versionNotes, refreshPropertyParts } from '../../domain/skeleton'

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

const BROKEN_BI = { parseFailed: true, present: new Set() }

describe('isImage — 정규 base64 만 그림이다(다시 인코딩해도 같아야 배포가 저장값을 바꾸지 않는다)', () => {
  it('정규 base64(길이 5 이상)만 true', () => {
    expect(isImage(LONG_B64)).toBe(true)
    expect(isImage('AA==')).toBe(false)
    expect(isImage('AAAAAAAA\n')).toBe(false) // 줄바꿈
    expect(isImage('iVBORw0KGgoAAAANSUhEUg')).toBe(false) // 패딩 빠짐
    expect(isImage('hello world!')).toBe(false) // base64 가 아닌 글
    expect(isImage(123)).toBe(false)
  })
  it('정규가 아닌 찾을 그림·보정 그림은 떼지 않고 저장값 그대로', () => {
    const odd = 'iVBORw0KGgoAAAANSUhEUg' // 패딩 빠짐
    const b = { ...body, Compensation: { X: 1, Y: 2, RefImage: odd },
      Step: [{ ...body.Step[0], Metadata: md(1, { 0: { BinaryImage: odd, Type: true }, 1: { BinaryImage: LONG_B64, Type: true } }) }] }
    const { skeleton, images } = buildSkeleton({ ...base, body: b })
    expect(images.map((i) => i.id).sort()).toEqual(['s0-train-1'])
    expect(skeleton.steps[0].raw.Metadata.ImageSearchParam.TrainImageMap['0'].BinaryImage).toBe(odd)
    expect(skeleton.header.compensation.refImage).toBeNull()
    expect(skeleton.header.raw.Compensation.RefImage).toBe(odd)
  })
})

describe('buildSkeleton', () => {
  it('스텝을 구조화하고 이미지를 떼어 URL 로 바꾼다', () => {
    const { skeleton, images } = buildSkeleton({ ...base, baseImages: { parseFailed: false, present: new Set([0]) } })
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
    expect(images.map((i) => i.id)).toEqual(['s0-train-0']) // 기준 화면은 BI 를 읽으며 이미 디스크에 썼다
    expect(skeleton.baseImageSummary).toEqual({ needed: 2, present: 1 })
    expect(skeleton.property).toMatchObject({ Priority: 10, Type: 1 })
    expect(skeleton.performance).toMatchObject({ scenarioDescription: '설명' })
    expect(skeleton.notes).toEqual([])
  })
  it('기준 화면이 아예 없는 버전(BI "")도 연다 — 알림만', () => {
    const { skeleton, images } = buildSkeleton({ ...base })
    expect(skeleton.steps[0].baseImage).toEqual({ state: 'missing' })
    expect(images.map((i) => i.id)).toEqual(['s0-train-0'])
  })
  it('운영 속성 해석 실패는 시나리오 경고, 속성은 null', () => {
    const { skeleton } = buildSkeleton({ ...base, propertyDoc: { Priority: null } })
    expect(skeleton.property).toBe(null)
    expect(skeleton.notes.map((n) => n.code)).toEqual(['PARSE_FAILED'])
  })

  describe('깨진 저장 값은 던지지 않고 알림으로 낮춘다', () => {
    const codes = (ns) => ns.map((n) => n.code)
    const withStep = (step) => ({ ...base, body: { ...body, Step: [step] } })

    it('본문이 객체가 아니면 빈 뼈대와 본문 해석 실패 경고', () => {
      for (const bad of [null, undefined, 'x', 5]) {
        const { skeleton, images } = buildSkeleton({ ...base, body: bad })
        expect(skeleton.steps).toEqual([])
        expect(images).toEqual([])
        expect(skeleton.notes).toContainEqual({ level: 'warning', code: 'PARSE_FAILED', params: { field: 'body' } })
        expect(skeleton.notes.filter((n) => n.params.field === 'steps')).toEqual([])
      }
    })
    it('Step 이 배열이 아니면 스텝 없음 + 해석 실패 경고', () => {
      const { skeleton } = buildSkeleton({ ...base, body: { ...body, Step: 'abc' } })
      expect(skeleton.steps).toEqual([])
      expect(skeleton.notes).toContainEqual({ level: 'warning', code: 'PARSE_FAILED', params: { field: 'steps' } })
    })
    it('객체가 아닌 스텝은 그 스텝만 경고하고 raw 는 빈 객체', () => {
      for (const bad of [null, 'x', 5]) {
        const { skeleton } = buildSkeleton({ ...base, body: { ...body, Step: [bad, body.Step[2]] } })
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
    it('BI 가 깨졌으면 없는 것으로 보고 PARSE_FAILED bi 로 알린다', () => {
      const { skeleton, images } = buildSkeleton({ ...base, baseImages: BROKEN_BI })
      expect(skeleton.steps[0].baseImage).toEqual({ state: 'missing' })
      expect(skeleton.baseImageSummary).toEqual({ needed: 2, present: 0 })
      expect(skeleton.notes.filter((n) => n.params.field === 'bi')).toEqual([{ level: 'warning', code: 'PARSE_FAILED', params: { field: 'bi' } }])
      expect(images.map((i) => i.id)).toEqual(['s0-train-0'])
    })
    it('BI 가 깨졌으면 스텝마다 BASE_IMAGE_MISSING 알림을 달지 않는다 — 시나리오의 PARSE_FAILED bi 하나로 알린다(SEW-006: 200 스텝이면 같은 알림 200개)', () => {
      const { skeleton } = buildSkeleton({ ...base, baseImages: BROKEN_BI })
      expect(skeleton.steps.flatMap((s) => s.notes).filter((n) => n.code === 'BASE_IMAGE_MISSING')).toEqual([])
    })
    it('BI 가 비었거나 항목이 없으면 없는 것으로 보되 PARSE_FAILED 는 없다', () => {
      const { skeleton } = buildSkeleton({ ...base, baseImages: { parseFailed: false, present: new Set() } })
      expect(skeleton.steps[0].baseImage).toEqual({ state: 'missing' })
      expect(skeleton.steps[0].notes.filter((n) => n.code === 'BASE_IMAGE_MISSING')).toEqual([{ level: 'info', code: 'BASE_IMAGE_MISSING', params: {} }]) // 읽었는데 그 스텝 것만 없으면 스텝에 단다
      expect(skeleton.notes.filter((n) => n.params.field === 'bi')).toEqual([])
      expect(buildSkeleton(base).skeleton.notes.filter((n) => n.params.field === 'bi')).toEqual([])
    })
  })

  describe('versionNotes — 현재 운영 속성에 기대지 않는 알림만 남긴다', () => {
    const w = (code, params = {}) => ({ level: 'warning', code, params })
    it('본문이 객체가 아니면 본문 해석 실패만 남는다(SUCCESS 없음·대상 창 표시 차이는 뺀다)', () => {
      const { skeleton } = buildSkeleton({ ...base, body: null })
      expect(skeleton.notes.map((n) => n.code)).toEqual(expect.arrayContaining(['PARSE_FAILED', 'NO_SUCCESS', 'TARGET_WINDOW_DIFFERS']))
      expect(versionNotes(skeleton.notes)).toEqual([w('PARSE_FAILED', { field: 'body' })])
    })
    it('Step 이 배열이 아닌 알림도 남는다', () => {
      const { skeleton } = buildSkeleton({ ...base, body: { ...body, Step: 'abc' } })
      expect(versionNotes(skeleton.notes)).toEqual([w('PARSE_FAILED', { field: 'steps' })])
    })
    it('BI 해석 실패는 남기고 우선순위 알림은 뺀다', () => {
      const { skeleton } = buildSkeleton({ ...base, baseImages: BROKEN_BI, propertyDoc: { Priority: 3 } })
      expect(skeleton.notes.map((n) => n.code)).toContain('PRIORITY_NONSTANDARD')
      expect(versionNotes(skeleton.notes)).toEqual([w('PARSE_FAILED', { field: 'bi' })])
    })
    it('운영 속성 해석 실패(PARSE_FAILED property)는 뺀다', () => {
      const { skeleton } = buildSkeleton({ ...base, propertyDoc: { Priority: null } })
      expect(skeleton.notes.map((n) => n.code)).toEqual(['PARSE_FAILED'])
      expect(versionNotes(skeleton.notes)).toEqual([])
    })
    it('순서를 지키고, 입력을 바꾸지 않는다', () => {
      const input = [w('PARSE_FAILED', { field: 'bi' }), w('NO_SUCCESS'), w('PARSE_FAILED', { field: 'property', error: 'x' }), w('PARSE_FAILED', { field: 'body' }), w('PRIORITY_NONSTANDARD'), w('TARGET_WINDOW_DIFFERS')]
      const copy = JSON.parse(JSON.stringify(input))
      expect(versionNotes(input).map((n) => n.params.field)).toEqual(['bi', 'body'])
      expect(input).toEqual(copy)
    })
  })

  it('보정 기준 이미지는 떼어 URL 로 바꾸고, 이미지가 아니면 URL 없이 좌표만 둔다', () => {
    const withComp = (comp) => buildSkeleton({ ...base, body: { ...body, Compensation: comp } })
    const a = withComp({ X: 3, Y: 4, RefImage: LONG_B64 })
    expect(a.skeleton.header.compensation).toEqual({ x: 3, y: 4, refImage: '/img/ref' })
    expect(a.images.at(-1)).toEqual({ id: 'ref', base64: LONG_B64 }) // 디코드하지 않은 base64 그대로
    const b = withComp({ X: 3, Y: 4, RefImage: 'AA==' })
    expect(b.skeleton.header.compensation).toEqual({ x: 3, y: 4, refImage: null })
    expect(b.images.map((i) => i.id)).not.toContain('ref')
    expect(buildSkeleton({ ...base }).skeleton.header.compensation).toBe(null)
  })
})

describe('refreshPropertyParts', () => {
  it('운영 속성이 바뀌면 속성·시나리오 경고를 다시 계산하고 BI 경고는 둔다', () => {
    const { skeleton } = buildSkeleton({ ...base, baseImages: BROKEN_BI })
    expect(skeleton.notes.map((n) => n.code)).toEqual(['PARSE_FAILED'])
    const r = refreshPropertyParts(skeleton, { Priority: 3, Type: 1 }, { ScenarioDescription: '새 설명' })
    expect(r.property.Priority).toBe(3)
    expect(r.performance.scenarioDescription).toBe('새 설명')
    expect(r.notes.map((n) => n.code).sort()).toEqual(['PARSE_FAILED', 'PRIORITY_NONSTANDARD'])
  })
})

describe('원본 보존', () => {
  const noImages = { parseFailed: false, present: new Set(), literals: new Map(), count: null }
  const withTrain = (v, train = { 0: { BinaryImage: v, Type: true } }) => ({ ...base.body, Step: [{ ...base.body.Step[0], Metadata: md(1, train) }] })
  it('자리표시 찾을 그림은 raw 에 원래 값으로 남는다', () => {
    const { skeleton } = buildSkeleton({ ...base, body: withTrain('AA=='), baseImages: noImages })
    expect(skeleton.steps[0].raw.Metadata.ImageSearchParam.TrainImageMap['0'].BinaryImage).toBe('AA==')
  })
  it('스텝마다 bi 항목 종류를 남긴다', () => {
    const baseImages = { parseFailed: false, present: new Set([0]), literals: new Map([[1, 'AA==']]), count: 2 }
    const { skeleton } = buildSkeleton({ ...base, baseImages })
    expect(skeleton.steps[0].bi).toEqual({ kind: 'image', id: 's0-bi' })
    expect(skeleton.steps[1].bi).toEqual({ kind: 'literal', value: 'AA==' })
    expect(skeleton.steps[2].bi).toEqual({ kind: 'absent' })
    expect(skeleton.biCount).toBe(2)
  })
  it('그림이 필요 없는 스텝의 그림 BI 도 image 로 남긴다(기준 화면 상태는 notNeeded 그대로)', () => {
    const { skeleton } = buildSkeleton({ ...base, baseImages: { ...noImages, present: new Set([2]), count: 3 } })
    expect(skeleton.steps[2].bi).toEqual({ kind: 'image', id: 's2-bi' })
    expect(skeleton.steps[2].baseImage).toEqual({ state: 'notNeeded' })
  })
  it('BI 해석 실패면 모든 스텝이 absent 이고 biCount 는 null', () => {
    const { skeleton } = buildSkeleton({ ...base, baseImages: BROKEN_BI })
    expect(skeleton.steps.every((s) => s.bi.kind === 'absent')).toBe(true)
    expect(skeleton.biCount).toBeNull()
  })
  it('header.raw 는 대상 창·숨길 창·보정을 저장값 그대로, 없던 키는 두지 않는다', () => {
    const { skeleton } = buildSkeleton({ ...base, body: { ...base.body, TargetWindowCondition: null, Compensation: { RefImage: 'AA==', X: 1, Y: 2 } } })
    expect(skeleton.header.raw).toEqual({ TargetWindowCondition: null, HidingWindowConditionList: [], Compensation: { RefImage: 'AA==', X: 1, Y: 2 } })
    const { TargetWindowCondition, HidingWindowConditionList, ...noTwc } = base.body
    expect('TargetWindowCondition' in buildSkeleton({ ...base, body: noTwc }).skeleton.header.raw).toBe(false)
    expect(buildSkeleton({ ...base, body: noTwc }).skeleton.header.raw).toEqual({ Compensation: null })
  })
  it('숨길 창 목록이 null·배열이 아니면 header.raw 에 저장값 그대로(화면용 hidingWindows 는 [])', () => {
    for (const stored of [null, 'x']) {
      const { skeleton } = buildSkeleton({ ...base, body: { ...base.body, HidingWindowConditionList: stored } })
      expect(skeleton.header.raw.HidingWindowConditionList).toBe(stored)
      expect(skeleton.header.hidingWindows).toEqual([])
    }
    const list = [{ Text: 'Popup', ClassName: 'Dlg', IsCheckRectEqual: false, Left: 0, Top: 0, Right: 0, Bottom: 0 }]
    const { skeleton } = buildSkeleton({ ...base, body: { ...base.body, HidingWindowConditionList: list } })
    expect(skeleton.header.raw.HidingWindowConditionList).toEqual(list)
    expect(skeleton.header.raw.HidingWindowConditionList).not.toBe(list) // 복사본
  })
  it('이미지가 아닌 조건의 찾을 그림도 떼어 URL 로 바꾼다(이미지 스텝을 OCR·조건 없음으로 바꿔 저장한 판)', () => {
    const train = { 0: { BinaryImage: LONG_B64, Type: true }, 1: { BinaryImage: 'AA==', Type: false } }
    const steps = [{ ...base.body.Step[1], Metadata: md(2, train) }, { ...base.body.Step[2], Metadata: md(0, { 3: { BinaryImage: LONG_B64, Type: false } }) }]
    const { skeleton, images } = buildSkeleton({ ...base, body: { ...base.body, Step: steps }, baseImages: noImages })
    expect(images.map((i) => i.id)).toEqual(['s0-train-0', 's1-train-3'])
    const [s0, s1] = skeleton.steps
    expect(s0.condition.kind).toBe('ocr')
    expect(s0.raw.Metadata.ImageSearchParam.TrainImageMap).toEqual({ 0: { BinaryImage: '/img/s0-train-0', Type: true }, 1: { BinaryImage: 'AA==', Type: false } })
    expect(s1.raw.Metadata.ImageSearchParam.TrainImageMap).toEqual({ 3: { BinaryImage: '/img/s1-train-3', Type: false } })
    expect(s0.notes.filter((n) => n.params.field === 'trainImage')).toEqual([])
  })
  it('음이 아닌 정수의 정규 표기가 아닌 키의 그림은 떼지 않고 raw 에 저장값 그대로 둔다', () => {
    const train = { '-1': { BinaryImage: LONG_B64, Type: true }, abc: { BinaryImage: LONG_B64, Type: true }, '01': { BinaryImage: LONG_B64, Type: true }, 0: { BinaryImage: LONG_B64, Type: true } }
    const { skeleton, images } = buildSkeleton({ ...base, body: withTrain(null, train), baseImages: noImages })
    expect(images.map((i) => i.id)).toEqual(['s0-train-0'])
    const map = skeleton.steps[0].raw.Metadata.ImageSearchParam.TrainImageMap
    expect(map).toEqual({ 0: { BinaryImage: '/img/s0-train-0', Type: true }, '-1': train['-1'], abc: train.abc, '01': train['01'] })
    expect(skeleton.steps[0].condition.image.trainImages.find((t) => t.key === 0).url).toBe('/img/s0-train-0')
    expect(skeleton.steps[0].condition.image.trainImages.filter((t) => t.key !== 0).every((t) => t.url === null)).toBe(true)
    // 알림은 전과 같다: 정수가 아닌 키('-1'·'abc')는 한 번, '01' 은 숫자 1 로 읽혀 표에 "1" 이 없다는 알림
    expect(skeleton.steps[0].notes.filter((n) => n.params.field === 'trainImage')).toEqual([
      { level: 'warning', code: 'PARSE_FAILED', params: { field: 'trainImage' } },
      { level: 'warning', code: 'PARSE_FAILED', params: { field: 'trainImage', key: 1 } }])
  })
  it('보정 RefImage 가 그림이면 raw 에는 null, URL 은 compensation.refImage 가 가리킨다', () => {
    const { skeleton } = buildSkeleton({ ...base, body: { ...base.body, Compensation: { RefImage: LONG_B64, X: 1, Y: 2 } } })
    expect(skeleton.header.raw.Compensation).toEqual({ RefImage: null, X: 1, Y: 2 })
    expect(skeleton.header.compensation.refImage).toBe('/img/ref')
  })
})
