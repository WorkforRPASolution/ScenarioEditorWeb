import { describe, it, expect } from 'vitest'
import {
  HIDING_LIMIT, UNCHECKED, blankWindow, blankWindows, targetState, hidingState, sameWindow, sameCondition, cleanWindow, windowErrors,
  setCheck, parseCoord, pasteHiding, windowChanges, windowsSummary, normalizeWindows
} from '../editor/windows'

// 창 조건(대상 창·숨길 창) 화면 모델 — P2-F 설계 §3·§6·§7. 판정은 서버(domain/targetWindow·windowsModel)와 같은 표다.
const win = (text, className, over = {}) => ({ text, className, checkRect: false, left: 0, top: 0, right: 0, bottom: 0, ...over })
const row = (origin, text, className, over) => ({ origin, ...win(text, className, over) })

describe('targetState — 에이전트가 대상 창을 찾는가', () => {
  it.each([
    [win('EQ Main', 'MainFrame'), { level: 'ok', reasonCode: null, matchMode: 'exact' }],
    [win('EQ Main*', 'MainFrame'), { level: 'ok', reasonCode: null, matchMode: 'partial' }],
    [win('', ''), { level: 'none', reasonCode: 'TEXT_EMPTY', matchMode: null }],
    [win('   ', ''), { level: 'none', reasonCode: 'TEXT_EMPTY', matchMode: null }],
    [win('', 'MainFrame'), { level: 'warn', reasonCode: 'TEXT_EMPTY', matchMode: null }],
    [win('*', 'MainFrame'), { level: 'warn', reasonCode: 'TEXT_STAR', matchMode: null }],
    [win('EQ Main', ''), { level: 'warn', reasonCode: 'CLASS_EMPTY', matchMode: null }],
    [win('EQ Main', '  '), { level: 'warn', reasonCode: 'CLASS_EMPTY', matchMode: null }]
  ])('%o', (w, want) => expect(targetState(w)).toEqual(want))
})

describe('hidingState — 에이전트가 숨길 창을 찾는가', () => {
  it.each([
    [win('Popup', 'Dlg'), { level: 'ok', code: 'FOUND' }],
    [win('', 'Dlg'), { level: 'ok', code: 'ANY_TITLE' }],
    [win('Popup', ''), { level: 'bad', code: 'CLASS_EMPTY' }],
    [win('Popup', '  '), { level: 'bad', code: 'CLASS_EMPTY' }],
    [win(' Popup* ', 'Dlg'), { level: 'warn', code: 'SPACE' }],
    [win('Popup', 'Dlg '), { level: 'warn', code: 'SPACE' }],
    [win('L', 'W', { checkRect: true, left: -218 }), { level: 'warn', code: 'FIXED_SIZE' }],
    [win('L', 'W', { checkRect: false, left: -218 }), { level: 'ok', code: 'FOUND' }]
  ])('%o', (w, want) => expect(hidingState(w)).toEqual(want))
})

describe('같은 값·같은 조건', () => {
  it('sameWindow: 일곱 칸이 모두 같아야 한다(origin 은 보지 않는다)', () => {
    expect(sameWindow(row(0, 'a', 'A'), win('a', 'A'))).toBe(true)
    expect(sameWindow(win('a', 'A'), win('a ', 'A'))).toBe(false)
    expect(sameWindow(win('a', 'A'), win('a', 'A', { bottom: 1 }))).toBe(false)
  })
  it('sameCondition: 앞뒤 공백을 뺀 글자와 위치 확인, 켜졌으면 좌표까지', () => {
    expect(sameCondition(win('a', 'A'), win(' a ', 'A'))).toBe(true)
    expect(sameCondition(win('a', 'A', { left: 1 }), win('a', 'A', { left: 2 }))).toBe(true)
    expect(sameCondition(win('a', 'A', { checkRect: true, left: 1 }), win('a', 'A', { checkRect: true, left: 2 }))).toBe(false)
  })
})

describe('입력 값 다듬기·검사', () => {
  it('parseCoord: 정수 글자만(Int32), 그 밖은 null', () => {
    expect(['0', '-18', ' 42 ', '2147483647', '-2147483648'].map(parseCoord)).toEqual([0, -18, 42, 2147483647, -2147483648])
    expect(['', 'a', '1.5', '1e3', '2147483648', '--1', null, undefined].map(parseCoord)).toEqual([null, null, null, null, null, null, null, null])
  })
  it('setCheck: 끄면 좌표가 -18(사내 전처리 창과 같다), 켜면 값은 그대로', () => {
    expect(UNCHECKED).toBe(-18)
    expect(setCheck(win('a', 'A', { checkRect: true, left: 1, top: 2, right: 3, bottom: 4 }), false)).toEqual(win('a', 'A', { left: -18, top: -18, right: -18, bottom: -18 }))
    expect(setCheck(win('a', 'A', { left: -18, top: -18, right: -18, bottom: -18 }), true)).toEqual(win('a', 'A', { checkRect: true, left: -18, top: -18, right: -18, bottom: -18 }))
  })
  it('cleanWindow: 제목·클래스 앞뒤 공백을 지운다', () => {
    expect(cleanWindow(row(null, '  Popup* ', ' Dlg '))).toEqual(row(null, 'Popup*', 'Dlg'))
  })
  it('windowErrors(숨길 창): 클래스 필수, 위치 확인이 켜졌으면 좌표 네 칸이 정수', () => {
    expect(windowErrors({ text: 'a', className: 'A', checkRect: false, coords: ['x', '', '', ''] }, { hiding: true })).toEqual({})
    expect(windowErrors({ text: 'a', className: '  ', checkRect: false, coords: ['-18', '-18', '-18', '-18'] }, { hiding: true })).toEqual({ className: 'SEW_PP_ERR_CLASS' })
    expect(windowErrors({ text: 'a', className: 'A', checkRect: true, coords: ['0', '0', '80o', '600'] }, { hiding: true })).toEqual({ coords: 'SEW_PP_ERR_COORD' })
  })
  it('windowErrors(대상 창): 클래스는 묻지 않는다(찾지 않는 값은 상태 줄이 알린다), 좌표만 본다', () => {
    expect(windowErrors({ text: 'EQ', className: '', checkRect: false, coords: ['0', '0', '0', '0'] }, { hiding: false })).toEqual({})
    expect(windowErrors({ text: 'EQ', className: '', checkRect: true, coords: ['0', '0', '0', '1.5'] }, { hiding: false })).toEqual({ coords: 'SEW_PP_ERR_COORD' })
  })
})

describe('pasteHiding — 붙여넣기', () => {
  const clip = [win('a', 'A'), win('b', 'B'), win('c', 'C')]
  it('같은 조건은 건너뛰고, 붙은 줄은 새 줄(origin null)·복사본이다', () => {
    const list = [row(0, 'a ', 'A')]
    const r = pasteHiding(list, clip)
    expect(r).toMatchObject({ added: 2, same: 1, over: 0 })
    expect(r.list).toEqual([row(0, 'a ', 'A'), row(null, 'b', 'B'), row(null, 'c', 'C')])
    expect(r.list[1]).not.toBe(clip[1])
    expect(list).toHaveLength(1)
  })
  it('한도 20개까지만 붙이고 넘친 수를 알린다. 묶음 안의 같은 조건도 한 번만', () => {
    const list = Array.from({ length: 19 }, (_, i) => row(i, 'p' + i, 'C' + i))
    const r = pasteHiding(list, [win('x', 'X'), win('x', 'X'), win('y', 'Y')])
    expect(r).toMatchObject({ added: 1, same: 1, over: 1 })
    expect(r.list).toHaveLength(HIDING_LIMIT)
    expect(pasteHiding(r.list, clip)).toMatchObject({ added: 0, same: 0, over: 3 })
  })
})

describe('windowChanges — 저장 기준점과 견준 변경', () => {
  const base = { target: win('EQ', 'Main'), hiding: [row(0, 'a', 'A'), row(1, 'b', 'B'), row(2, 'c', 'C')] }
  it('같으면 변경 없음(origin 을 잃은 같은 값도 같다)', () => {
    expect(windowChanges(base, JSON.parse(JSON.stringify(base)), { byOrigin: true })).toEqual({ target: null, hiding: null })
  })
  it('대상 창: 이전 → 지금', () => {
    const now = { ...base, target: win('EQ*', 'Main') }
    expect(windowChanges(now, base, { byOrigin: true }).target).toEqual({ before: base.target, after: now.target })
  })
  it('숨길 창(같은 출처): 자리(origin)로 맞춰 고침·더함·지움을 가른다', () => {
    const now = { ...base, hiding: [row(0, 'a', 'A2'), row(2, 'c', 'C'), row(null, 'n', 'N')] }
    expect(windowChanges(now, base, { byOrigin: true }).hiding).toEqual({
      added: [row(null, 'n', 'N')], removed: [row(1, 'b', 'B')], changed: [{ before: row(0, 'a', 'A'), after: row(0, 'a', 'A2') }]
    })
  })
  it('숨길 창(다른 출처 — 되돌려 연 세션): 내용으로만 견준다(고침은 지움 + 더함)', () => {
    const now = { ...base, hiding: [row(0, 'b', 'B'), row(1, 'z', 'Z')] } // origin 은 옛 판의 자리라 뜻이 다르다
    expect(windowChanges(now, base, { byOrigin: false }).hiding).toEqual({ added: [row(1, 'z', 'Z')], removed: [row(0, 'a', 'A'), row(2, 'c', 'C')], changed: [] })
  })
  it('어느 한쪽에 창 조건이 없으면(옛 초안) 견주지 않는다', () => {
    expect(windowChanges(undefined, base, { byOrigin: true })).toEqual({ target: null, hiding: null })
    expect(windowChanges(base, undefined, { byOrigin: true })).toEqual({ target: null, hiding: null })
  })
})

describe('windowsSummary·normalizeWindows·빈 값', () => {
  it('바 요약: 대상 창 상태와 숨길 창 수, 확인할 줄 수', () => {
    expect(windowsSummary({ target: win('EQ*', 'Main'), hiding: [win('a', 'A'), win('', 'B')] })).toEqual({ target: 'ok', hiding: 2, attention: 0 })
    expect(windowsSummary({ target: win('*', 'Main'), hiding: [win('a', ''), win(' b', 'B'), win('c', 'C')] })).toEqual({ target: 'warn', hiding: 3, attention: 2 })
    expect(windowsSummary(blankWindows())).toEqual({ target: 'none', hiding: 0, attention: 0 })
    expect(windowsSummary(undefined)).toBeNull()
  })
  it('normalizeWindows: 일곱 칸과 origin 만 남긴 복사본(화면용 표시는 버린다)', () => {
    const src = { target: { ...win('EQ', 'Main'), extra: 1 }, hiding: [{ ...row(null, 'a', 'A'), isNew: true }] }
    const out = normalizeWindows(src)
    expect(out).toEqual({ target: win('EQ', 'Main'), hiding: [row(null, 'a', 'A')] })
    expect(out.hiding[0]).not.toBe(src.hiding[0])
  })
  it('빈 값', () => {
    expect(blankWindow()).toEqual(win('', ''))
    expect(blankWindows()).toEqual({ target: win('', ''), hiding: [] })
  })
})
