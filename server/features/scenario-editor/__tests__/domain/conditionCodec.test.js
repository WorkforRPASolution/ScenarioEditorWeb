import { describe, it, expect } from 'vitest'
import { parseCondition, parseAction, encodeCondition, encodeAction } from '../../domain/conditionCodec'
import { newRawStep } from '../../domain/csDefaults'

const md = (over = {}) => ({
  SearchArea: { X: 10, Y: 20, Width: 30, Height: 40 },
  ImageSearchParam: { TrainImageMap: { 0: { BinaryImage: 'AQ==', Type: true } }, AcceptThreshold: 0.9, MaximumNumberToFind: 1, TimeoutEnabled: true, Timeout: 1000 },
  ConditionExpression: '',
  OcrParamInfo: { Type: 0, Operation: 0, TextValue: '', NumberValue: -218, NumberRangeMin: -218, NumberRangeMax: -218, MinMatchingValue: 5 },
  ...over
})
const step = (op, mdOver, script = { Type: 0, Value: '', NativeFunction: null }) => ({ Operation: op, Metadata: md(mdOver), Script: script })
const codes = (notes) => notes.map((n) => n.code).sort()

describe('parseCondition', () => {
  it('이미지: 검색 영역·정확도·다중 검사·학습 이미지 키', () => {
    const { condition, notes } = parseCondition(step(1, { OcrParamInfo: { ...md().OcrParamInfo, TextValue: '2-1' } }))
    expect(condition).toMatchObject({ kind: 'image', operationRaw: 1, skipPreprocessing: false, searchArea: { x: 10, y: 20, w: 30, h: 40 } })
    expect(condition.image).toMatchObject({ accept: 0.9, maxFind: 1, timeoutEnabled: true, timeout: 1000, multi: { count: '2', op: 1, raw: '2-1' }, trainImages: [{ key: 0, type: true }] })
    expect(notes).toEqual([])
  })
  it('이미지 다중 검사 빈 값은 1·0 으로 본다', () => {
    expect(parseCondition(step(1)).condition.image.multi).toEqual({ count: '1', op: 0, raw: '' })
  })
  it('OCR: 첫 @@@@ 에서 자르고 뒤를 - 로 나눈다', () => {
    const { condition, notes } = parseCondition(step(2, { OcrParamInfo: { Type: 1, Operation: 1, TextValue: 'IDLE@@@@1-0', NumberValue: -218, NumberRangeMin: -218, NumberRangeMax: -218, MinMatchingValue: 10 } }))
    expect(condition.ocr).toMatchObject({ op: 1, opName: 'TextEqual', type: 1, text: 'IDLE', multi: { count: '1', op: 0, raw: '1-0' }, minMatching: 10 })
    expect(notes).toEqual([])
  })
  it('OCR 연산 None 은 경고, "@@@@-0-1" 처럼 토큰이 어긋나면 해석 실패', () => {
    const r = parseCondition(step(2, { OcrParamInfo: { Type: 2, Operation: 0, TextValue: '@@@@-0-1', NumberValue: 1, NumberRangeMin: -218, NumberRangeMax: -218, MinMatchingValue: 10 } }))
    expect(codes(r.notes)).toEqual(['OCR_OP_NONE', 'PARSE_FAILED'])
  })
  it('설비 상태: 대상 종류와 _ 빈 칸', () => {
    const p = (expr) => parseCondition(step(4, { ConditionExpression: expr }))
    expect(p('MAIN,IDLE,_').condition.eqpState).toEqual({ target: 'MAIN', targetKind: 'main', state: 'IDLE', code: '', raw: 'MAIN,IDLE,_' })
    expect(p('A,_,1001').condition.eqpState.targetKind).toBe('chamber')
    expect(p('B1,RUN,_').condition.eqpState.targetKind).toBe('loadport')
    expect(p('MAIN,IDLE,_').condition.skipPreprocessing).toBe(null)
    expect(codes(p('MAIN,IDLE').notes)).toEqual(['PARSE_FAILED'])
    expect(codes(p('SkipPreprocessing').notes)).toEqual(['EQPSTATE_SKIP_PREPROCESSING'])
  })
  it('전처리 스킵은 ConditionExpression == SkipPreprocessing', () => {
    expect(parseCondition(step(0, { ConditionExpression: 'SkipPreprocessing' })).condition.skipPreprocessing).toBe(true)
  })
  it('Variable(3)·범위 밖은 unknown + 경고', () => {
    expect(parseCondition(step(3)).condition.kind).toBe('unknown')
    expect(codes(parseCondition(step(9)).notes)).toEqual(['CONDITION_UNKNOWN'])
  })
  it('Metadata 가 null 이면 해석 실패 경고', () => {
    expect(codes(parseCondition({ Operation: 1, Metadata: null, Script: null }).notes)).toEqual(['PARSE_FAILED'])
  })
})

describe('parseAction', () => {
  const a = (type, value, kind = 'none', nf = null) => parseAction({ Script: { Type: type, Value: value, NativeFunction: nf } }, kind)
  it('마우스: 이미지 스텝은 학습 이미지 기준, 조건 없음은 화면 왼쪽 위(SE-023)', () => {
    expect(a(1, '24:12', 'image').action.click).toEqual({ x: 24, y: 12, basis: 'trainImage' })
    expect(a(3, '-3:7', 'none').action.click).toEqual({ x: -3, y: 7, basis: 'screenOrigin' })
    expect(codes(a(1, '5:5', 'ocr').notes)).toEqual(['OCR_WITH_MOUSE_CLICK'])
    expect(codes(a(1, 'Set mouse Coordinates.', 'image').notes)).toEqual(['PARSE_FAILED'])
  })
  it('휠·대기', () => {
    expect(a(4, '-3@@2').action.wheel).toEqual({ notches: -3, delaySec: 2 })
    expect(a(6, '30000').action.waitSec).toBe(30)
    expect(codes(a(6, 'x').notes)).toEqual(['PARSE_FAILED'])
  })
  it('키보드: 문자열 + 기능 키, 이름표에 없는 코드는 알림', () => {
    expect(a(5, 'RESET@@10@@9').action.keyboard).toEqual({ text: 'RESET', keys: [{ code: 10, name: 'Enter' }, { code: 9, name: 'Tab' }], unknownCodes: [] })
    const r = a(5, 'x@@999')
    expect(r.action.keyboard.unknownCodes).toEqual([999])
    expect(codes(r.notes)).toEqual(['KEY_CODE_UNKNOWN'])
    expect(codes(a(5, 'a@@b').notes)).toEqual(['PARSE_FAILED'])
  })
  it('O.I. Command: EQP_DOWN·RUNDOWN_RELEASE·@COMMENT:', () => {
    expect(a(8, 'EQP_DOWN@10000@A').action.oiCommand).toEqual({ command: 'EQP_DOWN', code: '10000', chamber: 'A' })
    expect(a(8, 'RUNDOWN_RELEASE@B@COMMENT:메모').action.oiCommand).toEqual({ command: 'RUNDOWN_RELEASE', code: null, chamber: 'B' })
    expect(a(8, 'SERVER_RESTART').action.oiCommand).toEqual({ command: 'SERVER_RESTART', code: null, chamber: null })
    expect(codes(a(8, 'SERVER_RESTART').notes)).toEqual(['ACTION_NOT_IN_COMBO'])
  })
  it('FAP 4토큰·NativeFunction', () => {
    expect(a(13, 'SSB01@PM1@A@MACRO9').action.fap).toEqual({ ssbMessage: 'SSB01', pmCode: 'PM1', mainChamber: 'A', esopMacroId: 'MACRO9' })
    expect(codes(a(13, 'SSB01@PM1').notes)).toEqual(['ACTION_NOT_IN_COMBO', 'PARSE_FAILED'])
    expect(a(15, '', 'none', { FunctionName: 'F', Params: ['p'], Outputs: [] }).action.native).toEqual({ functionName: 'F', params: ['p'], outputs: [] })
  })
  it('값이 필요한 동작(FindWindow·RunCommand·CustomScript)의 빈 값은 경고', () => {
    expect(codes(a(11, '').notes)).toEqual(['VALUE_EMPTY'])
    expect(codes(a(9, '').notes)).toEqual(['VALUE_EMPTY'])
    expect(a(10, 'ops@example.com').notes).toEqual([])
  })
  it('동작 -1·범위 밖은 경고, 이름은 null', () => {
    const r = a(-1, '')
    expect(r.action).toMatchObject({ type: -1, typeName: null })
    expect(codes(r.notes)).toEqual(['ACTION_INVALID'])
  })
})

// 해석에 실패해도 예외로 끝내지 않고 그 스텝에 경고를 단다(설계 §5.6).
const warn = (field, extra = {}) => ({ level: 'warning', code: 'PARSE_FAILED', params: { field, ...extra } })
const ocrInfo = (over) => ({ OcrParamInfo: { Type: 1, Operation: 1, TextValue: '', NumberValue: -218, NumberRangeMin: -218, NumberRangeMax: -218, MinMatchingValue: 10, ...over } })
const DEFAULT_MULTI = { count: '1', op: 0, raw: '' }

describe('parseCondition: 잘못된 입력에도 예외가 없다', () => {
  it.each([null, undefined, 5, 'x'])('step=%s → unknown + step 경고', (bad) => {
    expect(() => parseCondition(bad)).not.toThrow()
    expect(parseCondition(bad)).toEqual({
      condition: { kind: 'unknown', operationRaw: null, skipPreprocessing: null },
      notes: [warn('step')]
    })
  })
  it.each([123, true, {}, ['2-1']])('이미지 스텝의 TextValue=%j 는 빈 값으로 보고 TextValue 경고', (bad) => {
    const r = parseCondition(step(1, { OcrParamInfo: { ...md().OcrParamInfo, TextValue: bad } }))
    expect(r.condition.image.multi).toEqual(DEFAULT_MULTI)
    expect(r.notes).toEqual([warn('TextValue')])
  })
  it('이미지 스텝의 TextValue 가 null·없음이면 경고 없이 기본값', () => {
    for (const tv of [null, undefined]) {
      const r = parseCondition(step(1, { OcrParamInfo: { ...md().OcrParamInfo, TextValue: tv } }))
      expect(r.condition.image.multi).toEqual(DEFAULT_MULTI)
      expect(r.notes).toEqual([])
    }
  })
  it.each([123, true, {}, ['IDLE@@@@1-0']])('OCR 스텝의 TextValue=%j 는 빈 값으로 보고 TextValue 경고', (bad) => {
    const r = parseCondition(step(2, ocrInfo({ TextValue: bad })))
    expect(r.condition.ocr).toMatchObject({ text: '', multi: DEFAULT_MULTI })
    expect(r.notes).toEqual([warn('TextValue')])
  })
  it('OCR 스텝의 TextValue 가 null·없음이면 경고 없이 빈 문자열', () => {
    for (const tv of [null, undefined]) {
      const r = parseCondition(step(2, ocrInfo({ TextValue: tv })))
      expect(r.condition.ocr).toMatchObject({ text: '', multi: DEFAULT_MULTI })
      expect(r.notes).toEqual([])
    }
  })
  it('OCR 텍스트에 @@@@ 가 없으면 다중 검사는 사내 기본값 1·0', () => {
    const r = parseCondition(step(2, ocrInfo({ TextValue: 'IDLE' })))
    expect(r.condition.ocr).toMatchObject({ text: 'IDLE', multi: DEFAULT_MULTI })
    expect(r.notes).toEqual([])
  })
  it.each([123, true, {}])('설비 상태 스텝의 ConditionExpression=%j 는 빈 값으로 보고 경고 둘(원인·결과)', (bad) => {
    const r = parseCondition(step(4, { ConditionExpression: bad }))
    expect(r.condition.kind).toBe('eqpState')
    expect(r.condition.eqpState).toMatchObject({ target: null, targetKind: 'unknown', raw: '' })
    expect(r.notes).toEqual([warn('ConditionExpression'), warn('eqpState', { raw: '' })])
  })
  it('설비 상태 스텝의 ConditionExpression 이 없으면 기존대로 eqpState 경고 하나', () => {
    const r = parseCondition(step(4, { ConditionExpression: undefined }))
    expect(r.notes).toEqual([warn('eqpState', { raw: '' })])
  })
})

describe('parseAction: 잘못된 입력에도 예외가 없다', () => {
  it.each([null, undefined, 5, 'x'])('step=%s → type null + step 경고', (bad) => {
    expect(() => parseAction(bad, 'image')).not.toThrow()
    expect(parseAction(bad, 'image')).toEqual({
      action: { type: null, typeName: null, raw: null },
      notes: [warn('step')]
    })
  })
})

describe('동작 해석 보강·조립', () => {
  const act = (t, v) => parseAction({ Script: { Type: t, Value: v } }, 'image').action
  const actFor = (kind, t, v) => parseAction({ Script: { Type: t, Value: v } }, kind).action
  const actNotes = (t, v) => parseAction({ Script: { Type: t, Value: v } }, 'image').notes
  const ocrCond = (ocr) => ({ kind: 'ocr', skipPreprocessing: false, searchArea: { x: 1, y: 2, w: 3, h: 4 }, ocr })

  it('창 찾기 해석', () => {
    expect(act(9, 'EQ Control*@WindowsForms10').findWindow).toEqual({ title: 'EQ Control*', className: 'WindowsForms10', x: null, y: null })
    expect(act(9, 'A@B@10@20').findWindow).toEqual({ title: 'A', className: 'B', x: 10, y: 20 })
    expect(actNotes(9, 'A@B@10').map((n) => n.code)).toContain('PARSE_FAILED')
    expect(act(9, 'A@B@10').findWindow).toBeUndefined()
    expect(actNotes(9, 'A@B@x@y').map((n) => n.code)).toContain('PARSE_FAILED')
    expect(act(9, 'A@B@x@y').findWindow).toBeUndefined()
  })
  it('명령 실행 해석', () => {
    expect(act(11, 'restart.bat').command).toBe('restart.bat')
  })
  it('사용자 스크립트 해석', () => {
    expect(act(12, 'reset;-f;x;@@timeout:5 minutes,email:fail').customScript)
      .toEqual({ name: 'reset', args: ['-f', 'x'], timeout: { value: 5, unit: 'minutes' }, email: ['fail'], legacy: false })
    expect(act(12, 'old@a@b').customScript).toEqual({ name: 'old', args: ['a', 'b'], timeout: null, email: [], legacy: true })
    expect(act(12, 'only;').customScript).toEqual({ name: 'only', args: [], timeout: null, email: [], legacy: false })
  })
  it('사용자 스크립트: 옵션이 잘못되면 해석 실패', () => {
    for (const v of ['a;@@timeout:5 days', 'a;@@timeout:x minutes', 'a;@@bogus:1', 'a;@@email:maybe']) {
      expect(actNotes(12, v).map((n) => n.code)).toContain('PARSE_FAILED')
      expect(act(12, v).customScript).toBeUndefined()
    }
  })
  it('클릭 기준', () => {
    expect(actFor('image', 1, '5:6').click.basis).toBe('trainImage')
    expect(actFor('none', 1, '5:6').click.basis).toBe('screenOrigin')
    expect(actFor('ocr', 1, '5:6').click.basis).toBe('unknown')
    expect(actFor('eqpState', 1, '5:6').click.basis).toBe('unknown')
  })
  it('조립 → 해석 왕복(동작 전 종류)', () => {
    for (const [t, v] of [[1, '-3:7'], [4, '-2@@1'], [5, 'abc@@10@@27'], [5, 'x@@999'], [6, '3000'], [6, '4350'], [6, '1500'], [9, 'A@B'], [9, 'A@B@10@20'],
      [11, 'restart.bat'], [12, 'reset;-f;@@timeout:5 minutes,email:fail'], [12, 'only;'], [12, 'n;a;'], [12, 'n;@@email:success,email:fail'],
      [12, 'old@a@b'], [0, '']]) {
      const parsed = act(t, v)
      expect(encodeAction(parsed, null)).toEqual({ Type: t, Value: v, NativeFunction: null })
    }
  })
  it('보존 전용 동작은 base 그대로', () => {
    const base = { Type: 8, Value: 'EQP_DOWN@E1@A@COMMENT:x', NativeFunction: null }
    expect(encodeAction(act(8, base.Value), base)).toEqual(base)
    const nf = { Type: 15, Value: 'v', NativeFunction: { FunctionName: 'f' } }
    expect(encodeAction(act(15, 'v'), nf)).toEqual(nf)
    const ml = { Type: 10, Value: 'to@x', NativeFunction: null }
    expect(encodeAction(act(10, 'to@x'), ml).Value).toBe('to@x')
  })
  it('대기 조립은 부동소수 오차 없이 정수 ms', () => {
    expect(encodeAction({ type: 6, waitSec: 4.35 }, null).Value).toBe('4350')
  })
  it('이미지 조건 조립', () => {
    const base = newRawStep('image').Metadata
    const r = encodeCondition({ kind: 'image', skipPreprocessing: false, searchArea: { x: 1, y: 2, w: 3, h: 4 },
      image: { accept: 0.85, multi: { count: '3', op: 1 } } }, base, [[0, { BinaryImage: 'QUJD', Type: true }]])
    expect(r.Operation).toBe(1)
    expect(r.Metadata.SearchArea).toEqual({ X: 1, Y: 2, Width: 3, Height: 4 })
    expect(r.Metadata.ImageSearchParam.AcceptThreshold).toBe(0.85)
    expect(r.Metadata.OcrParamInfo.TextValue).toBe('3-1')
    expect(r.Metadata.ImageSearchParam.TrainImageMap).toEqual([[0, { BinaryImage: 'QUJD', Type: true }]])
    expect(r.Metadata.ConditionExpression).toBe('')
    expect(base.SearchArea).toEqual({ X: 0, Y: 0, Width: 0, Height: 0 }) // base 는 바꾸지 않는다
  })
  it('SkipPreprocessing 은 ConditionExpression 으로', () => {
    const base = newRawStep('ocr').Metadata
    const c = ocrCond({ op: 1, text: 'A', multi: { count: '1', op: 0 } })
    expect(encodeCondition({ ...c, skipPreprocessing: true }, base, []).Metadata.ConditionExpression).toBe('SkipPreprocessing')
  })
  it('OCR 조건 조립: 문자·범위·숫자', () => {
    const base = newRawStep('ocr').Metadata
    expect(encodeCondition(ocrCond({ op: 1, text: 'IDLE', multi: { count: '1', op: 0 } }), base, []).Metadata.OcrParamInfo)
      .toMatchObject({ Type: 1, Operation: 1, TextValue: 'IDLE@@@@1-0', MinMatchingValue: 10 })
    expect(encodeCondition(ocrCond({ op: 7, min: 1.5, max: 3, multi: { count: '1', op: 0 } }), base, []).Metadata.OcrParamInfo)
      .toMatchObject({ Type: 2, Operation: 7, TextValue: '@@@@1-0', NumberRangeMin: 1.5, NumberRangeMax: 3 })
    const n = encodeCondition(ocrCond({ op: 5, number: 42, text: 'ignored', multi: { count: '2', op: 1 } }), base, []).Metadata.OcrParamInfo
    expect(n).toMatchObject({ Type: 2, Operation: 5, TextValue: '@@@@2-1', NumberValue: 42, NumberRangeMin: base.OcrParamInfo.NumberRangeMin })
  })
  it('조건 없음·설비 상태', () => {
    const base = newRawStep('none').Metadata
    expect(encodeCondition({ kind: 'none', skipPreprocessing: false }, base, [])).toEqual({ Operation: 0, Metadata: base })
    const eq = { ...base, ConditionExpression: 'MAIN,RUN,_' }
    expect(encodeCondition({ kind: 'eqpState' }, eq, [])).toEqual({ Operation: 4, Metadata: eq })
  })
})
