import { describe, it, expect } from 'vitest'
import { checkScenario } from '../../../domain/rules'
import { RULES } from '../../../domain/rules/codes'
import { resolveOrigins } from '../../../domain/changeDetect'
import { skeletonWith, rawStep, fresh, ctx, codesOf, okSource, newStep, SUCCESS, FAIL, NEXT } from './helpers'

const ref = { from: 'source', id: 's0-bi' }
const check = (e, src, c = ctx()) => checkScenario(e, src, c)
const blocksOf = (e, src, c) => codesOf(check(e, src, c).blocks)
const warnsOf = (e, src, c) => codesOf(check(e, src, c).warns)
const imageCond = (over = {}) => ({ kind: 'image', skipPreprocessing: false, searchArea: { x: 0, y: 0, w: 5, h: 5 }, image: { accept: 0.9, multi: { count: '1', op: 0 }, ...over } })
const ocrCond = (over = {}) => ({ kind: 'ocr', skipPreprocessing: false, searchArea: { x: 0, y: 0, w: 5, h: 5 }, ocr: { op: 1, text: 'a', number: 1, min: 1, max: 2, multi: { count: '1', op: 0 }, ...over } })
const withStep = (over, c) => { const src = okSource(); const e = fresh(src); e.steps.push(newStep('x', over)); return blocksOf(e, src, c) }
const stepsOf = (n) => Array.from({ length: n }, (_, i) => rawStep({ next: [i === n - 1 ? SUCCESS : i + 1, FAIL] }))

describe('1. 같은 origin 을 두 번 쓰면 보존 전용 동작을 복제할 수 없다', () => {
  it('resolveOrigins: 범위 밖·중복은 null', () => {
    const m = resolveOrigins([{ uid: 'a', origin: 0 }, { uid: 'b', origin: 0 }, { uid: 'c', origin: 5 }, { uid: 'd', origin: null }, { uid: 'e', origin: 1 }], 2)
    expect([...m]).toEqual([['a', 0], ['b', null], ['c', null], ['d', null], ['e', 1]])
  })
  for (const [type, raw] of [[13, 'a@b@c@d'], [8, 'EQP_DOWN@C1']]) {
    it(`동작 ${type} 스텝 복제본(같은 origin)은 막는다`, () => {
      const src = skeletonWith([rawStep({ action: [type, raw], next: [1, FAIL] }), rawStep({ next: [SUCCESS, FAIL] })], { property: { Type: 7 } })
      const e = fresh(src)
      expect(blocksOf(e, src)).not.toContain('ACTION_NOT_CREATABLE')
      const copy = JSON.parse(JSON.stringify(e.steps[0])); copy.uid = 'copy'
      e.steps.splice(1, 0, copy)
      const r = check(e, src)
      expect(r.blocks.filter((i) => i.code === 'ACTION_NOT_CREATABLE').map((i) => i.uid)).toEqual(['copy'])
    })
  }
})

describe('2. RULES 표 고정', () => {
  const A = 'always'; const C = 'changed'
  const table = {
    NO_STEPS: [A, 'block'], STEP_LIMIT: ['special', 'block'], BI_COUNT_MISMATCH: [A, 'block'], BASE_IMAGE_MISSING: [A, 'block'],
    SOURCE_PARSE_FAILED: [A, 'block'], LAST_STEP_NEXT: [A, 'block'], NEXT_SELF: [A, 'block'], NEXT_OUT_OF_RANGE: [A, 'block'],
    NEXT_UNRESOLVED: [A, 'block'], ACCEPT_TOO_LOW: [A, 'block'], NO_SUCCESS: [A, 'block'], INHOUSE_VALUE_EMPTY: [A, 'block'],
    FAP_TYPE_MISMATCH: [A, 'block'], MAIL_TITLE_EMPTY: [A, 'block'], MAIL_TITLE_COLON: [A, 'block'], TIMEOUT_INVALID: [A, 'block'],
    NAME_EMPTY: [A, 'block'], NAME_TOO_LONG: [A, 'block'], NAME_CHARS: [A, 'block'], MODEL_MISSING: [A, 'block'],
    BODY_TOO_LARGE: [A, 'block'], REQUEST_TOO_LARGE: [A, 'block'],
    OCR_MOUSE_CLICK: [C, 'block'], NONE_MOUSE_CLICK: [C, 'block'], VALUE_REQUIRED: [C, 'block'], CLICK_FORMAT: [C, 'block'],
    WHEEL_FORMAT: [C, 'block'], WAIT_FORMAT: [C, 'block'], KEY_FORMAT: [C, 'block'], FINDWINDOW_FORMAT: [C, 'block'],
    SCRIPT_FORMAT: [C, 'block'], ACCEPT_TOO_HIGH: [C, 'block'], MULTI_RANGE: [C, 'block'], MULTI_WITH_ACTION: [C, 'block'],
    OCR_OP_REQUIRED: [C, 'block'], OCR_NUMBER_REQUIRED: [C, 'block'], OCR_TEXT_FORMAT: [C, 'block'], TRAIN_IMAGE_MISSING: [C, 'block'],
    AREA_INVALID: [C, 'block'], RETRY_RANGE: [C, 'block'], ACTION_NOT_CREATABLE: [C, 'block'], ACTION_TYPE_INVALID: [C, 'block'],
    EQPSTATE_SKIP: [C, 'block'], STEP_DESC_EMPTY: [C, 'block'], STEP_DESC_CHARS: [C, 'block'],
    FALSE_NEXT_WITH_ACTION: [A, 'warn'], UNREACHABLE: [A, 'warn'], FOLLOW_MISSING: [A, 'warn'], FOLLOW_SELF: [A, 'warn'],
    START_DELAY_RANGE: [A, 'block'], RETRY_INTERVAL_RANGE: [A, 'block'], RETRY_CNT_RANGE: [A, 'block'], PRIORITY_VALUE: [A, 'block'],
    EXECUTING_LEVEL_VALUE: [A, 'block'], FOLLOW_NAME_REQUIRED: [A, 'block'], FOLLOW_DESC_SHORT: [A, 'block'],
    FOLLOW_CYCLE: [A, 'warn'], TYPE_UNSET: [A, 'warn']
  }
  it('코드·범위·수준이 표와 같다', () => {
    expect(Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, [v.scope, v.level]]))).toEqual(table)
  })
})

describe('2. 고치지 않은 옛 스텝: 늘 범위는 막고 고친 것 범위는 경고', () => {
  const only = (steps, o) => { const src = skeletonWith(steps, o); return [fresh(src), src] }
  it('ACCEPT_TOO_LOW', () => { const [e, s] = only([rawStep({ kind: 'image', accept: 0.4, next: [SUCCESS, FAIL] })]); expect(blocksOf(e, s)).toContain('ACCEPT_TOO_LOW') })
  it('BASE_IMAGE_MISSING', () => { const [e, s] = only([rawStep({ kind: 'image', next: [SUCCESS, FAIL] })], { noBase: [0] }); expect(blocksOf(e, s)).toContain('BASE_IMAGE_MISSING') })
  it('INHOUSE_VALUE_EMPTY', () => { const [e, s] = only([rawStep({ action: [1, ''], next: [SUCCESS, FAIL] })]); expect(blocksOf(e, s)).toContain('INHOUSE_VALUE_EMPTY') })
  it('NEXT_SELF', () => { const [e, s] = only([rawStep({ next: [0, FAIL] }), rawStep({ next: [SUCCESS, FAIL] })]); expect(blocksOf(e, s)).toContain('NEXT_SELF') })
  it('LAST_STEP_NEXT (옛 값)', () => { const [e, s] = only([rawStep({ next: [SUCCESS, NEXT] })]); expect(blocksOf(e, s)).toContain('LAST_STEP_NEXT') })
  it('마지막 스텝을 지우면 앞 스텝(고치지 않음)의 NEXT 가 LAST_STEP_NEXT 로 막힌다', () => {
    const src = skeletonWith([rawStep({ next: [NEXT, FAIL] }), rawStep({ next: [SUCCESS, FAIL] })])
    const e = fresh(src); e.steps.pop()
    e.steps[0].next.onTrue = { kind: 'next' } // 그대로(편집본 대상 NEXT)
    const r = check(e, src)
    expect(codesOf(r.blocks)).toContain('LAST_STEP_NEXT')
  })
  it('LAST_STEP_NEXT onTrue 쪽', () => {
    const src = okSource(); const e = fresh(src); e.steps[1].next.onTrue = { kind: 'next' }; e.steps[1].next.onFalse = { kind: 'end', value: 'SUCCESS' }
    expect(blocksOf(e, src)).toContain('LAST_STEP_NEXT')
  })
  it('웹 검사 위반은 고치지 않았으면 경고', () => {
    const [e, s] = only([rawStep({ kind: 'ocr', action: [1, '1:1'], next: [SUCCESS, FAIL] })])
    expect(blocksOf(e, s)).not.toContain('OCR_MOUSE_CLICK')
    expect(warnsOf(e, s)).toContain('OCR_MOUSE_CLICK')
    const [e2, s2] = only([rawStep({ kind: 'image', accept: 1.5, next: [SUCCESS, FAIL] })])
    expect(blocksOf(e2, s2)).not.toContain('ACCEPT_TOO_HIGH')
    expect(warnsOf(e2, s2)).toContain('ACCEPT_TOO_HIGH')
  })
})

describe('3. 경계', () => {
  it('STEP_LIMIT 200 통과·201 막힘/경고', () => {
    const e0 = fresh(okSource()); while (e0.steps.length < 200) e0.steps.push(newStep(`n${e0.steps.length}`))
    expect(blocksOf(e0, okSource())).not.toContain('STEP_LIMIT')
    expect(warnsOf(e0, okSource())).not.toContain('STEP_LIMIT')
    e0.steps.push(newStep('n201'))
    expect(blocksOf(e0, okSource())).toContain('STEP_LIMIT')
    const src = skeletonWith(stepsOf(201)); const e = fresh(src)
    expect(warnsOf(e, src)).toContain('STEP_LIMIT')
    const src200 = skeletonWith(stepsOf(200)); const e200 = fresh(src200)
    expect(codesOf([...check(e200, src200).blocks, ...check(e200, src200).warns])).not.toContain('STEP_LIMIT')
  })
  it('ACCEPT 경계', () => {
    expect(withStep({ condition: imageCond({ accept: 1 }), images: { train: { 0: ref }, base: ref } })).not.toContain('ACCEPT_TOO_HIGH')
    expect(withStep({ condition: imageCond({ accept: 1.0001 }), images: { train: { 0: ref }, base: ref } })).toContain('ACCEPT_TOO_HIGH')
  })
  it('RETRY limit 0 통과', () => { expect(withStep({ retry: { limit: 0, intervalMs: 2000 } })).not.toContain('RETRY_RANGE') })
  it('AREA 1 통과·0 막힘', () => {
    const img = (w, h) => withStep({ condition: { ...imageCond(), searchArea: { x: 0, y: 0, w, h } }, images: { train: { 0: ref }, base: ref } })
    expect(img(1, 1)).not.toContain('AREA_INVALID')
    expect(img(0, 1)).toContain('AREA_INVALID')
    expect(img(1, 0)).toContain('AREA_INVALID')
  })
  it('MULTI 경계', () => {
    const img = (count) => withStep({ condition: imageCond({ multi: { count, op: 0 } }), images: { train: { 0: ref }, base: ref } })
    const ocr = (count, op = 0) => withStep({ condition: ocrCond({ multi: { count, op } }), images: { train: {}, base: ref } })
    expect(img('20')).not.toContain('MULTI_RANGE'); expect(img('21')).toContain('MULTI_RANGE'); expect(img('0')).toContain('MULTI_RANGE')
    expect(ocr('0')).not.toContain('MULTI_RANGE'); expect(ocr('20')).not.toContain('MULTI_RANGE'); expect(ocr('21')).toContain('MULTI_RANGE')
    expect(ocr('1', 2)).not.toContain('MULTI_RANGE'); expect(ocr('1', 3)).toContain('MULTI_RANGE')
  })
  it('FAP_TYPE_MISMATCH', () => {
    const run = (type) => {
      const src = skeletonWith([rawStep({ action: [13, 'a@b@c@d'], next: [1, FAIL] }), rawStep({ next: [SUCCESS, FAIL] })], { property: { Type: type } })
      return blocksOf(fresh(src), src)
    }
    expect(run(7)).not.toContain('FAP_TYPE_MISMATCH'); expect(run(8)).toContain('FAP_TYPE_MISMATCH')
  })
  it('EQPSTATE_SKIP', () => {
    const c = (over) => ({ condition: { kind: 'eqpState', ...over } })
    expect(withStep(c({ eqpState: null }))).toContain('EQPSTATE_SKIP')
    expect(withStep(c({ skipPreprocessing: false, eqpState: { target: 'MAIN', state: 'x', code: 'y' } }))).not.toContain('EQPSTATE_SKIP')
  })
  it('마우스 클릭 종류별', () => {
    for (const t of [1, 2, 3]) {
      const a = { type: t, raw: '1:1', click: { x: 1, y: 1 } }
      expect(withStep({ condition: { kind: 'none', skipPreprocessing: false }, action: a })).toContain('NONE_MOUSE_CLICK')
      expect(withStep({ condition: ocrCond(), images: { train: {}, base: ref }, action: a })).toContain('OCR_MOUSE_CLICK')
    }
    const w = { type: 4, raw: '1@@1', wheel: { notches: 1, delaySec: 1 } }
    expect(withStep({ action: w })).not.toContain('NONE_MOUSE_CLICK')
    expect(withStep({ condition: ocrCond(), images: { train: {}, base: ref }, action: w })).not.toContain('OCR_MOUSE_CLICK')
  })
  it('FOLLOW 실패 쪽', () => {
    const c = { ...ctx(), targetNames: new Set(['B', 'N']), followGraph: new Map([['B', ['N']]]) }
    const w = (name) => { const src = okSource(); const e = fresh(src); e.property.NextScenarioIfFail = { Name: name }; return warnsOf(e, src, c) }
    expect(w('ZZ')).toContain('FOLLOW_MISSING'); expect(w('N')).toContain('FOLLOW_SELF'); expect(w('B')).toContain('FOLLOW_CYCLE')
  })
  it('형식 세부', () => {
    const fw = (o) => withStep({ action: { type: 9, raw: 'x', findWindow: { title: 't', className: 'c', x: null, y: null, ...o } } })
    expect(fw({ className: '' })).toContain('FINDWINDOW_FORMAT'); expect(fw({ className: 'a@b' })).toContain('FINDWINDOW_FORMAT')
    expect(withStep({ action: { type: 4, raw: 'x', wheel: { notches: 1.5, delaySec: 1 } } })).toContain('WHEEL_FORMAT')
    expect(withStep({ action: { type: 5, raw: 'a', keyboard: { text: 'a', keys: [], unknownCodes: [1.5] } } })).toContain('KEY_FORMAT')
    expect(withStep({ action: { type: 12, raw: 'x', customScript: { name: 'a', args: [], timeout: { value: 1.5, unit: 'seconds' }, email: [], legacy: false } } })).toContain('SCRIPT_FORMAT')
  })
})

describe('4. 빈 값은 정확히 빈 문자열만(사내 저장 검사와 같게)', () => {
  it('MAIL_TITLE_EMPTY 는 공백만 있는 제목을 막지 않는다', () => {
    const src = okSource(); const e = fresh(src)
    e.header.description = ' '
    expect(blocksOf(e, src)).not.toContain('MAIL_TITLE_EMPTY')
    e.header.description = ''
    expect(blocksOf(e, src)).toContain('MAIL_TITLE_EMPTY')
    e.header.description = null
    expect(blocksOf(e, src)).toContain('MAIL_TITLE_EMPTY')
  })
  it('NAME_EMPTY 는 공백 이름을 NAME_CHARS 로 막고 NAME_EMPTY 는 아니다', () => {
    const src = okSource(); const e = fresh(src)
    const r = blocksOf(e, src, { ...ctx(), target: { model: 'M', name: ' ' } })
    expect(r).not.toContain('NAME_EMPTY'); expect(r).toContain('NAME_CHARS')
  })
  it('STEP_DESC_EMPTY(웹 검사)는 공백만 있어도 막는다', () => {
    expect(withStep({ descriptionToEmail: '   ' })).toContain('STEP_DESC_EMPTY')
  })
})
