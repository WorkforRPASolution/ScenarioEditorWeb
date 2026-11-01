'use strict'
// 사내 C# 생성자 기본값을 그대로 흉내 낸다(조사 §1). 편집기가 스텝을 만드는 경로(MainWindow addScenarioStep)와 같은 값을 넣는다.
const NEXT = 10002, FAIL = -1, SUCCESS = 10000, SKIP = 10001
const PLACEHOLDER_BI = 'AA==' // new byte[1] — 조건 없음·설비 상태 스텝

const windowCondition = (Text, ClassName) => ({ Text, ClassName, IsCheckRectEqual: false, Left: 0, Top: 0, Right: 0, Bottom: 0 })
const newScenario = (id, desc) => ({ RevisionNo: 0, TriggerType: 2, ID: id, Text: '', Description: desc, Step: [],
  TargetWindowCondition: windowCondition(null, null), HidingWindowConditionList: [], Compensation: null, TimeoutLimit: 240 })
const newMetadata = (x, y, w, h) => ({
  SearchArea: { X: x, Y: y, Width: w, Height: h },
  ImageSearchParam: { TrainImageMap: [], AcceptThreshold: 0.9, MaximumNumberToFind: 1, TimeoutEnabled: true, Timeout: 1000 },
  ConditionExpression: '',
  OcrParamInfo: { Type: 0, Operation: 0, TextValue: '', NumberValue: -218, NumberRangeMin: -218, NumberRangeMax: -218, MinMatchingValue: 5 }
})
const newStep = (op, x, y, w, h) => ({ Operation: op, Metadata: newMetadata(x, y, w, h), Script: { Type: 0, Value: '', NativeFunction: null },
  RetryInterval: 2000, RetryLimit: 2, NextStepIfTrue: NEXT, NextStepIfFalse: FAIL, DescriptionToEmail: '', DescriptionToDialog: '', IsShowDialog: true })
const newBackupInfo = (id) => ({ ID: 'BI.' + id, TargetSnapshotList: [] })
const newProperty = (id) => ({ ID: id, Owners: ['sew_gen@2026-11-01 10:00:00'], ScenarioTriggerType: 0, DoNotSendEmailWhenSuccess: false,
  DoNotSendEmailWhenStop: false, DoNotSendEmailWhenFail: false, StartDelay: 0, RetryCnt: 0, RetryInterval: 10,
  NextScenarioIfSuccess: null, NextScenarioIfFail: null, Type: 1, DetailedDescriptionTitle: '', DetailedDescription: '',
  DescriptionFromDonductor: '', EDMLink: '', IsEnabled: true, ExecutingLevel: 0, IsShowDialog: true, Priority: 10, LcncType: 0, LowcodeExtension: '' })
const newPerformance = (desc) => ({ Group: 'SEW', Trigger: 1, TriggerInfo: null, Grade: 2, Supervisor: 'Not entered', SupervisorComment: '',
  CitizenDeveloper: [], PerformType: 1, ScenarioDescription: desc, ManWorkLoss: 0, EqpPerformanceLoss: 0, EqpStopLoss: 0, GlassLoss: 0,
  InvestCostLoss: 0, AdditionalEffect: '', AccidentType: 0, AccidentInfo: '', UpdateDate: '' })

// 시나리오 한 버전을 만드는 작업대. img 는 images.js (그림 원천).
function workbench(process, model, name, desc, img) {
  const id = `${process}-${model}-${name}`
  const sc = { scenario: newScenario(id, desc), bi: newBackupInfo(id), property: newProperty(id), performance: newPerformance(desc) }
  const push = (step, biEntry, { desc: d = '', next = [NEXT, FAIL], retry } = {}) => {
    step.DescriptionToEmail = d
    step.NextStepIfTrue = next[0]
    step.NextStepIfFalse = next[1]
    if (retry) { step.RetryLimit = retry[0]; step.RetryInterval = retry[1] }
    sc.scenario.Step.push(step)
    sc.bi.TargetSnapshotList.push(biEntry)
    return step
  }
  return {
    sc,
    image(o) {
      const s = newStep(1, ...o.area)
      s.Metadata.ImageSearchParam.TrainImageMap = [[0, { BinaryImage: img.crop(o.fx, o.train), Type: true }]]
      s.Metadata.ImageSearchParam.AcceptThreshold = o.accept ?? 0.9
      s.Metadata.OcrParamInfo.TextValue = o.multi ?? '1-0'
      const [t, v] = o.action ?? [1, o.click]
      s.Script = { Type: t, Value: v, NativeFunction: null }
      return push(s, o.bi ?? img.full(o.fx), o)
    },
    ocr(o) {
      const s = newStep(2, ...o.area)
      const text = o.op >= 1 && o.op <= 4
      s.Metadata.OcrParamInfo = { Type: text ? 1 : 2, Operation: o.op, TextValue: `${text ? o.text : ''}@@@@${o.multi ?? '1-0'}`,
        NumberValue: o.number ?? -218, NumberRangeMin: o.min ?? -218, NumberRangeMax: o.max ?? -218, MinMatchingValue: 10 }
      const [t, v] = o.action ?? [0, '']
      s.Script = { Type: t, Value: v, NativeFunction: null }
      return push(s, o.bi ?? img.full(o.fx), o)
    },
    none(o) {
      const s = newStep(0, -18, -18, -18, -18)
      const [t, v] = o.action ?? [0, '']
      s.Script = { Type: t, Value: v, NativeFunction: o.native ?? null }
      if (o.skipPreprocessing) s.Metadata.ConditionExpression = 'SkipPreprocessing'
      return push(s, PLACEHOLDER_BI, o)
    },
    eqp(o) {
      const s = newStep(4, -18, -18, -18, -18)
      s.Metadata.ConditionExpression = o.expr
      const [t, v] = o.action ?? [0, '']
      s.Script = { Type: t, Value: v, NativeFunction: null }
      return push(s, PLACEHOLDER_BI, o)
    },
    raw(step, biEntry, o = {}) { return push(step, biEntry, o) },
    targetWindow(text, cls) { sc.scenario.TargetWindowCondition = windowCondition(text, cls) }
  }
}

module.exports = { NEXT, FAIL, SUCCESS, SKIP, PLACEHOLDER_BI, newScenario, newStep, newMetadata, newBackupInfo, newProperty, newPerformance, windowCondition, workbench }
