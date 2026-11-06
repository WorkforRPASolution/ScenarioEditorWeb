import { describe, it, expect } from 'vitest'
import { checkScenario } from '../../../domain/rules'
import { skeletonWith, rawStep, fresh, ctx, codesOf, okSource, SUCCESS, FAIL } from './helpers'

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
