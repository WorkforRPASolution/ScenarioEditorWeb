import { describe, it, expect } from 'vitest'
import { checkScenario } from '../../../domain/rules'
import { RULES } from '../../../domain/rules/codes'
import { skeletonWith, rawStep, fresh, ctx, codesOf, okSource, newStep, SUCCESS, FAIL } from './helpers'

describe('checkScenario 나누기', () => {
  it('고친 스텝만 막고, 고치지 않은 옛 값은 경고', () => {
    const src = skeletonWith([rawStep({ action: [1, '1:1'] }), rawStep({ next: [SUCCESS, FAIL] })])
    const e = fresh(src)
    expect(codesOf(checkScenario(e, src, ctx()).warns)).toContain('NONE_MOUSE_CLICK')
    expect(codesOf(checkScenario(e, src, ctx()).blocks)).not.toContain('NONE_MOUSE_CLICK')
    e.steps[0].descriptionToEmail = '고침'
    expect(codesOf(checkScenario(e, src, ctx()).blocks)).toContain('NONE_MOUSE_CLICK')
  })
  it('범위 밖 옛 참조는 고치지 않아도 막는다', () => {
    const src = skeletonWith([rawStep({ next: [9999, FAIL] }), rawStep({ next: [SUCCESS, FAIL] })])
    expect(codesOf(checkScenario(fresh(src), src, ctx()).blocks)).toContain('NEXT_OUT_OF_RANGE')
  })
  it('지운 스텝을 가리키면 NEXT_UNRESOLVED 로 막고 던지지 않는다', () => {
    const src = skeletonWith([rawStep({ next: [2, FAIL] }), rawStep({ next: [2, FAIL] }), rawStep({ next: [SUCCESS, FAIL] })])
    const e = fresh(src); e.steps.splice(2, 1)
    expect(codesOf(checkScenario(e, src, ctx()).blocks)).toContain('NEXT_UNRESOLVED')
  })
  it('200 을 넘게 늘리면 막고, 이미 넘는 판은 경고', () => {
    const many = (n) => Array.from({ length: n }, (_, i) => rawStep({ next: [i === n - 1 ? SUCCESS : i + 1, FAIL] }))
    const src = skeletonWith(many(201))
    const e = fresh(src)
    const same = checkScenario(e, src, ctx())
    expect(codesOf(same.warns)).toContain('STEP_LIMIT')
    expect(codesOf(same.blocks)).not.toContain('STEP_LIMIT')
    e.steps.push(newStep('n1'))
    expect(codesOf(checkScenario(e, src, ctx()).blocks)).toContain('STEP_LIMIT')
    const e0 = fresh(okSource()); for (let i = 0; i < 199; i++) e0.steps.push(newStep(`n${i}`))
    expect(codesOf(checkScenario(e0, okSource(), ctx()).blocks)).toContain('STEP_LIMIT') // 201 > 2
    e0.steps.pop(); e0.steps.pop(); e0.steps.pop() // 198+... 200 이하는 통과
    expect(codesOf(checkScenario(e0, okSource(), ctx()).blocks)).not.toContain('STEP_LIMIT')
  })
  it('재시도 횟수 상한은 관리 등급에 따라', () => {
    const src = okSource(); const e = fresh(src); e.steps[0].retry.limit = 150
    expect(codesOf(checkScenario(e, src, { ...ctx(), user: { authorityManager: 0 } }).blocks)).toContain('RETRY_RANGE')
    expect(codesOf(checkScenario(e, src, { ...ctx(), user: { authorityManager: 2 } }).blocks)).not.toContain('RETRY_RANGE')
    e.steps[0].retry.limit = 201
    expect(codesOf(checkScenario(e, src, { ...ctx(), user: { authorityManager: 1 } }).blocks)).toContain('RETRY_RANGE')
  })
  it('정렬: 시나리오 단위 먼저, 스텝 위치, 코드 순; 같은 {code,uid} 는 한 번', () => {
    const src = okSource(); const e = fresh(src)
    e.header.description = ''; e.steps[1].descriptionToEmail = ''; e.steps[0].descriptionToEmail = 'a@'
    e.steps[1].next.onTrue = { kind: 'raw', value: 9 }; e.steps[1].next.onFalse = { kind: 'raw', value: 8 }
    const r = checkScenario(e, src, ctx())
    const keys = r.blocks.map((i) => `${i.uid ?? '-'}:${i.code}`)
    expect(keys.indexOf('-:MAIL_TITLE_EMPTY')).toBeLessThan(keys.indexOf('s0:STEP_DESC_CHARS'))
    expect(keys.indexOf('s0:STEP_DESC_CHARS')).toBeLessThan(keys.indexOf('s1:NEXT_OUT_OF_RANGE'))
    expect(keys.filter((k) => k === 's1:NEXT_OUT_OF_RANGE')).toHaveLength(1)
    expect(keys.indexOf('s1:NEXT_OUT_OF_RANGE')).toBeLessThan(keys.indexOf('s1:STEP_DESC_EMPTY'))
  })
  it('크기 초과·sizes 없으면 건너뜀', () => {
    const src = okSource(); const e = fresh(src)
    expect(codesOf(checkScenario(e, src, { ...ctx(), sizes: { bodyBytes: 15 * 1024 * 1024 + 1, requestBytes: 1 } }).blocks)).toContain('BODY_TOO_LARGE')
    expect(codesOf(checkScenario(e, src, { ...ctx(), sizes: { bodyBytes: 1, requestBytes: 100 * 1024 * 1024 + 1 } }).blocks)).toContain('REQUEST_TOO_LARGE')
    expect(codesOf(checkScenario(e, src, { ...ctx(), sizes: { bodyBytes: 1, requestBytes: 1 } }).blocks)).toEqual([])
    expect(codesOf(checkScenario(e, src, ctx()).blocks)).toEqual([])
  })
  it('깨끗한 시나리오는 막힘·경고 없음', () => {
    const src = okSource()
    expect(checkScenario(fresh(src), src, ctx())).toEqual({ blocks: [], warns: [] })
  })
  it('RULES 가 낸 코드를 모두 담고, 낼 수 없는 코드는 없다', () => {
    const emitted = new Set()
    const run = (e, src, c = ctx()) => { const r = checkScenario(e, src, c); for (const i of [...r.blocks, ...r.warns]) emitted.add(i.code) }
    // 모든 규칙을 건드리는 망가진 시나리오들
    const broken = skeletonWith([rawStep({ kind: 'ocr', action: [1, ''] }), rawStep({ kind: 'image', action: [0, ''] })], { property: { Type: 0 } })
    const e = fresh(broken)
    e.steps = [
      newStep('a', { condition: { kind: 'ocr', skipPreprocessing: false, searchArea: { x: 0, y: 0, w: 0, h: 0 }, ocr: { op: 0, text: '', multi: { count: '99', op: 7 } } }, action: { type: 1, raw: '' }, next: { onTrue: { kind: 'step', uid: 'a' }, onFalse: { kind: 'next' } }, retry: { limit: 999, intervalMs: 1 }, descriptionToEmail: '' }),
      newStep('b', { condition: { kind: 'image', skipPreprocessing: false, searchArea: { x: 0, y: 0, w: 5, h: 5 }, image: { accept: 0.1, multi: { count: '5', op: 0 } } }, action: { type: 13, raw: 'x' }, next: { onTrue: { kind: 'raw', value: 9 }, onFalse: { kind: 'unresolved' } }, descriptionToEmail: 'a@b' }),
      newStep('c', { condition: { kind: 'eqpState', skipPreprocessing: true }, action: { type: 99 }, next: { onTrue: { kind: 'step', uid: 'zz' }, onFalse: { kind: 'next' } } }),
      newStep('d', { action: { type: 5, raw: '', keyboard: { text: 'a@@', keys: [{ code: 1.5 }], unknownCodes: [] } }, next: { onTrue: { kind: 'next' }, onFalse: { kind: 'next' } } }),
      newStep('e', { action: { type: 4, raw: '' } }), newStep('f', { action: { type: 6, raw: '' } }), newStep('g', { action: { type: 9, raw: '' } }),
      newStep('h', { action: { type: 9, raw: 'x', findWindow: { title: '', className: 'a', x: 1, y: null } } }),
      newStep('i', { action: { type: 12, raw: 'x', customScript: { name: '', args: [], timeout: null, email: [], legacy: false } } }),
      newStep('j', { condition: { kind: 'ocr', skipPreprocessing: false, searchArea: { x: 0, y: 0, w: 5, h: 5 }, ocr: { op: 5, text: '', number: null, multi: { count: '1', op: 0 } } }, action: { type: 11, raw: '', command: '' } }),
      newStep('k', { condition: { kind: 'none', skipPreprocessing: false }, action: { type: 2, raw: '1:1', click: { x: 1, y: 1 } } }),
      newStep('l', { condition: { kind: 'ocr', skipPreprocessing: false, searchArea: { x: 0, y: 0, w: 5, h: 5 }, ocr: { op: 1, text: '', multi: { count: '1', op: 0 } } } }),
      newStep('m', { condition: { kind: 'image', skipPreprocessing: false, searchArea: { x: 0, y: 0, w: 5, h: 5 }, image: { accept: 2, multi: { count: '2', op: 0 } } }, action: { type: 9, raw: 'x@y', findWindow: { title: 't', className: 'c', x: null, y: null } }, next: { onTrue: { kind: 'next' }, onFalse: { kind: 'next' } } })
    ]
    e.header = { description: 'a:b', timeoutLimit: '0' }
    e.property = { Type: 0, NextScenarioIfSuccess: { Name: 'X' }, NextScenarioIfFail: { Name: 'N' } }
    run(e, broken, { ...ctx(), target: { model: '', name: 'bad name' }, sizes: { bodyBytes: 1e9, requestBytes: 1e9 } })
    const e2 = fresh(broken); e2.steps = []; e2.header = { description: '', timeoutLimit: '1' }
    run(e2, { ...broken, notes: [{ code: 'PARSE_FAILED', params: { field: 'body' } }] }, { ...ctx(), target: { model: 'M', name: 'x'.repeat(51) } })
    const e3 = fresh(broken); e3.property = { Type: 1, NextScenarioIfSuccess: { Name: 'B' } }
    run(e3, broken, { ...ctx(), targetNames: new Set(['B']), followGraph: new Map([['B', ['N']]]) })
    const e4 = fresh(broken); e4.property = { Type: 1 }
    for (let i = 0; i < 201; i++) e4.steps.push(newStep(`z${i}`))
    run(e4, broken)
    run(fresh(broken), broken, { ...ctx(), target: { model: 'M', name: '' } })
    const e9 = fresh(broken); e9.property = { Type: 1, NextScenarioIfSuccess: { Name: 'N' } }; run(e9, broken)
    run(fresh(broken), { ...broken, biCount: null })
    const e5 = fresh(broken); e5.steps[0].images.base = null; run(e5, broken)
    const e6 = fresh(okSource()); e6.steps[0].next.onTrue = { kind: 'next' }; e6.steps[0].action = { type: 9, raw: 'a@b', findWindow: { title: 'a', className: 'b', x: null, y: null } }; e6.steps[1].next.onTrue = { kind: 'end', value: 'SKIP' }
    e6.steps[1].next.onFalse = { kind: 'next' }
    run(e6, okSource())
    const e7 = fresh(okSource()); e7.steps[0].next.onTrue = { kind: 'end', value: 'SUCCESS' }; e7.steps[0].next.onFalse = { kind: 'next' }; e7.steps[0].action = { type: 8, raw: 'x' }
    e7.steps[0].condition = { kind: 'none', skipPreprocessing: false }; run(e7, okSource())
    const e8 = fresh(okSource()); e8.steps[1].action = { type: 7, raw: 'x' }; run(e8, okSource())
    const unknown = [...emitted].filter((c) => !(c in RULES))
    expect(unknown).toEqual([])
    const unreachable = Object.keys(RULES).filter((c) => !emitted.has(c))
    expect(unreachable).toEqual([])
  })
})
