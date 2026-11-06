'use strict'
// C# 생성자 기본값(분석 01 §3). 옛 본문에 없는 키를 사내 편집기가 다시 저장할 때처럼 채운다.
// 값은 tools/scenario-gen/lib/builders.js 와 같다(domain 은 tools 를 import 하지 않으므로 복사).
const { SCHEMAS } = require('./csharpJson')
const { DEFAULTS: PROPERTY_DEFAULTS } = require('./propertyModel')

const PLACEHOLDER_BI = 'AA==' // new byte[1] — 조건 없음·설비 상태 스텝
const NEXT = 10002
const FAIL = -1

// 형 이름 → 키 → 기본값을 돌려주는 함수(호출마다 새 객체). 스키마 형 키는 undefined 면 안쪽까지 채워 만든다.
const CS_DEFAULTS = {
  Scenario: {
    RevisionNo: () => 0, TriggerType: () => 2, ID: () => '', Text: () => '', Description: () => '', Step: () => [],
    TargetWindowCondition: () => ({}), HidingWindowConditionList: () => [], Compensation: () => null, TimeoutLimit: () => 240
  },
  ScenarioStep: {
    Operation: () => 0, Metadata: () => ({}), Script: () => ({}), RetryInterval: () => 2000, RetryLimit: () => 2,
    NextStepIfTrue: () => NEXT, NextStepIfFalse: () => FAIL, DescriptionToEmail: () => '', DescriptionToDialog: () => '',
    IsShowDialog: () => true
  },
  ScenarioMetadata: {
    SearchArea: () => ({}), ImageSearchParam: () => ({}), ConditionExpression: () => '', OcrParamInfo: () => ({})
  },
  ScreenSearchArea: { X: () => -18, Y: () => -18, Width: () => -18, Height: () => -18 },
  ImageSearchingParam: {
    TrainImageMap: () => [], AcceptThreshold: () => 0.9, MaximumNumberToFind: () => 1, TimeoutEnabled: () => true, Timeout: () => 1000
  },
  TrainImage: { BinaryImage: () => PLACEHOLDER_BI, Type: () => true },
  OcrParam: {
    Type: () => 0, Operation: () => 0, TextValue: () => '', NumberValue: () => -218, NumberRangeMin: () => -218,
    NumberRangeMax: () => -218, MinMatchingValue: () => 5
  },
  ScenarioScript: { Type: () => 0, Value: () => '', NativeFunction: () => null },
  NativeFunctionItem: { FunctionName: () => null, Params: () => [], Outputs: () => [] },
  WindowSearchCondition: {
    Text: () => null, ClassName: () => null, IsCheckRectEqual: () => false, Left: () => 0, Top: () => 0, Right: () => 0, Bottom: () => 0
  },
  XYCompensation: { RefImage: () => null, X: () => 0, Y: () => 0 },
  ScenarioBackupInfo: { ID: () => '', TargetSnapshotList: () => [] },
  NextScenarioCondition: { Name: () => '', Text: () => '' },
  ScenarioProperty: Object.fromEntries(Object.entries(PROPERTY_DEFAULTS)
    .map(([k, v]) => [k, () => (Array.isArray(v) ? [] : v)])),
  SetScenarioRequest: { Process: () => '', Model: () => '', SCName: () => '', BI: () => '', Body: () => '', Property: () => '' }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// 값 하나를 형에 맞춰 채운다. 객체가 아니거나 null 이면 그대로(틀린 형도 손대지 않는다).
function fillValue(type, v) {
  if (Array.isArray(type)) {
    if (type[0] === 'list' && Array.isArray(v) && typeof type[1] === 'string' && SCHEMAS[type[1]]) {
      return v.map((x) => (isObj(x) ? fillObject(type[1], x) : x))
    }
    return v // dict 는 [[키, 값]] 쌍 — 이미지 값은 건드리지 않는다
  }
  return isObj(v) && SCHEMAS[type] ? fillObject(type, v) : v
}

function fillObject(name, obj) {
  const out = {}
  for (const [key, type] of SCHEMAS[name]) {
    out[key] = fillValue(type, obj[key] === undefined ? CS_DEFAULTS[name][key]() : obj[key])
  }
  // 스키마 밖 키는 순서 뒤에 그대로 둔다(직렬화는 스키마 키만 쓴다)
  for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k]
  return out
}

function withCsDefaults(typeName, obj) {
  if (!SCHEMAS[typeName]) throw new Error(`스키마 없음: ${typeName}`)
  if (!isObj(obj)) return obj
  return fillObject(typeName, obj)
}

// 사내 편집기가 스텝을 만드는 값(MainWindow addScenarioStep). 이미지·OCR 의 검색 영역은 호출자가 화면 칸 값으로 덮는다.
const OPERATION = { none: 0, image: 1, ocr: 2 }
function newRawStep(kind) {
  if (!(kind in OPERATION)) throw new Error(`알 수 없는 스텝 종류: ${kind}`)
  const step = withCsDefaults('ScenarioStep', { Operation: OPERATION[kind] })
  if (kind !== 'none') step.Metadata.SearchArea = { X: 0, Y: 0, Width: 0, Height: 0 }
  if (kind === 'ocr') step.Metadata.OcrParamInfo.MinMatchingValue = 10
  return step
}

module.exports = { CS_DEFAULTS, PLACEHOLDER_BI, withCsDefaults, newRawStep }
