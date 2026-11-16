'use strict'
// Vision·OCR 시험의 규칙 (P4 설계 §5.2·§5.3·§6) — 입력 검사, 판정 서버로 보낼 요청 조립, 응답 정리. 순수 함수.
// 그림은 브라우저가 준비한다(검색 영역 조각·찾을 그림). 서버는 받은 PNG 를 그대로 싣는다.
// 요청은 시험마다 새로 만든다 — 사내 편집기는 앞 시험의 값이 OCR 요청에 남는다.
const { seError } = require('../errors')

const MAX_REQUEST_BYTES = 4 * 1024 * 1024 // 판정 서버(사내 C# Grpc.Core)의 수신 기본값 — 직렬화한 요청이 넘으면 보내지 않는다
// 사내 편집기가 보내는 고정값(분석 42 Q-110 — 개수·Timeout 칸을 두지 않는다. 판정 서버는 개수를 20 으로 덮어쓴다)
const VISION_MAX_TO_FIND = 20
const VISION_TIMEOUT = 2000
const OCR_MIN_MATCHING = 10
const TEXT_OPS = new Set([1, 2, 3, 4])
const RANGE_OPS = new Set([7, 8])
const MULTI = '@@@@'
const TEXT_MAX = 500
const ABOUT_MAX = 100
const ABOUT_KEYS = ['process', 'model', 'scenario']

const bad = (path, message) => seError(400, 'BAD_REQUEST', message, { path })
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

function metaObject(meta) {
  if (!isObject(meta)) throw bad('meta', 'meta 는 객체여야 합니다')
  return meta
}

// 무엇을 시험했는지 — 로그에만 쓴다. 틀린 칸은 조용히 버린다(시험을 막지 않는다).
function parseAbout(about) {
  if (!isObject(about)) return null
  const out = {}
  for (const key of ABOUT_KEYS) {
    // 줄바꿈·제어 문자는 빈칸으로 — 로그 줄을 깨지 않는다
    if (typeof about[key] === 'string') out[key] = about[key].replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, ABOUT_MAX)
  }
  if (Number.isInteger(about.step)) out.step = about.step
  return out
}

function parseVisionMeta(meta) {
  const m = metaObject(meta)
  if (!isNum(m.accept) || m.accept < 0 || m.accept > 1) throw bad('accept', '정확도는 0 이상 1 이하의 수여야 합니다')
  return { accept: m.accept, about: parseAbout(m.about) }
}

function parseMulti(multi) {
  if (multi === undefined || multi === null) return null
  const ok = isObject(multi) && Number.isInteger(multi.count) && multi.count >= 0 && multi.count <= 20 && [0, 1, 2].includes(multi.op)
  if (!ok) throw bad('multi', '다중 검사는 개수 0~20 의 정수와 연산 0·1·2 여야 합니다')
  return { count: multi.count, op: multi.op }
}

// 연산에 맞는 칸만 본다(나머지는 버린다). 화면의 패널 검사(fieldRules)와 같은 뜻이다.
function parseOcrMeta(meta) {
  const m = metaObject(meta)
  const op = m.op
  if (!Number.isInteger(op) || op < 1 || op > 10) throw bad('op', 'OCR 비교 방법은 1~10 이어야 합니다')
  const out = { op, text: null, number: null, min: null, max: null, multi: parseMulti(m.multi), about: parseAbout(m.about) }
  if (TEXT_OPS.has(op)) {
    // `@@@@` 는 다중 검사 구분자다. `@` 로 끝나는 값은 구분자가 한 칸 앞에서 잡혀 판정 서버가 예외를 낸다
    const t = m.text
    if (typeof t !== 'string' || t === '' || t.length > TEXT_MAX || t.includes(MULTI) || t.endsWith('@')) {
      throw bad('text', `OCR 글 값은 1~${TEXT_MAX}자이고 @@@@ 를 넣거나 @ 로 끝날 수 없습니다`)
    }
    out.text = t
  } else if (RANGE_OPS.has(op)) {
    if (!isNum(m.min)) throw bad('min', 'OCR 범위의 작은 값은 수여야 합니다')
    if (!isNum(m.max)) throw bad('max', 'OCR 범위의 큰 값은 수여야 합니다')
    out.min = m.min
    out.max = m.max
  } else {
    if (!isNum(m.number)) throw bad('number', 'OCR 수 값은 수여야 합니다')
    out.number = m.number
  }
  return out
}

function buildVisionRequest({ source, train, accept }) {
  return {
    sourceImage: source,
    trainImage: train,
    param: { AcceptThreshold: accept, MaximumNumberToFind: VISION_MAX_TO_FIND, Timeout: VISION_TIMEOUT, TimeoutEnabled: true }
  }
}

// parseOcrMeta 의 결과로 만든다. 다중 검사가 없으면(저장값에 접미사가 없던 옛 스텝) 접미사를 붙이지 않는다 — 실행과 같게.
function buildOcrRequest({ source, op, text, number, min, max, multi }) {
  const isText = TEXT_OPS.has(op)
  const isRange = RANGE_OPS.has(op)
  return {
    sourceImage: source,
    param: {
      OcrValueType: isText ? 1 : 2,
      OcrOperation: op,
      TextValue: `${isText ? text : ''}${multi ? `${MULTI}${multi.count}-${multi.op}` : ''}`,
      MinMatchingValue: OCR_MIN_MATCHING,
      NumberValue: !isText && !isRange ? number : 0,
      NumberRangeMin: isRange ? min : 0,
      NumberRangeMax: isRange ? max : 0
    }
  }
}

// 좌표는 보낸 조각 기준의 왼쪽 위다(소수일 수 있다) — 화면이 조각의 자리를 더하고 버린다.
function visionResults(response) {
  const list = response && Array.isArray(response.searchmaxResult) ? response.searchmaxResult : []
  return list.filter((r) => r && r.success).map((r) => ({ score: r.Score, x: r.TX, y: r.TY }))
}

function ocrResult(response) {
  const r = response || {}
  return { accepted: r.IsAccepted === true, found: typeof r.FoundResult === 'string' ? r.FoundResult : '', confidence: typeof r.Confidence === 'string' ? r.Confidence : '' }
}

function aboutText(about) {
  if (!about) return '-'
  const part = (v) => (v === undefined || v === '' ? '-' : v)
  return `${part(about.process)}/${part(about.model)}/${part(about.scenario)}#${part(about.step)}`
}

module.exports = { MAX_REQUEST_BYTES, parseVisionMeta, parseOcrMeta, buildVisionRequest, buildOcrRequest, visionResults, ocrResult, aboutText }
