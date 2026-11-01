import { describe, it, expect } from 'vitest'
import { parseCondition, parseAction } from '../../domain/conditionCodec'

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
  it('마우스: 이미지 스텝은 학습 이미지 기준, 그 밖은 절대', () => {
    expect(a(1, '24:12', 'image').action.click).toEqual({ x: 24, y: 12, basis: 'trainImage' })
    expect(a(3, '-3:7', 'none').action.click).toEqual({ x: -3, y: 7, basis: 'absolute' })
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
