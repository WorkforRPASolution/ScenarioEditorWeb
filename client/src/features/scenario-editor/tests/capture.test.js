import { describe, it, expect } from 'vitest'
import { CAP_FLOWS, captureFlow, nextStage, normRect, moveRect, resizeRect, handlePoints, areaView, newStepDraft, baseRefFor, isRect } from '../editor/capture'

describe('잡기 흐름(목업 CAP_FLOW·capNext)', () => {
  it('새 스텝 흐름: 이미지 = 영역 → 그림 → 누를 곳, OCR = 문자 영역', () => {
    expect(CAP_FLOWS.image).toEqual(['area', 'train', 'click'])
    expect(CAP_FLOWS.ocr).toEqual(['ocr'])
  })
  it('잡기 버튼 흐름: 보는 곳은 영역부터, 찾는 것은 그림부터, 누를 곳은 마우스 클릭일 때만', () => {
    const img = (type) => ({ condition: { kind: 'image' }, action: { type } })
    expect(captureFlow(img(1), 'look')).toEqual(['area', 'train', 'click'])
    expect(captureFlow(img(0), 'look')).toEqual(['area', 'train'])
    expect(captureFlow(img(3), 'find')).toEqual(['train', 'click'])
    expect(captureFlow(img(5), 'find')).toEqual(['train'])
    expect(captureFlow({ condition: { kind: 'ocr' }, action: { type: 0 } }, 'look')).toEqual(['ocr'])
  })
  it('다음 단계: 마우스 클릭이 아니면 누를 곳을 건너뛰고, 끝이면 null', () => {
    expect(nextStage(['area', 'train', 'click'], 'area', 1)).toBe('train')
    expect(nextStage(['area', 'train', 'click'], 'train', 1)).toBe('click')
    expect(nextStage(['area', 'train', 'click'], 'click', 1)).toBe(null)
    expect(nextStage(['area', 'train', 'click'], 'train', 0)).toBe(null)
    expect(nextStage(['ocr'], 'ocr', 0)).toBe(null)
  })
})

describe('사각형(기준 화면 픽셀)', () => {
  const IMG = { x: 0, y: 0, w: 1000, h: 500 }
  it('두 점 → 정수 사각형, 방향 상관없이, 경계 안으로 자른다', () => {
    expect(normRect({ x: 30.4, y: 40.6 }, { x: 10.2, y: 10 }, IMG)).toEqual({ x: 10, y: 10, w: 20, h: 31 })
    expect(normRect({ x: -50, y: 480 }, { x: 40, y: 900 }, IMG)).toEqual({ x: 0, y: 480, w: 40, h: 20 })
    // 경계(검색 영역) 안에서만 — 찾을 그림
    expect(normRect({ x: 5, y: 5 }, { x: 400, y: 400 }, { x: 100, y: 50, w: 200, h: 100 })).toEqual({ x: 100, y: 50, w: 200, h: 100 })
  })
  it('반올림으로 경계를 넘지 않는다', () => {
    const r = normRect({ x: 10.5, y: 0 }, { x: 110.4, y: 10 }, { x: 10, y: 0, w: 100, h: 10 })
    expect(r.x + r.w).toBeLessThanOrEqual(110)
  })
  it('옮기기는 그림 밖으로 나가지 않는다', () => {
    const a = { x: 100, y: 100, w: 200, h: 100 }
    expect(moveRect(a, 50, -30, 1000, 500)).toEqual({ x: 150, y: 70, w: 200, h: 100 })
    expect(moveRect(a, 5000, 5000, 1000, 500)).toEqual({ x: 800, y: 400, w: 200, h: 100 })
    expect(moveRect(a, -5000, -5000, 1000, 500)).toEqual({ x: 0, y: 0, w: 200, h: 100 })
  })
  it('모서리로 크기 바꾸기: 손잡이 쪽만 움직이고 20px 아래로 줄지 않는다', () => {
    const a = { x: 100, y: 100, w: 200, h: 100 }
    expect(resizeRect(a, 'se', { x: 400, y: 260 }, 1000, 500)).toEqual({ x: 100, y: 100, w: 300, h: 160 })
    expect(resizeRect(a, 'nw', { x: 50, y: 80 }, 1000, 500)).toEqual({ x: 50, y: 80, w: 250, h: 120 })
    expect(resizeRect(a, 'e', { x: 0, y: 999 }, 1000, 500)).toEqual({ x: 100, y: 100, w: 20, h: 100 })
    expect(resizeRect(a, 'n', { x: 0, y: -100 }, 1000, 500)).toEqual({ x: 100, y: 0, w: 200, h: 200 })
  })
  it('손잡이 여덟 곳', () => {
    expect(handlePoints({ x: 0, y: 0, w: 10, h: 20 }).map((h) => h.slice(0, 3))).toEqual([
      ['nw', 0, 0], ['n', 5, 0], ['ne', 10, 0], ['e', 10, 10], ['se', 10, 20], ['s', 5, 20], ['sw', 0, 20], ['w', 0, 10]
    ])
  })
  it('isRect: 네 값이 유한하고 너비·높이가 양수', () => {
    expect(isRect({ x: 0, y: 0, w: 1, h: 1 })).toBe(true)
    expect(isRect({ x: 0, y: 0, w: 0, h: 1 })).toBe(false)
    expect(isRect(null)).toBe(false)
    expect(isRect({ x: 'a', y: 0, w: 1, h: 1 })).toBe(false)
  })
  it('영역에 맞춰 확대(목업 areaView): 영역이 상자 가운데 꽉 차고, 전체보다 작게 줄이지 않는다', () => {
    const v = areaView({ x: 400, y: 200, w: 100, h: 50 }, { w: 800, h: 400 }, { w: 1000, h: 500 })
    expect(v.scale).toBeCloseTo(Math.min(776 / 100, 360 / 50), 5)
    expect(400 + 50).toBeCloseTo((400 - v.tx) / v.scale, 5) // 상자 가운데(가로) = 영역 가운데
    const whole = areaView({ x: 0, y: 0, w: 1000, h: 500 }, { w: 800, h: 400 }, { w: 1000, h: 500 })
    expect(whole.scale).toBeCloseTo(0.784, 5)
    expect(whole.tx).toBeCloseTo(8, 5)
  })
})

describe('새 스텝 초안(서버 assemble 이 origin 없는 스텝에 쓰는 값)', () => {
  const base = { from: 'source', id: 's2-bi' }
  it('공통: 성공 NEXT·실패 FAIL·재시도 2회 2초·설명 빈 값·대화 상자 보이기', () => {
    for (const kind of ['image', 'ocr', 'none']) {
      const d = newStepDraft(kind, { uid: 'n1', base })
      expect(d).toMatchObject({
        uid: 'n1', origin: null,
        next: { onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } },
        retry: { limit: 2, intervalMs: 2000 }, descriptionToEmail: '', descriptionToDialog: '', isShowDialog: true
      })
      expect(d.condition.kind).toBe(kind)
      expect(d.condition.skipPreprocessing).toBe(false)
    }
  })
  it('이미지: 왼쪽 클릭(찾을 그림 왼쪽 위 기준), 정확도 0.9, 다중 검사 1개, 영역 없음, 기준 화면 = 받은 참조', () => {
    const d = newStepDraft('image', { uid: 'n1', base })
    expect(d.condition).toEqual({ kind: 'image', operationRaw: 1, skipPreprocessing: false, searchArea: null,
      image: { accept: 0.9, maxFind: 1, timeoutEnabled: true, timeout: 1000, trainImages: [], multi: { count: '1', op: 0, raw: '' } } })
    expect(d.action).toEqual({ type: 1, typeName: 'MouseLeftClick', raw: '', click: { x: null, y: null, basis: 'trainImage' } })
    expect(d.images).toEqual({ train: {}, base })
  })
  it('OCR: 동작 없음, 비교 방법은 고르기 전', () => {
    const d = newStepDraft('ocr', { uid: 'n1', base })
    expect(d.condition.operationRaw).toBe(2)
    expect(d.condition.searchArea).toBe(null)
    expect(d.condition.ocr).toMatchObject({ op: 0, text: '', multi: { count: '1', op: 0, raw: '' } })
    expect(d.action).toEqual({ type: 0, typeName: 'None', raw: '' })
    expect(d.images.base).toBe(base)
  })
  it('조건 없음: 명령 실행, 기준 화면은 자리표시 literal(AA==)', () => {
    const d = newStepDraft('none', { uid: 'n1', base })
    expect(d.condition).toEqual({ kind: 'none', operationRaw: 0, skipPreprocessing: false })
    expect(d.action).toEqual({ type: 11, typeName: 'RunCommand', raw: '', command: '' })
    expect(d.images).toEqual({ train: {}, base: { literal: 'AA==' } })
  })
  it('기준 화면: 고른 스텝의 참조, 없으면 기준 화면(참조)이 있는 첫 스텝, 하나도 없으면 null', () => {
    const w = { steps: [
      { uid: 'a', images: { base: { literal: 'AA==' } } },
      { uid: 'b', images: { base: { from: 'source', id: 's1-bi' } } },
      { uid: 'c', images: { base: { from: 'upload', tempId: 't1' } } }
    ] }
    expect(baseRefFor(w, 'c')).toEqual({ from: 'upload', tempId: 't1' })
    expect(baseRefFor(w, 'a')).toEqual({ from: 'source', id: 's1-bi' })
    expect(baseRefFor(w, null)).toEqual({ from: 'source', id: 's1-bi' })
    expect(baseRefFor({ steps: [w.steps[0]] }, 'a')).toBe(null)
  })
})

import { tagBox, clickTagBox, trainTagBox } from '../editor/capture'
describe('이름표(목업 tagSvg) — 누를 곳을 가리지 않게', () => {
  const T = { x: 100, y: 100, w: 200, h: 80 }
  const covers = (b, p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
  it('tagBox: 글자 수로 너비(한글은 넓게), 높이 18·글자 12 를 배율로 나누고, 위로 나가지 않는다', () => {
    expect(tagBox(10, 40, '찾은 그림', 1)).toEqual({ x: 10, y: 22, w: (1 * 7.1 + 4 * 12.5 + 12), h: 18, tx: 16, ty: 35, fs: 12, rx: 3, text: '찾은 그림' })
    expect(tagBox(10, 5, 'A', 2)).toMatchObject({ y: 0, h: 36, fs: 24 })
  })
  it('누를 곳 이름표: 그림 안이면 그림 위쪽, 밖이면 누를 곳 오른쪽 아래 — 어느 쪽이든 누를 곳을 가리지 않는다', () => {
    const inside = clickTagBox(T, { x: 124, y: 112 }, '누를 곳', 1)
    expect(inside).toMatchObject({ x: 100, y: 100 - 4 - 18 })
    const out = clickTagBox(T, { x: 400, y: 90 }, '누를 곳', 1)
    expect(out).toMatchObject({ x: 412, y: 90 + 9 - 18 })
    // 그림이 화면 맨 위에 붙어 위쪽 이름표가 그림 안으로 내려오면 누를 곳 옆으로
    const top = { x: 100, y: 0, w: 200, h: 80 }
    const near = clickTagBox(top, { x: 110, y: 6 }, '누를 곳', 1)
    expect(covers(near, { x: 110, y: 6 })).toBe(false)
    for (const c of [{ x: 124, y: 112 }, { x: 400, y: 90 }, { x: 90, y: 200 }]) expect(covers(clickTagBox(T, c, '누를 곳', 1), c), JSON.stringify(c)).toBe(false)
  })
  it('찾은 그림 이름표: 그림 아래, 그 자리가 누를 곳을 가리면 그림 위', () => {
    expect(trainTagBox(T, { x: 124, y: 112 }, '찾은 그림', 1)).toMatchObject({ x: 100, y: 100 + 80 + 20 - 18 })
    const below = { x: 110, y: 190 }
    const b = trainTagBox(T, below, '찾은 그림', 1)
    expect(b).toMatchObject({ x: 100, y: 100 - 4 - 18 })
    expect(covers(b, below)).toBe(false)
    expect(trainTagBox(T, null, '찾은 그림', 1)).toMatchObject({ y: 182 })
  })
})
