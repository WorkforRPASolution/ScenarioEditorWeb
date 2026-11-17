// 큰 화면 잡기·새 스텝의 순수 함수(목업 CAP_FLOW·capNext·normRect·handles·areaView·startNew). 좌표는 모두 기준 화면 픽셀이고
// 화면 확대·이동과 상관없다. 새 스텝 초안은 서버 conditionCodec·csDefaults 가 origin 없는 스텝을 조립할 때 쓰는 값(newRawStep 을 푼 모양)이다.
import { CLICK_TYPES } from './panel'

// 새 스텝이 처음 거치는 잡기 흐름: 이미지 = 검색 영역 → 찾을 그림 → 누를 곳, OCR = 문자 영역
export const CAP_FLOWS = Object.freeze({ image: Object.freeze(['area', 'train', 'click']), ocr: Object.freeze(['ocr']) })
export const MIN_CAPTURE = 8 // 이보다 작게 끈 사각형은 받지 않는다(목업 onScreenDown)
export const MIN_RESIZE = 20 // 모서리로 줄일 때 남는 최소 크기(목업 resize)
export const LOCATE_MS = 3000 // [다시 찍기] 위치 찾기 시간 상한(설계 §4.2)
const PLACEHOLDER_BI = 'AA==' // 서버 csDefaults PLACEHOLDER_BI — 조건 없음 스텝의 기준 화면 자리

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export const isRect = (r) => !!r && typeof r === 'object' && ['x', 'y', 'w', 'h'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k])) && r.w > 0 && r.h > 0
export const isRef = (r) => !!r && typeof r === 'object' && 'from' in r

// 패널 잡기 버튼이 시작할 흐름: 보는 곳 = 영역부터, 찾는 것 = 그림부터. 누를 곳은 동작이 마우스 클릭일 때만(목업 lookStation·findStation).
export function captureFlow(draft, from) {
  if (draft?.condition?.kind === 'ocr') return ['ocr']
  const flow = from === 'find' ? ['train'] : ['area', 'train']
  return CLICK_TYPES.includes(draft?.action?.type) ? [...flow, 'click'] : flow
}

// 다음 단계. 동작이 마우스 클릭이 아니면 누를 곳을 건너뛴다(목업 capNext). 끝이면 null.
export function nextStage(flow, stage, actionType) {
  let i = flow.indexOf(stage) + 1
  while (i < flow.length && flow[i] === 'click' && !CLICK_TYPES.includes(actionType)) i++
  return i < flow.length ? flow[i] : null
}

// 두 점이 이루는 사각형을 bound 안으로 자른 정수 사각형(목업 normRect). 끝점을 따로 반올림해 경계를 넘지 않는다.
export function normRect(a, b, bound) {
  const x1 = Math.round(clamp(Math.min(a.x, b.x), bound.x, bound.x + bound.w))
  const x2 = Math.round(clamp(Math.max(a.x, b.x), bound.x, bound.x + bound.w))
  const y1 = Math.round(clamp(Math.min(a.y, b.y), bound.y, bound.y + bound.h))
  const y2 = Math.round(clamp(Math.max(a.y, b.y), bound.y, bound.y + bound.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}
// 두 사각형이 겹치는 곳(찾을 그림은 검색 영역 안만)
export const clipRect = (r, bound) => normRect({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, bound)

// 영역 끌어 옮기기 — 그림 밖으로 나가지 않는다(목업 move)
export function moveRect(orig, dx, dy, W, H) {
  return { ...orig, x: Math.round(clamp(orig.x + dx, 0, W - orig.w)), y: Math.round(clamp(orig.y + dy, 0, H - orig.h)) }
}
// 모서리·변 손잡이로 크기 바꾸기 — 손잡이 쪽만 움직이고 MIN_RESIZE 아래로 줄지 않는다(목업 resize)
export function resizeRect(orig, handle, q, W, H, min = MIN_RESIZE) {
  let x1 = orig.x
  let y1 = orig.y
  let x2 = orig.x + orig.w
  let y2 = orig.y + orig.h
  if (handle.includes('w')) x1 = Math.min(q.x, x2 - min)
  if (handle.includes('e')) x2 = Math.max(q.x, x1 + min)
  if (handle.includes('n')) y1 = Math.min(q.y, y2 - min)
  if (handle.includes('s')) y2 = Math.max(q.y, y1 + min)
  return normRect({ x: x1, y: y1 }, { x: x2, y: y2 }, { x: 0, y: 0, w: W, h: H })
}
// 손잡이 여덟 곳 [이름, x, y, 커서](목업 handles)
export function handlePoints(a) {
  const mx = a.x + a.w / 2
  const my = a.y + a.h / 2
  const r = a.x + a.w
  const b = a.y + a.h
  return [['nw', a.x, a.y, 'nwse-resize'], ['n', mx, a.y, 'ns-resize'], ['ne', r, a.y, 'nesw-resize'], ['e', r, my, 'ew-resize'],
    ['se', r, b, 'nwse-resize'], ['s', mx, b, 'ns-resize'], ['sw', a.x, b, 'nesw-resize'], ['w', a.x, my, 'ew-resize']]
}

// 큰 화면 이름표 상자(목업 tagSvg): 글자 수로 너비를 어림한다(한글은 넓게). y = 이름표 아래 끝, 기준 화면 위로 나가지 않게 0 에서 멈춘다.
// k = 1 / 화면 배율 — 확대·이동과 상관없이 화면에서 같은 크기로 보인다.
export function tagBox(x, y, text, k) {
  const wide = [...text].filter((ch) => { const c = ch.charCodeAt(0); return c >= 0xac00 && c <= 0xd7a3 }).length
  const h = 18 * k
  const top = Math.max(0, y - h)
  return { x, y: top, w: ((text.length - wide) * 7.1 + wide * 12.5 + 12) * k, h, tx: x + 6 * k, ty: top + 13 * k, fs: 12 * k, rx: 3 * k, text }
}
const CROSS = 9 // 누를 곳 + 의 반 길이(화면 px)
const covers = (b, p, m) => p.x >= b.x - m && p.x <= b.x + b.w + m && p.y >= b.y - m && p.y <= b.y + b.h + m
// 누를 곳 이름표: 누를 곳을 가리지 않게 — 찾은 그림 안이면 그림 위쪽, 밖이면(또는 위쪽 이름표가 누를 곳에 닿으면) 누를 곳 오른쪽 아래(목업 overlay)
export function clickTagBox(train, click, text, k) {
  const inside = click.x >= train.x && click.y >= train.y && click.x <= train.x + train.w && click.y <= train.y + train.h
  const above = inside ? tagBox(train.x, train.y - 4 * k, text, k) : null
  return above && !covers(above, click, CROSS * k) ? above : tagBox(click.x + 12 * k, click.y + CROSS * k, text, k)
}
// 찾은 그림 이름표: 그림 아래(목업), 그 자리가 누를 곳에 닿으면 그림 위
export function trainTagBox(train, click, text, k) {
  const below = tagBox(train.x, train.y + train.h + 20 * k, text, k)
  return click && covers(below, click, CROSS * k) ? tagBox(train.x, train.y - 4 * k, text, k) : below
}

// 영역을 큰 화면 가운데 꽉 차게(목업 areaView): 이름표가 보이게 좌우 12px·위아래 20px 를 남기고, 전체 맞춤보다 작게 줄이지 않는다.
// box = 큰 화면 상자 크기, natural = 기준 화면 크기. 결과는 StepViewer 의 { scale, tx, ty }.
export function areaView(a, box, natural, { max = 8 } = {}) {
  const fit = Math.min(box.w / natural.w, box.h / natural.h) * 0.98
  const s = clamp(Math.min((box.w - 24) / a.w, (box.h - 40) / a.h), fit, Math.max(fit, max))
  const place = (boxLen, imgLen, c) => {
    const len = imgLen * s
    return len <= boxLen ? (boxLen - len) / 2 : clamp(boxLen / 2 - c * s, boxLen - len, 0)
  }
  return { scale: s, tx: place(box.w, natural.w, a.x + a.w / 2), ty: place(box.h, natural.h, a.y + a.h / 2) }
}

// 새 스텝 초안(EditedStep). 서버 newRawStep(kind) 을 parseCondition·parseAction 으로 푼 값과 같은 모양이고, 동작 기본값은
// 이미지 = 왼쪽 클릭(찾을 그림 왼쪽 위 기준)·조건 없음 = 명령 실행·OCR = 없음(설계 §4.2, 목업 startNew).
// OCR 숫자 칸은 비워 둔다(null) — 조립은 고른 비교 방법의 칸만 쓴다. base = 기준 화면 참조(조건 없음은 자리표시 literal).
export function newStepDraft(kind, { uid, base }) {
  const multi = () => ({ count: '1', op: 0, raw: '' })
  let condition
  let action
  if (kind === 'image') {
    condition = { kind, operationRaw: 1, skipPreprocessing: false, searchArea: null,
      image: { accept: 0.9, maxFind: 1, timeoutEnabled: true, timeout: 1000, trainImages: [], multi: multi() } }
    action = { type: 1, typeName: 'MouseLeftClick', raw: '', click: { x: null, y: null, basis: 'trainImage' } }
  } else if (kind === 'ocr') {
    condition = { kind, operationRaw: 2, skipPreprocessing: false, searchArea: null,
      ocr: { op: 0, opName: 'None', type: 0, text: '', number: null, min: null, max: null, minMatching: 10, multi: multi(), raw: '' } }
    action = { type: 0, typeName: 'None', raw: '' }
  } else {
    condition = { kind: 'none', operationRaw: 0, skipPreprocessing: false }
    action = { type: 11, typeName: 'RunCommand', raw: '', command: '' }
  }
  return {
    uid, origin: null, condition, action,
    next: { onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } },
    retry: { limit: 2, intervalMs: 2000 },
    descriptionToEmail: '', descriptionToDialog: '', isShowDialog: true,
    images: { train: {}, base: kind === 'image' || kind === 'ocr' ? base : { literal: PLACEHOLDER_BI } }
  }
}

// 고른 스텝의 기준 화면 참조 — 새 이미지·OCR 스텝이 "고른 스텝의 화면" 을 빌릴 때 쓴다. 그 스텝에 기준 화면이 없거나 고른 줄이 없으면 null.
// 다른 스텝(첫 스텝)의 화면으로 넘어가지 않는다(2026-11-17 — 어느 화면이 쓰였는지 알 수 없어 "이상한 그림이 골라진다" 는 사내 보고).
export function baseRefFor(working, anchorUid) {
  const a = anchorUid == null ? null : (working?.steps ?? []).find((s) => s.uid === anchorUid)
  return a && isRef(a.images?.base) ? a.images.base : null
}

// 새 스텝의 넣을 자리: 고른 줄 뒤 — 그 다음 줄의 uid(그 줄 앞에 넣는다). 마지막 줄이거나 고른 줄이 없으면 null(맨 끝).
// 넣은 스텝이 골라지므로 이어 만들면 만든 순서대로 쌓인다(2026-11-17 — 표 위 [새 스텝] 과 스냅샷 화면 [새 스텝] 의 자리를 하나로 맞췄다).
export function afterUid(working, anchorUid) {
  const steps = working?.steps ?? []
  const i = anchorUid == null ? -1 : steps.findIndex((s) => s.uid === anchorUid)
  return i < 0 ? null : (steps[i + 1]?.uid ?? null)
}

// 찾을 그림 참조(키 0 먼저, 없으면 가장 작은 키). 그림이 아닌 literal 은 없는 것으로 본다.
export function firstTrainRef(train) {
  const keys = Object.keys(train ?? {}).filter((k) => isRef(train[k])).sort((a, b) => Number(a) - Number(b))
  return keys.length ? train[keys[0]] : null
}
