import { describe, it, expect } from 'vitest'
import { judgeTargetWindow } from '../../domain/targetWindow'

const w = (Text, ClassName) => ({ Text, ClassName, IsCheckRectEqual: false, Left: 0, Top: 0, Right: 0, Bottom: 0 })
describe('judgeTargetWindow (Q-013: 에이전트 기준 + 사내 표시)', () => {
  it.each([
    [null, null, false, null, 'TEXT_EMPTY', true],
    ['', '', false, null, 'TEXT_EMPTY', false],
    ['EQ Control', '', false, null, 'CLASS_EMPTY', false],
    ['', 'WindowsForms10', false, null, 'TEXT_EMPTY', true],
    ['*', 'WindowsForms10', false, null, 'TEXT_STAR', true],
    ['EQ Control*', 'WindowsForms10', true, 'partial', null, true],
    ['EQ Control', 'WindowsForms10', true, 'exact', null, true],
    ['  ', 'X', false, null, 'TEXT_EMPTY', true]
  ])('Text=%j Class=%j', (t, c, finds, mode, reason, inHouse) => {
    expect(judgeTargetWindow(w(t, c))).toMatchObject({ agentFinds: finds, matchMode: mode, reasonCode: reason, inHouseShowsSet: inHouse })
  })
})
