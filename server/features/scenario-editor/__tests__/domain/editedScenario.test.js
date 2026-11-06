import { describe, it, expect } from 'vitest'
import { buildSkeleton } from '../../domain/skeleton'
import { editedFromSkeleton, parseEditedScenario, EditedScenarioError } from '../../domain/editedScenario'

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
    { Operation: 1, Metadata: md(1, { 0: { BinaryImage: LONG_B64, Type: true }, 1: { BinaryImage: 'AA==', Type: false } }), Script: { Type: 1, Value: '24:12', NativeFunction: null },
      RetryInterval: 2000, RetryLimit: 2, NextStepIfTrue: 10002, NextStepIfFalse: -1, DescriptionToEmail: '누르기', DescriptionToDialog: '', IsShowDialog: true },
    { Operation: 2, Metadata: md(2), Script: { Type: 0, Value: '', NativeFunction: null },
      RetryInterval: 2000, RetryLimit: 5, NextStepIfTrue: 10002, NextStepIfFalse: 0, DescriptionToEmail: 'OCR', DescriptionToDialog: '', IsShowDialog: true },
    { Operation: 0, Metadata: md(0), Script: { Type: 6, Value: '30000', NativeFunction: null },
      RetryInterval: 2000, RetryLimit: 0, NextStepIfTrue: 10000, NextStepIfFalse: 99, DescriptionToEmail: '대기', DescriptionToDialog: '', IsShowDialog: true }
  ],
  TargetWindowCondition: { Text: 'EQ Control*', ClassName: 'WF', IsCheckRectEqual: false, Left: 0, Top: 0, Right: 0, Bottom: 0 },
  HidingWindowConditionList: [], Compensation: null, TimeoutLimit: 240
}
const { skeleton } = buildSkeleton({
  process: 'P', model: 'M', name: 'N', crtime: 1730000000000, isCurrent: true, body, propertyDoc: { Priority: 10, Type: 1 },
  performanceDoc: {}, imageBaseUrl: '/img',
  baseImages: { parseFailed: false, present: new Set([0]), literals: new Map([[2, 'AA==']]) }
})
const fresh = () => editedFromSkeleton(skeleton, { fileId: 'F1' })

describe('editedFromSkeleton', () => {
  it('뼈대에서 만든 편집 시나리오는 JSON 왕복 뒤 형식 검사를 통과하고 그대로다', () => {
    const e = fresh()
    expect(parseEditedScenario(JSON.parse(JSON.stringify(e)))).toEqual(e)
    expect(e.steps[0]).toMatchObject({ uid: 's0', origin: 0, images: { base: { from: 'source', id: 's0-bi' } } })
  })
  it('source·headCrtime·header', () => {
    const e = fresh()
    expect(e.source).toEqual({ process: 'P', model: 'M', name: 'N', crtime: 1730000000000, fileId: 'F1' })
    expect(e.headCrtime).toBeNull()
    expect(editedFromSkeleton({ ...skeleton, headCrtime: 5 }).headCrtime).toBe(5)
    expect(editedFromSkeleton(skeleton).source.fileId).toBeNull()
    expect(e.header).toEqual({ description: '메일 제목', timeoutLimit: '240' })
    const odd = editedFromSkeleton({ ...skeleton, header: { ...skeleton.header, description: undefined, timeoutLimit: undefined } })
    expect(odd.header).toEqual({ description: '', timeoutLimit: '' })
  })
  it('대상은 no 없이 uid 만, 해석 안 된 값은 raw 로 남는다', () => {
    const e = fresh()
    expect(e.steps[0].next).toEqual({ onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } })
    expect(e.steps[1].next.onFalse).toEqual({ kind: 'step', uid: 's0' })
    expect(e.steps[2].next.onFalse).toEqual({ kind: 'raw', value: 99 })
  })
  it('찾을 그림은 URL 이 있으면 source 참조, 없으면 원래 값(literal)', () => {
    const e = fresh()
    expect(e.steps[0].images.train).toEqual({ 0: { from: 'source', id: 's0-train-0' }, 1: { literal: 'AA==' } })
  })
  it('찾을 그림 참조는 조건 종류와 상관없이 raw 의 찾을 그림 표에서 만든다', () => {
    const train = { 0: { BinaryImage: LONG_B64, Type: true }, 1: { BinaryImage: 'AA==', Type: false }, 2: null, '-1': { BinaryImage: LONG_B64, Type: true } }
    const ocrBody = { ...body, Step: [{ ...body.Step[1], Metadata: md(2, train) }] }
    const { skeleton: sk } = buildSkeleton({ process: 'P', model: 'M', name: 'N', crtime: 1, isCurrent: true, body: ocrBody, propertyDoc: {}, performanceDoc: {}, imageBaseUrl: '/img' })
    const e = editedFromSkeleton(sk)
    // 정규 키가 아닌 '-1' 은 참조를 만들지 않는다(조립이 raw 의 저장값을 그대로 쓴다)
    expect(e.steps[0].images.train).toEqual({ 0: { from: 'source', id: 's0-train-0' }, 1: { literal: 'AA==' }, 2: { literal: null } })
    expect(parseEditedScenario(JSON.parse(JSON.stringify(e)))).toEqual(e)
  })
  it('기준 화면: image·literal·absent', () => {
    const e = fresh()
    expect(e.steps[0].images.base).toEqual({ from: 'source', id: 's0-bi' })
    expect(e.steps[1].images.base).toBeNull()
    expect(e.steps[2].images.base).toEqual({ literal: 'AA==' })
    expect(e.steps[2].images.train).toEqual({})
  })
  it('fileId 없이 만든 것도 형식 검사를 통과한다', () => {
    const e = editedFromSkeleton(skeleton)
    expect(parseEditedScenario(JSON.parse(JSON.stringify(e)))).toEqual(e)
  })
  it('옛 본문에 없던 키(undefined)는 C# ScenarioStep 기본값, 있던 null 은 null, 값은 그대로 복사', () => {
    // 사내 편집기는 옛 본문을 읽을 때 빠진 키를 생성자 값으로 채운다 — 고쳐서 다시 쓰면 그 값이 나간다(C1)
    const sk = JSON.parse(JSON.stringify(skeleton))
    for (const k of ['isShowDialog', 'descriptionToEmail', 'descriptionToDialog']) delete sk.steps[0][k]
    sk.steps[0].retry = {}
    const s = editedFromSkeleton(sk).steps[0]
    expect(s).toMatchObject({ isShowDialog: true, descriptionToEmail: '', descriptionToDialog: '', retry: { limit: 2, intervalMs: 2000 } })
    Object.assign(sk.steps[1], { isShowDialog: null, descriptionToEmail: null, descriptionToDialog: null, retry: { limit: null, intervalMs: null } })
    expect(editedFromSkeleton(sk).steps[1]).toMatchObject({ isShowDialog: null, descriptionToEmail: null, descriptionToDialog: null, retry: { limit: null, intervalMs: null } })
    delete sk.steps[2].retry
    expect(editedFromSkeleton(sk).steps[2].retry).toEqual({ limit: 2, intervalMs: 2000 })
    expect(fresh().steps[0]).toMatchObject({ descriptionToEmail: '누르기', isShowDialog: true, retry: { limit: 2, intervalMs: 2000 } })
  })
  it('property 는 복사본이다', () => {
    const e = fresh()
    expect(e.property).toEqual(skeleton.property)
    expect(e.property).not.toBe(skeleton.property)
  })
})

describe('parseEditedScenario', () => {
  const bad = (mut) => { const e = fresh(); mut(e); return () => parseEditedScenario(e) }
  it('uid 가 겹치면 거절', () => {
    expect(bad((e) => { e.steps[1].uid = e.steps[0].uid })).toThrow(/uid/)
  })
  it('없는 대상 종류는 거절', () => {
    expect(bad((e) => { e.steps[0].next.onTrue = { kind: 'jump' } })).toThrow(EditedScenarioError)
  })
  it('오류는 path·reason 을 담는다', () => {
    try { bad((e) => { e.steps[0].origin = -1 })() } catch (err) {
      expect(err).toBeInstanceOf(EditedScenarioError)
      expect(err.path).toBe('steps[0].origin'); expect(typeof err.reason).toBe('string'); return
    }
    throw new Error('던져야 한다')
  })
  it.each([
    ['origin 음수', (e) => { e.steps[0].origin = -1 }],
    ['origin 소수', (e) => { e.steps[0].origin = 1.5 }],
    ['uid 빈 문자열', (e) => { e.steps[0].uid = '' }],
    ['객체가 아님', null],
    ['steps 배열 아님', (e) => { e.steps = {} }],
    ['header.timeoutLimit 숫자', (e) => { e.header.timeoutLimit = 240 }],
    ['condition.kind 없음', (e) => { e.steps[0].condition = { kind: 'zzz' } }],
    ['action.type 문자열', (e) => { e.steps[0].action = { type: 'x' } }],
    ['retry.limit 문자열', (e) => { e.steps[0].retry.limit = '2' }],
    ['isShowDialog 문자열', (e) => { e.steps[0].isShowDialog = 'y' }],
    ['train 값 모양', (e) => { e.steps[0].images.train[0] = { from: 'zzz' } }],
    ['upload 에 tempId 없음', (e) => { e.steps[0].images.base = { from: 'upload' } }],
    ['property null', (e) => { e.property = null }],
    ['source.crtime 문자열', (e) => { e.source.crtime = 'x' }],
    ['headCrtime 문자열', (e) => { e.headCrtime = 'x' }],
    ['step 대상에 uid 없음', (e) => { e.steps[0].next.onTrue = { kind: 'step' } }]
  ])('거절: %s', (_n, mut) => {
    if (mut === null) return expect(() => parseEditedScenario(null)).toThrow(EditedScenarioError)
    expect(bad(mut)).toThrow(EditedScenarioError)
  })
  it.each(['01', '-1', '1.0', 'abc', '__proto__', ''])('찾을 그림 키 %j 는 거절(음이 아닌 정수의 정규 표기만)', (k) => {
    const e = fresh()
    // __proto__ 도 프로토타입 대입이 아니라 자기 키로 넣는다(JSON 본문을 읽은 것과 같다)
    Object.defineProperty(e.steps[0].images.train, k, { value: { literal: 'AA==' }, enumerable: true, configurable: true, writable: true })
    expect(Object.keys(e.steps[0].images.train)).toContain(k)
    try { parseEditedScenario(e) } catch (err) {
      expect(err).toBeInstanceOf(EditedScenarioError)
      expect(err.path).toBe(`steps[0].images.train.${k}`)
      return
    }
    throw new Error('던져야 한다')
  })
  it('JSON 의 "__proto__" 찾을 그림 키도 거절하고 프로토타입을 바꾸지 않는다', () => {
    const json = JSON.stringify(fresh()).replace('"train":{"0":', '"train":{"__proto__":{"literal":"AA=="},"0":')
    const parsed = JSON.parse(json)
    expect(Object.keys(parsed.steps[0].images.train)).toContain('__proto__')
    expect(() => parseEditedScenario(parsed)).toThrow(EditedScenarioError)
    expect(Object.getPrototypeOf(parsed.steps[0].images.train)).toBe(Object.prototype)
  })
  it('다른 판·업로드 그림 참조와 source null·unresolved 를 받는다', () => {
    const e = fresh()
    e.source = null
    e.steps[0].images.train[2] = { from: 'upload', tempId: 't1' }
    e.steps[0].images.base = { from: 'other', process: 'P', model: 'M', name: 'X', crtime: 1, fileId: 'F', id: 's0-bi' }
    e.steps[0].next.onTrue = { kind: 'unresolved', value: 7 }
    e.steps[1].next.onTrue = { kind: 'unresolved' }
    expect(parseEditedScenario(JSON.parse(JSON.stringify(e)))).toEqual(e)
  })
  it('알 수 없는 키는 버리고 새 객체를 돌려준다', () => {
    const e = fresh(); e.extra = 1; e.steps[0].raw = { x: 1 }; e.header.text = 'z'
    const out = parseEditedScenario(e)
    expect(out).not.toBe(e)
    expect(out.extra).toBeUndefined(); expect(out.steps[0].raw).toBeUndefined(); expect(out.header).toEqual({ description: '메일 제목', timeoutLimit: '240' })
    out.steps[0].condition.kind = 'none'
    expect(e.steps[0].condition.kind).toBe('image')
  })
})
