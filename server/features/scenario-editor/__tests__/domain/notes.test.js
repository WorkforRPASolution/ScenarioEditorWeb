import { describe, it, expect } from 'vitest'
import { graphNotes, scenarioNotes } from '../../domain/notes'
import { toTarget } from '../../domain/nextStep'

const st = (t, f, type = 0) => ({ NextStepIfTrue: t, NextStepIfFalse: f, Script: { Type: type, Value: '', NativeFunction: null } })
const run = (steps) => {
  const uids = steps.map((_, i) => `s${i}`)
  const targets = steps.map((s) => ({ onTrue: toTarget(s.NextStepIfTrue, uids), onFalse: toTarget(s.NextStepIfFalse, uids) }))
  return graphNotes(steps, targets, uids).map((ns) => ns.map((n) => n.code).sort())
}

describe('graphNotes', () => {
  it('정상 흐름은 경고 없음', () => {
    expect(run([st(10002, -1, 1), st(10000, -1)])).toEqual([[], []])
  })
  it('범위 밖·자기 참조·마지막 NEXT·동작 있는 실패 쪽 NEXT·도달 불가', () => {
    expect(run([
      st(10002, -1),         // s0
      st(3, 10002, 6),       // s1 → s3, 실패 쪽 NEXT + 동작 Wait
      st(-2, -1),            // s2: s1 의 실패 NEXT 로 도달, 범위 밖
      st(3, 10001),          // s3: 자기 참조
      st(10002, -1)          // s4: 도달 불가, 마지막 NEXT
    ])).toEqual([
      [], ['FALSE_NEXT_WITH_ACTION'], ['NEXT_OUT_OF_RANGE'], ['NEXT_SELF'], ['LAST_STEP_NEXT', 'UNREACHABLE']
    ])
  })
})

describe('graphNotes — 깨진 저장 값', () => {
  it('스텝이 없으면 빈 배열', () => {
    expect(graphNotes([], [], [])).toEqual([])
  })
  it('객체가 아닌 스텝이 섞여 있어도 던지지 않고 그 스텝만 경고한다', () => {
    const steps = [st(10002, -1), null, st(10000, -1)]
    const uids = steps.map((_, i) => `s${i}`)
    const targets = steps.map((s) => ({ onTrue: toTarget(s && s.NextStepIfTrue, uids), onFalse: toTarget(s && s.NextStepIfFalse, uids) }))
    const out = graphNotes(steps, targets, uids).map((ns) => ns.map((n) => n.code).sort())
    expect(out[0]).toEqual([])
    expect(out[1]).toEqual(['NEXT_OUT_OF_RANGE'])
    expect(out[2]).toEqual(['UNREACHABLE']) // 깨진 스텝에서 흐름이 끊긴다
  })
})

describe('scenarioNotes', () => {
  const tw = (agentFinds, inHouseShowsSet) => ({ agentFinds, inHouseShowsSet })
  it('SUCCESS 없음·우선순위 1·5·10 밖·대상 창 표시가 다름', () => {
    const codes = scenarioNotes({ rawSteps: [st(10002, -1)], property: { Priority: 3 }, targetWindow: tw(false, true) }).map((n) => n.code).sort()
    expect(codes).toEqual(['NO_SUCCESS', 'PRIORITY_NONSTANDARD', 'TARGET_WINDOW_DIFFERS'])
  })
  it('정상', () => {
    expect(scenarioNotes({ rawSteps: [st(10000, -1)], property: { Priority: 10 }, targetWindow: tw(true, true) })).toEqual([])
  })
  it('객체가 아닌 스텝이 있어도 던지지 않는다', () => {
    const codes = scenarioNotes({ rawSteps: [null, 5, st(10000, -1)], property: null, targetWindow: null }).map((n) => n.code)
    expect(codes).toEqual([])
  })
})
