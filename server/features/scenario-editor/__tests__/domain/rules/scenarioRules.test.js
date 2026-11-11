import { describe, it, expect } from 'vitest'
import { checkScenario } from '../../../domain/rules'
import { skeletonWith, rawStep, fresh, ctx, codesOf, okSource, okSteps, SUCCESS, FAIL } from './helpers'

const run = (mutate, { src = okSource(), c = ctx() } = {}) => { const e = fresh(src); mutate(e, c); return checkScenario(e, src, c) }
const blocks = (m, o) => codesOf(run(m, o).blocks)
const warns = (m, o) => codesOf(run(m, o).warns)
const none = () => {}

describe('시나리오 단위 막힘', () => {
  const cases = [
    ['NO_STEPS', (e) => { e.steps = [] }],
    ['BASE_IMAGE_MISSING', (e) => { e.steps[0].condition = { kind: 'ocr', skipPreprocessing: false, searchArea: { x: 0, y: 0, w: 5, h: 5 }, ocr: { op: 1, text: 'a', multi: { count: '1', op: 0 } } }; e.steps[0].images.base = { literal: 'AA==' } }, 'step'],
    ['LAST_STEP_NEXT', (e) => { e.steps[1].next.onFalse = { kind: 'next' } }],
    ['NEXT_SELF', (e) => { e.steps[0].next.onTrue = { kind: 'step', uid: 's0' } }],
    ['NEXT_OUT_OF_RANGE', (e) => { e.steps[0].next.onTrue = { kind: 'raw', value: 77 } }],
    ['NEXT_UNRESOLVED', (e) => { e.steps[0].next.onFalse = { kind: 'unresolved' } }],
    ['NEXT_UNRESOLVED', (e) => { e.steps[0].next.onFalse = { kind: 'step', uid: 'gone' } }],
    ['NO_SUCCESS', (e) => { e.steps[1].next.onTrue = { kind: 'end', value: 'SKIP' } }],
    ['FAP_TYPE_MISMATCH', (e) => { e.steps[0].action = { type: 13, raw: 'a@b@c@d' }; e.property.Type = 1 }, 'always'],
    ['MAIL_TITLE_EMPTY', (e) => { e.header.description = '' }],
    ['MAIL_TITLE_COLON', (e) => { e.header.description = 'a:b' }],
    ['NAME_EMPTY', (e, c) => { c.target.name = '' }],
    ['NAME_TOO_LONG', (e, c) => { c.target.name = 'a'.repeat(51) }],
    ['NAME_CHARS', (e, c) => { c.target.name = 'a b' }],
    ['NAME_CHARS', (e, c) => { c.target.name = 'ab\n' }],
    ['MODEL_MISSING', (e, c) => { c.target.model = '' }]
  ]
  for (const [code, mutate] of cases) {
    it(`${code} 막힘`, () => { expect(blocks(mutate)).toContain(code) })
  }
  it('통과하는 경우', () => {
    expect(blocks(none)).toEqual([])
    expect(blocks((e, c) => { c.target.name = 'a'.repeat(50) })).toEqual([])
    expect(blocks((e) => { e.steps[1].next.onFalse = { kind: 'end', value: 'SUCCESS' } })).toEqual([])
  })
  it('BI: 기준 화면이 없는 스텝은 막고, 기준 판 BI 해석 실패면 기준 화면을 쓰는 스텝도 막는다', () => {
    expect(blocks((e) => { e.steps[0].images.base = null })).toContain('BI_COUNT_MISMATCH')
    const broken = { ...okSource(), biCount: null }
    expect(blocks(none, { src: broken })).toContain('BI_COUNT_MISMATCH')
    expect(blocks(none)).not.toContain('BI_COUNT_MISMATCH')
  })
  it('SOURCE_PARSE_FAILED', () => {
    const bad = { ...okSource(), notes: [{ code: 'PARSE_FAILED', params: { field: 'steps' } }] }
    expect(blocks(none, { src: bad })).toContain('SOURCE_PARSE_FAILED')
    expect(blocks(none, { src: { ...okSource(), notes: [{ code: 'PARSE_FAILED', params: { field: 'bi' } }] } })).not.toContain('SOURCE_PARSE_FAILED')
  })
  it('TIMEOUT_INVALID', () => {
    for (const t of ['0', '', 'abc', '1.5', '-3', '2147483648', '01']) expect(blocks((e) => { e.header.timeoutLimit = t })).toContain('TIMEOUT_INVALID')
    for (const t of ['1', '240', '2147483647']) expect(blocks((e) => { e.header.timeoutLimit = t })).not.toContain('TIMEOUT_INVALID')
  })
  it('크기', () => {
    const big = { bodyBytes: 15 * 1024 * 1024 + 1, requestBytes: 100 * 1024 * 1024 + 1 }
    expect(blocks((e, c) => { c.sizes = big })).toEqual(expect.arrayContaining(['BODY_TOO_LARGE', 'REQUEST_TOO_LARGE']))
    expect(blocks((e, c) => { c.sizes = { bodyBytes: 15 * 1024 * 1024, requestBytes: 100 * 1024 * 1024 } })).toEqual([])
  })
  it('크기: 한도가 없으면 건너뛰지 않고 막는다(fail closed)', () => {
    expect(blocks((e, c) => { delete c.limits; c.sizes = { bodyBytes: 1, requestBytes: 1 } })).toEqual(expect.arrayContaining(['BODY_TOO_LARGE', 'REQUEST_TOO_LARGE']))
    expect(blocks((e, c) => { c.limits = { bodyMax: 15 * 1024 * 1024 }; c.sizes = { bodyBytes: 1, requestBytes: 1 } })).toEqual(['REQUEST_TOO_LARGE'])
  })
  it('BI 가 스텝보다 길면 경고(BI_LONGER_THAN_STEPS), 같거나 짧으면 없음', () => {
    const src = skeletonWith([rawStep({ next: [1, FAIL] }), rawStep({ next: [SUCCESS, FAIL] })], { biCount: 5 })
    const r = run(none, { src })
    expect(codesOf(r.warns)).toContain('BI_LONGER_THAN_STEPS')
    expect(codesOf(r.blocks)).not.toContain('BI_LONGER_THAN_STEPS')
    expect(warns(none)).not.toContain('BI_LONGER_THAN_STEPS')
  })
})

describe('시나리오 단위 경고', () => {
  it('UNREACHABLE: 편집본 기준(uid·NEXT)', () => {
    const src = skeletonWith([rawStep({ next: [2, FAIL] }), rawStep({ next: [SUCCESS, FAIL] }), rawStep({ next: [SUCCESS, FAIL] })])
    const w = run(none, { src }).warns
    expect(w.filter((i) => i.code === 'UNREACHABLE').map((i) => i.uid)).toEqual(['s1'])
    expect(warns(none)).not.toContain('UNREACHABLE')
    expect(warns((e) => { e.steps[0].next.onTrue = { kind: 'next' } }, { src })).toContain('UNREACHABLE') // NEXT → s1, s2 닿지 않음
  })
  it('FALSE_NEXT_WITH_ACTION', () => {
    const m = (e) => { e.steps[0].next.onFalse = { kind: 'next' }; e.steps[0].action = { type: 11, raw: 'x', command: 'x' } }
    expect(warns(m)).toContain('FALSE_NEXT_WITH_ACTION')
    expect(warns((e) => { e.steps[0].next.onFalse = { kind: 'next' } })).not.toContain('FALSE_NEXT_WITH_ACTION')
  })
  it('TYPE_UNSET', () => {
    expect(warns((e) => { e.property.Type = 0 })).toContain('TYPE_UNSET')
    expect(warns(none)).not.toContain('TYPE_UNSET')
  })
  it('후속: 없음·자기 자신·순환', () => {
    const c = { ...ctx(), targetNames: new Set(['B', 'N']), followGraph: new Map([['B', ['N']]]) }
    const w = (name) => warns((e) => { e.property.NextScenarioIfSuccess = { Name: name, Text: '' } }, { c })
    expect(w('ZZ')).toContain('FOLLOW_MISSING')
    expect(w('N')).toContain('FOLLOW_SELF')
    expect(w('B')).toContain('FOLLOW_CYCLE')
    expect(w('')).toEqual([])
    const c2 = { ...c, followGraph: new Map() }
    expect(warns((e) => { e.property.NextScenarioIfFail = { Name: 'B', Text: '' } }, { c: c2 })).toEqual([])
  })
  it('후속 순환은 경고(여러 단계)', () => {
    const c = { ...ctx(), targetNames: new Set(['B', 'C']), followGraph: new Map([['B', ['C']], ['C', ['N']]]) }
    expect(warns((e) => { e.property.NextScenarioIfSuccess = { Name: 'B' } }, { c })).toContain('FOLLOW_CYCLE')
  })
})

// P2-F 전처리 설정(설계 §6): 새로 넣거나 고친 창 조건만 막고, 옛 값은 경고한다.
describe('창 조건(header.windows)', () => {
  const W = (Text, ClassName, over = {}) => ({ Text, ClassName, IsCheckRectEqual: false, Left: 0, Top: 0, Right: 0, Bottom: 0, ...over })
  const win = (text, className, over = {}) => ({ text, className, checkRect: false, left: 0, top: 0, right: 0, bottom: 0, ...over })
  const add = (text, className, over) => ({ origin: null, ...win(text, className, over) })
  const srcWith = (target, hiding) => skeletonWith(okSteps(), { extra: { TargetWindowCondition: target, HidingWindowConditionList: hiding } })
  const check = (src, change) => { const e = fresh(src); if (change) change(e.header.windows, e); return checkScenario(e, src, ctx()) }
  const of = (list, code) => list.filter((i) => i.code === code)
  const OLD = [W('Notice', ''), W(' Popup* ', 'Dlg'), W('ok', 'Ok')]

  it('고치지 않으면 막지 않는다 — 옛 숨길 창의 클래스 없음·앞뒤 공백은 경고', () => {
    const r = check(srcWith(W('*', 'Main'), OLD))
    expect(codesOf(r.blocks)).toEqual([])
    expect(of(r.warns, 'HIDING_NOT_FOUND')).toEqual([{ code: 'HIDING_NOT_FOUND', params: { which: 'hiding:0', no: 1 } }])
    expect(of(r.warns, 'HIDING_TEXT_SPACE')).toEqual([{ code: 'HIDING_TEXT_SPACE', params: { which: 'hiding:1', no: 2 } }])
  })
  it('창 조건이 멀쩡하면 아무것도 없다. windows 가 없어도(옛 초안) 아무것도 없다', () => {
    const src = srcWith(W('EQ*', 'Main'), [W('', 'Saver'), W('Popup', 'Dlg')])
    const names = (r) => [...codesOf(r.blocks), ...codesOf(r.warns)].filter((c) => /WINDOW|HIDING/.test(c))
    expect(names(check(src))).toEqual([])
    expect(names(check(srcWith(W('*', ''), OLD), (_, e) => { delete e.header.windows }))).toEqual([])
  })
  it('새 숨길 창: 클래스가 비면(공백뿐 포함) 막는다 — 줄마다 하나씩', () => {
    const r = check(srcWith(W('EQ', 'Main'), []), (w) => { w.hiding = [add('화면 보호기', ''), add('x', '   '), add('', 'Dlg')] })
    expect(of(r.blocks, 'HIDING_CLASS_EMPTY').map((i) => i.params.no)).toEqual([1, 2])
    expect(of(r.warns, 'HIDING_NOT_FOUND')).toEqual([])
  })
  it('옛 숨길 창을 고쳤는데 클래스가 여전히 비면 막는다', () => {
    const r = check(srcWith(W('EQ', 'Main'), OLD), (w) => { w.hiding[0] = { ...w.hiding[0], text: 'Notice2' } })
    expect(of(r.blocks, 'HIDING_CLASS_EMPTY').map((i) => i.params.no)).toEqual([1])
  })
  it('앞뒤 공백: 새 줄·고친 줄(WINDOW_TEXT_SPACE)과 고친 대상 창(TARGET_TEXT_SPACE)은 막는다, 고치지 않은 것은 막지 않는다', () => {
    const src = srcWith(W(' EQ ', 'Main'), OLD)
    expect(codesOf(check(src).blocks)).toEqual([])
    const r = check(src, (w) => { w.target = { ...w.target, className: 'Main2' }; w.hiding.push(add('a ', 'A')); w.hiding[1] = { ...w.hiding[1], className: 'Dlg ' } })
    expect(of(r.blocks, 'WINDOW_TEXT_SPACE').map((i) => i.params.which).sort()).toEqual(['hiding:1', 'hiding:3'])
    expect(of(r.blocks, 'TARGET_TEXT_SPACE')).toEqual([{ code: 'TARGET_TEXT_SPACE', params: { which: 'target' } }])
    expect(of(r.warns, 'HIDING_TEXT_SPACE')).toEqual([])
  })
  it('대상 창을 에이전트가 찾지 않는 값으로 고쳐도 막지 않고 경고한다. 고치지 않았거나 비웠으면 경고도 없다', () => {
    const src = srcWith(W('EQ', 'Main'), [])
    const warn = (target) => of(check(src, (w) => { w.target = target }).warns, 'TARGET_WINDOW_NOT_FOUND').map((i) => i.params.reasonCode)
    expect(warn(win('EQ', ''))).toEqual(['CLASS_EMPTY'])
    expect(warn(win('', 'Main'))).toEqual(['TEXT_EMPTY'])
    expect(warn(win('*', 'Main'))).toEqual(['TEXT_STAR'])
    expect(warn(win('', ''))).toEqual([])
    expect(warn(win('EQ*', 'Main2'))).toEqual([])
    expect(codesOf(check(src, (w) => { w.target = win('EQ', '') }).blocks)).toEqual([])
    expect(of(check(srcWith(W('*', 'Main'), [])).warns, 'TARGET_WINDOW_NOT_FOUND')).toEqual([])
  })
  it('한도 20개: 넘으면서 기준 판보다 많으면 막는다. 기준 판이 이미 넘었으면 더 늘릴 때만 막고 아니면 경고', () => {
    const many = (n) => Array.from({ length: n }, (_, i) => W('p' + i, 'C' + i))
    const fresh20 = check(srcWith(W('EQ', 'Main'), many(20)))
    expect([...codesOf(fresh20.blocks), ...codesOf(fresh20.warns)]).not.toContain('HIDING_LIMIT')
    const over = check(srcWith(W('EQ', 'Main'), many(20)), (w) => { w.hiding.push(add('n', 'N')) })
    expect(of(over.blocks, 'HIDING_LIMIT')).toEqual([{ code: 'HIDING_LIMIT', params: { count: 21, limit: 20, grew: true } }])
    const old25 = srcWith(W('EQ', 'Main'), many(25))
    expect(of(check(old25).warns, 'HIDING_LIMIT')).toEqual([{ code: 'HIDING_LIMIT', params: { count: 25, limit: 20, grew: false } }])
    expect(codesOf(check(old25).blocks)).not.toContain('HIDING_LIMIT')
    expect(codesOf(check(old25, (w) => { w.hiding.pop() }).blocks)).not.toContain('HIDING_LIMIT')
    expect(codesOf(check(old25, (w) => { w.hiding.push(add('n', 'N')) }).blocks)).toContain('HIDING_LIMIT')
  })
  it('같은 조건의 숨길 창이 둘 이상이면 경고(뒤 줄마다)', () => {
    const r = check(srcWith(W('EQ', 'Main'), [W('a', 'A'), W('b', 'B')]), (w) => { w.hiding.push(add(' a', 'A'), add('a', 'A', { checkRect: true })) })
    expect(of(r.warns, 'HIDING_DUPLICATE')).toEqual([{ code: 'HIDING_DUPLICATE', params: { which: 'hiding:2', no: 3, firstNo: 1 } }])
  })
  it('새 시나리오(출처 없음)는 넣은 것이 모두 새 값이다', () => {
    const e = fresh(okSource())
    e.source = null
    e.steps = e.steps.map((s) => ({ ...s, origin: null }))
    e.header.windows = { target: win('EQ', ''), hiding: [add('x', '')] }
    const r = checkScenario(e, null, ctx())
    expect(codesOf(r.blocks)).toContain('HIDING_CLASS_EMPTY')
    expect(codesOf(r.warns)).toContain('TARGET_WINDOW_NOT_FOUND')
  })
})

