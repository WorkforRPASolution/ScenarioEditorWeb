import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { serializeScenario, serializeBackupInfo, serializeProperty } = require('../../../server/features/scenario-editor/domain/csharpJson')
const { normalize, dotnetAvailable } = require('../normalize')

// 이 도구는 .NET 10 에서 돌고 "R" 이 최단 왕복 형식이라, 최단 표기가 16자리인 double(예: 0.7999999999999999)은 일부러 쓰지 않는다. .NET Framework 의 G15→G17 동작은 server 의 csharpJson.test.js csJsonDouble 표(0.7999999999999999 → 0.79999999999999993)가 따로 본다.
const md = (train, textValue) => ({
  SearchArea: { X: 1, Y: 2, Width: 3, Height: 4 },
  ImageSearchParam: { TrainImageMap: train, AcceptThreshold: 0.85, MaximumNumberToFind: 2, TimeoutEnabled: false, Timeout: 1500.5 },
  ConditionExpression: 'SkipPreprocessing',
  OcrParamInfo: { Type: 2, Operation: 7, TextValue: textValue, NumberValue: 1e-5, NumberRangeMin: 0.1 + 0.2, NumberRangeMax: 12.5, MinMatchingValue: 10 }
})
const tricky = {
  RevisionNo: 3, TriggerType: 2, ID: 'SEWCVD-SEWMODELA-TRICKY', Text: 'x', Description: '설명   줄\t탭 "따옴표" \u0001',
  Step: [{ Operation: 2, Metadata: md([[3, { BinaryImage: 'AQ==', Type: true }], [1, { BinaryImage: 'Ag==', Type: false }]], 'IDLE@@@@1-0'),
    Script: { Type: 15, Value: 'v', NativeFunction: { FunctionName: 'F', Params: ['a'], Outputs: ['b', 'c'] } },
    RetryInterval: 2000, RetryLimit: 200, NextStepIfTrue: 10000, NextStepIfFalse: -2, DescriptionToEmail: 'a@@b', DescriptionToDialog: '', IsShowDialog: false }],
  TargetWindowCondition: { Text: 'EQ Control*', ClassName: 'WindowsForms10', IsCheckRectEqual: true, Left: -218, Top: 0, Right: 0, Bottom: 0 },
  HidingWindowConditionList: [{ Text: '', ClassName: 'ScreenSaver', IsCheckRectEqual: false, Left: 0, Top: 0, Right: 0, Bottom: 0 }],
  Compensation: { RefImage: 'CQ==', X: 5, Y: 6 }, TimeoutLimit: 30
}

describe.skipIf(!dotnetAvailable())('C# 기준 비교 (Newtonsoft 12.0.1)', () => {
  it('까다로운 Scenario 를 C# 와 같은 글자로 쓴다', () => {
    const js = serializeScenario(tricky)
    expect(normalize('Scenario', js)).toBe(js)
  })
  it('BackupInfo', () => {
    const js = serializeBackupInfo({ ID: 'BI.X', TargetSnapshotList: ['AQID', 'AA==', ''] })
    expect(normalize('BackupInfo', js)).toBe(js)
  })
  it('Property (후속 시나리오·null 생략)', () => {
    const p = { ID: 'X', Owners: ['a@2026-11-01 10:00:00', 'b'], ScenarioTriggerType: 2, DoNotSendEmailWhenSuccess: true, DoNotSendEmailWhenStop: false,
      DoNotSendEmailWhenFail: true, StartDelay: 5, RetryCnt: 3, RetryInterval: 10, NextScenarioIfSuccess: { Name: 'N', Text: 'T' }, NextScenarioIfFail: null,
      Type: 8, DetailedDescriptionTitle: '제목', DetailedDescription: '', DescriptionFromConductor: '', EDMLink: 'http://x', IsEnabled: false,
      ExecutingLevel: 1, IsShowDialog: true, Priority: 3, LcncType: 0, LowcodeExtension: '' }
    const js = serializeProperty(p)
    expect(normalize('Property', js)).toBe(js)
  })
})
