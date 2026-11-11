import { buildSkeleton } from '../../../domain/skeleton'
import { editedFromSkeleton } from '../../../domain/editedScenario'

export const SUCCESS = 10000
export const FAIL = -1
export const NEXT = 10002
const LONG_B64 = 'iVBORw0KGgoAAAANSUhEUg=='

const md = (op, train = {}, ocr = {}, accept = 0.9) => ({
  SearchArea: op === 0 ? { X: -18, Y: -18, Width: -18, Height: -18 } : { X: 10, Y: 20, Width: 300, Height: 200 },
  ImageSearchParam: { TrainImageMap: train, AcceptThreshold: accept, MaximumNumberToFind: 1, TimeoutEnabled: true, Timeout: 1000 },
  ConditionExpression: '',
  OcrParamInfo: { Type: 1, Operation: 1, TextValue: op === 2 ? 'IDLE@@@@1-0' : '1-0', NumberValue: -218, NumberRangeMin: -218, NumberRangeMax: -218, MinMatchingValue: 5, ...ocr }
})

// kind: none | image | ocr. next = [true쪽, false쪽] 저장 번호. action = [종류, 값].
export function rawStep({ kind = 'none', action = [0, ''], next = [NEXT, FAIL], desc = '설명', retry = [2, 2000], ocr, accept } = {}) {
  const op = { none: 0, image: 1, ocr: 2 }[kind]
  const train = kind === 'image' ? { 0: { BinaryImage: LONG_B64, Type: true } } : {}
  return {
    Operation: op, Metadata: md(op, train, kind === 'ocr' ? ocr : {}, accept), Script: { Type: action[0], Value: action[1], NativeFunction: null },
    RetryInterval: retry[1], RetryLimit: retry[0], NextStepIfTrue: next[0], NextStepIfFalse: next[1],
    DescriptionToEmail: desc, DescriptionToDialog: '', IsShowDialog: true
  }
}

// literals: 스텝 번호 → 그림으로 보지 않은 BI 저장값(정규가 아닌 base64 등, 판정 R5)
// extra: 본문 머리에 더할 키(대상 창·숨길 창 등)
export function skeletonWith(rawSteps, { property = { Priority: 10, Type: 1 }, description = '메일 제목', timeout = 240, biCount, noBase = [], literals = new Map(), extra = {} } = {}) {
  const present = new Set(rawSteps.map((s, i) => i).filter((i) => !noBase.includes(i) && !literals.has(i))) // 사내는 스텝마다 BI 한 칸
  const { skeleton } = buildSkeleton({
    process: 'P', model: 'M', name: 'N', crtime: 1730000000000, isCurrent: true,
    body: { RevisionNo: 0, TriggerType: 2, ID: 'P-M-N', Text: '', Description: description, Step: rawSteps, TimeoutLimit: timeout, ...extra },
    propertyDoc: property, performanceDoc: {}, imageBaseUrl: '/img',
    baseImages: { parseFailed: false, present, literals, count: biCount ?? rawSteps.length }
  })
  return skeleton
}

export const ctx = () => ({
  user: { authorityManager: 0 }, target: { model: 'M', name: 'N' }, targetNames: new Set(), followGraph: new Map(),
  limits: { bodyMax: 15 * 1024 * 1024, requestMax: 100 * 1024 * 1024 }
})
export const codesOf = (list) => list.map((i) => i.code)
export const fresh = (src) => editedFromSkeleton(src, { fileId: 'F' })
export const okSteps = () => [rawStep({ next: [1, FAIL] }), rawStep({ next: [SUCCESS, FAIL] })]
export const okSource = () => skeletonWith(okSteps())
// 새 스텝(기준 없음 = 늘 고친 것)
export const newStep = (uid, over = {}) => ({
  uid, origin: null, condition: { kind: 'none', skipPreprocessing: false }, action: { type: 0, raw: '' },
  next: { onTrue: { kind: 'end', value: 'SUCCESS' }, onFalse: { kind: 'end', value: 'FAIL' } },
  retry: { limit: 2, intervalMs: 2000 }, descriptionToEmail: '설명', descriptionToDialog: '', isShowDialog: true,
  images: { train: {}, base: { from: 'source', id: 's0-bi' } }, ...over
})
