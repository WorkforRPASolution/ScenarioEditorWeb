import { describe, it, expect } from 'vitest'
import { withCsDefaults, newRawStep, PLACEHOLDER_BI } from '../../domain/csDefaults'
import { serializeScenario, serializeProperty } from '../../domain/csharpJson'

describe('csDefaults', () => {
  it('본문에 없는 키는 C# 기본값', () => {
    const s = withCsDefaults('Scenario', { ID: 'P-M-N', Description: 'd', Step: [] })
    expect(s.TimeoutLimit).toBe(240); expect(s.RevisionNo).toBe(0); expect(s.TriggerType).toBe(2); expect(s.Text).toBe('')
    expect(s.TargetWindowCondition).toEqual({ Text: null, ClassName: null, IsCheckRectEqual: false, Left: 0, Top: 0, Right: 0, Bottom: 0 })
    expect(s.HidingWindowConditionList).toEqual([]); expect(s.Compensation).toBe(null)
  })
  it('있는 키는 null 이어도 그대로', () => {
    expect(withCsDefaults('Scenario', { TargetWindowCondition: null }).TargetWindowCondition).toBe(null)
  })
  it('스텝 안쪽까지 채운다', () => {
    const st = withCsDefaults('ScenarioStep', { Operation: 0, Script: { Type: 6, Value: '1000' } })
    expect(st.IsShowDialog).toBe(true); expect(st.RetryInterval).toBe(2000); expect(st.RetryLimit).toBe(2)
    expect(st.NextStepIfTrue).toBe(10002); expect(st.NextStepIfFalse).toBe(-1)
    expect(st.Script.NativeFunction).toBe(null)
    expect(st.Metadata.ImageSearchParam).toEqual({ TrainImageMap: [], AcceptThreshold: 0.9, MaximumNumberToFind: 1, TimeoutEnabled: true, Timeout: 1000 })
    expect(st.Metadata.OcrParamInfo.NumberValue).toBe(-218); expect(st.Metadata.OcrParamInfo.MinMatchingValue).toBe(5)
  })
  it('새 조건 없음 스텝', () => {
    const s = newRawStep('none')
    expect(s.Operation).toBe(0); expect(s.Metadata.SearchArea).toEqual({ X: -18, Y: -18, Width: -18, Height: -18 })
    expect(s.NextStepIfTrue).toBe(10002); expect(s.NextStepIfFalse).toBe(-1); expect(PLACEHOLDER_BI).toBe('AA==')
  })
  it('새 이미지·OCR 스텝', () => {
    expect(newRawStep('image').Operation).toBe(1)
    const o = newRawStep('ocr')
    expect(o.Operation).toBe(2); expect(o.Metadata.OcrParamInfo.MinMatchingValue).toBe(10)
    expect(newRawStep('image').Metadata.SearchArea).toEqual({ X: 0, Y: 0, Width: 0, Height: 0 })
    expect(() => newRawStep('x')).toThrow()
  })
  it('입력을 바꾸지 않고, 호출마다 새 객체', () => {
    const inp = { ID: 'a' }
    const out = withCsDefaults('Scenario', inp)
    expect(Object.keys(inp)).toEqual(['ID'])
    expect(withCsDefaults('Scenario', {}).Step).not.toBe(out.Step)
    expect(newRawStep('none')).not.toBe(newRawStep('none'))
  })
  it('null 입력은 null, 틀린 타입의 기존 값은 그대로', () => {
    expect(withCsDefaults('Scenario', null)).toBe(null)
    expect(withCsDefaults('Scenario', { Step: 'x', TimeoutLimit: '5' })).toMatchObject({ Step: 'x', TimeoutLimit: '5' })
  })
  it('목록은 객체 원소마다 채운다', () => {
    const s = withCsDefaults('Scenario', { Step: [{ Operation: 1 }, null], HidingWindowConditionList: [{ Text: 't' }] })
    expect(s.Step[0].RetryLimit).toBe(2); expect(s.Step[1]).toBe(null)
    expect(s.HidingWindowConditionList[0]).toEqual({ Text: 't', ClassName: null, IsCheckRectEqual: false, Left: 0, Top: 0, Right: 0, Bottom: 0 })
  })
  it('사전(찾을 그림 표) 항목도 TrainImage 기본값으로 채운다 — 객체 꼴·[[키, 항목]] 꼴 모두(M5)', () => {
    const isp = (map) => withCsDefaults('ScenarioStep', { Metadata: { ImageSearchParam: { TrainImageMap: map } } }).Metadata.ImageSearchParam.TrainImageMap
    expect(isp({ 0: { BinaryImage: 'QUJD' }, 2: { Type: false }, 3: null })).toEqual({ 0: { BinaryImage: 'QUJD', Type: true }, 2: { BinaryImage: PLACEHOLDER_BI, Type: false }, 3: null })
    expect(isp([[0, { BinaryImage: 'QUJD' }], [1, null], [2, { BinaryImage: 'QUJD', Type: false }]]))
      .toEqual([[0, { BinaryImage: 'QUJD', Type: true }], [1, null], [2, { BinaryImage: 'QUJD', Type: false }]])
    const inp = { 0: { BinaryImage: 'QUJD' } }
    isp(inp)
    expect(inp).toEqual({ 0: { BinaryImage: 'QUJD' } }) // 입력은 그대로
    const proto = JSON.parse('{"__proto__":{"BinaryImage":"QUJD"}}')
    const out = isp(proto)
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Object.keys(out)).toEqual(['__proto__'])
  })
  it('채운 결과는 직렬화가 던지지 않는다', () => {
    const sc = withCsDefaults('Scenario', { ID: 'P-M-N', Description: 'd', Step: [withCsDefaults('ScenarioStep', { Operation: 0 })] })
    expect(() => serializeScenario(sc)).not.toThrow()
    expect(() => serializeProperty(withCsDefaults('ScenarioProperty', {}))).not.toThrow()
  })
})
