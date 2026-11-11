import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { buildSkeleton, isImage, baseImageId } from '../../domain/skeleton'
import { editedFromSkeleton } from '../../domain/editedScenario'
import { assembleScenario, assembleProperty } from '../../domain/assemble'
import { changedStepUids } from '../../domain/changeDetect'
import { serializeScenario, serializeProperty } from '../../domain/csharpJson'
import { PLACEHOLDER_BI } from '../../domain/csDefaults'
import { propertyFromBson } from '../../domain/propertyModel'
import { checkScenario } from '../../domain/rules'

const require = createRequire(import.meta.url)
const builders = require('../../../../../tools/scenario-gen/lib/builders') // 사내 C# 생성자 기본값 흉내(시험만 tools 를 읽는다)

const clone = (v) => JSON.parse(JSON.stringify(v))
const IMG_A0 = 'iVBORw0KGgoAAAANSUhEUgAA'
const IMG_B0 = 'iVBORw0KGgoBBBBNSUhEUgBB'
const IMG_C0 = 'iVBORw0KGgoCCCCNSUhEUgCC'
const IMG_D3 = 'iVBORw0KGgoDDDDNSUhEUgDD'
const IMG_REF = 'iVBORw0KGgoRRRRNSUhEUgRR'
const BI_A = 'QklfQV9TQ1JFRU5fQQ=='
const BI_B = 'QklfQl9TQ1JFRU5fQg=='
const UPLOADED = { t0: 'iVBORw0KGgoUUUUNSUhEUgU0', t1: 'iVBORw0KGgoUUUUNSUhEUgU1', b0: 'QklfVVBMT0FERURfMA==' }

// 생성기(사내 C# 객체)와 같은 꼴: 찾을 그림 표는 [[정수 키, 항목]]. 저장 본문 = 직렬화 글자를 JSON.parse 한 것(Mongo 에서 읽은 값과 같은 꼴).
const imageStep = (area, train, click, desc, next) => {
  const s = builders.newStep(1, ...area)
  s.Metadata.ImageSearchParam.TrainImageMap = train
  s.Metadata.OcrParamInfo.TextValue = '1-0'
  s.Script = { Type: 1, Value: click, NativeFunction: null }
  return Object.assign(s, { DescriptionToEmail: desc, NextStepIfTrue: next[0], NextStepIfFalse: next[1] })
}
const ocrStep = (train, desc, next) => {
  const s = builders.newStep(2, 366, 111, 450, 60)
  s.Metadata.ImageSearchParam.TrainImageMap = train
  s.Metadata.OcrParamInfo = { Type: 1, Operation: 1, TextValue: 'IDLE@@@@1-0', NumberValue: -218, NumberRangeMin: -218, NumberRangeMax: -218, MinMatchingValue: 10 }
  return Object.assign(s, { DescriptionToEmail: desc, NextStepIfTrue: next[0], NextStepIfFalse: next[1] })
}
const noneStep = (action, desc, next, train = []) => {
  const s = builders.newStep(0, -18, -18, -18, -18)
  s.Metadata.ImageSearchParam.TrainImageMap = train
  s.Script = { Type: action[0], Value: action[1], NativeFunction: null }
  return Object.assign(s, { DescriptionToEmail: desc, NextStepIfTrue: next[0], NextStepIfFalse: next[1] })
}
const scenario = (steps, over = {}) => ({ ...builders.newScenario('P-M-N', '메일 제목'), Step: steps,
  TargetWindowCondition: builders.windowCondition('EQ Control*', 'WindowsForms10'), ...over })

// [A, B, C]: A 성공 → C(2), B 성공 SUCCESS·실패 FAIL, C 는 조건 없음
const SC = scenario([
  imageStep([560, 320, 880, 520], [[0, { BinaryImage: IMG_A0, Type: true }], [1, { BinaryImage: 'AA==', Type: false }]], '24:12', 'A', [2, -1]),
  imageStep([10, 20, 300, 200], [[0, { BinaryImage: IMG_B0, Type: true }]], '5:6', 'B', [10000, -1]),
  noneStep([6, '30000'], 'C', [10000, -1])
])
const TEXT = serializeScenario(SC)
const BI = [BI_A, BI_B, PLACEHOLDER_BI]
const PROP_DOC = clone(builders.newProperty('P-M-N'))

// 서버 열기와 같은 규칙으로 뼈대를 만든다: BI 항목은 그림이면 s{i}-bi, 아니면 literal.
function open(text, biList = [], propertyDoc = PROP_DOC) {
  const present = new Set()
  const literals = new Map()
  const table = new Map()
  biList.forEach((v, i) => { if (isImage(v)) { present.add(i); table.set(baseImageId(i), v) } else literals.set(i, v) })
  const { skeleton, images } = buildSkeleton({ process: 'P', model: 'M', name: 'N', crtime: 1730000000000, isCurrent: true, body: JSON.parse(text),
    baseImages: { parseFailed: false, present, literals, count: biList.length || null }, propertyDoc, performanceDoc: null, imageBaseUrl: '/img' })
  for (const im of images) table.set(im.id, im.base64)
  const calls = []
  const resolveImage = async (ref) => {
    calls.push(ref)
    if (ref.from === 'source' && table.has(ref.id)) return table.get(ref.id)
    if (ref.from === 'upload' && UPLOADED[ref.tempId]) return UPLOADED[ref.tempId]
    throw new Error(`그림 없음 ${JSON.stringify(ref)}`)
  }
  return { skeleton, images, table, resolveImage, calls }
}
const { skeleton: src, resolveImage, table: TABLE } = open(TEXT, BI)

// 뼈대 raw 의 그림 URL 을 base64 로 되돌리고 찾을 그림 표를 직렬화 꼴([[키, 항목]] 오름차순)로
const rawWithImages = (sk, i) => {
  const r = clone(sk.steps[i].raw)
  const map = r.Metadata.ImageSearchParam.TrainImageMap
  r.Metadata.ImageSearchParam.TrainImageMap = Object.keys(map).map(Number).sort((a, b) => a - b)
    .map((k) => [k, { ...map[k], BinaryImage: TABLE.get(`s${i}-train-${k}`) ?? map[k].BinaryImage }])
  return r
}

const newEditedStep = (uid, kind) => ({
  uid, origin: null,
  condition: { kind, operationRaw: 0, skipPreprocessing: false },
  action: { type: 0, typeName: 'None', raw: '' },
  next: { onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } },
  retry: { limit: 2, intervalMs: 2000 },
  descriptionToEmail: '', descriptionToDialog: '', isShowDialog: true,
  images: { train: {}, base: { literal: PLACEHOLDER_BI } }
})
const newImageStep = (uid) => ({
  ...newEditedStep(uid, 'image'),
  condition: { kind: 'image', operationRaw: 1, skipPreprocessing: false, searchArea: { x: 100, y: 200, w: 300, h: 150 },
    image: { accept: 0.85, maxFind: 1, timeoutEnabled: true, timeout: 1000, trainImages: [], multi: { count: '1', op: 0, raw: '1-0' } } },
  action: { type: 1, typeName: 'MouseLeftClick', raw: '', click: { x: 3, y: 4, basis: 'trainImage' } },
  images: { train: { 0: { from: 'upload', tempId: 't0' } }, base: { from: 'upload', tempId: 'b0' } }
})
const rawNone = () => clone(JSON.parse(serializeScenario(scenario([noneStep([0, ''], '끝', [10000, -1])]))).Step[0])
const skeletonWith = (rawSteps, over = {}) => {
  const body = { ...JSON.parse(serializeScenario(scenario([]))), Step: rawSteps, ...over }
  const { skeleton } = buildSkeleton({ process: 'P', model: 'M', name: 'N', crtime: 1, isCurrent: true, body: clone(body),
    baseImages: { parseFailed: false, present: new Set(), literals: new Map(rawSteps.map((_, i) => [i, PLACEHOLDER_BI])), count: rawSteps.length || null },
    propertyDoc: PROP_DOC, performanceDoc: null, imageBaseUrl: '/img' })
  return skeleton
}
const prop = propertyFromBson(PROP_DOC).value

describe('assembleScenario — 고치지 않은 스텝', () => {
  it('아무것도 고치지 않으면 저장 글자와 같다', async () => {
    const r = await assembleScenario(editedFromSkeleton(src), src, { id: 'P-M-N', resolveImage })
    expect(r.bodyString).toBe(TEXT)
    expect(r.changed.size).toBe(0)
  })
  it('고치지 않으면 원래 raw, 번호만 다시 매긴다', async () => {
    const e = editedFromSkeleton(src); e.steps.splice(1, 0, newEditedStep('x', 'none')) // [A,X,B,C]
    const { body, changed } = await assembleScenario(e, src, { id: 'P-M-N', resolveImage })
    expect(body.Step[0].NextStepIfTrue).toBe(3) // A → C 를 따라감
    expect(body.Step[2]).toEqual(rawWithImages(src, 1)) // B 는 원래 raw 그대로(그림 URL 만 base64 로)
    expect(body.Step[2]).toEqual(SC.Step[1])
    expect(body.Step[3]).toEqual(SC.Step[2])
    expect({ ...body.Step[0], NextStepIfTrue: 2 }).toEqual(SC.Step[0])
    expect([...changed]).toEqual(['x'])
  })
  it('옛 본문에서 빠진 키는 C# 기본값으로 채운다', async () => {
    const src2 = skeletonWith([{ ...rawNone(), IsShowDialog: undefined }]) // raw 에 키 없음
    const { body } = await assembleScenario(editedFromSkeleton(src2), src2, { id: 'P-M-N', resolveImage })
    expect(body.Step[0].IsShowDialog).toBe(true)
  })
  it('대상이 없으면 던진다', async () => {
    const e = editedFromSkeleton(src); e.steps[0].next.onTrue = { kind: 'unresolved' }
    await expect(assembleScenario(e, src, { id: 'x', resolveImage })).rejects.toThrow('UNRESOLVED_TARGET')
    const e2 = editedFromSkeleton(src); e2.steps.splice(2, 1) // C 를 지우면 A → C 가 없는 uid
    await expect(assembleScenario(e2, src, { id: 'x', resolveImage })).rejects.toThrow('UNRESOLVED_TARGET')
  })
  it('범위 밖 저장 번호(raw)는 그대로 쓴다 — 막는 것은 검사', async () => {
    const t = serializeScenario(scenario([noneStep([0, ''], 'a', [-2, 9999])]))
    const o = open(t, [PLACEHOLDER_BI])
    const r = await assembleScenario(editedFromSkeleton(o.skeleton), o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect(r.bodyString).toBe(t)
  })
  it('찾을 그림은 편집 스텝의 images.train 참조로만 푼다', async () => {
    const o = open(TEXT, BI)
    await assembleScenario(editedFromSkeleton(o.skeleton), o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect(o.calls).toEqual([{ from: 'source', id: 's0-train-0' }, { from: 'source', id: 's1-train-0' }])
  })
  it('뼈대(source)를 바꾸지 않는다', async () => {
    const before = clone(src)
    await assembleScenario(editedFromSkeleton(src), src, { id: 'P-M-N', resolveImage })
    expect(src).toEqual(before)
  })
  it('오름차순이 아닌 찾을 그림 키는 오름차순으로 나온다(한계)', async () => {
    // 원본 {"1":…,"0":…} → 출력 {"0":…,"1":…}. JS 객체(Mongo 에서 읽은 본문)가 정수 키를 오름차순으로 늘어놓아 저장 순서를 알 수 없다.
    const asc = '"TrainImageMap":{"0":{"BinaryImage":"' + IMG_A0 + '","Type":true},"1":{"BinaryImage":"AA==","Type":false}}'
    const desc = '"TrainImageMap":{"1":{"BinaryImage":"AA==","Type":false},"0":{"BinaryImage":"' + IMG_A0 + '","Type":true}}'
    expect(TEXT).toContain(asc)
    const reversed = TEXT.replace(asc, desc)
    const o = open(reversed, BI)
    const r = await assembleScenario(editedFromSkeleton(o.skeleton), o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect(r.bodyString).not.toBe(reversed)
    expect(r.bodyString).toBe(TEXT)
  })
})

describe('assembleScenario — 이미지가 아닌 조건의 찾을 그림(Task 1 결함 고침)', () => {
  // 사내에서 이미지 스텝을 OCR·조건 없음으로 바꾸면 찾을 그림 표가 남은 채 저장된다.
  const SC2 = scenario([
    ocrStep([[0, { BinaryImage: IMG_C0, Type: true }], [1, { BinaryImage: 'AA==', Type: false }]], 'OCR', [10002, -1]),
    noneStep([6, '1000'], '조건 없음', [10000, -1], [[3, { BinaryImage: IMG_D3, Type: false }]])
  ])
  const TEXT2 = serializeScenario(SC2)
  it('OCR 스텝의 그림 찾을 그림을 열고 다시 조립하면 저장 글자와 같다', async () => {
    const o = open(TEXT2, [BI_A, PLACEHOLDER_BI])
    expect(o.images.map((i) => i.id)).toEqual(['s0-train-0', 's1-train-3'])
    const r = await assembleScenario(editedFromSkeleton(o.skeleton), o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect(r.bodyString).toBe(TEXT2)
  })
  it('고친 OCR 스텝도 찾을 그림 표를 지킨다', async () => {
    const o = open(TEXT2, [BI_A, PLACEHOLDER_BI])
    const e = editedFromSkeleton(o.skeleton); e.steps[0].descriptionToEmail = '고친 OCR'
    const r = await assembleScenario(e, o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect([...r.changed]).toEqual(['s0'])
    expect(r.body.Step[0]).toEqual({ ...SC2.Step[0], DescriptionToEmail: '고친 OCR' })
  })
  it('고친 스텝의 images.train 에서 뺀 정규 키는 쓰지 않는다', async () => {
    const o = open(TEXT2, [BI_A, PLACEHOLDER_BI])
    const e = editedFromSkeleton(o.skeleton); delete e.steps[0].images.train[0]
    const r = await assembleScenario(e, o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect(r.body.Step[0].Metadata.ImageSearchParam.TrainImageMap).toEqual([[1, { BinaryImage: 'AA==', Type: false }]])
  })
})

describe('assembleScenario — 찾을 그림 항목에서 빠진 키(M5)', () => {
  // 저장 본문(JSON 객체)의 찾을 그림 항목에서 키를 뺀다
  const withEntry = (entry) => {
    const body = JSON.parse(serializeScenario(scenario([imageStep([1, 2, 3, 4], [[0, { BinaryImage: IMG_A0, Type: false }]], '1:1', 'a', [10000, -1])])))
    body.Step[0].Metadata.ImageSearchParam.TrainImageMap = { 0: entry }
    return JSON.stringify(body)
  }
  it('Type 이 없는 항목은 고치지 않아도 C# 기본값 true 로 쓴다(직렬화가 던지지 않는다)', async () => {
    const o = open(withEntry({ BinaryImage: IMG_A0 }), [BI_A])
    const r = await assembleScenario(editedFromSkeleton(o.skeleton), o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect(r.changed.size).toBe(0)
    expect(r.bodyString).toContain('"TrainImageMap":{"0":{"BinaryImage":"' + IMG_A0 + '","Type":true}}')
    const e = editedFromSkeleton(o.skeleton); e.steps[0].descriptionToEmail = '고침'
    const r2 = await assembleScenario(e, o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect(r2.body.Step[0].Metadata.ImageSearchParam.TrainImageMap).toEqual([[0, { BinaryImage: IMG_A0, Type: true }]])
  })
  it('BinaryImage 가 없는 항목은 null 이 아니라 C# 기본값(자리표시)으로 쓴다', async () => {
    const o = open(withEntry({ Type: false }), [BI_A])
    const r = await assembleScenario(editedFromSkeleton(o.skeleton), o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect(r.bodyString).toContain('"TrainImageMap":{"0":{"BinaryImage":"' + PLACEHOLDER_BI + '","Type":false}}')
    const e = editedFromSkeleton(o.skeleton); e.steps[0].descriptionToEmail = '고침'
    const r2 = await assembleScenario(e, o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect(r2.body.Step[0].Metadata.ImageSearchParam.TrainImageMap).toEqual([[0, { BinaryImage: PLACEHOLDER_BI, Type: false }]])
  })
  it('저장값이 null 인 BinaryImage 는 null 그대로', async () => {
    const o = open(withEntry({ BinaryImage: null, Type: true }), [BI_A])
    const r = await assembleScenario(editedFromSkeleton(o.skeleton), o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect(r.bodyString).toContain('"TrainImageMap":{"0":{"BinaryImage":null,"Type":true}}')
  })
})

describe('assembleScenario — 정규 표기가 아닌 찾을 그림 키', () => {
  it('"-1" 키 그림은 raw 의 저장값으로 다시 쓴다', async () => {
    const t = serializeScenario(scenario([imageStep([1, 2, 3, 4], [[-1, { BinaryImage: IMG_B0, Type: false }], [0, { BinaryImage: IMG_A0, Type: true }]], '1:1', 'a', [10000, -1])]))
    const o = open(t, [BI_A])
    expect(o.images.map((i) => i.id)).toEqual(['s0-train-0'])
    const r = await assembleScenario(editedFromSkeleton(o.skeleton), o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect(r.bodyString).toBe(t)
  })
  it('정수가 아닌 키는 사전으로 쓸 수 없어 던진다(한계 — C# Dictionary<int,…> 가 가질 수 없는 키라 사내도 열지 못한다)', async () => {
    const good = '"TrainImageMap":{"0":{"BinaryImage":"' + IMG_A0 + '","Type":true}}'
    const t = serializeScenario(scenario([imageStep([1, 2, 3, 4], [[0, { BinaryImage: IMG_A0, Type: true }]], '1:1', 'a', [10000, -1])]))
    const bad = t.replace(good, good.slice(0, -1) + ',"abc":{"BinaryImage":"AA==","Type":true}}')
    expect(bad).not.toBe(t)
    const o = open(bad, [BI_A])
    await expect(assembleScenario(editedFromSkeleton(o.skeleton), o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })).rejects.toThrow(/정수 키/)
  })
})

describe('assembleScenario — 고친 스텝', () => {
  it('새 조건 없음 스텝 기본값과 BI 자리표시', async () => {
    const e = editedFromSkeleton(src); e.steps.push(newEditedStep('n', 'none'))
    const r = await assembleScenario(e, src, { id: 'P-M-N', resolveImage })
    expect(r.body.Step.at(-1)).toMatchObject({ Operation: 0, NextStepIfFalse: -1, RetryLimit: 2, RetryInterval: 2000 })
    expect(r.biEntries.at(-1)).toEqual({ kind: 'literal', value: 'AA==' })
    expect(r.body.Step.at(-1)).toEqual(builders.newStep(0, -18, -18, -18, -18)) // 사내 addScenarioStep 과 같은 값
  })
  it('새 이미지 스텝: 올린 찾을 그림·검색 영역·누를 곳', async () => {
    const e = editedFromSkeleton(src); e.steps.push(newImageStep('m'))
    const r = await assembleScenario(e, src, { id: 'P-M-N', resolveImage })
    const want = builders.newStep(1, 100, 200, 300, 150)
    want.Metadata.ImageSearchParam.TrainImageMap = [[0, { BinaryImage: UPLOADED.t0, Type: true }]]
    want.Metadata.ImageSearchParam.AcceptThreshold = 0.85
    want.Metadata.OcrParamInfo.TextValue = '1-0'
    want.Script = { Type: 1, Value: '3:4', NativeFunction: null }
    expect(r.body.Step.at(-1)).toEqual(want)
    expect(r.biEntries.at(-1)).toEqual({ kind: 'image', ref: { from: 'upload', tempId: 'b0' } })
  })
  it('고친 칸 말고는 저장값과 같고, 찾을 그림 Type 은 바탕 값을 지킨다', async () => {
    const e = editedFromSkeleton(src)
    Object.assign(e.steps[0], { descriptionToEmail: '고친 A', descriptionToDialog: '창', isShowDialog: false, retry: { limit: 5, intervalMs: 3000 } })
    const r = await assembleScenario(e, src, { id: 'P-M-N', resolveImage })
    expect([...r.changed]).toEqual(['s0'])
    expect(r.body.Step[0]).toEqual({ ...SC.Step[0], DescriptionToEmail: '고친 A', DescriptionToDialog: '창', IsShowDialog: false, RetryLimit: 5, RetryInterval: 3000 })
  })
  it('찾을 그림을 더하면 키 오름차순, 새 키의 Type 은 true', async () => {
    const e = editedFromSkeleton(src)
    e.steps[0].images.train[2] = { from: 'upload', tempId: 't1' }
    e.steps[0].next.onTrue = { kind: 'step', uid: 's1' }
    const r = await assembleScenario(e, src, { id: 'P-M-N', resolveImage })
    expect(r.body.Step[0].Metadata.ImageSearchParam.TrainImageMap).toEqual([
      [0, { BinaryImage: IMG_A0, Type: true }], [1, { BinaryImage: 'AA==', Type: false }], [2, { BinaryImage: UPLOADED.t1, Type: true }]])
    expect(r.body.Step[0].NextStepIfTrue).toBe(1)
  })
  it('바꾼 조건·동작을 저장 형식으로 쓴다', async () => {
    const e = editedFromSkeleton(src)
    e.steps[2].action = { type: 6, typeName: 'Wait', raw: '30000', waitSec: 4.35 }
    const r = await assembleScenario(e, src, { id: 'P-M-N', resolveImage })
    expect(r.body.Step[2]).toEqual({ ...SC.Step[2], Script: { Type: 6, Value: '4350', NativeFunction: null } })
  })
})

describe('assembleScenario — 동작 종류를 바꾼 스텝(R-T6d)', () => {
  it('대기 스텝을 메일 보내기로 바꾸면 저장 값은 빈 값(옛 대기 값을 옮기지 않는다)', async () => {
    const e = editedFromSkeleton(src)
    e.steps[2].action = { type: 10, typeName: 'SendEmail' }
    const r = await assembleScenario(e, src, { id: 'P-M-N', resolveImage })
    expect(r.body.Step[2].Script).toEqual({ Type: 10, Value: '', NativeFunction: null })
  })
})

describe('assembleScenario — 옛 본문에서 빠진 키를 가진 스텝을 고칠 때(C1)', () => {
  const ctx = () => ({ user: { authorityManager: 0 }, target: { model: 'M', name: 'N' }, targetNames: new Set(), followGraph: new Map(), limits: {} })
  it('IsShowDialog·RetryLimit·RetryInterval 이 없는 스텝의 설명만 고치면 막힘 없이 C# 기본값(true·2·2000)을 쓴다', async () => {
    const raw = rawNone(); delete raw.IsShowDialog; delete raw.RetryLimit; delete raw.RetryInterval
    const src2 = skeletonWith([raw])
    const e = editedFromSkeleton(src2); e.steps[0].descriptionToEmail = '고친 설명'
    expect(checkScenario(e, src2, ctx()).blocks).toEqual([])
    const r = await assembleScenario(e, src2, { id: 'P-M-N', resolveImage })
    expect([...r.changed]).toEqual(['s0'])
    expect(r.body.Step[0]).toMatchObject({ IsShowDialog: true, RetryLimit: 2, RetryInterval: 2000, DescriptionToEmail: '고친 설명' })
    expect(r.bodyString).toContain('"RetryInterval":2000,"RetryLimit":2,')
    expect(r.bodyString).toContain('"IsShowDialog":true}')
    expect(r.bodyString).not.toContain('null}]')
  })
  it('저장값이 null 인 키는 고쳐도 null 그대로(저장값에 충실)', async () => {
    const src2 = skeletonWith([{ ...rawNone(), IsShowDialog: null }])
    const e = editedFromSkeleton(src2); e.steps[0].descriptionToEmail = '고친 설명'
    expect(e.steps[0].isShowDialog).toBeNull()
    const r = await assembleScenario(e, src2, { id: 'P-M-N', resolveImage })
    expect(r.body.Step[0].IsShowDialog).toBeNull()
  })
  it('조립은 참거짓이 아닌 IsShowDialog·숫자가 아닌 재시도 값을 바탕(저장값) 값으로 쓴다', async () => {
    const e = editedFromSkeleton(src)
    Object.assign(e.steps[2], { isShowDialog: null, retry: { limit: null, intervalMs: NaN }, descriptionToEmail: '고친 C' })
    const r = await assembleScenario(e, src, { id: 'P-M-N', resolveImage })
    expect(r.body.Step[2]).toEqual({ ...SC.Step[2], DescriptionToEmail: '고친 C' })
  })
})

describe('assembleScenario — 그대로 두는 조건(설비 상태·알 수 없음)을 가진 스텝을 고칠 때(I2)', () => {
  const eqpRaw = () => { const s = rawNone(); s.Operation = 4; s.Metadata.ConditionExpression = 'MAIN,IDLE,_'; return s }
  // 저장값(JSON 객체)과 같되 찾을 그림 표는 직렬화 꼴([[키, 항목]])로
  const asBody = (raw, over) => { const w = { ...clone(raw), ...over }; w.Metadata.ImageSearchParam.TrainImageMap = []; return w }
  it('설비 상태 스텝의 설명만 고치면 Operation·Metadata 는 저장값 — 브라우저가 바꾼 operationRaw 는 쓰지 않는다', async () => {
    const src2 = skeletonWith([eqpRaw()])
    const e = editedFromSkeleton(src2); e.steps[0].descriptionToEmail = '고친 설명'; e.steps[0].condition.operationRaw = 1
    const r = await assembleScenario(e, src2, { id: 'P-M-N', resolveImage })
    expect(r.body.Step[0]).toEqual(asBody(eqpRaw(), { DescriptionToEmail: '고친 설명' }))
  })
  it('알 수 없는 조건(Operation 3) 스텝도 저장된 Operation 을 쓴다', async () => {
    const raw = { ...rawNone(), Operation: 3 }
    const src2 = skeletonWith([raw])
    const e = editedFromSkeleton(src2); e.steps[0].descriptionToEmail = '고친 설명'; e.steps[0].condition.operationRaw = 9
    const r = await assembleScenario(e, src2, { id: 'P-M-N', resolveImage })
    expect(r.body.Step[0]).toEqual(asBody(raw, { DescriptionToEmail: '고친 설명' }))
  })
})

describe('assembleScenario — 키보드 코드 순서(I3)', () => {
  it('모르는 코드·아는 코드가 섞인 키보드 스텝의 설명만 고쳐도 누르는 순서가 그대로다', async () => {
    const raw = { ...rawNone(), Script: { Type: 5, Value: 'x@@17@@10', NativeFunction: null } }
    const src2 = skeletonWith([raw])
    const e = editedFromSkeleton(src2); e.steps[0].descriptionToEmail = '고친 설명'
    const r = await assembleScenario(e, src2, { id: 'P-M-N', resolveImage })
    expect([...r.changed]).toEqual(['s0'])
    expect(r.body.Step[0].Script).toEqual({ Type: 5, Value: 'x@@17@@10', NativeFunction: null })
  })
})

describe('assembleScenario — 형식 검사를 건너뛴 찾을 그림 키', () => {
  it.each(['01', '-1', '1.0'])('images.train 키 %j 는 BAD_TRAIN_KEY(검사가 먼저 막으므로 프로그램 오류)', async (k) => {
    const e = editedFromSkeleton(src)
    e.steps[0].images.train[k] = { literal: 'AA==' } // parseEditedScenario 를 거치지 않은 값
    await expect(assembleScenario(e, src, { id: 'P-M-N', resolveImage })).rejects.toThrow('BAD_TRAIN_KEY')
  })
  it('"1" 과 "01" 이 함께 있어도 같은 키를 두 번 쓰지 않고 던진다', async () => {
    const e = editedFromSkeleton(src)
    e.steps[0].images.train['01'] = { from: 'upload', tempId: 't1' }
    await expect(assembleScenario(e, src, { id: 'P-M-N', resolveImage })).rejects.toThrow('BAD_TRAIN_KEY')
  })
})

describe('assembleScenario — 머리', () => {
  it('저장된 머리 값(개정 번호·트리거·글·숨길 창·보정 그림)을 그대로 쓴다', async () => {
    const t = serializeScenario(scenario([noneStep([0, ''], '끝', [10000, -1])], {
      RevisionNo: 3, TriggerType: 1, Text: '글', TimeoutLimit: 600,
      HidingWindowConditionList: [builders.windowCondition('Popup', 'Dlg')], Compensation: { RefImage: IMG_REF, X: 7, Y: -3 }
    }))
    const o = open(t, [PLACEHOLDER_BI])
    const r = await assembleScenario(editedFromSkeleton(o.skeleton), o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect(r.bodyString).toBe(t)
    expect(o.calls).toContainEqual({ from: 'source', id: 'ref' })
  })
  it('숨길 창 목록이 null 이면 null 그대로, 없던 키는 C# 기본값 [] (M4)', async () => {
    const t = serializeScenario(scenario([noneStep([0, ''], '끝', [10000, -1])], { HidingWindowConditionList: null }))
    expect(t).toContain('"HidingWindowConditionList":null')
    const o = open(t, [PLACEHOLDER_BI])
    const r = await assembleScenario(editedFromSkeleton(o.skeleton), o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect(r.bodyString).toBe(t)
    const e = editedFromSkeleton(o.skeleton); e.steps[0].descriptionToEmail = '고침'; e.header.description = '새 제목'
    expect((await assembleScenario(e, o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })).body.HidingWindowConditionList).toBeNull()
    const noKey = skeletonWith([rawNone()], { HidingWindowConditionList: undefined })
    expect((await assembleScenario(editedFromSkeleton(noKey), noKey, { id: 'P-M-N', resolveImage })).body.HidingWindowConditionList).toEqual([])
  })
  it('보정 그림이 자리표시면 저장값 그대로', async () => {
    const t = serializeScenario(scenario([noneStep([0, ''], '끝', [10000, -1])], { Compensation: { RefImage: 'AA==', X: 1, Y: 2 } }))
    const o = open(t, [PLACEHOLDER_BI])
    const r = await assembleScenario(editedFromSkeleton(o.skeleton), o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
    expect(r.bodyString).toBe(t)
  })
  it('ID·설명·제한 시간은 편집 값, 없던 대상 창은 C# 기본값', async () => {
    const src2 = skeletonWith([rawNone()], { TargetWindowCondition: undefined })
    expect('TargetWindowCondition' in src2.header.raw).toBe(false)
    const e = editedFromSkeleton(src2); e.header = { description: '새 제목', timeoutLimit: '300' }
    const { body } = await assembleScenario(e, src2, { id: 'Q-R-S', resolveImage })
    expect(body).toMatchObject({ ID: 'Q-R-S', Description: '새 제목', TimeoutLimit: 300 })
    expect(body.TargetWindowCondition).toEqual(builders.windowCondition(null, null))
  })
  it('제한 시간이 빈 값이면 0 으로 쓰지 않고 던진다(검사 TIMEOUT_INVALID 가 먼저 막는다)', async () => {
    const e = editedFromSkeleton(src); e.header.timeoutLimit = ''
    await expect(assembleScenario(e, src, { id: 'P-M-N', resolveImage })).rejects.toThrow(/TimeoutLimit/)
  })
  it('새 시나리오(source 없음)는 사내 새 시나리오 기본값', async () => {
    const e = { source: null, headCrtime: null, header: { description: '메일 제목', timeoutLimit: '240' }, steps: [newEditedStep('a', 'none'), newImageStep('b')], property: {} }
    e.steps[0].next.onTrue = { kind: 'step', uid: 'b' }
    const r = await assembleScenario(e, null, { id: 'P-M-N', resolveImage })
    const { Step, ...head } = r.body
    const { Step: _s, ...want } = builders.newScenario('P-M-N', '메일 제목')
    expect(head).toEqual(want)
    expect(Step[0]).toEqual({ ...builders.newStep(0, -18, -18, -18, -18), NextStepIfTrue: 1 })
    expect([...r.changed]).toEqual(['a', 'b'])
  })
})

describe('assembleScenario — BI 항목·고친 스텝', () => {
  it('images.base 를 BI 항목으로: 그림 참조는 image, 그 밖은 literal', async () => {
    const r = await assembleScenario(editedFromSkeleton(src), src, { id: 'P-M-N', resolveImage })
    expect(r.biEntries).toEqual([
      { kind: 'image', ref: { from: 'source', id: 's0-bi' } }, { kind: 'image', ref: { from: 'source', id: 's1-bi' } }, { kind: 'literal', value: 'AA==' }])
  })
  it('images.base 가 null 이면 프로그램 오류(검사 BI_COUNT_MISMATCH 가 먼저 막는다)', async () => {
    const e = editedFromSkeleton(src); e.steps[1].images.base = null
    await expect(assembleScenario(e, src, { id: 'P-M-N', resolveImage })).rejects.toThrow('BI_ENTRY_MISSING')
  })
  it('changed = changedStepUids', async () => {
    const e = editedFromSkeleton(src); e.steps[1].descriptionToEmail = 'x'; e.steps.push(newEditedStep('n', 'none'))
    const r = await assembleScenario(e, src, { id: 'P-M-N', resolveImage })
    expect(r.changed).toEqual(changedStepUids(e, src))
    expect([...r.changed]).toEqual(['s1', 'n'])
  })
})

describe('assembleProperty', () => {
  it('생성기 property 와 같은 글자', () => {
    expect(assembleProperty(prop, { id: 'P-M-N' })).toBe(serializeProperty(builders.newProperty('P-M-N')))
  })
  it('후속 설명 null 은 빈 문자열로', () => {
    expect(assembleProperty({ ...prop, NextScenarioIfFail: { Name: 'B', Text: null } }, { id: 'P-M-N' })).toContain('"NextScenarioIfFail":{"Name":"B","Text":""}')
  })
  it('null 후속은 뺀다', () => {
    const s = assembleProperty({ ...prop, NextScenarioIfSuccess: null, NextScenarioIfFail: { Name: 'B', Text: '실패 때' } }, { id: 'P-M-N' })
    expect(s).not.toContain('NextScenarioIfSuccess')
    expect(s).toContain('"NextScenarioIfFail":{"Name":"B","Text":"실패 때"}')
  })
  it('ID 는 받은 id, Owners·LcncType 은 받은 값 그대로, 빠진 키는 C# 기본값', () => {
    const { Priority, ...noPriority } = prop
    const s = assembleProperty({ ...noPriority, ID: 'OLD', Owners: ['a@1', 'b@2'], LcncType: 3 }, { id: 'Q-R-S' })
    const o = JSON.parse(s)
    expect(o).toMatchObject({ ID: 'Q-R-S', Owners: ['a@1', 'b@2'], LcncType: 3, Priority: 10 })
  })
  it('입력을 바꾸지 않는다', () => {
    const p = { ...prop, NextScenarioIfFail: { Name: 'B', Text: null } }
    const before = clone(p)
    assembleProperty(p, { id: 'P-M-N' })
    expect(p).toEqual(before)
  })
})

// P2-F 전처리 설정(설계 §5): 고치지 않으면 글자까지 같고, 고친 조건만 새로 쓴다.
describe('assembleScenario — 창 조건(header.windows)', () => {
  const W = builders.windowCondition
  const end = () => noneStep([0, ''], '끝', [10000, -1])
  const win = (text, className, over = {}) => ({ text, className, checkRect: false, left: 0, top: 0, right: 0, bottom: 0, ...over })
  const HIDE = [W('화면 보호기', 'Saver'), { ...W('', 'Dlg'), IsCheckRectEqual: true, Left: 100, Top: 100, Right: 500, Bottom: 400 }, { ...W(' Popup* ', 'X'), Left: -18, Top: -18, Right: -18, Bottom: -18 }]
  const openWith = (over) => { const t = serializeScenario(scenario([end()], over)); return { t, ...open(t, [PLACEHOLDER_BI]) } }
  const run = async (o, change) => {
    const e = editedFromSkeleton(o.skeleton)
    if (change) change(e.header.windows, e)
    return assembleScenario(e, o.skeleton, { id: 'P-M-N', resolveImage: o.resolveImage })
  }

  it('고치지 않으면 글자까지 같다 — 숨길 창 여러 개·앞뒤 공백·위치 값 포함', async () => {
    const o = openWith({ HidingWindowConditionList: HIDE })
    expect((await run(o)).bodyString).toBe(o.t)
  })
  it('대상 창이 null/null, 숨길 창 목록이 null 이어도 고치지 않으면 글자까지 같다', async () => {
    const o = openWith({ TargetWindowCondition: W(null, null), HidingWindowConditionList: null })
    expect(o.t).toContain('"TargetWindowCondition":{"Text":null,"ClassName":null')
    expect((await run(o)).bodyString).toBe(o.t)
  })
  it('대상 창만 고치면 대상 창만 새로 쓴다(빈 칸은 ""), 숨길 창은 저장값 그대로', async () => {
    const o = openWith({ TargetWindowCondition: W(null, null), HidingWindowConditionList: HIDE })
    const r = await run(o, (w) => { w.target = win('EQ Main*', '') })
    expect(r.body.TargetWindowCondition).toEqual(W('EQ Main*', ''))
    expect(r.body.HidingWindowConditionList).toEqual(HIDE)
    expect(r.bodyString).toBe(serializeScenario(scenario([end()], { TargetWindowCondition: W('EQ Main*', ''), HidingWindowConditionList: HIDE })))
  })
  it('숨길 창: 한 줄 고침·한 줄 지움·한 줄 더함 — 그 줄만 새로, 나머지는 저장값, 순서는 편집 값', async () => {
    const o = openWith({ HidingWindowConditionList: HIDE })
    const r = await run(o, (w) => {
      w.hiding = [w.hiding[2], { ...w.hiding[0], className: 'Saver2' }, { origin: null, ...win('', 'NotifyWnd', { checkRect: true, left: 0, top: 0, right: 800, bottom: 600 }) }]
    })
    expect(r.body.HidingWindowConditionList).toEqual([
      HIDE[2], W('화면 보호기', 'Saver2'), { ...W('', 'NotifyWnd'), IsCheckRectEqual: true, Left: 0, Top: 0, Right: 800, Bottom: 600 }
    ])
  })
  it('고쳤다가 원래 값으로 되돌리면 글자까지 같다', async () => {
    const o = openWith({ TargetWindowCondition: W(null, null), HidingWindowConditionList: HIDE })
    const r = await run(o, (w) => { w.target = { ...w.target, text: '' }; w.hiding = w.hiding.map((h) => ({ ...h })) })
    expect(r.bodyString).toBe(o.t)
  })
  it('숨길 창을 모두 지우면 [] — 저장값이 null 이어도 새 줄을 넣으면 배열로 쓴다', async () => {
    const o = openWith({ HidingWindowConditionList: HIDE })
    expect((await run(o, (w) => { w.hiding = [] })).body.HidingWindowConditionList).toEqual([])
    const n = openWith({ HidingWindowConditionList: null })
    expect((await run(n, (w) => { w.hiding = [{ origin: null, ...win('a', 'A') }] })).body.HidingWindowConditionList).toEqual([W('a', 'A')])
  })
  it('windows 가 없으면(옛 초안) 지금까지처럼 출처 저장값 그대로', async () => {
    const o = openWith({ TargetWindowCondition: W(null, null), HidingWindowConditionList: HIDE })
    const r = await run(o, (_, e) => { delete e.header.windows; e.header.description = '새 제목' })
    expect(r.body.TargetWindowCondition).toEqual(W(null, null))
    expect(r.body.HidingWindowConditionList).toEqual(HIDE)
  })
  it('새 시나리오(출처 없음): windows 가 비면 사내 새 시나리오 값(null·[]), 넣었으면 그 값', async () => {
    const e = editedFromSkeleton(skeletonWith([rawNone()]))
    e.source = null
    e.steps = e.steps.map((s) => ({ ...s, origin: null }))
    e.header.windows = { target: win('', ''), hiding: [] }
    const a = await assembleScenario(e, null, { id: 'P-M-NEW', resolveImage })
    expect(a.body.TargetWindowCondition).toEqual(W(null, null))
    expect(a.body.HidingWindowConditionList).toEqual([])
    e.header.windows = { target: win('EQ', 'Main'), hiding: [{ origin: null, ...win('', 'Dlg') }] }
    const b = await assembleScenario(e, null, { id: 'P-M-NEW', resolveImage })
    expect(b.body.TargetWindowCondition).toEqual(W('EQ', 'Main'))
    expect(b.body.HidingWindowConditionList).toEqual([W('', 'Dlg')])
    delete e.header.windows
    const c = await assembleScenario(e, null, { id: 'P-M-NEW', resolveImage })
    expect(c.body.TargetWindowCondition).toEqual(W(null, null))
  })
})

