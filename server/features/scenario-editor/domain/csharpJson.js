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

function csJsonString(s) {
  let o = '"'
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
  return o + '"'
}

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

module.exports = { SCHEMAS, csJsonDouble, csJsonString, serializeScenario, serializeBackupInfo, serializeProperty, serializeSetScenarioRequest }
