import { describe, it, expect } from 'vitest'
import { checkStepFields, barFieldErrors } from '../editor/fieldRules'

const img = { from: 'source', id: 's0-train-0' }
function imageStep(over = {}) {
  return {
    uid: 'u1', origin: 0,
    condition: { kind: 'image', searchArea: { x: 0, y: 0, w: 10, h: 10 }, image: { accept: 0.8, multi: { count: '1', op: 0 } }, skipPreprocessing: false },
    action: { type: 0, raw: '' },
    next: { onTrue: { kind: 'end', value: 'SUCCESS' }, onFalse: { kind: 'end', value: 'FAIL' } },
    retry: { limit: 0, intervalMs: 2000 },
    descriptionToEmail: '확인', descriptionToDialog: '', isShowDialog: false,
    images: { train: { 0: img }, base: { from: 'source', id: 's0-bi' } },
    ...over
  }
}
const withAction = (action) => imageStep({ action: { raw: '', ...action } })
const withCond = (cond) => { const s = imageStep(); return { ...s, condition: { ...s.condition, ...cond } } }
const ocrStep = (ocr, action = { type: 0, raw: '' }) => imageStep({ condition: { kind: 'ocr', searchArea: { x: 0, y: 0, w: 5, h: 5 }, ocr: { op: 1, text: 'a', multi: { count: '0', op: 0 }, ...ocr }, skipPreprocessing: false }, action })
const ctx = (step, extra = {}) => ({ working: { steps: [step, { ...imageStep(), uid: 'u2' }] }, isNew: false, base: step, user: { authorityManager: 3 }, ...extra })
const check = (step, extra) => checkStepFields(step, ctx(step, extra))
const codes = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.code]))

describe('checkStepFields', () => {
  it('정상 스텝은 오류가 없다', () => { expect(check(imageStep())).toEqual({}) })
  it('설명 비움·@·$', () => {
    expect(codes(check(imageStep({ descriptionToEmail: '  ' })))).toEqual({ desc: 'STEP_DESC_EMPTY' })
    expect(codes(check(imageStep({ descriptionToEmail: 'a@b' })))).toEqual({ desc: 'STEP_DESC_CHARS' })
    expect(codes(check(imageStep({ descriptionToEmail: 'a$' })))).toEqual({ desc: 'STEP_DESC_CHARS' })
  })
  it('검색 영역·찾을 그림', () => {
    expect(codes(check(withCond({ searchArea: null })))).toEqual({ area: 'AREA_INVALID' })
    expect(codes(check(withCond({ searchArea: { x: 0, y: 0, w: 0, h: 5 } })))).toEqual({ area: 'AREA_SIZE_MIN' })
    expect(codes(check(withCond({ searchArea: { x: 1.5, y: 0, w: 5, h: 5 } })))).toEqual({ area: 'AREA_NOT_INTEGER' })
    const s = imageStep(); s.images = { ...s.images, train: {} }
    expect(codes(check(s))).toEqual({ train: 'TRAIN_IMAGE_MISSING' })
  })
  it('검색 영역을 숫자로 넣기: 빈 칸·글자·소수점은 걸린 칸과 함께 막는다(OCR 도 같다)', () => {
    const r = check(withCond({ searchArea: { x: 'abc', y: 0, w: 5, h: '2.5' } }))
    expect(r.area).toEqual({ code: 'AREA_NOT_INTEGER', params: { names: 'X·H', keys: ['x', 'h'] }, level: 'error' })
    expect(check(withCond({ searchArea: { x: 1, y: null, w: 5, h: 5 } })).area).toEqual({ code: 'AREA_FIELD_EMPTY', params: { names: 'Y', keys: ['y'] }, level: 'error' })
    const o = ocrStep({}); o.condition.searchArea = { x: 0, y: 0, w: 5, h: 'x' }
    expect(codes(check(o))).toEqual({ area: 'AREA_NOT_INTEGER' })
    // 패널에서 잘못 친 글자는 영역 밖에 따로 쥔다(areaTyped) — 영역이 바르더라도 막는다
    expect(check(withCond({ areaTyped: { w: '5o' } })).area).toEqual({ code: 'AREA_NOT_INTEGER', params: { names: 'W', keys: ['w'] }, level: 'error' })
    expect(codes(check(withCond({ areaTyped: { w: '' } })))).toEqual({ area: 'AREA_FIELD_EMPTY' })
  })
  it('검색 영역이 기준 화면 밖: 패널에서 고친 값만 막는다 — 화면 크기(screen)를 알 때만, 적용돼 있던 값(applied)은 둔다', () => {
    const screen = { w: 100, h: 50 }
    const applied = withCond({ searchArea: { x: 90, y: 0, w: 20, h: 10 } }) // 작업본의 값이 이미 화면 밖(저장돼 있던 값·붙여 온 스텝)
    expect(checkStepFields(applied, ctx(applied, { applied, screen }))).toEqual({}) // 고치지 않았다
    const moved = withCond({ searchArea: { x: 95, y: 0, w: 20, h: 10 } })
    expect(checkStepFields(moved, ctx(moved, { applied, screen })).area).toEqual({ code: 'AREA_OUT_RIGHT', params: { w: 100, h: 50, sum: 115, keys: ['x', 'w'] }, level: 'error' })
    const low = withCond({ searchArea: { x: 0, y: 45, w: 20, h: 10 } })
    expect(codes(checkStepFields(low, ctx(low, { applied, screen })))).toEqual({ area: 'AREA_OUT_BOTTOM' })
    expect(checkStepFields(moved, ctx(moved, { applied }))).toEqual({}) // 화면 크기를 모른다
    // 방향마다: 적용돼 있던 값이 오른쪽 밖이어도 Y 만 고치면 막지 않는다
    const down = withCond({ searchArea: { x: 90, y: 5, w: 20, h: 10 } })
    expect(checkStepFields(down, ctx(down, { applied, screen }))).toEqual({})
    // 영역에 들어 있던 음수는 다른 칸을 고쳐도 막지 않는다(음수는 칠 때 areaTyped 로 잡는다)
    const negApplied = withCond({ searchArea: { x: -1, y: 0, w: 20, h: 10 } })
    const negMoved = withCond({ searchArea: { x: -1, y: 0, w: 30, h: 10 } })
    expect(checkStepFields(negMoved, ctx(negMoved, { applied: negApplied, screen }))).toEqual({})
    expect(codes(check(withCond({ areaTyped: { x: '-1' } })))).toEqual({ area: 'AREA_NEGATIVE' })
    expect(codes(check(withCond({ areaTyped: { w: '99999999999' } })))).toEqual({ area: 'AREA_TOO_LARGE' })
  })
  it('표의 줄 알림(applied 를 주지 않는다)은 음수·화면 밖을 보지 않는다 — 저장 기준에 없는 붙여 온 스텝도', () => {
    const s = withCond({ searchArea: { x: -5, y: 0, w: 500, h: 10 } })
    expect(checkStepFields(s, ctx(s, { base: undefined, screen: { w: 100, h: 50 } }))).toEqual({})
  })
  it('새 스텝의 영역은 늘 고친 값이다(견줄 값이 없다)', () => {
    const s = withCond({ searchArea: { x: 95, y: 0, w: 20, h: 10 } })
    expect(codes(checkStepFields(s, ctx(s, { isNew: true, base: null, screen: { w: 100, h: 50 } })))).toEqual({ area: 'AREA_OUT_RIGHT' })
    const fit = withCond({ searchArea: { x: 80, y: 40, w: 20, h: 10 } })
    expect(checkStepFields(fit, ctx(fit, { isNew: true, base: null, screen: { w: 100, h: 50 } }))).toEqual({})
  })
  it('찾을 그림 literal: 공백을 뺀 길이 4 초과이고 4의 배수여야 그림이다(서버 hasImage 와 같다 — 패딩 없는 base64 는 C# 이 못 읽는다)', () => {
    const lit = (literal) => { const s = imageStep(); s.images = { ...s.images, train: { 0: { literal } } }; return codes(check(s)) }
    expect(lit('iVBORw0KGgo=')).toEqual({})
    expect(lit('iVBO Rw0K\nGgo=')).toEqual({})
    expect(lit('iVBORw0KGgo')).toEqual({ train: 'TRAIN_IMAGE_MISSING' })
    expect(lit('AA==')).toEqual({ train: 'TRAIN_IMAGE_MISSING' })
  })
  it('정확도: 0.3 낮음, 1.5·숫자 아님 높음', () => {
    const acc = (accept) => codes(check(withCond({ image: { accept, multi: { count: '1', op: 0 } } })))
    expect(acc(0.3)).toEqual({ accept: 'ACCEPT_TOO_LOW' })
    expect(acc(1.5)).toEqual({ accept: 'ACCEPT_TOO_HIGH' })
    expect(acc(NaN)).toEqual({ accept: 'ACCEPT_TOO_HIGH' })
    expect(acc(undefined)).toEqual({ accept: 'ACCEPT_TOO_HIGH' })
    expect(acc(0.5)).toEqual({})
    expect(acc(1)).toEqual({})
  })
  it('다중 검사 범위(이미지 1~20, OCR 0~20)와 동작 충돌', () => {
    const m = (count, op = 0) => withCond({ image: { accept: 0.8, multi: { count, op } } })
    expect(codes(check(m('0')))).toEqual({ multi: 'MULTI_RANGE' })
    expect(codes(check(m('21')))).toEqual({ multi: 'MULTI_RANGE' })
    expect(codes(check(m('x')))).toEqual({ multi: 'MULTI_RANGE' })
    expect(codes(check(m('1', 5)))).toEqual({ multi: 'MULTI_RANGE' })
    expect(codes(check(ocrStep({ multi: { count: '0', op: 0 } })))).toEqual({})
    expect(codes(check(ocrStep({ multi: { count: '21', op: 0 } })))).toEqual({ multi: 'MULTI_RANGE' })
    const s = imageStep({ action: { type: 1, raw: '', click: { x: 1, y: 1 } } })
    s.condition = { ...s.condition, image: { accept: 0.8, multi: { count: '3', op: 0 } } }
    expect(codes(check(s))).toEqual({ action: 'MULTI_WITH_ACTION' })
    s.action = { type: 0, raw: '' }
    expect(codes(check(s))).toEqual({})
  })
  it('클릭 좌표·휠·대기', () => {
    expect(codes(check(withAction({ type: 1, click: { x: 1, y: null } })))).toEqual({ click: 'CLICK_FORMAT' })
    expect(codes(check(withAction({ type: 1 })))).toEqual({ click: 'CLICK_FORMAT' })
    expect(codes(check(withAction({ type: 1, click: { x: -3, y: 4 } })))).toEqual({})
    expect(codes(check(withAction({ type: 4, wheel: { notches: 1, delaySec: -1 } })))).toEqual({ wheel: 'WHEEL_FORMAT' })
    expect(codes(check(withAction({ type: 4, wheel: { notches: 2, delaySec: 0 } })))).toEqual({})
    expect(codes(check(withAction({ type: 6, waitSec: 0.5 })))).toEqual({ wait: 'WAIT_FORMAT' })
    expect(codes(check(withAction({ type: 6, waitSec: 1 })))).toEqual({})
  })
  it('키보드: codes 로 판단, @@ 와 빈 값', () => {
    const kb = (keyboard) => codes(check(withAction({ type: 5, keyboard })))
    expect(kb({ text: 'a@@b', codes: [] })).toEqual({ key: 'KEY_FORMAT' })
    expect(kb({ text: 'user@', codes: [10] })).toEqual({ key: 'KEY_FORMAT' })
    expect(kb({ text: 'x', codes: [1.5] })).toEqual({ key: 'KEY_FORMAT' })
    expect(kb({ text: '', codes: [] })).toEqual({ key: 'INHOUSE_VALUE_EMPTY' })
    expect(kb({ text: '', codes: [13], keys: [], unknownCodes: [] })).toEqual({})
    expect(kb({ text: 'abc', codes: [] })).toEqual({})
  })
  it('창 찾기: 한쪽 좌표만, 이름·클래스 비움', () => {
    const fw = (findWindow, raw = 'x') => codes(check(withAction({ type: 9, findWindow, raw })))
    expect(fw({ title: 't', className: 'c', x: 1, y: null })).toEqual({ fw: 'FINDWINDOW_FORMAT' })
    expect(fw({ title: '', className: 'c', x: null, y: null })).toEqual({ fw: 'FINDWINDOW_FORMAT' })
    expect(fw({ title: 'a@', className: 'c', x: null, y: null })).toEqual({ fw: 'FINDWINDOW_FORMAT' })
    expect(fw({ title: 't', className: 'c', x: 1, y: 2 })).toEqual({})
    expect(fw({ title: 't', className: 'c', x: null, y: null })).toEqual({})
    expect(fw(undefined, '')).toEqual({ fw: 'VALUE_REQUIRED' })
    expect(fw(undefined, 'broken')).toEqual({ fw: 'FINDWINDOW_FORMAT' })
  })
  it('명령·스크립트', () => {
    expect(codes(check(withAction({ type: 11, command: '' })))).toEqual({ cmd: 'VALUE_REQUIRED' })
    expect(codes(check(withAction({ type: 11, command: 'dir' })))).toEqual({})
    expect(codes(check(withAction({ type: 12, raw: '' })))).toEqual({ script: 'VALUE_REQUIRED' })
    expect(codes(check(withAction({ type: 12, raw: 'a;b' })))).toEqual({ script: 'SCRIPT_FORMAT' })
    const cs = (o) => withAction({ type: 12, customScript: { name: 'run', args: [], timeout: null, email: [], legacy: false, ...o } })
    expect(codes(check(cs({})))).toEqual({})
    expect(codes(check(cs({ name: '' })))).toEqual({ script: 'SCRIPT_FORMAT' })
    expect(codes(check(cs({ args: ['a;b'] })))).toEqual({ script: 'SCRIPT_FORMAT' })
    expect(codes(check(cs({ timeout: { value: 0, unit: 'seconds' } })))).toEqual({ script: 'SCRIPT_FORMAT' })
  })
  it('OCR 비교 방법·값', () => {
    expect(codes(check(ocrStep({ op: 0 })))).toEqual({ ocrOp: 'OCR_OP_REQUIRED' })
    expect(codes(check(ocrStep({ op: 1, text: '' })))).toEqual({ ocrVal: 'OCR_TEXT_FORMAT' })
    expect(codes(check(ocrStep({ op: 1, text: 'a@@@@b' })))).toEqual({ ocrVal: 'OCR_TEXT_FORMAT' })
    expect(codes(check(ocrStep({ op: 5, number: null })))).toEqual({ ocrVal: 'OCR_NUMBER_REQUIRED' })
    expect(codes(check(ocrStep({ op: 7, min: 1, max: null })))).toEqual({ ocrVal: 'OCR_NUMBER_REQUIRED' })
    expect(codes(check(ocrStep({ op: 7, min: 1, max: 5 })))).toEqual({})
  })
  it('갈 곳: 자기 자신·미해결·마지막 스텝의 NEXT', () => {
    const next = (onTrue, onFalse = { kind: 'end', value: 'FAIL' }) => imageStep({ next: { onTrue, onFalse } })
    expect(codes(check(next({ kind: 'step', uid: 'u1' })))).toEqual({ onTrue: 'NEXT_SELF' })
    expect(codes(check(next({ kind: 'end', value: 'SUCCESS' }, { kind: 'unresolved', value: 9 })))).toEqual({ onFalse: 'NEXT_UNRESOLVED' })
    expect(codes(check(next({ kind: 'step', uid: 'gone' })))).toEqual({ onTrue: 'NEXT_UNRESOLVED' })
    // 칸 문구가 원래 번호를 보이도록(목업 validate "갈 곳을 고르세요(원래 N번).") 미해결의 원래 번호를 params 에 싣는다 — 모르면 싣지 않는다
    expect(check(next({ kind: 'end', value: 'SUCCESS' }, { kind: 'unresolved', value: 9 })).onFalse.params).toStrictEqual({ which: 'onFalse', value: 9 })
    expect(check(next({ kind: 'unresolved' })).onTrue.params).toStrictEqual({ which: 'onTrue' })
    expect(check(next({ kind: 'step', uid: 'gone' })).onTrue.params).toStrictEqual({ which: 'onTrue' })
    const last = next({ kind: 'next' })
    expect(codes(checkStepFields(last, { working: { steps: [imageStep({ uid: 'u0' }), last] }, isNew: false, base: last, user: {} }))).toEqual({ onTrue: 'LAST_STEP_NEXT' })
    expect(codes(checkStepFields(last, { working: { steps: [last, imageStep({ uid: 'u0' })] }, isNew: false, base: last, user: {} }))).toEqual({})
    // 새 스텝은 아직 목록에 없어 마지막이 아니다
    expect(codes(checkStepFields(last, { working: { steps: [imageStep({ uid: 'u0' })] }, isNew: true, base: null, user: {} }))).toEqual({})
  })
  it('재시도: 간격 2초 이상, 횟수 상한은 등급 1·2 가 200', () => {
    const r = (limit, intervalMs = 2000) => imageStep({ retry: { limit, intervalMs } })
    expect(check(r(150), { user: { authorityManager: 3 } }).retry).toEqual({ code: 'RETRY_RANGE', params: { max: 20 }, level: 'error' })
    expect(check(r(150), { user: { authorityManager: 2 } })).toEqual({})
    expect(check(r(150), { user: { authorityManager: 1 } })).toEqual({})
    expect(codes(check(r(201), { user: { authorityManager: 2 } }))).toEqual({ retry: 'RETRY_RANGE' })
    expect(codes(check(r(20)))).toEqual({})
    expect(codes(check(r(1, 1999)))).toEqual({ retry: 'RETRY_RANGE' })
    expect(codes(check(r(1.5)))).toEqual({ retry: 'RETRY_RANGE' })
  })
  describe('OCR·조건 없음 + 클릭 (R-T3a)', () => {
    const click = { type: 1, click: { x: 1, y: 2 } }
    it('고친 스텝은 error', () => {
      const base = ocrStep({}, { type: 0, raw: '' })
      const s = ocrStep({}, click)
      expect(check(s, { base }).action).toMatchObject({ code: 'OCR_MOUSE_CLICK', level: 'error' })
      const none = imageStep({ condition: { kind: 'none', skipPreprocessing: false }, action: click })
      expect(check(none, { base: null, isNew: true }).action).toMatchObject({ code: 'NONE_MOUSE_CLICK', level: 'error' })
    })
    it('옛 값 그대로면 notice', () => {
      const s = ocrStep({}, click)
      expect(check(s, { base: s }).action).toEqual({ code: 'OCR_MOUSE_CLICK', params: {}, level: 'notice' })
      const none = imageStep({ condition: { kind: 'none', skipPreprocessing: false }, action: click })
      expect(check(none, { base: { ...none } }).action).toMatchObject({ code: 'NONE_MOUSE_CLICK', level: 'notice' })
    })
    it('다른 칸 오류는 항상 error', () => {
      expect(check(imageStep({ descriptionToEmail: '' })).desc.level).toBe('error')
    })
  })
})

describe('barFieldErrors — 서버 header 규칙과 같다', () => {
  const h = (description, timeoutLimit) => barFieldErrors({ description, timeoutLimit })
  it('제목 비움·콜론', () => {
    expect(h('', '1').description).toBe('MAIL_TITLE_EMPTY')
    expect(h('a:b', '1').description).toBe('MAIL_TITLE_COLON')
    expect(h('ok', '1')).toEqual({})
  })
  it('제한 시간: 1 이상 정수 문자열, 상한 2147483647, 숫자 타입은 거절', () => {
    for (const bad of ['', '0', '01', '1.5', 'x', '2147483648', '99999999999']) expect(h('a', bad).timeoutLimit).toBe('TIMEOUT_INVALID')
    expect(h('a', 15).timeoutLimit).toBe('TIMEOUT_INVALID')
    expect(h('a', '2147483647')).toEqual({})
  })
})
