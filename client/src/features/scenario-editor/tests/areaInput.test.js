import { describe, it, expect } from 'vitest'
import { AREA_KEYS, AREA_MAX, areaIn, typeArea, areaText, withArea, areaIssue, sameArea } from '../editor/areaInput'
import { PANEL_OWN_CODES } from '../editor/panel'

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
    expect(areaIn('+5')).toBe(5)
  })
  it('전각 숫자는 반각으로 읽는다(한글 입력기)', () => {
    expect(areaIn('１２０')).toBe(120)
    expect(areaIn('－５')).toBe(-5)
  })
  it('아주 큰 수도 수로 읽는다 — 한도 검사가 "너무 큽니다" 로 잡는다(정수가 아니라고 하지 않는다)', () => {
    expect(areaIn('99999999999')).toBe(99999999999)
    expect(areaIn('99999999999999999999')).toBeGreaterThan(AREA_MAX)
    expect(Number.isFinite(areaIn('9'.repeat(400)))).toBe(true)
  })
  it('소수점·글자·지수·16진 꼴·너무 큰 수는 친 글자 그대로 남긴다(칸 검사가 잡는다)', () => {
    for (const s of ['12.5', '12.', '.5', '12a', 'abc', '1e3', '0x10', '+-5', '1 2', '1,000', '--5']) expect(areaIn(s), s).toBe(s)
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
  it('정수여도 영역에 넣을 수 없는 값(폭·높이 1 미만, 음수, 한도 초과)은 쥔다 — 영역은 마지막 바른 값으로 남는다', () => {
    for (const [k, text] of [['w', '0'], ['h', '-3'], ['x', '-1'], ['y', '-20'], ['x', String(AREA_MAX + 1)], ['w', '99999999999']]) {
      const r = typeArea(cond, k, text)
      expect(r.searchArea, `${k}=${text}`).toBe(area)
      expect(r.areaTyped, `${k}=${text}`).toEqual({ [k]: text })
    }
    expect(typeArea(cond, 'x', '0').searchArea).toEqual({ x: 0, y: 20, w: 300, h: 200 })
    expect(typeArea(cond, 'w', String(AREA_MAX)).searchArea.w).toBe(AREA_MAX)
  })
  it('영역이 없을 때도 넣을 수 없는 값이 하나라도 있으면 영역을 만들지 않는다', () => {
    let c = { kind: 'image', searchArea: null }
    for (const [k, text] of [['x', '5'], ['y', '6'], ['w', '0'], ['h', '7']]) c = typeArea(c, k, text)
    expect(c.searchArea).toBe(null)
    expect(c.areaTyped).toEqual({ x: '5', y: '6', w: '0', h: '7' })
    expect(typeArea(c, 'w', '8').searchArea).toEqual({ x: 5, y: 6, w: 8, h: 7 })
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
  it('쥔 글자가 정수여도 넣을 수 없는 값이면 그 이유: 폭·높이 1 미만 → 음수 → 한도 초과', () => {
    expect(areaIssue({ searchArea: ok, areaTyped: { w: '0' } })).toEqual({ code: 'AREA_SIZE_MIN', params: { names: 'W', keys: ['w'] } })
    expect(areaIssue({ searchArea: ok, areaTyped: { x: '-1', y: '-2' } })).toEqual({ code: 'AREA_NEGATIVE', params: { names: 'X·Y', keys: ['x', 'y'] } })
    expect(areaIssue({ searchArea: ok, areaTyped: { h: '70000' } })).toEqual({ code: 'AREA_TOO_LARGE', params: { names: 'H', keys: ['h'], max: AREA_MAX } })
    expect(areaIssue({ searchArea: ok, areaTyped: { h: '70000', w: '0' } }).code).toBe('AREA_SIZE_MIN')
    expect(areaIssue({ searchArea: null, areaTyped: { x: '5', y: '6', w: '0', h: '7' } })).toEqual({ code: 'AREA_SIZE_MIN', params: { names: 'W', keys: ['w'] } })
    // 화면 크기를 몰라도 한도는 늘 본다(독립 검토 I1)
    expect(areaIssue(typeArea({ searchArea: ok }, 'w', '99999999999'), { screen: null, changed: true }).code).toBe('AREA_TOO_LARGE')
  })
  it('쥔 글자가 있으면 어떤 경우에도 null 이 아니다(작업본으로 새지 않는 근거)', () => {
    const texts = ['', '5', '0', '-1', 'a', '1.5', '70000']
    for (const area of [ok, null]) for (const k of AREA_KEYS) for (const t1 of texts) for (const k2 of AREA_KEYS) for (const t2 of texts) {
      const typed = { [k]: t1, [k2]: t2 }
      expect(areaIssue({ searchArea: area, areaTyped: typed }, { screen, changed: true }), JSON.stringify([area, typed])).not.toBe(null)
    }
  })
  it('칸 검사가 내는 영역 code 는 모두 패널 알림 줄에서 빠진다(PANEL_OWN_CODES — 같은 말이 두 번 나오지 않게)', () => {
    for (const c of ['AREA_INVALID', 'AREA_FIELD_EMPTY', 'AREA_NOT_INTEGER', 'AREA_SIZE_MIN', 'AREA_NEGATIVE', 'AREA_TOO_LARGE', 'AREA_OUT_RIGHT', 'AREA_OUT_BOTTOM']) expect(PANEL_OWN_CODES.has(c), c).toBe(true)
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
  it('영역에 들어 있는 음수(저장돼 있던 값)는 다른 칸을 고쳐도 막지 않는다 — 음수는 칠 때 잡는다', () => {
    expect(issue({ ...ok, x: -1 })).toBe(null)
    expect(issue({ ...ok, x: -1, y: -2 }, { changed: ['w'] })).toBe(null)
  })
  it('화면 밖은 그 방향의 칸을 고쳤을 때만 본다(X·W → 오른쪽, Y·H → 아래)', () => {
    const out = { x: 1700, y: 1100, w: 300, h: 200 } // 오른쪽·아래 모두 밖
    expect(issue(out, { changed: [] })).toBe(null)
    expect(issue(out, { changed: ['y'] }).code).toBe('AREA_OUT_BOTTOM')
    expect(issue(out, { changed: ['h'] }).code).toBe('AREA_OUT_BOTTOM')
    expect(issue(out, { changed: ['x'] }).code).toBe('AREA_OUT_RIGHT')
    expect(issue(out, { changed: ['w', 'h'] }).code).toBe('AREA_OUT_RIGHT')
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
    expect(issue({ x: 1900, y: 20, w: 300, h: 200 }, { changed: false })).toBe(null)
    expect(issue({ ...ok, w: 0 }, { changed: false }).code).toBe('AREA_SIZE_MIN')
    expect(issue({ ...ok, x: 1.5 }, { changed: false }).code).toBe('AREA_NOT_INTEGER')
    expect(areaIssue({ searchArea: ok })).toBe(null) // 옵션 없이도
  })
})
