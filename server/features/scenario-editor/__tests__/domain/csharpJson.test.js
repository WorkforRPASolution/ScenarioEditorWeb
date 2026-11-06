import { describe, it, expect } from 'vitest'
import { csJsonDouble, csJsonString, serializeScenario, serializeBackupInfo, serializeProperty, serializeSetScenarioRequest, csJsonEscape, backupInfoChunks, setScenarioRequestChunks } from '../../domain/csharpJson'

// 기대 글자는 실제 Newtonsoft 12.0.1 출력이다(2026-11-01 실측, 사본 DataStruct 그대로 실행).
const md = (x, y, w, h, train, textValue) => ({
  SearchArea: { X: x, Y: y, Width: w, Height: h },
  ImageSearchParam: { TrainImageMap: train, AcceptThreshold: 0.9, MaximumNumberToFind: 1, TimeoutEnabled: true, Timeout: 1000 },
  ConditionExpression: '',
  OcrParamInfo: { Type: 0, Operation: 0, TextValue: textValue, NumberValue: -218, NumberRangeMin: -218, NumberRangeMax: -218, MinMatchingValue: 5 }
})
const sample = {
  RevisionNo: 0, TriggerType: 2, ID: 'CVD-M100-ALARM_RECOVERY_01', Text: '', Description: 'Alarm 1234 auto recovery',
  Step: [
    { Operation: 1, Metadata: md(100, 200, 300, 150, [[0, { BinaryImage: 'iVBORw0KGgo=', Type: true }]], '1-0'),
      Script: { Type: 1, Value: '35:12', NativeFunction: null }, RetryInterval: 2000, RetryLimit: 2,
      NextStepIfTrue: 10002, NextStepIfFalse: -1, DescriptionToEmail: 'Click OK button', DescriptionToDialog: '', IsShowDialog: true },
    { Operation: 0, Metadata: md(-18, -18, -18, -18, [], ''),
      Script: { Type: 5, Value: 'abc@@10', NativeFunction: null }, RetryInterval: 2000, RetryLimit: 2,
      NextStepIfTrue: 10000, NextStepIfFalse: -1, DescriptionToEmail: 'Type abc and Enter', DescriptionToDialog: '', IsShowDialog: true }
  ],
  TargetWindowCondition: { Text: null, ClassName: null, IsCheckRectEqual: false, Left: 0, Top: 0, Right: 0, Bottom: 0 },
  HidingWindowConditionList: [], Compensation: null, TimeoutLimit: 240
}
const EXPECTED_BODY = '{"RevisionNo":0,"TriggerType":2,"ID":"CVD-M100-ALARM_RECOVERY_01","Text":"","Description":"Alarm 1234 auto recovery","Step":[{"Operation":1,"Metadata":{"SearchArea":{"X":100,"Y":200,"Width":300,"Height":150},"ImageSearchParam":{"TrainImageMap":{"0":{"BinaryImage":"iVBORw0KGgo=","Type":true}},"AcceptThreshold":0.9,"MaximumNumberToFind":1,"TimeoutEnabled":true,"Timeout":1000.0},"ConditionExpression":"","OcrParamInfo":{"Type":0,"Operation":0,"TextValue":"1-0","NumberValue":-218.0,"NumberRangeMin":-218.0,"NumberRangeMax":-218.0,"MinMatchingValue":5}},"Script":{"Type":1,"Value":"35:12","NativeFunction":null},"RetryInterval":2000,"RetryLimit":2,"NextStepIfTrue":10002,"NextStepIfFalse":-1,"DescriptionToEmail":"Click OK button","DescriptionToDialog":"","IsShowDialog":true},{"Operation":0,"Metadata":{"SearchArea":{"X":-18,"Y":-18,"Width":-18,"Height":-18},"ImageSearchParam":{"TrainImageMap":{},"AcceptThreshold":0.9,"MaximumNumberToFind":1,"TimeoutEnabled":true,"Timeout":1000.0},"ConditionExpression":"","OcrParamInfo":{"Type":0,"Operation":0,"TextValue":"","NumberValue":-218.0,"NumberRangeMin":-218.0,"NumberRangeMax":-218.0,"MinMatchingValue":5}},"Script":{"Type":5,"Value":"abc@@10","NativeFunction":null},"RetryInterval":2000,"RetryLimit":2,"NextStepIfTrue":10000,"NextStepIfFalse":-1,"DescriptionToEmail":"Type abc and Enter","DescriptionToDialog":"","IsShowDialog":true}],"TargetWindowCondition":{"Text":null,"ClassName":null,"IsCheckRectEqual":false,"Left":0,"Top":0,"Right":0,"Bottom":0},"HidingWindowConditionList":[],"Compensation":null,"TimeoutLimit":240}'

const property = {
  ID: 'CVD-M100-ALARM_RECOVERY_01', Owners: ['user01@2026-11-01 10:00:00'], ScenarioTriggerType: 0,
  DoNotSendEmailWhenSuccess: false, DoNotSendEmailWhenStop: false, DoNotSendEmailWhenFail: false,
  StartDelay: 0, RetryCnt: 0, RetryInterval: 10, NextScenarioIfSuccess: null, NextScenarioIfFail: null, Type: 1,
  DetailedDescriptionTitle: '', DetailedDescription: '', DescriptionFromConductor: '', EDMLink: '',
  IsEnabled: true, ExecutingLevel: 0, IsShowDialog: true, Priority: 10, LcncType: 0, LowcodeExtension: ''
}

describe('csJsonDouble (.NET Framework "R" + .0)', () => {
  it.each([
    [0.9, '0.9'], [1000, '1000.0'], [-218, '-218.0'], [0, '0.0'], [-0, '0.0'], [12.5, '12.5'],
    [1e-5, '1E-05'], [1.5e-7, '1.5E-07'], [0.1 + 0.2, '0.30000000000000004'], [1e15, '1E+15'],
    [0.7999999999999999, '0.79999999999999993'],
    [NaN, '"NaN"'], [Infinity, '"Infinity"'], [-Infinity, '"-Infinity"']
  ])('%s → %s', (v, out) => expect(csJsonDouble(v)).toBe(out))
})

describe('csJsonString (Newtonsoft 기본 이스케이프)', () => {
  it('짧은 이스케이프와 \\u00XX(소문자)', () => {
    expect(csJsonString('a\tb\nc\r\f\b\\"')).toBe('"a\\tb\\nc\\r\\f\\b\\\\\\""')
    expect(csJsonString('\u0001\u001f')).toBe('"\\u0001\\u001f"')
  })
  it('U+0085·U+2028·U+2029 는 이스케이프, 한글·/·\'·<>&·DEL 은 그대로', () => {
    expect(csJsonString('\u0085\u2028\u2029')).toBe('"\\u0085\\u2028\\u2029"')
    expect(csJsonString('한글/\'<>&\u007f')).toBe('"한글/\'<>&\u007f"')
  })
})

describe('serializeScenario', () => {
  it('Newtonsoft 출력과 글자 단위로 같다', () => {
    expect(serializeScenario(sample)).toBe(EXPECTED_BODY)
  })
  it('TrainImageMap 은 넣은 순서를 지킨다', () => {
    const s = structuredClone(sample)
    s.Step[0].Metadata.ImageSearchParam.TrainImageMap = [[3, { BinaryImage: 'AQ==', Type: true }], [1, { BinaryImage: 'Ag==', Type: false }]]
    expect(serializeScenario(s)).toContain('"TrainImageMap":{"3":{"BinaryImage":"AQ==","Type":true},"1":{"BinaryImage":"Ag==","Type":false}}')
  })
  it('스키마 키가 없으면 경로와 함께 실패한다', () => {
    const s = structuredClone(sample)
    delete s.Step[1].Script.NativeFunction
    expect(() => serializeScenario(s)).toThrowError('Scenario.Step[1].Script.NativeFunction 없음')
  })
  it('정수 자리에 소수가 오면 실패한다', () => {
    const s = structuredClone(sample)
    s.Step[0].RetryLimit = 2.5
    expect(() => serializeScenario(s)).toThrowError(/RetryLimit/)
  })
  it('NativeFunction·Compensation 객체를 쓴다', () => {
    const s = structuredClone(sample)
    s.Step[1].Script = { Type: 15, Value: '', NativeFunction: { FunctionName: 'CloseAll', Params: ['force'], Outputs: [] } }
    s.Compensation = { RefImage: 'CQ==', X: 5, Y: 6 }
    const out = serializeScenario(s)
    expect(out).toContain('"Script":{"Type":15,"Value":"","NativeFunction":{"FunctionName":"CloseAll","Params":["force"],"Outputs":[]}}')
    expect(out).toContain('"Compensation":{"RefImage":"CQ==","X":5,"Y":6}')
  })
})

describe('serializeBackupInfo', () => {
  it('Newtonsoft 출력과 같다', () => {
    expect(serializeBackupInfo({ ID: 'BI.CVD-M100-ALARM_RECOVERY_01', TargetSnapshotList: ['iVBORw0KGgoA', 'AA=='] }))
      .toBe('{"ID":"BI.CVD-M100-ALARM_RECOVERY_01","TargetSnapshotList":["iVBORw0KGgoA","AA=="]}')
  })
})

describe('serializeProperty (NullValueHandling.Ignore)', () => {
  it('Newtonsoft 출력과 같고 null 키를 뺀다', () => {
    expect(serializeProperty(property)).toBe('{"ID":"CVD-M100-ALARM_RECOVERY_01","Owners":["user01@2026-11-01 10:00:00"],"ScenarioTriggerType":0,"DoNotSendEmailWhenSuccess":false,"DoNotSendEmailWhenStop":false,"DoNotSendEmailWhenFail":false,"StartDelay":0,"RetryCnt":0,"RetryInterval":10,"Type":1,"DetailedDescriptionTitle":"","DetailedDescription":"","DescriptionFromConductor":"","EDMLink":"","IsEnabled":true,"ExecutingLevel":0,"IsShowDialog":true,"Priority":10,"LcncType":0,"LowcodeExtension":""}')
  })
  it('후속 시나리오가 있으면 필드 객체로 쓴다', () => {
    const p = { ...property, NextScenarioIfSuccess: { Name: 'NEXT_SC', Text: 'after ok' } }
    expect(serializeProperty(p)).toContain('"RetryInterval":10,"NextScenarioIfSuccess":{"Name":"NEXT_SC","Text":"after ok"},"Type":1')
  })
})

describe('serializeSetScenarioRequest', () => {
  it('안쪽 JSON 은 문자열로 한 번 더 이스케이프된다', () => {
    const out = serializeSetScenarioRequest({ Process: 'CVD', Model: 'M100', SCName: 'X', BI: '{"ID":"BI.X"}', Body: '{"a":1}', Property: '{}' })
    expect(out).toBe('{"Process":"CVD","Model":"M100","SCName":"X","BI":"{\\"ID\\":\\"BI.X\\"}","Body":"{\\"a\\":1}","Property":"{}"}')
  })
})

// ---- 흘려 쓰기 ----
const join = async (it) => { let o = ''; for await (const c of it) o += c; return o }
const tick = () => new Promise((r) => setTimeout(r, 1))
const entries3 = [{ kind: 'image', ref: { from: 'source', id: 'a' } }, { kind: 'literal', value: 'AA==' }, { kind: 'literal', value: null }]
const resolve3 = async (r) => ({ a: 'QUJD' })[r.id]

describe('흘려 쓰기', () => {
  it('csJsonEscape 는 csJsonString 에서 따옴표를 뺀 것이고 조각별로 해도 같다', () => {
    const s = 'a b\u0085c\u0001"\\\u2028\u2029\t\n\r\f\b\u{1F600}é'
    expect(csJsonString(s)).toBe('"' + csJsonEscape(s) + '"')
    expect(csJsonEscape(s.slice(0, 5)) + csJsonEscape(s.slice(5))).toBe(csJsonEscape(s))
  })
  it('조각을 이으면 한 번에 직렬화한 글자와 같다', async () => {
    const bi = await join(backupInfoChunks('BI.P-M-N', entries3, resolve3))
    expect(bi).toBe(serializeBackupInfo({ ID: 'BI.P-M-N', TargetSnapshotList: ['QUJD', 'AA==', null] }))
    const body = serializeScenario({ ...sample, Description: 'a b\u0085c\u0001"\\\u{1F600}' })
    const prop = serializeProperty(property)
    const req = await join(setScenarioRequestChunks({ process: 'P', model: 'M', name: 'N', biChunks: backupInfoChunks('BI.P-M-N', entries3, resolve3), bodyString: body, propertyString: prop }))
    expect(req).toBe(serializeSetScenarioRequest({ Process: 'P', Model: 'M', SCName: 'N', BI: bi, Body: body, Property: prop }))
  })
  it('빈 목록·큰 본문(조각 경계에 서로게이트 쌍)도 같다', async () => {
    const bi = await join(backupInfoChunks('BI.x', [], resolve3))
    expect(bi).toBe(serializeBackupInfo({ ID: 'BI.x', TargetSnapshotList: [] }))
    // 조각 크기 1MiB 경계(1048576 글자)에 쌍이 걸치도록 한다.
    const body = 'x'.repeat(1048575) + '\u{1F600}' + 'y'.repeat(10) + '"'
    const req = await join(setScenarioRequestChunks({ process: 'P', model: 'M', name: 'N', biChunks: backupInfoChunks('BI.x', [], resolve3), bodyString: body, propertyString: '{}' }))
    expect(req).toBe(serializeSetScenarioRequest({ Process: 'P', Model: 'M', SCName: 'N', BI: bi, Body: body, Property: '{}' }))
  })
  it('그림은 하나씩 읽는다', async () => {
    let inFlight = 0, max = 0, calls = 0
    const resolve = async () => { inFlight++; calls++; max = Math.max(max, inFlight); await tick(); inFlight--; return 'QUJD' }
    await join(backupInfoChunks('BI.x', Array.from({ length: 5 }, (_, i) => ({ kind: 'image', ref: { from: 'source', id: String(i) } })), resolve))
    expect(max).toBe(1)
    expect(calls).toBe(5)
  })
  it('요청 조각은 BI 조각을 게으르게 소비한다', async () => {
    const log = []
    async function* bi() { for (let i = 0; i < 3; i++) { log.push('bi' + i); yield 'AB' } }
    const it = setScenarioRequestChunks({ process: 'P', model: 'M', name: 'N', biChunks: bi(), bodyString: 'b', propertyString: 'p' })
    let n = 0
    for await (const c of it) { log.push('out'); if (++n >= 3) break }
    expect(log.filter((x) => x.startsWith('bi')).length).toBeLessThan(3)
  })
  it('1MB 그림 50개를 문자열 하나로 모으지 않고 흘려 보내도 길이가 산술값과 같다', async () => {
    const MB = 'A'.repeat(1 << 20)
    const ents = Array.from({ length: 50 }, (_, i) => ({ kind: 'image', ref: { from: 'source', id: String(i) } }))
    let total = 0, biLen = 0
    const counted = async function* () { for await (const c of backupInfoChunks('BI.big', ents, async () => MB)) { biLen += c.length; yield c } }
    for await (const c of setScenarioRequestChunks({ process: 'P', model: 'M', name: 'N', biChunks: counted(), bodyString: 'body', propertyString: 'prop' })) total += c.length
    const header = '{"ID":"BI.big","TargetSnapshotList":['
    const expectedBi = header.length + 50 * (MB.length + 2) + 49 + 2
    expect(biLen).toBe(expectedBi)
    // 요청 안에서 BI 의 따옴표(머리 6개 + 그림 50개 × 2)마다 역슬래시가 하나 붙는다.
    const quotes = header.match(/"/g).length + 100
    const wrap = '{"Process":"P","Model":"M","SCName":"N","BI":"'.length + '","Body":"body","Property":"prop"}'.length
    expect(total).toBe(wrap + expectedBi + quotes)
  })
})
