import { describe, it, expect } from 'vitest'
import { graphNotes, scenarioNotes, SCENARIO_NOTE_CODES } from '../../domain/notes'
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
      st(3, 10002, 11),      // s1 → s3, 실패 쪽 NEXT + 동작 명령 실행
      st(-2, -1),            // s2: s1 의 실패 NEXT 로 도달, 범위 밖
      st(3, 10001),          // s3: 자기 참조
      st(10002, -1)          // s4: 도달 불가, 마지막 NEXT
    ])).toEqual([
      [], ['FALSE_NEXT_WITH_ACTION'], ['NEXT_OUT_OF_RANGE'], ['NEXT_SELF'], ['LAST_STEP_NEXT', 'UNREACHABLE']
    ])
  })
})

describe('graphNotes — 실패 쪽 NEXT', () => {
  it('실패를 돌려주는 동작만 경고한다', () => {
    expect(run([st(10000, 10002, 1), st(10000, -1)])[0]).not.toContain('FALSE_NEXT_WITH_ACTION') // 마우스 클릭
    expect(run([st(10000, 10002, 11), st(10000, -1)])[0]).toContain('FALSE_NEXT_WITH_ACTION') // 명령 실행
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
  // P2-F: 숨길 창(HidingWindowConditionList) — 에이전트 기준(windowsModel.judgeHiding)
  it('숨길 창: 찾지 않는 줄(클래스 없음·값 없음)·앞뒤 공백은 경고, 고정 크기(-218)는 알림 — 줄 수를 싣는다', () => {
    const W = (Text, ClassName, over = {}) => ({ Text, ClassName, IsCheckRectEqual: false, Left: 0, Top: 0, Right: 0, Bottom: 0, ...over })
    const base = { rawSteps: [st(10000, -1)], property: { Priority: 10 }, targetWindow: tw(true, true) }
    const notes = scenarioNotes({ ...base, hidingWindows: [W('ok', 'Ok'), W('Notice', ''), W(null, 'Dlg'), W(' Popup* ', 'Dlg'), W('L', 'W', { IsCheckRectEqual: true, Left: -218 }), null] })
    expect(notes).toEqual([
      { level: 'warning', code: 'HIDING_WINDOW_NOT_FOUND', params: { count: 3 } },
      { level: 'warning', code: 'HIDING_WINDOW_SPACE', params: { count: 1 } },
      { level: 'info', code: 'HIDING_WINDOW_FIXED_SIZE', params: { count: 1 } }
    ])
    expect(scenarioNotes({ ...base, hidingWindows: [W('ok', 'Ok'), W('', 'Saver')] })).toEqual([])
    expect(scenarioNotes({ ...base, hidingWindows: undefined })).toEqual([])
    expect(scenarioNotes({ ...base, hidingWindows: null })).toEqual([])
  })
  it('SCENARIO_NOTE_CODES 는 숨길 창 알림도 담는다(속성만 바뀐 뒤 다시 붙일 때 겹치지 않게)', () => {
    expect(SCENARIO_NOTE_CODES).toEqual(expect.arrayContaining(['HIDING_WINDOW_NOT_FOUND', 'HIDING_WINDOW_SPACE', 'HIDING_WINDOW_FIXED_SIZE']))
  })
  it('객체가 아닌 스텝이 있어도 던지지 않는다', () => {
    const codes = scenarioNotes({ rawSteps: [null, 5, st(10000, -1)], property: null, targetWindow: null }).map((n) => n.code)
    expect(codes).toEqual([])
  })
})

describe('SCENARIO_NOTE_CODES', () => {
  it('scenarioNotes 가 낼 수 있는 코드 전부이고 얼려 있다', () => {
    const hidingWindows = [{ Text: 'a', ClassName: '' }, { Text: ' b ', ClassName: 'B' }, { Text: 'c', ClassName: 'C', IsCheckRectEqual: true, Left: -218 }]
    const all = scenarioNotes({ rawSteps: [st(10002, -1)], property: { Priority: 3 }, targetWindow: { agentFinds: false, inHouseShowsSet: true }, hidingWindows })
    expect(all.map((n) => n.code).sort()).toEqual([...SCENARIO_NOTE_CODES].sort())
    expect(Object.isFrozen(SCENARIO_NOTE_CODES)).toBe(true)
  })
})
