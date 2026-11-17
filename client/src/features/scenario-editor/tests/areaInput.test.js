import { describe, it, expect } from 'vitest'
import { AREA_KEYS, areaIn, typeArea, areaText, withArea, areaIssue, sameArea } from '../editor/areaInput'

describe('areaIn — 영역 칸에 친 글자 → 값', () => {
  it('빈 칸은 null, 앞뒤 공백은 지운다', () => {
    expect(areaIn('')).toBe(null)
    expect(areaIn('   ')).toBe(null)
    expect(areaIn(null)).toBe(null)
    expect(areaIn(' 120 ')).toBe(120)
  })
  it('숫자로만 된 글자(앞에 - 하나까지)만 수가 된다', () => {
    expect(areaIn('0')).toBe(0)
    expect(areaIn('1920')).toBe(1920)
    expect(areaIn('007')).toBe(7)
    expect(areaIn('-5')).toBe(-5)
  })
  it('소수점·글자·지수·16진 꼴·너무 큰 수는 친 글자 그대로 남긴다(칸 검사가 잡는다)', () => {
    for (const s of ['12.5', '12.', '.5', '12a', 'abc', '1e3', '0x10', '+5', '1 2', '1,000', '--5', '99999999999999999999']) expect(areaIn(s), s).toBe(s)
  })
})

describe('typeArea — 한 칸에 친 글자를 조건에 넣는다(영역은 마지막 바른 값으로 남는다)', () => {
  const area = { x: 10, y: 20, w: 300, h: 200 }
  const cond = { kind: 'image', searchArea: area, image: { accept: 0.9 } }
  it('정수를 치면 그 칸만 바뀐 새 영역', () => {
    const r = typeArea(cond, 'w', ' 310 ')
    expect(r).toEqual({ kind: 'image', searchArea: { x: 10, y: 20, w: 310, h: 200 }, image: { accept: 0.9 } })
    expect(r.image).toBe(cond.image)
    expect('areaTyped' in r).toBe(false)
  })
  it('값이 같으면 같은 조건 객체', () => {
    expect(typeArea(cond, 'x', '10')).toBe(cond)
    expect(typeArea(cond, 'x', ' 10 ')).toBe(cond)
  })
  it('글자·소수점·빈 칸은 영역을 바꾸지 않고 친 글자만 따로 쥔다(areaTyped)', () => {
    const r = typeArea(cond, 'w', '31o')
    expect(r.searchArea).toBe(area)
    expect(r.areaTyped).toEqual({ w: '31o' })
    expect(typeArea(r, 'h', '2.5').areaTyped).toEqual({ w: '31o', h: '2.5' })
    expect(typeArea(r, 'w', '').areaTyped).toEqual({ w: '' })
    expect(typeArea(r, 'w', '31o')).toBe(r) // 같은 글자
  })
  it('쥔 글자를 바른 수로 고치면 영역에 들어가고 쥔 글자는 사라진다 — 다른 칸은 남는다', () => {
    const r = typeArea(typeArea(cond, 'w', '31o'), 'h', '')
    const fixed = typeArea(r, 'w', '310')
    expect(fixed.searchArea).toEqual({ x: 10, y: 20, w: 310, h: 200 })
    expect(fixed.areaTyped).toEqual({ h: '' })
    const done = typeArea(fixed, 'h', '200')
    expect(done.searchArea).toBe(fixed.searchArea)
    expect('areaTyped' in done).toBe(false)
  })
  it('쥔 글자를 원래 값으로 되돌리면 처음 조건과 같은 값', () => {
    expect(typeArea(typeArea(cond, 'w', 'x'), 'w', '300')).toEqual(cond)
  })
  it('영역이 없으면(새 스텝) 친 글자를 쥐고 있다가 네 칸이 모두 정수가 되면 영역이 된다', () => {
    const none = { kind: 'ocr', searchArea: null }
    const a = typeArea(none, 'y', '5')
    expect(a).toEqual({ kind: 'ocr', searchArea: null, areaTyped: { y: '5' } })
    const b = typeArea(typeArea(a, 'x', '4'), 'w', '6o')
    expect(b.searchArea).toBe(null)
    expect(b.areaTyped).toEqual({ y: '5', x: '4', w: '6o' })
    const c = typeArea(typeArea(b, 'h', '70'), 'w', '60')
    expect(c).toEqual({ kind: 'ocr', searchArea: { x: 4, y: 5, w: 60, h: 70 } })
  })
  it('영역이 없을 때 빈 칸은 쥐지 않는다 — 다 지우면 처음과 같다', () => {
    const none = { kind: 'ocr', searchArea: null }
    expect(typeArea(none, 'y', '')).toBe(none)
    expect(typeArea(typeArea(none, 'y', '5'), 'y', ' ')).toEqual(none)
  })
  it('칸 이름은 x·y·w·h 넷', () => { expect(AREA_KEYS).toEqual(['x', 'y', 'w', 'h']) })
})

describe('areaText — 칸에 보일 글자', () => {
  it('쥔 글자가 먼저, 없으면 영역의 값, 영역도 없으면 빈 칸', () => {
    const c = { searchArea: { x: 10, y: 20, w: 300, h: 200 }, areaTyped: { w: '31o', h: '' } }
    expect(AREA_KEYS.map((k) => areaText(c, k))).toEqual(['10', '20', '31o', ''])
    expect(AREA_KEYS.map((k) => areaText({ searchArea: null, areaTyped: { y: '5' } }, k))).toEqual(['', '5', '', ''])
    expect(areaText(undefined, 'x')).toBe('')
  })
})

describe('withArea — 마우스로 잡은 영역(쥔 글자를 버린다)', () => {
  it('영역을 바꾸고 areaTyped 를 없앤다', () => {
    const c = { kind: 'image', searchArea: { x: 1, y: 2, w: 3, h: 4 }, areaTyped: { w: 'x' } }
    const r = { x: 5, y: 6, w: 7, h: 8 }
    expect(withArea(c, r)).toEqual({ kind: 'image', searchArea: r })
    expect(withArea(c, r).searchArea).toBe(r)
  })
})

describe('sameArea', () => {
  it('네 값이 같으면 같다', () => {
    expect(sameArea({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 4 })).toBe(true)
    expect(sameArea({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 5 })).toBe(false)
    expect(sameArea(null, null)).toBe(true)
    expect(sameArea(null, { x: 1, y: 2, w: 3, h: 4 })).toBe(false)
  })
})

describe('areaIssue — 영역 값 검사(조건을 받는다)', () => {
  const screen = { w: 1920, h: 1200 }
  const ok = { x: 10, y: 20, w: 300, h: 200 }
  const issue = (a, opt) => areaIssue({ searchArea: a }, { screen, changed: true, ...opt })
  it('바른 영역은 null', () => {
    expect(issue(ok)).toBe(null)
    expect(issue({ x: 0, y: 0, w: 1920, h: 1200 })).toBe(null) // 화면 전체
    expect(issue({ x: 1919, y: 1199, w: 1, h: 1 })).toBe(null) // 오른쪽 아래 끝 한 점
  })
  it('영역이 없으면 AREA_INVALID(서버 code)', () => {
    expect(issue(null)).toEqual({ code: 'AREA_INVALID', params: {} })
    expect(issue(undefined)).toEqual({ code: 'AREA_INVALID', params: {} })
    expect(areaIssue(undefined)).toEqual({ code: 'AREA_INVALID', params: {} })
  })
  it('쥔 글자(areaTyped)가 있으면 늘 오류다 — 정수 아님이 먼저, 그다음 빈 칸', () => {
    expect(areaIssue({ searchArea: ok, areaTyped: { w: '31o' } })).toEqual({ code: 'AREA_NOT_INTEGER', params: { names: 'W', keys: ['w'] } })
    expect(areaIssue({ searchArea: ok, areaTyped: { h: '2.5', x: 'a' } })).toEqual({ code: 'AREA_NOT_INTEGER', params: { names: 'X·H', keys: ['x', 'h'] } })
    expect(areaIssue({ searchArea: ok, areaTyped: { w: '' } })).toEqual({ code: 'AREA_FIELD_EMPTY', params: { names: 'W', keys: ['w'] } })
    expect(areaIssue({ searchArea: ok, areaTyped: { w: '', h: 'z' } }).code).toBe('AREA_NOT_INTEGER')
  })
  it('영역이 없을 때 쥔 글자: 틀린 글자가 먼저, 아니면 아직 치지 않은 칸', () => {
    expect(areaIssue({ searchArea: null, areaTyped: { x: '4', w: '6o' } })).toEqual({ code: 'AREA_NOT_INTEGER', params: { names: 'W', keys: ['w'] } })
    expect(areaIssue({ searchArea: null, areaTyped: { x: '4', w: '60' } })).toEqual({ code: 'AREA_FIELD_EMPTY', params: { names: 'Y·H', keys: ['y', 'h'] } })
  })
  it('영역 값 자체가 빈 칸·정수가 아닐 때도 잡는다(저장돼 있던 값)', () => {
    expect(issue({ x: null, y: 5, w: null, h: 3 })).toEqual({ code: 'AREA_FIELD_EMPTY', params: { names: 'X·W', keys: ['x', 'w'] } })
    expect(issue({ ...ok, x: '12.5' })).toEqual({ code: 'AREA_NOT_INTEGER', params: { names: 'X', keys: ['x'] } })
    expect(issue({ ...ok, y: 'abc', h: 2.5 })).toEqual({ code: 'AREA_NOT_INTEGER', params: { names: 'Y·H', keys: ['y', 'h'] } })
    expect(issue({ ...ok, w: NaN })).toEqual({ code: 'AREA_NOT_INTEGER', params: { names: 'W', keys: ['w'] } })
  })
  it('폭·높이는 1 이상', () => {
    expect(issue({ ...ok, w: 0 })).toEqual({ code: 'AREA_SIZE_MIN', params: { names: 'W', keys: ['w'] } })
    expect(issue({ ...ok, w: -3, h: 0 })).toEqual({ code: 'AREA_SIZE_MIN', params: { names: 'W·H', keys: ['w', 'h'] } })
  })
  it('X·Y 는 0 이상', () => {
    expect(issue({ ...ok, x: -1 })).toEqual({ code: 'AREA_NEGATIVE', params: { names: 'X', keys: ['x'] } })
    expect(issue({ ...ok, x: -1, y: -2 })).toEqual({ code: 'AREA_NEGATIVE', params: { names: 'X·Y', keys: ['x', 'y'] } })
  })
  it('화면 오른쪽·아래로 나가면 — 오른쪽 먼저', () => {
    expect(issue({ x: 1700, y: 20, w: 300, h: 200 })).toEqual({ code: 'AREA_OUT_RIGHT', params: { w: 1920, h: 1200, sum: 2000, keys: ['x', 'w'] } })
    expect(issue({ x: 10, y: 1100, w: 300, h: 200 })).toEqual({ code: 'AREA_OUT_BOTTOM', params: { w: 1920, h: 1200, sum: 1300, keys: ['y', 'h'] } })
    expect(issue({ x: 1700, y: 1100, w: 300, h: 200 }).code).toBe('AREA_OUT_RIGHT')
  })
  it('화면 크기를 모르면 화면 밖을 보지 않는다', () => {
    const far = { searchArea: { x: 5000, y: 20, w: 300, h: 200 } }
    expect(areaIssue(far, { screen: null, changed: true })).toBe(null)
    expect(areaIssue(far, { changed: true })).toBe(null)
    expect(areaIssue(far, { screen: { w: 0, h: 0 }, changed: true })).toBe(null)
  })
  it('바꾸지 않은 옛 값은 음수·화면 밖이어도 두고(서버가 받는 값), 정수·크기는 늘 본다', () => {
    expect(issue({ x: -4, y: 20, w: 300, h: 200 }, { changed: false })).toBe(null)
    expect(issue({ x: 1900, y: 20, w: 300, h: 200 }, { changed: false })).toBe(null)
    expect(issue({ ...ok, w: 0 }, { changed: false }).code).toBe('AREA_SIZE_MIN')
    expect(issue({ ...ok, x: 1.5 }, { changed: false }).code).toBe('AREA_NOT_INTEGER')
    expect(areaIssue({ searchArea: ok })).toBe(null) // 옵션 없이도
  })
})
