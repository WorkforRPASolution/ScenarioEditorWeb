// 흉내 판정 서버의 규칙(P4 설계 §10) — Vision 은 똑같은 픽셀 찾기, OCR 은 사내 판정 서버 사본(OCRCore/core/CoreService.cs matchOcrValueCondition)의 판정 규칙.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')
const { findExact, judgeOcr } = require('../fake-vision-rules')

// 픽셀마다 다른 색(자리로 정해진다) — 같은 조각이 우연히 두 번 나오지 않는다
function canvas(w, h, paint = (x, y) => [(x * 7 + y * 13) % 256, (x * 3 + y * 29) % 256, (x + y * 5) % 256, 255]) {
  const png = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) png.data.set(paint(x, y), (y * w + x) * 4)
  return png
}
function crop(png, x0, y0, w, h) {
  const out = new PNG({ width: w, height: h })
  PNG.bitblt(png, out, x0, y0, w, h, 0, 0)
  return out
}
const bytes = (png) => PNG.sync.write(png)

describe('findExact — 화면 조각 안에서 찾을 그림과 똑같은 픽셀', () => {
  const screen = canvas(60, 40)
  it('한 곳: 왼쪽 위 좌표를 준다', () => {
    expect(findExact(bytes(screen), bytes(crop(screen, 17, 9, 12, 8)))).toEqual([{ x: 17, y: 9 }])
  })
  it('가장자리(오른쪽 아래 끝)에 붙은 것도 찾는다', () => {
    expect(findExact(bytes(screen), bytes(crop(screen, 48, 32, 12, 8)))).toEqual([{ x: 48, y: 32 }])
  })
  it('여러 곳: 위에서 아래로, 왼쪽에서 오른쪽으로', () => {
    const tile = canvas(5, 5, (x, y) => [200, x * 40, y * 40, 255])
    const two = canvas(60, 40, () => [0, 0, 0, 255])
    PNG.bitblt(tile, two, 0, 0, 5, 5, 30, 20)
    PNG.bitblt(tile, two, 0, 0, 5, 5, 3, 4)
    expect(findExact(bytes(two), bytes(tile))).toEqual([{ x: 3, y: 4 }, { x: 30, y: 20 }])
  })
  it('한 픽셀이라도 다르면(투명도 포함) 못 찾는다', () => {
    const t = crop(screen, 17, 9, 12, 8)
    t.data[3] = 254
    expect(findExact(bytes(screen), bytes(t))).toEqual([])
  })
  it('찾을 그림이 조각보다 크면 빈 목록', () => {
    expect(findExact(bytes(crop(screen, 0, 0, 10, 10)), bytes(crop(screen, 0, 0, 12, 8)))).toEqual([])
  })
  it('PNG 가 아니면 빈 목록(판정 서버의 엔진 실패는 0건이다)', () => {
    expect(findExact(Buffer.from('not a png'), bytes(crop(screen, 0, 0, 4, 4)))).toEqual([])
    expect(findExact(bytes(screen), Buffer.alloc(0))).toEqual([])
  })
  it('한도(기본 20곳)에서 멈춘다', () => {
    const flat = canvas(30, 30, () => [9, 9, 9, 255])
    const dot = canvas(2, 2, () => [9, 9, 9, 255])
    expect(findExact(bytes(flat), bytes(dot))).toHaveLength(20)
    expect(findExact(bytes(flat), bytes(dot), 3)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }])
  })
})

const text = (op, value, extra = {}) => ({ OcrValueType: 1, OcrOperation: op, TextValue: value, MinMatchingValue: 10, NumberValue: 0, NumberRangeMin: 0, NumberRangeMax: 0, ...extra })
const number = (op, extra = {}, suffix = '') => ({ OcrValueType: 2, OcrOperation: op, TextValue: suffix, MinMatchingValue: 10, NumberValue: 0, NumberRangeMin: 0, NumberRangeMax: 0, ...extra })
const ok = (param, lines) => judgeOcr(param, lines).IsAccepted

describe('judgeOcr — 글 비교(값 종류 1, 연산 1~4)', () => {
  it('1 같음 · 2 다름 · 3 포함 · 4 포함 안 함 — 줄마다 견주고, 접미사가 없으면 한 줄 이상 맞으면 성공', () => {
    expect(ok(text(1, 'READY'), ['READY'])).toBe(true)
    expect(ok(text(1, 'READY'), ['READY 2'])).toBe(false)
    expect(ok(text(1, 'READY'), ['IDLE', 'READY'])).toBe(true)
    expect(ok(text(2, 'READY'), ['READY'])).toBe(false)
    expect(ok(text(2, 'READY'), ['READY', 'IDLE'])).toBe(true)
    expect(ok(text(3, 'EAD'), ['READY'])).toBe(true)
    expect(ok(text(3, 'ead'), ['READY'])).toBe(false) // 대소문자를 가린다
    expect(ok(text(4, 'EAD'), ['READY'])).toBe(false)
    expect(ok(text(4, 'EAD'), ['IDLE'])).toBe(true)
  })
  it('읽은 줄이 없으면 맞은 수 0 — 접미사가 없으면 실패', () => {
    expect(ok(text(1, 'READY'), [])).toBe(false)
    expect(ok(text(2, 'READY'), [])).toBe(false)
  })
  it('글 비교인데 연산이 수 쪽이면(5~10) 어느 줄도 맞지 않는다', () => {
    expect(ok(text(5, 'READY'), ['READY'])).toBe(false)
  })
  it('응답: 읽은 줄을 " @@ " 로 잇고, 신뢰도는 글자마다 ":<정수>" — TX·TY 는 0', () => {
    expect(judgeOcr(text(1, 'AB'), ['AB', 'C D'], 87)).toEqual({ IsAccepted: true, FoundResult: 'AB @@ C D', Confidence: ':87:87:87:87:87', TX: 0, TY: 0 })
  })
})

describe('judgeOcr — 다중 검사 접미사 `@@@@{개수}-{연산}`', () => {
  const lines = ['READY', 'READY', 'IDLE']
  it('첫 @@@@ 앞이 기대 글이다. 연산 0 같음 · 1 개수 ≤ 맞은 수 · 2 개수 ≥ 맞은 수', () => {
    expect(ok(text(1, 'READY@@@@2-0'), lines)).toBe(true)
    expect(ok(text(1, 'READY@@@@1-0'), lines)).toBe(false)
    expect(ok(text(1, 'READY@@@@2-1'), lines)).toBe(true)
    expect(ok(text(1, 'READY@@@@3-1'), lines)).toBe(false)
    expect(ok(text(1, 'READY@@@@2-2'), lines)).toBe(true)
    expect(ok(text(1, 'READY@@@@1-2'), lines)).toBe(false)
  })
  it('`@@@@0-2`(0개 이하)는 하나도 맞지 않을 때 성공, `@@@@0-0` 도', () => {
    expect(ok(text(1, 'NONE@@@@0-2'), lines)).toBe(true)
    expect(ok(text(1, 'NONE@@@@0-0'), lines)).toBe(true)
    expect(ok(text(1, 'READY@@@@0-0'), lines)).toBe(false)
  })
  it('모르는 연산(3 이상)은 실패', () => {
    expect(ok(text(1, 'READY@@@@2-3'), lines)).toBe(false)
  })
  it('예외가 나는 접미사는 던진다: `-` 없음 · 수가 아님 · `@` 로 끝나는 값(구분자가 한 칸 앞에서 잡힌다)', () => {
    expect(() => judgeOcr(text(1, 'READY@@@@2'), lines)).toThrow()
    expect(() => judgeOcr(text(1, 'READY@@@@a-1'), lines)).toThrow()
    expect(() => judgeOcr(text(1, 'READY@@@@2-'), lines)).toThrow()
    expect(() => judgeOcr(text(1, 'AB@' + '@@@@2-1'), ['AB@', 'AB@'])).toThrow()
  })
  it('값 종류·연산이 범위 밖이면 던진다', () => {
    expect(() => judgeOcr(text(11, 'A'), ['A'])).toThrow()
    expect(() => judgeOcr({ ...text(1, 'A'), OcrValueType: 4 }, ['A'])).toThrow()
  })
  it('값 종류 0(없음)·3(정규식)은 어느 줄도 맞지 않는다', () => {
    expect(ok({ ...text(1, 'A'), OcrValueType: 0 }, ['A'])).toBe(false)
    expect(ok({ ...text(1, 'A'), OcrValueType: 3 }, ['A'])).toBe(false)
  })
})

describe('judgeOcr — 수 비교(값 종류 2, 연산 5~10)', () => {
  it('5 같음 · 6 다름 · 9 값 > 읽은 수 · 10 값 < 읽은 수', () => {
    expect(ok(number(5, { NumberValue: 12.5 }), ['12.5'])).toBe(true)
    expect(ok(number(5, { NumberValue: 12.5 }), ['12.50'])).toBe(true)
    expect(ok(number(5, { NumberValue: 12.5 }), ['13'])).toBe(false)
    expect(ok(number(6, { NumberValue: 12.5 }), ['13'])).toBe(true)
    expect(ok(number(9, { NumberValue: 10 }), ['9'])).toBe(true)
    expect(ok(number(9, { NumberValue: 10 }), ['10'])).toBe(false)
    expect(ok(number(10, { NumberValue: 10 }), ['11'])).toBe(true)
    expect(ok(number(10, { NumberValue: 10 }), ['10'])).toBe(false)
  })
  it('7 범위 안은 경계를 포함한다 · 8 범위 밖도 경계에서 참이다', () => {
    const range = { NumberRangeMin: 10, NumberRangeMax: 20 }
    expect([10, 15, 20, 9.9, 20.1].map((v) => ok(number(7, range), [String(v)]))).toEqual([true, true, true, false, false])
    expect([10, 15, 20, 9.9, 20.1].map((v) => ok(number(8, range), [String(v)]))).toEqual([true, false, true, true, true])
  })
  it('줄 안의 빈칸을 지우고 수로 바꾼다 — 응답의 읽은 값도 바뀐 수이고 신뢰도는 빈 글', () => {
    expect(judgeOcr(number(5, { NumberValue: 1234 }), ['1 2 3 4', '7.50'])).toEqual({ IsAccepted: true, FoundResult: '1234 @@ 7.5', Confidence: '', TX: 0, TY: 0 })
  })
  it('수가 아닌 줄은 그대로 두고, 수처럼 생긴 글자만 모아 견준다(`12V` → 12)', () => {
    const out = judgeOcr(number(5, { NumberValue: 12 }), ['12V'])
    expect(out.FoundResult).toBe('12V')
    expect(out.IsAccepted).toBe(true)
  })
  it('수를 하나도 못 뽑은 줄은 가장 작은 수로 견준다 — "다름"·"값 > 읽은 수" 가 참이 된다(판정 서버 그대로)', () => {
    expect(ok(number(5, { NumberValue: 0 }), ['abc'])).toBe(false)
    expect(ok(number(6, { NumberValue: 0 }), ['abc'])).toBe(true)
    expect(ok(number(9, { NumberValue: 0 }), ['abc'])).toBe(true)
    expect(ok(number(10, { NumberValue: 0 }), ['abc'])).toBe(false)
  })
  it('다중 검사: 접미사만 있는 TextValue(`@@@@2-1`)를 받고, 빈칸으로 쪼갠 조각마다 센다', () => {
    const range = { NumberRangeMin: 10, NumberRangeMax: 20 }
    expect(ok(number(7, range, '@@@@2-1'), ['12', '15', '99'])).toBe(true)
    expect(ok(number(7, range, '@@@@3-1'), ['12', '15', '99'])).toBe(false)
    expect(ok(number(7, range, '@@@@2-0'), ['12', '15', '99'])).toBe(true)
    // 수가 아닌 줄은 빈칸이 남아 있다 — 다중 검사일 때만 조각으로 나뉜다
    expect(judgeOcr(number(7, range, '@@@@2-1'), ['12V 15V']).FoundResult).toBe('12V @@ 15V')
    expect(judgeOcr(number(7, range), ['12V 15V']).FoundResult).toBe('12V 15V')
  })
})
