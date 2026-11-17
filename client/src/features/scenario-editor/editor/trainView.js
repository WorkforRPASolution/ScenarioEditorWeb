// 찾을 그림 + 누를 곳 보기(목업 trainThumb·clickOutside, 큰 화면 overlay 의 찾은 그림·누를 곳). 보기 기능이라 작업본·초안을 바꾸지 않는다.
// - thumbView: 누를 곳이 찾을 그림 밖이면 썸네일을 그 지점까지 넓힌다(좌표는 찾을 그림 왼쪽 위 기준).
// - spotInputOf*: 초점 스텝(패널 초안 또는 보는 스텝 — 이미지 조건이면 동작과 상관없이)에서 기준 화면의 찾을 그림 위치를 찾을 입력. 저장값에는 찾을 그림의 기준 화면 위치가 없어
//   [다시 찍기]와 같은 길(editStore.findSpot → locateTrain)로 찾는다. 키 = 기준 화면·찾을 그림·검색 영역(누를 곳은 넣지 않는다).
// - spotAround·spotMarks·spotNote: 찾은 결과를 썸네일 주변 채우기·큰 화면 표시·썸네일 아래 문구로.
import { refUrl } from './images'
import { imageSrc } from './display'
import { isRect, isRef, firstTrainRef } from './capture'
import { CLICK_TYPES } from './panel'

// [누를 곳 보기] 로 큰 화면에 점을 깜빡여 보이는 시간 — 깜빡임 한 번이 1초(snapshot.css)라 다섯 번이다
export const CLICK_SHOW_MS = 5000

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const areaOf = (a) => ({ x: a.x, y: a.y, w: a.w, h: a.h })

// size = 찾을 그림 크기 { w, h }, click = 찾을 그림 왼쪽 위에서 잰 누를 곳 { x, y }. 결과 { outside, x1, y1, W, H, k } —
// 보일 영역(찾을 그림 기준 좌표, x1·y1 ≤ 0)과 배율. 배율 = min(기준 너비 / w, maxW / W, maxH / H), 기준 너비 = min(150, max(70, w/2)).
// 그림 안이면 넓히지 않고, 밖이면 여백 pad = max(6, w*0.06)(목업)을 둔다. 다만 줄인 뒤 여백이 화면에서 mark(+ 반 길이, px)보다 작으면
// + 가 잘리지 않게 여백을 mark / 배율 까지 늘린다(배율이 다시 줄 수 있어 몇 번 되풀이한다). 잘못된 크기·누를 곳이면 null.
export function thumbView(size, click, { maxW = 300, maxH = 150, mark = 8 } = {}) {
  if (!size || !finite(size.w) || !finite(size.h) || !(size.w > 0 && size.h > 0)) return null
  if (!click || !finite(click.x) || !finite(click.y)) return null
  const { w, h } = size
  const base = Math.min(150, Math.max(70, w / 2))
  const outside = click.x < 0 || click.y < 0 || click.x > w || click.y > h
  if (!outside) return { outside: false, x1: 0, y1: 0, W: w, H: h, k: Math.min(base / w, maxW / w, maxH / h) }
  const view = (pad) => {
    const x1 = Math.min(0, click.x - pad)
    const y1 = Math.min(0, click.y - pad)
    const W = Math.max(w, click.x + pad) - x1
    const H = Math.max(h, click.y + pad) - y1
    return { outside: true, x1, y1, W, H, k: Math.min(base / w, maxW / W, maxH / H) }
  }
  let pad = Math.max(6, w * 0.06)
  let v = view(pad)
  for (let i = 0; i < 20 && pad * v.k < mark - 1e-9; i++) {
    pad = mark / v.k
    v = view(pad)
  }
  return v
}

// 누를 곳(찾을 그림 왼쪽 위 기준): 마우스 클릭 셋이고 좌표가 정수일 때만. 그 밖의 동작(키보드·대기·없음 …)과 아직 찍지 않은 누를 곳은 null —
// 찾을 그림의 자리는 동작과 상관없이 찾아 그린다(2026-11-17 사내 보고: 마우스 클릭 스텝에서만 찾은 그림이 보였다).
const clickOf = (a, needBasis) => (CLICK_TYPES.includes(a?.type) && (!needBasis || a.click?.basis === 'trainImage')
  && Number.isInteger(a.click?.x) && Number.isInteger(a.click?.y) ? { x: a.click.x, y: a.click.y } : null)

// 패널 초안(EditedStep): 이미지 조건 + 검색 영역 + 기준 화면·찾을 그림 참조(URL 을 만들 수 있을 때). click = 누를 곳 또는 null
export function spotInputOfDraft(draft, ctx) {
  const c = draft?.condition
  if (c?.kind !== 'image' || !isRect(c.searchArea)) return null
  const base = draft.images?.base
  const baseUrl = isRef(base) ? refUrl(base, ctx) : null
  const trainUrl = refUrl(firstTrainRef(draft.images?.train), ctx)
  if (!baseUrl || !trainUrl) return null
  return { baseUrl, trainUrl, area: areaOf(c.searchArea), click: clickOf(draft.action, false) }
}

// 표시 스텝(P1 뼈대 모양 — 읽기 전용 상세·큰 화면): 기준 화면이 있고, 학습 이미지(키 0 먼저) URL 이 있을 때. click = 학습 이미지 기준의 누를 곳 또는 null
export function spotInputOfStep(step) {
  const c = step?.condition
  if (c?.kind !== 'image' || !isRect(c.searchArea) || step.baseImage?.state !== 'present') return null
  const ti = (c.image?.trainImages ?? []).filter((x) => imageSrc(x)).sort((p, q) => Number(p.key) - Number(q.key))[0]
  const baseUrl = imageSrc(step.baseImage)
  const trainUrl = ti ? imageSrc(ti) : null
  if (!baseUrl || !trainUrl) return null
  return { baseUrl, trainUrl, area: areaOf(c.searchArea), click: clickOf(step.action, true) }
}

export const spotKey = (input) => (input ? `${input.baseUrl}\n${input.trainUrl}\n${input.area.x},${input.area.y},${input.area.w},${input.area.h}` : null)

const isOne = (input, r) => !!input && r?.found === 'one'
// 썸네일의 넓힌 부분을 채울 기준 화면: src = 기준 화면 URL, x·y = 기준 화면에서 찾은 찾을 그림 왼쪽 위, bw·bh = 기준 화면 크기
export const spotAround = (input, r) => (isOne(input, r) ? { src: input.baseUrl, x: r.x, y: r.y, bw: r.bw, bh: r.bh } : null)
// 큰 화면에 그릴 찾은 그림 사각형과 누를 곳(기준 화면 픽셀). 누를 곳이 없는 스텝은 click 이 null
export const spotMarks = (input, r) => (isOne(input, r)
  ? { train: { x: r.x, y: r.y, w: r.w, h: r.h }, click: input.click ? { x: r.x + input.click.x, y: r.y + input.click.y } : null } : null)

const NOTE_FOUND = new Set(['one', 'many', 'none', 'timeout', 'error'])
// 썸네일 아래 "주변 화면" 문구 키. 찾을 수 없는 스텝(기준 화면·영역·그림이 없음)은 저장되어 있지 않음, 찾는 중이면 null.
export function spotNote(input, r) {
  if (!input) return 'SEW_UI_SPOT_NOT_STORED'
  if (!r) return null
  return `SEW_UI_SPOT_${NOTE_FOUND.has(r.found) ? r.found : 'error'}`
}
