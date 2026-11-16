'use strict'
// 흉내 판정 서버의 규칙(P4 설계 §10). 목적은 화면·계약·오류 경로다 — 판정 알고리즘이 사내와 같은지는 보지 않는다.
// - Vision: 화면 조각 안에서 찾을 그림과 네 채널이 모두 같은 자리(왼쪽 위). 진짜 엔진(Cognex·OpenCV)의 비슷함 점수는 흉내 내지 않는다.
// - OCR: 글자를 읽지 않는다(읽은 줄은 흉내 서버의 제어 값). 판정만 사내 판정 서버 사본의 규칙을 옮겼다
//   (ARS 작업 공간 OCRProcessingServer/OCRCore/core/CoreService.cs 의 matchOcrValueCondition·RequestOcr, 2026-11-16 확인).
const { PNG } = require('pngjs')

const MULTI = '@@@@'
const MULTI_PARAM = '-'
const MIN_DOUBLE = -Number.MAX_VALUE // C# double.MinValue — 수를 못 뽑은 줄이 견줘지는 값
const VALUE_TYPES = 4 // 0 None · 1 Text · 2 Number · 3 Regex
const OPERATIONS = 11 // 0 None · 1~4 글 · 5~10 수

function decode(buf) {
  try {
    return PNG.sync.read(Buffer.from(buf))
  } catch {
    return null
  }
}

// 찾을 그림과 똑같은 픽셀이 있는 자리들(위에서 아래로, 왼쪽에서 오른쪽으로). PNG 를 못 읽으면 빈 목록 — 판정 서버의 엔진 실패도 0건으로 온다.
function findExact(sourcePng, trainPng, limit = 20) {
  const src = decode(sourcePng)
  const tr = decode(trainPng)
  if (!src || !tr || tr.width > src.width || tr.height > src.height) return []
  const out = []
  const rowBytes = tr.width * 4
  const rows = []
  for (let y = 0; y < tr.height; y++) rows.push(tr.data.subarray(y * rowBytes, (y + 1) * rowBytes))
  for (let y = 0; y <= src.height - tr.height; y++) {
    for (let x = 0; x <= src.width - tr.width; x++) {
      let same = true
      for (let ty = 0; ty < tr.height && same; ty++) {
        const at = ((y + ty) * src.width + x) * 4
        same = src.data.compare(rows[ty], 0, rowBytes, at, at + rowBytes) === 0
      }
      if (same) {
        out.push({ x, y })
        if (out.length >= limit) return out
      }
    }
  }
  return out
}

// C# double.Parse 의 흔한 꼴만(부호·소수·지수). 못 바꾸면 null
function parseDouble(text) {
  const t = String(text).trim()
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) ? Number(t) : null
}
// C# Convert.ToInt16 — 정수 글자가 아니거나 범위를 넘으면 던진다
function toInt16(text) {
  const t = String(text).trim()
  if (!/^[+-]?\d+$/.test(t)) throw new Error(`not an integer: ${text}`)
  const n = Number(t)
  if (n < -32768 || n > 32767) throw new Error(`out of Int16 range: ${text}`)
  return n
}
// checkNumberFormat — 수처럼 생긴 글자만 모은다
const numberLike = (text) => [...String(text).matchAll(/-?\d?\.?\d?([eE]?[-+]?)\d?/g)].map((m) => m[0].trim()).join('')

// param = OcrParam, lines = 엔진이 읽은 줄들. 예외가 나는 요청은 던진다(판정 서버는 응답을 만들지 못한다).
function judgeOcr(param, lines, confidence = 95) {
  const valueType = param.OcrValueType
  const operation = param.OcrOperation
  if (!Number.isInteger(valueType) || valueType < 0 || valueType >= VALUE_TYPES) throw new Error(`OcrValueType out of range: ${valueType}`)
  if (!Number.isInteger(operation) || operation < 0 || operation >= OPERATIONS) throw new Error(`OcrOperation out of range: ${operation}`)
  const input = String(param.TextValue ?? '')
  let expected = input
  let multi = false
  let wish = 1
  let matchType = -1
  const cut = input.indexOf(MULTI)
  if (cut >= 0) {
    multi = true
    expected = input.slice(0, cut)
    const rest = input.slice(cut + MULTI.length)
    const dash = rest.indexOf(MULTI_PARAM)
    if (dash < 0) throw new Error('multi check suffix has no "-"')
    wish = toInt16(rest.slice(0, dash))
    matchType = toInt16(rest.slice(dash + MULTI_PARAM.length))
  }

  let read = lines.map(String)
  const isNumber = valueType === 2
  if (isNumber) {
    // 줄의 빈칸을 지우고 수로 바꾼다. 못 바꾸면 그 줄 그대로
    read = read.map((line) => {
      const n = parseDouble(line.replace(/ /g, ''))
      return n === null ? line : String(n)
    })
    if (multi) read = read.flatMap((line) => line.split(' '))
  }

  let matched = 0
  for (const line of read) {
    let accepted = false
    if (valueType === 1) {
      if (operation === 1) accepted = line === expected
      else if (operation === 2) accepted = line !== expected
      else if (operation === 3) accepted = line.includes(expected)
      else if (operation === 4) accepted = !line.includes(expected)
    } else if (isNumber) {
      const packed = line.replace(/ /g, '')
      let v = parseDouble(packed)
      if (v === null) v = parseDouble(numberLike(packed))
      if (v === null) v = MIN_DOUBLE
      if (operation === 5) accepted = param.NumberValue === v
      else if (operation === 6) accepted = param.NumberValue !== v
      else if (operation === 7) accepted = param.NumberRangeMin <= v && param.NumberRangeMax >= v
      else if (operation === 8) accepted = param.NumberRangeMin >= v || param.NumberRangeMax <= v
      else if (operation === 9) accepted = param.NumberValue > v
      else if (operation === 10) accepted = param.NumberValue < v
    }
    if (accepted) matched += 1
  }

  let ok
  if (!multi) ok = matched >= 1
  else if (matchType === 0) ok = wish === matched
  else if (matchType === 1) ok = wish <= matched
  else if (matchType === 2) ok = wish >= matched
  else ok = false

  return {
    IsAccepted: ok,
    FoundResult: read.join(' @@ '),
    // 글 비교: 글자마다 ":<정수>". 수 비교: 수로 바꾼 줄에는 신뢰도가 없다
    Confidence: isNumber ? '' : read.map((line) => `:${confidence}`.repeat([...line].length)).join(''),
    TX: 0,
    TY: 0
  }
}

module.exports = { findExact, judgeOcr }
