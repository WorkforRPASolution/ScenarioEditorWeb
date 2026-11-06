'use strict'
// 사내 편집기(Newtonsoft.Json 12, .NET Framework 4.6.1, Formatting.None)와 같은 글자를 내는 직렬화기.
// 근거: C# 직렬화 실측 조사(2026-11-01) §1~§2. 필드 순서 = C# 선언 순서.

const SCHEMAS = {
  Scenario: [['RevisionNo', 'int'], ['TriggerType', 'int'], ['ID', 'string'], ['Text', 'string'], ['Description', 'string'],
    ['Step', ['list', 'ScenarioStep']], ['TargetWindowCondition', 'WindowSearchCondition'],
    ['HidingWindowConditionList', ['list', 'WindowSearchCondition']], ['Compensation', 'XYCompensation'], ['TimeoutLimit', 'int']],
  ScenarioStep: [['Operation', 'int'], ['Metadata', 'ScenarioMetadata'], ['Script', 'ScenarioScript'], ['RetryInterval', 'int'],
    ['RetryLimit', 'int'], ['NextStepIfTrue', 'int'], ['NextStepIfFalse', 'int'], ['DescriptionToEmail', 'string'],
    ['DescriptionToDialog', 'string'], ['IsShowDialog', 'bool']],
  ScenarioMetadata: [['SearchArea', 'ScreenSearchArea'], ['ImageSearchParam', 'ImageSearchingParam'],
    ['ConditionExpression', 'string'], ['OcrParamInfo', 'OcrParam']],
  ScreenSearchArea: [['X', 'int'], ['Y', 'int'], ['Width', 'int'], ['Height', 'int']],
  ImageSearchingParam: [['TrainImageMap', ['dict', 'TrainImage']], ['AcceptThreshold', 'double'], ['MaximumNumberToFind', 'int'],
    ['TimeoutEnabled', 'bool'], ['Timeout', 'double']],
  TrainImage: [['BinaryImage', 'bytes'], ['Type', 'bool']],
  OcrParam: [['Type', 'int'], ['Operation', 'int'], ['TextValue', 'string'], ['NumberValue', 'double'], ['NumberRangeMin', 'double'],
    ['NumberRangeMax', 'double'], ['MinMatchingValue', 'int']],
  ScenarioScript: [['Type', 'int'], ['Value', 'string'], ['NativeFunction', 'NativeFunctionItem']],
  NativeFunctionItem: [['FunctionName', 'string'], ['Params', ['list', 'string']], ['Outputs', ['list', 'string']]],
  WindowSearchCondition: [['Text', 'string'], ['ClassName', 'string'], ['IsCheckRectEqual', 'bool'], ['Left', 'int'], ['Top', 'int'],
    ['Right', 'int'], ['Bottom', 'int']],
  XYCompensation: [['RefImage', 'bytes'], ['X', 'int'], ['Y', 'int']],
  ScenarioBackupInfo: [['ID', 'string'], ['TargetSnapshotList', ['list', 'bytes']]],
  NextScenarioCondition: [['Name', 'string'], ['Text', 'string']],
  ScenarioProperty: [['ID', 'string'], ['Owners', ['list', 'string']], ['ScenarioTriggerType', 'int'],
    ['DoNotSendEmailWhenSuccess', 'bool'], ['DoNotSendEmailWhenStop', 'bool'], ['DoNotSendEmailWhenFail', 'bool'],
    ['StartDelay', 'int'], ['RetryCnt', 'int'], ['RetryInterval', 'int'], ['NextScenarioIfSuccess', 'NextScenarioCondition'],
    ['NextScenarioIfFail', 'NextScenarioCondition'], ['Type', 'int'], ['DetailedDescriptionTitle', 'string'],
    ['DetailedDescription', 'string'], ['DescriptionFromConductor', 'string'], ['EDMLink', 'string'], ['IsEnabled', 'bool'],
    ['ExecutingLevel', 'int'], ['IsShowDialog', 'bool'], ['Priority', 'int'], ['LcncType', 'int'], ['LowcodeExtension', 'string']],
  SetScenarioRequest: [['Process', 'string'], ['Model', 'string'], ['SCName', 'string'], ['BI', 'string'], ['Body', 'string'], ['Property', 'string']]
}

// .NET Framework double.ToString("R"): G15 로 써서 되읽어 같으면 그것, 아니면 G17. 지수는 E+XX/E-XX(최소 2자리).
function netFxR(v) {
  if (v === 0) return '0'
  let p = 15
  let ex = v.toExponential(14)
  if (Number(ex) !== v) { p = 17; ex = v.toExponential(16) }
  let [m, es] = ex.split('e')
  const e = parseInt(es, 10)
  const neg = m[0] === '-'
  if (neg) m = m.slice(1)
  const d = m.replace('.', '').replace(/0+$/, '') || '0'
  const sc = e + 1
  let o
  if (sc > p || sc < -3) o = d[0] + (d.length > 1 ? '.' + d.slice(1) : '') + 'E' + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0')
  else if (sc <= 0) o = '0.' + '0'.repeat(-sc) + d
  else if (d.length <= sc) o = d + '0'.repeat(sc - d.length)
  else o = d.slice(0, sc) + '.' + d.slice(sc)
  return (neg ? '-' : '') + o
}

function csJsonDouble(v) {
  if (Number.isNaN(v)) return '"NaN"'
  if (v === Infinity) return '"Infinity"'
  if (v === -Infinity) return '"-Infinity"'
  const t = netFxR(v)
  return /[.eE]/.test(t) ? t : t + '.0'
}

// 글자 단위(앞뒤 글자를 보지 않음)라 조각마다 따로 불러 이어도 통째로 부른 것과 같다. 서로게이트 쌍은 그대로 통과하므로 쌍 중간만 자르지 않으면 된다.
function csJsonEscape(s) {
  let o = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    switch (c) {
      case 9: o += '\\t'; continue
      case 10: o += '\\n'; continue
      case 13: o += '\\r'; continue
      case 12: o += '\\f'; continue
      case 8: o += '\\b'; continue
      case 92: o += '\\\\'; continue
      case 34: o += '\\"'; continue
      case 0x85: o += '\\u0085'; continue
      case 0x2028: o += '\\u2028'; continue
      case 0x2029: o += '\\u2029'; continue
    }
    o += c < 0x20 ? '\\u' + c.toString(16).padStart(4, '0') : s[i]
  }
  return o
}

const csJsonString = (s) => '"' + csJsonEscape(s) + '"'

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

function writeValue(type, v, path, ignoreNull) {
  if (v === null) return 'null'
  if (Array.isArray(type)) {
    const [kind, inner] = type
    if (!Array.isArray(v)) throw new Error(`${path}: 배열이어야 함`)
    if (kind === 'list') return '[' + v.map((x, i) => writeValue(inner, x, `${path}[${i}]`, ignoreNull)).join(',') + ']'
    if (kind === 'dict') {
      return '{' + v.map(([k, x], i) => {
        if (!Number.isInteger(k)) throw new Error(`${path}[${i}]: 정수 키여야 함`)
        return csJsonString(String(k)) + ':' + writeValue(inner, x, `${path}[${k}]`, ignoreNull)
      }).join(',') + '}'
    }
  }
  switch (type) {
    case 'int':
      if (!Number.isInteger(v)) throw new Error(`${path}: 정수여야 함 (${v})`)
      return String(v)
    case 'double':
      if (typeof v !== 'number') throw new Error(`${path}: 숫자여야 함`)
      return csJsonDouble(v)
    case 'bool':
      if (typeof v !== 'boolean') throw new Error(`${path}: bool 이어야 함`)
      return v ? 'true' : 'false'
    case 'string':
      if (typeof v !== 'string') throw new Error(`${path}: 문자열이어야 함`)
      return csJsonString(v)
    case 'bytes':
      if (typeof v !== 'string' || !BASE64.test(v)) throw new Error(`${path}: base64 문자열이어야 함`)
      return csJsonString(v)
    default:
      return writeObject(type, v, path, ignoreNull)
  }
}

function writeObject(name, obj, path, ignoreNull) {
  const schema = SCHEMAS[name]
  if (!schema) throw new Error(`스키마 없음: ${name}`)
  if (typeof obj !== 'object') throw new Error(`${path}: 객체여야 함`)
  const parts = []
  for (const [key, type] of schema) {
    if (!(key in obj)) throw new Error(`${path}.${key} 없음`)
    const v = obj[key]
    if (v === null && ignoreNull) continue
    parts.push(csJsonString(key) + ':' + writeValue(type, v, `${path}.${key}`, ignoreNull))
  }
  return '{' + parts.join(',') + '}'
}

const serializeScenario = (o) => writeObject('Scenario', o, 'Scenario', false)
const serializeBackupInfo = (o) => writeObject('ScenarioBackupInfo', o, 'ScenarioBackupInfo', false)
const serializeProperty = (o) => writeObject('ScenarioProperty', o, 'ScenarioProperty', true)
const serializeSetScenarioRequest = (o) => writeObject('SetScenarioRequest', o, 'SetScenarioRequest', false)

// ---- 흘려 쓰기 ----
// BI 는 그림 base64 를 이어 붙여 약 115MB 라 문자열 하나로 만들지 않는다. 그림은 하나씩 읽어 그 base64 를 조각 하나로 낸다.
// base64 는 ASCII 라 서로게이트 문제가 없다(BASE64 검사로 보장).
async function* backupInfoChunks(id, entries, resolveImage) {
  yield '{' + csJsonString('ID') + ':' + csJsonString(id) + ',' + csJsonString('TargetSnapshotList') + ':['
  let first = true
  for (const e of entries) {
    let v
    if (e.kind === 'image') v = await resolveImage(e.ref)
    else v = e.value
    if (v !== null && (typeof v !== 'string' || !BASE64.test(v))) throw new Error(`TargetSnapshotList: base64 문자열이어야 함`)
    const lead = first ? '' : ','
    first = false
    if (v === null) { yield lead + 'null'; continue }
    yield lead + '"'
    yield v
    yield '"'
  }
  yield ']}'
}

// 본문·운영 속성은 통째로 이스케이프하되, 15MB 까지라 1M 글자씩 조각으로 낸다. 조각 끝이 서로게이트 앞쪽 절반이면 한 글자 줄여 쌍을 가르지 않는다.
const PIECE = 1 << 20
function* escapedPieces(s) {
  for (let i = 0; i < s.length;) {
    let end = Math.min(i + PIECE, s.length)
    if (end < s.length) {
      const c = s.charCodeAt(end - 1)
      if (c >= 0xD800 && c <= 0xDBFF) end--
    }
    yield csJsonEscape(s.slice(i, end))
    i = end
  }
}

async function* setScenarioRequestChunks({ process, model, name, biChunks, bodyString, propertyString }) {
  const k = (n) => csJsonString(n) + ':'
  yield '{' + k('Process') + csJsonString(process) + ',' + k('Model') + csJsonString(model) + ',' + k('SCName') + csJsonString(name) + ',' + k('BI') + '"'
  for await (const c of biChunks) yield csJsonEscape(c)
  yield '",' + k('Body') + '"'
  yield* escapedPieces(bodyString)
  yield '",' + k('Property') + '"'
  yield* escapedPieces(propertyString)
  yield '"}'
}

module.exports = { SCHEMAS, csJsonDouble, csJsonEscape, csJsonString, backupInfoChunks, setScenarioRequestChunks, serializeScenario, serializeBackupInfo, serializeProperty, serializeSetScenarioRequest }
