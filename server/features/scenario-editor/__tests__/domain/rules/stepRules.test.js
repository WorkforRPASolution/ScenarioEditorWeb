import { describe, it, expect } from 'vitest'
import { checkScenario } from '../../../domain/rules'
import { fresh, ctx, codesOf, okSource, newStep, rawStep, skeletonWith, SUCCESS, FAIL } from './helpers'

const ref = { from: 'source', id: 's0-bi' }
const imageCond = (over = {}) => ({ kind: 'image', skipPreprocessing: false, searchArea: { x: 0, y: 0, w: 5, h: 5 }, image: { accept: 0.9, multi: { count: '1', op: 0 }, ...over } })
const ocrCond = (over = {}) => ({ kind: 'ocr', skipPreprocessing: false, searchArea: { x: 0, y: 0, w: 5, h: 5 }, ocr: { op: 1, text: 'IDLE', number: -218, min: -218, max: -218, multi: { count: '1', op: 0 }, ...over } })
const imgStep = (over = {}, cond = {}) => ({ condition: imageCond(cond), images: { train: { 0: ref }, base: ref }, ...over })
const ocrStep = (over = {}, cond = {}) => ({ condition: ocrCond(cond), images: { train: {}, base: ref }, ...over })

// 새 스텝 하나를 끝에 넣는다(기준 없음 = 고친 것). 앞 스텝이 새 스텝을 가리키지 않아도 막힘 판정에는 상관없다.
const withStep = (over, { c = ctx(), src = okSource() } = {}) => {
  const e = fresh(src); e.steps.push(newStep('x', over)); return checkScenario(e, src, c)
}
const blocks = (over, o) => codesOf(withStep(over, o).blocks)
const act = (type, extra = {}) => ({ action: { type, raw: '', ...extra } })

const BLOCK = [
  ['OCR_MOUSE_CLICK', ocrStep(act(1, { click: { x: 1, y: 1 }, raw: '1:1' }))],
  ['NONE_MOUSE_CLICK', act(2, { click: { x: 1, y: 1 }, raw: '1:1' })],
  ['VALUE_REQUIRED', act(11, { command: '' })],
  ['VALUE_REQUIRED', act(9)],
  ['VALUE_REQUIRED', act(12)],
  ['CLICK_FORMAT', act(1, { raw: 'x' })],
  ['CLICK_FORMAT', act(3, { click: { x: 1.5, y: 1 }, raw: '1:1' })],
  ['WHEEL_FORMAT', act(4, { raw: 'x' })],
  ['WHEEL_FORMAT', act(4, { wheel: { notches: 1, delaySec: 1.5 }, raw: 'x' })],
  ['WAIT_FORMAT', act(6, { raw: 'x' })],
  ['WAIT_FORMAT', act(6, { waitSec: 0, raw: '0' })],
  ['WAIT_FORMAT', act(6, { waitSec: 1.5, raw: '1500' })],
  ['KEY_FORMAT', act(5, { raw: 'x' })],
  ['KEY_FORMAT', act(5, { keyboard: { text: 'a@@b', keys: [], unknownCodes: [] }, raw: 'a@@b' })],
  ['KEY_FORMAT', act(5, { keyboard: { text: 'a', keys: [{ code: 1.5 }], unknownCodes: [] }, raw: 'a' })],
  ['FINDWINDOW_FORMAT', act(9, { raw: 'x@y@1' })],
  ['FINDWINDOW_FORMAT', act(9, { findWindow: { title: '', className: 'c', x: null, y: null }, raw: 'x' })],
  ['FINDWINDOW_FORMAT', act(9, { findWindow: { title: 'a@b', className: 'c', x: null, y: null }, raw: 'x' })],
  ['FINDWINDOW_FORMAT', act(9, { findWindow: { title: 'a', className: 'c', x: 1, y: null }, raw: 'x' })],
  ['FINDWINDOW_FORMAT', act(9, { findWindow: { title: 'a', className: 'c', x: 1.5, y: 2 }, raw: 'x' })],
  ['SCRIPT_FORMAT', act(12, { raw: 'x;;@@bad' })],
  ['SCRIPT_FORMAT', act(12, { customScript: { name: '', args: [], timeout: null, email: [], legacy: false }, raw: 'x' })],
  ['SCRIPT_FORMAT', act(12, { customScript: { name: 'a;b', args: [], timeout: null, email: [], legacy: false }, raw: 'x' })],
  ['SCRIPT_FORMAT', act(12, { customScript: { name: 'a', args: ['b;c'], timeout: null, email: [], legacy: false }, raw: 'x' })],
  ['SCRIPT_FORMAT', act(12, { customScript: { name: 'a', args: ['@@c'], timeout: null, email: [], legacy: false }, raw: 'x' })],
  ['SCRIPT_FORMAT', act(12, { customScript: { name: 'a', args: [], timeout: { value: 0, unit: 'seconds' }, email: [], legacy: false }, raw: 'x' })],
  ['SCRIPT_FORMAT', act(12, { customScript: { name: 'a', args: [], timeout: { value: 1, unit: 'days' }, email: [], legacy: false }, raw: 'x' })],
  ['SCRIPT_FORMAT', act(12, { customScript: { name: 'a', args: [], timeout: null, email: ['maybe'], legacy: false }, raw: 'x' })],
  ['ACCEPT_TOO_LOW', imgStep({}, { accept: 0.49 })],
  ['ACCEPT_TOO_HIGH', imgStep({}, { accept: 1.01 })],
  ['MULTI_RANGE', imgStep({}, { multi: { count: '0', op: 0 } })],
  ['MULTI_RANGE', imgStep({}, { multi: { count: '21', op: 0 } })],
  ['MULTI_RANGE', imgStep({}, { multi: { count: '1', op: 3 } })],
  ['MULTI_RANGE', ocrStep({}, { multi: { count: '21', op: 0 } })],
  ['MULTI_WITH_ACTION', imgStep(act(1, { click: { x: 1, y: 1 }, raw: '1:1' }), { multi: { count: '2', op: 0 } })],
  ['OCR_OP_REQUIRED', ocrStep({}, { op: 0 })],
  ['OCR_NUMBER_REQUIRED', ocrStep({}, { op: 5, number: null })],
  ['OCR_NUMBER_REQUIRED', ocrStep({}, { op: 7, min: 1, max: null })],
  ['OCR_TEXT_FORMAT', ocrStep({}, { op: 1, text: '' })],
  ['OCR_TEXT_FORMAT', ocrStep({}, { op: 3, text: 'a@@@@b' })],
  ['TRAIN_IMAGE_MISSING', imgStep({ images: { train: { 0: { literal: 'AA==' } }, base: ref } })],
  ['TRAIN_IMAGE_MISSING', imgStep({ images: { train: {}, base: ref } })],
  ['AREA_INVALID', imgStep({}, {}), (s) => { s.condition.searchArea.w = 0 }],
  ['AREA_INVALID', ocrStep({}, {}), (s) => { s.condition.searchArea.h = 0.5 }],
  ['BASE_IMAGE_MISSING', imgStep({ images: { train: { 0: ref }, base: null } })],
  ['RETRY_RANGE', { retry: { limit: 21, intervalMs: 2000 } }],
  ['RETRY_RANGE', { retry: { limit: -1, intervalMs: 2000 } }],
  ['RETRY_RANGE', { retry: { limit: 1, intervalMs: 1999 } }],
  ['RETRY_RANGE', { retry: { limit: 1.5, intervalMs: 2000 } }],
  ['ACTION_NOT_CREATABLE', act(7, { raw: 'v' })],
  ['ACTION_NOT_CREATABLE', act(8, { raw: 'EQP_DOWN' })],
  ['ACTION_NOT_CREATABLE', act(13, { raw: 'a@b@c@d' })],
  ['ACTION_NOT_CREATABLE', act(14)],
  ['ACTION_NOT_CREATABLE', act(15)],
  ['ACTION_TYPE_INVALID', { action: { type: 16, raw: '' } }],
  ['ACTION_TYPE_INVALID', { action: { type: null, raw: null } }],
  ['EQPSTATE_SKIP', { condition: { kind: 'eqpState', skipPreprocessing: true, eqpState: null } }],
  ['STEP_DESC_EMPTY', { descriptionToEmail: '' }],
  ['STEP_DESC_EMPTY', { descriptionToEmail: null }],
  ['STEP_DESC_CHARS', { descriptionToEmail: 'a@b' }],
  ['STEP_DESC_CHARS', { descriptionToEmail: 'a$b' }],
  ['INHOUSE_VALUE_EMPTY', act(1, { raw: '' })],
  ['INHOUSE_VALUE_EMPTY', act(5, { keyboard: { text: '', keys: [], unknownCodes: [] } })]
]

describe('스텝 값 막힘(새 스텝 = 고친 것)', () => {
  BLOCK.forEach(([code, over, tweak], i) => {
    it(`#${i} ${code}`, () => {
      const o = typeof over === 'function' ? over() : JSON.parse(JSON.stringify(over))
      if (tweak) tweak(o)
      expect(blocks(o)).toContain(code)
    })
  })
})

describe('스텝 값 통과', () => {
  const PASS = [
    ['조건 없음 + 대기', act(6, { waitSec: 1, raw: '1000' })],
    ['이미지(다중 1·동작 있음)', imgStep(act(1, { click: { x: -3, y: 4 }, raw: '-3:4' }))],
    ['이미지(다중 5·동작 없음, 정확도 0.5·1)', imgStep({}, { accept: 0.5, multi: { count: '5', op: 1 } })],
    ['OCR 텍스트', ocrStep({}, { op: 3, text: '문자' })],
    ['OCR 숫자·범위', ocrStep({}, { op: 8, min: 1, max: 5 })],
    ['OCR 다중 0', ocrStep({}, { multi: { count: '0', op: 2 } })],
    ['휠·키보드', act(4, { wheel: { notches: -1, delaySec: 0 }, raw: '-1@@0' })],
    ['키보드', act(5, { keyboard: { text: 'ab', keys: [{ code: 10 }], unknownCodes: [300] }, raw: 'ab@@10@@300' })],
    ['창 찾기(좌표 없음)', act(9, { findWindow: { title: 't', className: 'c', x: null, y: null }, raw: 't@c' })],
    ['창 찾기(좌표)', act(9, { findWindow: { title: 't', className: 'c', x: 1, y: 2 }, raw: 't@c@1@2' })],
    ['명령', act(11, { command: 'dir', raw: 'dir' })],
    ['스크립트', act(12, { customScript: { name: 'a', args: ['b'], timeout: { value: 3, unit: 'minutes' }, email: ['fail'], legacy: false }, raw: 'a;b;@@timeout:3 minutes,email:fail' })],
    ['메일 전송(10)', act(10)]
  ]
  for (const [name, over] of PASS) it(name, () => { expect(blocks(over)).toEqual([]) })

  it('재시도 상한 경계', () => {
    expect(blocks({ retry: { limit: 20, intervalMs: 2000 } })).toEqual([])
    expect(blocks({ retry: { limit: 200, intervalMs: 5000 } }, { c: { ...ctx(), user: { authorityManager: 1 } } })).toEqual([])
  })
  it('FALSE_NEXT_WITH_ACTION 은 스텝 값 검사에서도 경고로만 나온다', () => {
    const r = withStep({ ...act(11, { command: 'x', raw: 'x' }), next: { onTrue: { kind: 'next' }, onFalse: { kind: 'next' } } })
    expect(codesOf(r.warns)).toContain('FALSE_NEXT_WITH_ACTION')
  })
})

describe('보존 전용 동작과 고친 스텝 판정', () => {
  it('기준 판과 같은 동작이면 만들 수 없음이 아니다(설명만 고침)', () => {
    const src = skeletonWith([rawStep({ action: [8, 'EQP_DOWN@C1'], next: [1, FAIL] }), rawStep({ next: [SUCCESS, FAIL] })])
    const e = fresh(src); e.steps[0].descriptionToEmail = '고침'
    expect(codesOf(checkScenario(e, src, ctx()).blocks)).not.toContain('ACTION_NOT_CREATABLE')
    e.steps[0].action = { ...e.steps[0].action, raw: 'EQP_DOWN@C2' }
    expect(codesOf(checkScenario(e, src, ctx()).blocks)).toContain('ACTION_NOT_CREATABLE')
  })
  it('고치지 않은 스텝의 웹 검사 위반은 경고', () => {
    const src = skeletonWith([rawStep({ desc: '', next: [1, FAIL], retry: [50, 100] }), rawStep({ next: [SUCCESS, FAIL] })])
    const r = checkScenario(fresh(src), src, ctx())
    expect(codesOf(r.blocks)).toEqual([])
    expect(codesOf(r.warns)).toEqual(expect.arrayContaining(['STEP_DESC_EMPTY', 'RETRY_RANGE']))
  })
  it('옛 이미지 스텝의 낮은 정확도는 고치지 않아도 막는다(사내 저장 검사)', () => {
    const src = skeletonWith([rawStep({ kind: 'image', next: [SUCCESS, FAIL] })])
    const e = fresh(src); e.steps[0].condition.image.accept = 0.4
    expect(codesOf(checkScenario(e, src, ctx()).blocks)).toContain('ACCEPT_TOO_LOW')
    const e2 = fresh(src)
    expect(codesOf(checkScenario(e2, src, ctx()).blocks)).toEqual([])
  })
  it('옛 값이 빈 클릭(동작 1~6 빈 저장 값)은 고치지 않아도 막는다', () => {
    const src = skeletonWith([rawStep({ action: [6, ''], next: [SUCCESS, FAIL] })])
    expect(codesOf(checkScenario(fresh(src), src, ctx()).blocks)).toContain('INHOUSE_VALUE_EMPTY')
  })
})
