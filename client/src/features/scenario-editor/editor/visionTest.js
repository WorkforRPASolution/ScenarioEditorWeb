// Vision·OCR 시험의 화면 규칙 (P4 설계 §4) — 순수 함수. 시험은 스텝·초안을 바꾸지 않는다.
// - testInputOf*: 시험 줄이 보는 스텝(패널 초안 또는 읽기 전용의 표시 스텝)에서 시험에 쓸 값을 꺼낸다. 이미지·OCR 스텝만(나머지는 null).
//   기존 spotInputOf*(trainView)는 마우스 클릭 스텝만 주지만 시험은 동작이 없는 스텝도 한다.
// - 좌표: 서버는 "보낸 조각 안에서 찾은 곳의 왼쪽 위" 를 소수째 준다. 화면이 소수를 버리고 **실제로 자른 조각의 왼쪽 위**를 더한다
//   (검색 영역이 시험할 화면 밖으로 나가면 조각은 영역보다 작다 — 영역 X·Y 를 더하면 어긋난다).
// - 시험 입력 키(testKey)가 달라지면 결과를 지우고, 값(valueKey)만 달라지면 "값이 바뀌었습니다" 로 흐리게 한다(설계 §4.5).
import { refUrl } from './images'
import { imageSrc } from './display'
import { isRect, isRef, firstTrainRef } from './capture'
import { CLICK_TYPES } from './panel'
import { clampRect } from './crop'
import { sameStep } from './diff'

const TEXT_OPS = [1, 2, 3, 4]
const RANGE_OPS = [7, 8]
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const areaOf = (a) => (isRect(a) ? { x: a.x, y: a.y, w: a.w, h: a.h } : null)
const acceptIn = (v) => (isNum(v) && v >= 0 && v <= 1 ? v : null)

// 저장 형식의 다중 검사 { count: '2', op: 1 } → { count: 2, op: 1 }. 읽을 수 없으면 null. min = 개수 하한(이미지 1, OCR 0)
function multiOf(multi, min) {
  if (!multi || typeof multi.count !== 'string' || !/^\d+$/.test(multi.count)) return null
  const count = Number(multi.count)
  return count >= min && count <= 20 && [0, 1, 2].includes(multi.op) ? { count, op: multi.op } : null
}
function clickOfAction(action) {
  const c = action?.click
  return CLICK_TYPES.includes(action?.type) && c?.basis === 'trainImage' && Number.isInteger(c.x) && Number.isInteger(c.y) ? { x: c.x, y: c.y } : null
}
// withSuffix: 다중 검사 접미사를 붙여 보낼 것인가(배포될 값과 같게 — 아래 testInputOfDraft)
function ocrOf(o, withSuffix) {
  const multi = withSuffix ? multiOf(o?.multi, 0) : null
  return { op: o?.op, text: o?.text, number: o?.number, min: o?.min, max: o?.max, multi, multiBad: withSuffix && !multi }
}
// withRule: 이미지 다중 검사 조건을 실을 것인가(배포될 값에 조건이 있을 때만 — 아래 testInputOfDraft)
function shape(kind, uid, c, a, urls, ocr, withRule) {
  const image = kind === 'image'
  return {
    kind, uid, area: areaOf(c.searchArea), baseUrl: urls.baseUrl, trainUrl: image ? urls.trainUrl : null,
    accept: image ? acceptIn(c.image?.accept) : null, click: image ? clickOfAction(a) : null, actionType: a?.type ?? null,
    multi: image && withRule ? multiOf(c.image?.multi, 1) : null, ocr,
    // 패널의 영역 칸에 잘못 친 글자가 남아 있다(editor/areaInput.js) — 칸에 보이는 값과 다른 영역으로 시험하지 않는다
    ...(c.areaTyped ? { areaTyped: true } : {})
  }
}

// 패널 초안(EditedStep). ctx = { session, uploads, draftId }(그림 참조 → URL).
// sourceStep = 저장 기준 판의 같은 스텝(session.saveBase 의 것, 새 스텝이면 null) — OCR 접미사를 붙일지 가린다:
// 서버는 고친 스텝을 통째로 다시 조립하며 `@@@@{개수}-{연산}` 을 쓴다(설명만 고쳐도). 손대지 않은 스텝은 저장값 그대로 나간다.
// 그래서 저장값에 접미사가 없던 옛 스텝을 고치지 않고 시험할 때만 접미사 없이 보낸다(실행과 같게 — 한 줄 이상 맞으면 성공).
// 이미지의 다중 검사도 같다: 저장값(TextValue)이 비어 있으면 판정 서버는 개수를 견주지 않고(하나 이상이면 성공), 고친 스텝에는 서버가 `{개수}-{연산}` 을 써 넣는다.
export function testInputOfDraft(draft, ctx, sourceStep = null) {
  const c = draft?.condition
  if (c?.kind !== 'image' && c?.kind !== 'ocr') return null
  const base = draft.images?.base
  const urls = { baseUrl: isRef(base) ? refUrl(base, ctx) : null, trainUrl: c.kind === 'image' ? refUrl(firstTrainRef(draft.images?.train), ctx) : null }
  const untouched = !!sourceStep && sourceStep.origin === draft.origin && sameStep(sourceStep, draft)
  const stored = (multi) => !(untouched && (multi?.raw ?? '') === '')
  const ocr = c.kind === 'ocr' ? ocrOf(c.ocr, stored(c.ocr?.multi)) : null
  return shape(c.kind, draft.uid, c, draft.action, urls, ocr, stored(c.image?.multi))
}

// 표시 스텝(읽기 전용 상세 — P1 뼈대 모양). 저장값 그대로 시험한다: OCR 접미사·이미지 다중 검사 조건은 저장값에 있을 때만.
export function testInputOfStep(step) {
  const c = step?.condition
  if (c?.kind !== 'image' && c?.kind !== 'ocr') return null
  const ti = (c.image?.trainImages ?? []).filter((x) => imageSrc(x)).sort((p, q) => Number(p.key) - Number(q.key))[0]
  const urls = { baseUrl: step.baseImage?.state === 'present' ? imageSrc(step.baseImage) : null, trainUrl: ti ? imageSrc(ti) : null }
  const ocr = c.kind === 'ocr' ? ocrOf(c.ocr, (c.ocr?.multi?.raw ?? '') !== '') : null
  return shape(c.kind, step.uid, c, step.action, urls, ocr, (c.image?.multi?.raw ?? '') !== '')
}

// 시험 정확도 칸의 글자 → 0~1 의 수. 아니면 null(지수 표기·부호는 받지 않는다)
export function acceptOf(text) {
  if (isNum(text)) return acceptIn(text)
  if (typeof text !== 'string') return null
  const t = text.trim()
  return /^(\d+\.?\d*|\.\d+)$/.test(t) ? acceptIn(Number(t)) : null
}
// 저장할 수 있는 값은 0.5 부터다 — 그 아래는 시험만 된다
export const acceptWarn = (n) => isNum(n) && n < 0.5

function ocrProblem(o) {
  if (!(Number.isInteger(o.op) && o.op >= 1 && o.op <= 10)) return 'SEW_TEST_WHY_OCR_OP'
  if (TEXT_OPS.includes(o.op)) {
    if (typeof o.text !== 'string' || o.text === '' || o.text.includes('@@@@') || o.text.endsWith('@')) return 'SEW_TEST_WHY_OCR_VALUE'
  } else if (RANGE_OPS.includes(o.op)) {
    if (!isNum(o.min) || !isNum(o.max)) return 'SEW_TEST_WHY_OCR_VALUE'
  } else if (!isNum(o.number)) return 'SEW_TEST_WHY_OCR_VALUE'
  return o.multiBad ? 'SEW_TEST_WHY_OCR_MULTI' : null
}

// [시험] 이 꺼지는 까닭(문구 키) — 없으면 null. screen = { kind: 'base' } | { kind: 'snapshot', snapshot: { eqpId, fileName } | null }
export function blockReason(input, { screen, accept = null, running = false } = {}) {
  if (!input) return 'SEW_TEST_WHY_NO_AREA'
  if (running) return 'SEW_TEST_WHY_RUNNING'
  if (!input.area) return 'SEW_TEST_WHY_NO_AREA'
  if (input.areaTyped) return 'SEW_TEST_WHY_AREA_TYPED'
  if (input.kind === 'image') {
    if (!input.trainUrl) return 'SEW_TEST_WHY_NO_TRAIN'
    if (accept === null) return 'SEW_TEST_WHY_ACCEPT'
  } else {
    const why = ocrProblem(input.ocr)
    if (why) return why
  }
  if (screen?.kind === 'snapshot') return screen.snapshot ? null : 'SEW_TEST_WHY_NO_SNAPSHOT'
  return input.baseUrl ? null : 'SEW_TEST_WHY_NO_BASE'
}

// 보낼 조각 = 검색 영역을 시험할 화면(size = { w, h }) 안쪽으로 자른 것. 통째로 밖이면 null.
export const cropOf = (area, size) => clampRect(area, size.w, size.h)
// 조각이 찾을 그림보다 작으면 엔진이 0건으로 답해 못 찾은 것처럼 보인다 — 보내지 않는다
export const tooSmall = (crop, train) => crop.w < train.w || crop.h < train.h

// 서버가 준 좌표(조각 기준, 소수) → 시험한 화면의 좌표. 소수는 버린다(사내 편집기·실행 판정과 같다).
export const toScreen = (results, crop) => results.map((r) => ({ score: r.score, x: crop.x + Math.trunc(r.x), y: crop.y + Math.trunc(r.y) }))
// 누를 곳 = 첫 결과의 왼쪽 위 + 스텝의 상대 좌표. 1818 을 특별 취급하지 않는다(DC-078).
export const clickOf = (input, first) => (input?.click && first ? { x: first.x + input.click.x, y: first.y + input.click.y } : null)

// 스텝의 조건으로 맞음·안 맞음(판정 서버의 실행 규칙 — ImageProcessingServer SearchMax.cs): **먼저 하나 이상** 찾아야 하고,
// 동작이 없고(type 0) 다중 검사 조건이 있으면 그다음에 개수를 견준다. 0곳은 "n개 이하" 여도 실패다.
export function visionVerdict(input, count) {
  const rule = input.actionType === 0 && input.multi ? input.multi : null
  if (count < 1) return { ok: false, rule }
  if (!rule) return { ok: true, rule: null }
  const ok = rule.op === 0 ? count === rule.count : rule.op === 1 ? count >= rule.count : count <= rule.count
  return { ok, rule }
}

// 서버 POST /ocr-test 의 meta — 연산에 맞는 칸만
export function ocrMeta(input) {
  const o = input.ocr
  const out = { op: o.op }
  if (TEXT_OPS.includes(o.op)) out.text = o.text
  else if (RANGE_OPS.includes(o.op)) { out.min = o.min; out.max = o.max } else out.number = o.number
  if (o.multi) out.multi = { count: o.multi.count, op: o.multi.op }
  return out
}

const screenId = (input, screen) => (screen?.kind === 'snapshot' ? `snap:${screen.snapshot?.eqpId ?? ''}/${screen.snapshot?.fileName ?? ''}` : `base:${input.baseUrl ?? ''}`)
// 시험 입력 키: 스텝·시험할 화면의 그림·찾을 그림·영역. 달라지면 앞 결과는 다른 것의 결과다 — 지운다.
export function testKey(input, screen) {
  if (!input) return null
  const a = input.area
  return [input.kind, input.uid, screenId(input, screen), input.trainUrl ?? '', a ? `${a.x},${a.y},${a.w},${a.h}` : ''].join('\n')
}
// 값 키: 달라지면 결과는 그대로 두되 "값이 바뀌었습니다" 로 흐리게 한다
export const valueKey = (input, accept = null) => JSON.stringify(input.kind === 'image' ? [accept, input.actionType, input.multi, input.click] : [input.ocr])

// OCR 응답: 글 비교의 읽은 글은 줄을 " @@ " 로 이은 것, 신뢰도는 글자마다 ":<정수>"(수 비교는 빈 글)
export const ocrLines = (found) => (typeof found === 'string' && found !== '' ? found.split(' @@ ') : [])
export function confidenceOf(text) {
  const values = [...String(text ?? '').matchAll(/:(\d+)/g)].map((m) => Number(m[1]))
  return { values, min: values.length ? Math.min(...values) : null }
}

// 큰 화면 겹침(TestLayer)이 그릴 것 — 찾은 곳마다 찾을 그림 크기의 사각형(왼쪽 위 = 결과 좌표)과 첫 결과의 누를 곳.
// mode = 그 층이 붙은 보기('step' | 'snapshot'). 시험한 화면의 모드가 아니거나 그릴 결과가 없으면 null.
export function hitsOf(run, mode) {
  if (run?.status !== 'done' || run.kind !== 'image' || !run.results?.length || !run.train) return null
  if ((run.screen === 'snapshot' ? 'snapshot' : 'step') !== mode) return null
  return {
    rects: run.results.map((r, i) => ({ no: i + 1, x: r.x, y: r.y, w: run.train.w, h: run.train.h, picked: i === run.picked })),
    click: run.click ?? null, stale: !!run.stale
  }
}

// 서버 로그에 남길 "무엇을 시험했는지". open = { process, model, name }(연 시나리오), no = 스텝 번호
export function aboutOf(open, no) {
  const out = {}
  if (open?.process) out.process = open.process
  if (open?.model) out.model = open.model
  if (open?.name) out.scenario = open.name
  if (Number.isInteger(no) && no > 0) out.step = no
  return out
}
