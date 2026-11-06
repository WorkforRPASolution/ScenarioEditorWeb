import { describe, it, expect } from 'vitest'
import { buildSkeleton } from '../../domain/skeleton'
import { editedFromSkeleton } from '../../domain/editedScenario'
import { changedStepUids, changedPropertyKeys } from '../../domain/changeDetect'

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
const src = skeleton
const fresh = () => editedFromSkeleton(src, { fileId: 'F1' })
const newStep = (uid) => ({
  uid, origin: null, condition: { kind: 'none' }, action: { type: 0 },
  next: { onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } },
  retry: { limit: 0, intervalMs: 0 }, descriptionToEmail: '', descriptionToDialog: '', isShowDialog: true,
  images: { train: {}, base: null }
})

describe('changedStepUids', () => {
  it('그대로면 고친 스텝 없음', () => { expect(changedStepUids(fresh(), src).size).toBe(0) })
  it('키 순서가 달라도 같은 값이면 고치지 않은 것', () => {
    const e = fresh()
    const c = e.steps[0].condition
    e.steps[0].condition = Object.fromEntries(Object.entries(c).reverse())
    expect(changedStepUids(e, src).size).toBe(0)
  })
  it('앞에 스텝을 넣어 번호만 바뀐 스텝은 고치지 않은 것', () => {
    const e = fresh()
    e.steps[0].next.onTrue = { kind: 'step', uid: e.steps[2].uid }
    const base = changedStepUids(e, src) // 원본 대상이 스텝이 아니라 바꾼 것이므로 s0 만 고친 것
    expect([...base]).toEqual(['s0'])
    const src2 = { ...src, steps: src.steps.map((s, i) => (i === 0 ? { ...s, next: { ...s.next, onTrue: { kind: 'step', uid: src.steps[2].uid, no: 2 } } } : s)) }
    const e2 = editedFromSkeleton(src2)
    e2.steps.splice(1, 0, newStep('x'))
    expect([...changedStepUids(e2, src2)]).toEqual(['x'])
  })
  it('대상을 다른 스텝으로 바꾸면 고친 것', () => {
    const e = fresh(); e.steps[0].next.onTrue = { kind: 'step', uid: e.steps[1].uid }
    expect(changedStepUids(e, src).has('s0')).toBe(true)
  })
  it('새 스텝을 가리키게 바꾸면 고친 것', () => {
    const e = fresh(); e.steps.push(newStep('x')); e.steps[0].next.onFalse = { kind: 'step', uid: 'x' }
    expect([...changedStepUids(e, src)].sort()).toEqual(['s0', 'x'])
  })
  it('없는 스텝을 가리키면 고친 것', () => {
    const e = fresh(); e.steps[0].next.onTrue = { kind: 'step', uid: 'nope' }
    expect(changedStepUids(e, src).has('s0')).toBe(true)
  })
  it('정확도만 바꿔도 고친 것', () => {
    const e = fresh(); e.steps[0].condition.image.accept = 0.8
    expect(changedStepUids(e, src).has('s0')).toBe(true)
  })
  it('재시도·설명·대화상자·그림 참조', () => {
    const e = fresh()
    e.steps[0].retry.limit = 9
    e.steps[1].descriptionToEmail = '다름'
    e.steps[2].isShowDialog = false
    expect([...changedStepUids(e, src)].sort()).toEqual(['s0', 's1', 's2'])
    const f = fresh(); f.steps[0].images.base = { literal: 'AA==' }
    expect([...changedStepUids(f, src)]).toEqual(['s0'])
  })
  it('origin 이 범위 밖이거나 겹치면 고친 것(브라우저가 보내선 안 되는 값은 안전한 쪽)', () => {
    const e = fresh(); e.steps[0].origin = 99
    expect(changedStepUids(e, src).has('s0')).toBe(true)
    const d = fresh(); d.steps[1].origin = 0
    expect([...changedStepUids(d, src)]).toEqual(['s1'])
  })
  it('origin 이 null 이면 고친 것, source 가 null 이면 모두 고친 것', () => {
    const e = fresh(); e.steps.push(newStep('x'))
    expect([...changedStepUids(e, src)]).toEqual(['x'])
    expect([...changedStepUids(fresh(), null)].sort()).toEqual(['s0', 's1', 's2'])
  })
})

describe('changedPropertyKeys', () => {
  it('운영 속성 키, Owners 는 뺀다', () => {
    const e = fresh(); e.property.StartDelay = 30; e.property.Owners = ['x@2026-11-06 10:00:00']
    expect([...changedPropertyKeys(e.property, src.property)]).toEqual(['StartDelay'])
  })
  it('사라진 키·객체 키 순서', () => {
    expect([...changedPropertyKeys({ A: { x: 1, y: 2 } }, { A: { y: 2, x: 1 }, B: 1 })]).toEqual(['B'])
  })
  it('source 가 null 이면 모든 키(Owners 제외)', () => {
    expect([...changedPropertyKeys({ A: 1, Owners: [] }, null)]).toEqual(['A'])
  })
})
