import { describe, it, expect } from 'vitest'
import { viewOf, sameMeaning, freshOf, windowsOf, targetRawFor, hidingRawFor, judgeHiding, sameCondition, HIDING_LIMIT } from '../../domain/windowsModel'

// 창 조건(대상 창·숨길 창, P2-F 설계 §4~§6). 저장값 = C# WindowSearchCondition, 편집 값 = { text, className, checkRect, left, top, right, bottom }.
const raw = (Text, ClassName, over = {}) => ({ Text, ClassName, IsCheckRectEqual: false, Left: 0, Top: 0, Right: 0, Bottom: 0, ...over })
const view = (text, className, over = {}) => ({ text, className, checkRect: false, left: 0, top: 0, right: 0, bottom: 0, ...over })

describe('viewOf — 저장값 → 편집 값', () => {
  it('값을 그대로 옮긴다', () => {
    expect(viewOf(raw('Popup*', 'Dlg', { IsCheckRectEqual: true, Left: 1, Top: 2, Right: 3, Bottom: 4 })))
      .toEqual({ text: 'Popup*', className: 'Dlg', checkRect: true, left: 1, top: 2, right: 3, bottom: 4 })
  })
  it('null·빠진 키·형이 틀린 값은 빈 값(문자열 "", 거짓, 0)', () => {
    expect(viewOf(raw(null, null))).toEqual(view('', ''))
    expect(viewOf({})).toEqual(view('', ''))
    expect(viewOf({ Text: 5, ClassName: ['x'], IsCheckRectEqual: 'yes', Left: '3', Top: 1.5 })).toEqual(view('', ''))
  })
  it('객체가 아니면(null·없음·배열) 빈 값', () => {
    for (const v of [null, undefined, [], 'x', 3]) expect(viewOf(v)).toEqual(view('', ''))
  })
})

describe('sameMeaning — 편집 값이 저장값과 같은 뜻인가', () => {
  it('null 과 "", 빠진 키와 C# 기본값은 같다', () => {
    expect(sameMeaning(view('', ''), raw(null, null))).toBe(true)
    expect(sameMeaning(view('', ''), {})).toBe(true)
    expect(sameMeaning(view('', ''), null)).toBe(true)
    expect(sameMeaning(view('', ''), undefined)).toBe(true)
    expect(sameMeaning(view('A', 'B'), { Text: 'A', ClassName: 'B' })).toBe(true)
  })
  it('글자·위치 확인·좌표 가운데 하나만 달라도 다르다(공백도 글자다)', () => {
    const r = raw('A', 'B', { Left: -18, Top: -18, Right: -18, Bottom: -18 })
    const v = viewOf(r)
    expect(sameMeaning(v, r)).toBe(true)
    expect(sameMeaning({ ...v, text: 'A ' }, r)).toBe(false)
    expect(sameMeaning({ ...v, className: '' }, r)).toBe(false)
    expect(sameMeaning({ ...v, checkRect: true }, r)).toBe(false)
    expect(sameMeaning({ ...v, bottom: -17 }, r)).toBe(false)
  })
  it('origin 같은 덧붙은 키는 보지 않는다', () => {
    expect(sameMeaning({ origin: 3, ...view('A', 'B') }, raw('A', 'B'))).toBe(true)
  })
})

describe('freshOf — 새로 쓰는 저장값', () => {
  it('C# 필드 7개를 순서대로, 빈 칸은 "" 로', () => {
    const f = freshOf({ origin: null, ...view('', 'Dlg', { checkRect: true, left: 1, top: 2, right: 3, bottom: 4 }) })
    expect(Object.keys(f)).toEqual(['Text', 'ClassName', 'IsCheckRectEqual', 'Left', 'Top', 'Right', 'Bottom'])
    expect(f).toEqual({ Text: '', ClassName: 'Dlg', IsCheckRectEqual: true, Left: 1, Top: 2, Right: 3, Bottom: 4 })
  })
})

describe('windowsOf — 뼈대 저장값(header.raw) → 편집 형식', () => {
  it('대상 창과 숨길 창(origin = 저장 목록의 자리)', () => {
    expect(windowsOf({ TargetWindowCondition: raw('EQ*', 'Main'), HidingWindowConditionList: [raw('a', 'A'), raw(null, 'B')] })).toEqual({
      target: view('EQ*', 'Main'),
      hiding: [{ origin: 0, ...view('a', 'A') }, { origin: 1, ...view('', 'B') }]
    })
  })
  it('키가 없거나 목록이 배열이 아니면 빈 값·빈 목록', () => {
    expect(windowsOf({})).toEqual({ target: view('', ''), hiding: [] })
    expect(windowsOf({ TargetWindowCondition: null, HidingWindowConditionList: null })).toEqual({ target: view('', ''), hiding: [] })
    expect(windowsOf(undefined)).toEqual({ target: view('', ''), hiding: [] })
  })
})

describe('targetRawFor·hidingRawFor — 조립이 쓸 값(undefined = 저장값 그대로 둔다)', () => {
  it('대상 창: 같은 뜻이면 손대지 않고, 다르면 새로 쓴다', () => {
    expect(targetRawFor(view('', ''), raw(null, null))).toBeUndefined()
    expect(targetRawFor(view('', ''), undefined)).toBeUndefined()
    expect(targetRawFor(view('EQ', ''), raw(null, null))).toEqual(raw('EQ', ''))
    expect(targetRawFor(view('', ''), raw('EQ', 'Main'))).toEqual(raw('', '')) // 지우면 "" (사내가 전처리 창을 닫았을 때와 같은 모양)
  })
  it('숨길 창: 고치지 않은 줄은 저장값 그대로(null 글자 포함), 고친 줄·새 줄만 새로 쓴다. 순서는 편집 값', () => {
    const stored = [raw(null, 'A'), raw('b ', 'B'), raw('c', 'C')]
    const views = windowsOf({ HidingWindowConditionList: stored }).hiding
    expect(hidingRawFor(views, stored)).toEqual(stored)
    const edited = [{ ...views[2], text: 'c2' }, views[0], { origin: null, ...view('new', 'N') }]
    const out = hidingRawFor(edited, stored)
    expect(out).toEqual([raw('c2', 'C'), raw(null, 'A'), raw('new', 'N')])
    expect(out[1]).not.toBe(stored[0]) // 복사본
  })
  it('숨길 창: 저장 목록이 배열이 아니고(null·없음) 편집 목록이 비면 손대지 않는다', () => {
    expect(hidingRawFor([], null)).toBeUndefined()
    expect(hidingRawFor([], undefined)).toBeUndefined()
    expect(hidingRawFor([], [])).toEqual([])
    expect(hidingRawFor([{ origin: null, ...view('', 'N') }], null)).toEqual([raw('', 'N')])
  })
  it('숨길 창: origin 이 저장 목록 밖이거나 고쳐 달라졌으면 새로 쓴다', () => {
    const stored = [raw('a', 'A')]
    expect(hidingRawFor([{ origin: 5, ...view('a', 'A') }], stored)).toEqual([raw('a', 'A')])
    expect(hidingRawFor([{ origin: 0, ...view('a', 'A', { checkRect: true, left: -18, top: -18, right: -18, bottom: -18 }) }], stored))
      .toEqual([raw('a', 'A', { IsCheckRectEqual: true, Left: -18, Top: -18, Right: -18, Bottom: -18 })])
  })
})

// ARSAgent utils/ControlMSWindow.scala RemoveWindow · system/MSWindow.scala getEnumWindows(2026-11-11, 사내와 같음)
describe('judgeHiding — 에이전트가 숨길 창을 찾는가', () => {
  it('클래스가 있으면 찾는다. 제목이 비면 제목은 보지 않는다', () => {
    expect(judgeHiding(raw('Popup', 'Dlg'))).toEqual({ finds: true, reasonCode: null, anyTitle: false, untrimmed: false, fixedSize: false })
    expect(judgeHiding(raw('', 'Dlg'))).toMatchObject({ finds: true, anyTitle: true })
  })
  it('클래스가 비거나 공백뿐이면 찾지 않는다', () => {
    expect(judgeHiding(raw('Popup', ''))).toMatchObject({ finds: false, reasonCode: 'CLASS_EMPTY' })
    expect(judgeHiding(raw('Popup', '   '))).toMatchObject({ finds: false, reasonCode: 'CLASS_EMPTY' })
  })
  it('제목·클래스가 null 이거나 조건이 객체가 아니면 값 없음(에이전트가 trim 에서 예외)', () => {
    expect(judgeHiding(raw(null, 'Dlg'))).toMatchObject({ finds: false, reasonCode: 'VALUE_NULL' })
    expect(judgeHiding(raw('x', null))).toMatchObject({ finds: false, reasonCode: 'VALUE_NULL' })
    expect(judgeHiding(null)).toMatchObject({ finds: false, reasonCode: 'VALUE_NULL' })
  })
  it('앞뒤 공백(DC-147)과 고정 크기(위치 확인 + 왼쪽 -218)를 알린다', () => {
    expect(judgeHiding(raw(' Popup* ', 'Dlg'))).toMatchObject({ finds: true, untrimmed: true })
    expect(judgeHiding(raw('Popup', 'Dlg '))).toMatchObject({ untrimmed: true })
    expect(judgeHiding(raw('L', 'W', { IsCheckRectEqual: true, Left: -218 }))).toMatchObject({ finds: true, fixedSize: true })
    expect(judgeHiding(raw('L', 'W', { IsCheckRectEqual: false, Left: -218 }))).toMatchObject({ fixedSize: false })
  })
})

describe('sameCondition — 같은 숨길 창인가(중복)', () => {
  it('앞뒤 공백을 뺀 제목·클래스와 위치 확인이 같고, 위치 확인이 켜졌으면 좌표도 같아야 한다', () => {
    expect(sameCondition(view('a', 'A'), view(' a ', 'A'))).toBe(true)
    expect(sameCondition(view('a', 'A'), view('a', 'B'))).toBe(false)
    expect(sameCondition(view('a', 'A', { left: 1 }), view('a', 'A', { left: 2 }))).toBe(true) // 꺼져 있으면 좌표는 보지 않는다
    expect(sameCondition(view('a', 'A', { checkRect: true, left: 1 }), view('a', 'A', { checkRect: true, left: 2 }))).toBe(false)
    expect(sameCondition(view('a', 'A', { checkRect: true }), view('a', 'A'))).toBe(false)
  })
  it('한도는 20개', () => expect(HIDING_LIMIT).toBe(20))
})
