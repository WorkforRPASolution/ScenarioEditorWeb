// Vision·OCR 시험의 규칙(P4 설계 §5.2·§5.3·§6) — 입력 검사, 판정 서버로 보낼 요청 조립, 응답 정리
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const {
  MAX_REQUEST_BYTES, parseVisionMeta, parseOcrMeta, buildVisionRequest, buildOcrRequest, visionResults, ocrResult, aboutText
} = require('../../domain/visionTest')

const SOURCE = Buffer.from('source-png')
const TRAIN = Buffer.from('train-png')
const bad = (fn) => { try { fn() } catch (e) { return e } throw new Error('던지지 않았다') }

describe('한도', () => {
  it('보낼 수 있는 요청은 4 MiB 까지(판정 서버의 수신 기본값)', () => {
    expect(MAX_REQUEST_BYTES).toBe(4194304)
  })
})

describe('parseVisionMeta', () => {
  it('정확도 0~1 의 유한한 수를 받는다 — 0.5 미만도 시험은 한다', () => {
    expect(parseVisionMeta({ accept: 0.95 })).toEqual({ accept: 0.95, about: null })
    expect(parseVisionMeta({ accept: 0 }).accept).toBe(0)
    expect(parseVisionMeta({ accept: 1 }).accept).toBe(1)
    expect(parseVisionMeta({ accept: 0.3 }).accept).toBe(0.3)
  })
  it('범위 밖·수가 아닌 값은 400 BAD_REQUEST(path accept)', () => {
    for (const v of [-0.01, 1.01, NaN, Infinity, '0.9', null, undefined, true, [0.9]]) {
      const e = bad(() => parseVisionMeta({ accept: v }))
      expect([e.statusCode, e.code, e.details], String(v)).toEqual([400, 'BAD_REQUEST', { path: 'accept' }])
    }
  })
  it('meta 가 객체가 아니면 400', () => {
    for (const m of [null, 'x', 3, [1]]) expect(bad(() => parseVisionMeta(m)).code).toBe('BAD_REQUEST')
  })
  it('about 은 로그용이다 — 글자열은 100자까지, step 은 정수만, 모르는 칸은 버린다', () => {
    const out = parseVisionMeta({ accept: 0.9, about: { process: 'SEWCVD', model: 'M'.repeat(300), scenario: 'S1', step: 3, extra: 'x' } })
    expect(out.about).toEqual({ process: 'SEWCVD', model: 'M'.repeat(100), scenario: 'S1', step: 3 })
    expect(parseVisionMeta({ accept: 0.9, about: { step: '3', process: 7 } }).about).toEqual({})
    expect(parseVisionMeta({ accept: 0.9, about: 'x' }).about).toBeNull()
  })
})

describe('parseOcrMeta', () => {
  it('글 비교(연산 1~4): text 만 쓴다', () => {
    expect(parseOcrMeta({ op: 3, text: 'READY', number: 5, min: 1, max: 2 }))
      .toEqual({ op: 3, text: 'READY', number: null, min: null, max: null, multi: null, about: null })
  })
  it('수 비교(5·6·9·10): number 만, 범위(7·8): min·max 만', () => {
    expect(parseOcrMeta({ op: 9, number: -12.5, text: 'x' })).toMatchObject({ op: 9, text: null, number: -12.5, min: null, max: null })
    expect(parseOcrMeta({ op: 7, min: 10, max: 20, number: 3 })).toMatchObject({ op: 7, text: null, number: null, min: 10, max: 20 })
    expect(parseOcrMeta({ op: 8, min: 20, max: 10 })).toMatchObject({ min: 20, max: 10 }) // 순서는 보지 않는다(화면 규칙과 같다)
  })
  it('다중 검사는 없거나 { count 0~20 정수, op 0·1·2 }', () => {
    expect(parseOcrMeta({ op: 1, text: 'A', multi: { count: 2, op: 1 } }).multi).toEqual({ count: 2, op: 1 })
    expect(parseOcrMeta({ op: 1, text: 'A', multi: { count: 0, op: 2 } }).multi).toEqual({ count: 0, op: 2 })
    expect(parseOcrMeta({ op: 1, text: 'A', multi: null }).multi).toBeNull()
    for (const m of [{ count: 21, op: 0 }, { count: -1, op: 0 }, { count: 1.5, op: 0 }, { count: '2', op: 0 }, { count: 2, op: 3 }, { count: 2 }, 'x', []]) {
      const e = bad(() => parseOcrMeta({ op: 1, text: 'A', multi: m }))
      expect([e.code, e.details], JSON.stringify(m)).toEqual(['BAD_REQUEST', { path: 'multi' }])
    }
  })
  it('연산은 1~10 의 정수', () => {
    for (const op of [0, 11, 1.5, '3', null, undefined]) {
      expect(bad(() => parseOcrMeta({ op, text: 'A' })).details, String(op)).toEqual({ path: 'op' })
    }
  })
  it('글 값: 비었거나, `@@@@` 가 들었거나, `@` 로 끝나거나, 500자를 넘거나, 글자열이 아니면 400(path text)', () => {
    for (const text of ['', 'A@@@@B', 'AB@', 'x'.repeat(501), 5, null, undefined]) {
      expect(bad(() => parseOcrMeta({ op: 1, text })).details, String(text).slice(0, 20)).toEqual({ path: 'text' })
    }
    expect(parseOcrMeta({ op: 1, text: 'a@b' }).text).toBe('a@b')
    expect(parseOcrMeta({ op: 1, text: 'x'.repeat(500) }).text).toHaveLength(500)
  })
  it('수 값: 유한한 수가 아니면 400 — number / min·max', () => {
    for (const number of ['5', NaN, Infinity, null, undefined]) expect(bad(() => parseOcrMeta({ op: 5, number })).details).toEqual({ path: 'number' })
    expect(bad(() => parseOcrMeta({ op: 7, min: 1 })).details).toEqual({ path: 'max' })
    expect(bad(() => parseOcrMeta({ op: 7, max: 1 })).details).toEqual({ path: 'min' })
    expect(bad(() => parseOcrMeta({ op: 8, min: '1', max: 2 })).details).toEqual({ path: 'min' })
  })
})

describe('buildVisionRequest', () => {
  it('받은 그림 둘을 그대로 싣고 개수 20·Timeout 2000·true 를 보낸다(Q-110)', () => {
    const req = buildVisionRequest({ source: SOURCE, train: TRAIN, accept: 0.87 })
    expect(req).toEqual({ sourceImage: SOURCE, trainImage: TRAIN, param: { AcceptThreshold: 0.87, MaximumNumberToFind: 20, Timeout: 2000, TimeoutEnabled: true } })
    expect(req.sourceImage).toBe(SOURCE)
  })
})

describe('buildOcrRequest — 사내 편집기와 같은 형식', () => {
  const build = (meta) => buildOcrRequest({ source: SOURCE, ...parseOcrMeta(meta) })
  const ZERO = { NumberValue: 0, NumberRangeMin: 0, NumberRangeMax: 0 }
  it('글 비교: 값 종류 1, TextValue = 값, MinMatchingValue 10, 수 칸은 0', () => {
    for (const op of [1, 2, 3, 4]) {
      expect(build({ op, text: 'READY' })).toEqual({ sourceImage: SOURCE, param: { OcrValueType: 1, OcrOperation: op, TextValue: 'READY', MinMatchingValue: 10, ...ZERO } })
    }
  })
  it('단일 수 비교(5·6·9·10): 값 종류 2, TextValue 빈 글, NumberValue 만', () => {
    for (const op of [5, 6, 9, 10]) {
      expect(build({ op, number: 12.5 }).param).toEqual({ OcrValueType: 2, OcrOperation: op, TextValue: '', MinMatchingValue: 10, NumberValue: 12.5, NumberRangeMin: 0, NumberRangeMax: 0 })
    }
  })
  it('범위(7·8): NumberRangeMin·Max 만', () => {
    for (const op of [7, 8]) {
      expect(build({ op, min: 10, max: 20 }).param).toEqual({ OcrValueType: 2, OcrOperation: op, TextValue: '', MinMatchingValue: 10, NumberValue: 0, NumberRangeMin: 10, NumberRangeMax: 20 })
    }
  })
  it('다중 검사가 있으면 뒤에 `@@@@{개수}-{연산}` — 수 비교는 접미사만', () => {
    expect(build({ op: 3, text: 'READY', multi: { count: 2, op: 1 } }).param.TextValue).toBe('READY@@@@2-1')
    expect(build({ op: 7, min: 1, max: 2, multi: { count: 0, op: 2 } }).param.TextValue).toBe('@@@@0-2')
    expect(build({ op: 5, number: 3, multi: { count: 20, op: 0 } }).param.TextValue).toBe('@@@@20-0')
  })
  it('다중 검사가 없으면(옛 스텝) 접미사를 붙이지 않는다', () => {
    expect(build({ op: 1, text: 'READY' }).param.TextValue).toBe('READY')
    expect(build({ op: 5, number: 3 }).param.TextValue).toBe('')
  })
  it('시험마다 새 객체다 — 앞 시험의 값이 남지 않는다', () => {
    const a = build({ op: 7, min: 10, max: 20 })
    const b = build({ op: 5, number: 1 })
    expect(b.param.NumberRangeMin).toBe(0)
    expect(a.param).not.toBe(b.param)
  })
})

describe('응답 정리', () => {
  it('visionResults: 점수·좌표를 받은 그대로(소수 포함) — success 가 거짓인 것은 뺀다', () => {
    expect(visionResults({ searchmaxResult: [{ success: true, Score: 0.9731, TX: 12.5, TY: 40 }, { success: false, Score: 0.2, TX: 1, TY: 1 }, { success: true, Score: 1, TX: 0, TY: 0 }] }))
      .toEqual([{ score: 0.9731, x: 12.5, y: 40 }, { score: 1, x: 0, y: 0 }])
    expect(visionResults({ searchmaxResult: [] })).toEqual([])
    expect(visionResults({})).toEqual([])
  })
  it('ocrResult: 판정·읽은 글·신뢰도를 받은 그대로', () => {
    expect(ocrResult({ IsAccepted: true, FoundResult: 'READY @@ IDLE', Confidence: ':98:71', TX: 0, TY: 0 })).toEqual({ accepted: true, found: 'READY @@ IDLE', confidence: ':98:71' })
    expect(ocrResult({})).toEqual({ accepted: false, found: '', confidence: '' })
  })
})

describe('aboutText — 로그 한 토막', () => {
  it('공정/모델/시나리오#스텝 — 없는 칸은 `-`', () => {
    expect(aboutText({ process: 'SEWCVD', model: 'M1', scenario: 'S1', step: 3 })).toBe('SEWCVD/M1/S1#3')
    expect(aboutText({ scenario: 'S1' })).toBe('-/-/S1#-')
    expect(aboutText(null)).toBe('-')
  })
  it('줄바꿈·제어 문자는 빈칸으로 — 로그 줄을 깨지 않는다', () => {
    const { about } = parseVisionMeta({ accept: 1, about: { scenario: 'A\nB\tC\u0000D' } })
    expect(aboutText(about)).toBe('-/-/A B C D#-')
  })
})
