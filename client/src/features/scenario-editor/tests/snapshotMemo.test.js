// 메모 규칙 — 글 검사, 메모 목록 거르기 (P3 설계 §4.4·§4.5·§7)
import { describe, it, expect } from 'vitest'
import { MEMO_MAX, checkMemo, isMine, memoOptions, filterMemos } from '../editor/snapshotMemo'

describe('checkMemo — 메모 글', () => {
  it('앞뒤 공백을 지운 글, 비었는지', () => {
    expect(checkMemo('  가 나 ')).toEqual({ text: '가 나', empty: false, error: null })
    for (const v of ['', '   ', null, undefined]) expect(checkMemo(v)).toEqual({ text: '', empty: true, error: null })
  })
  it('128자까지(공백을 지운 뒤), 작은따옴표는 쓸 수 없다 — 서버와 같은 규칙', () => {
    expect(MEMO_MAX).toBe(128)
    expect(checkMemo(` ${'가'.repeat(128)} `).error).toBeNull()
    expect(checkMemo('가'.repeat(129)).error).toBe('MEMO_TOO_LONG')
    expect(checkMemo("it's").error).toBe('MEMO_QUOTE')
    expect(checkMemo("'".repeat(200)).error).toBe('MEMO_QUOTE')
  })
})

describe('isMine', () => {
  it('작성자가 나일 때만 — 작성자가 없으면 내 것이 아니다', () => {
    expect(isMine({ author: 'kim' }, 'kim')).toBe(true)
    expect(isMine({ author: 'lee' }, 'kim')).toBe(false)
    expect(isMine({ author: '' }, '')).toBe(false)
    expect(isMine(null, 'kim')).toBe(false)
  })
})

const m = (eqpId, process, model, author, text = 'x') => ({ eqpId, process, model, fileName: `${eqpId}.png`, date: '2026-11-11', time: '09:00:00', daysLeft: 15, memo: { text, author, authorName: author } })
const ITEMS = [m('E3', 'ETCH', 'M2', 'kim'), m('C1', 'CVD', 'M1', 'kim'), m('C2', 'CVD', 'M2', 'lee'), m('C1', 'CVD', 'M1', 'lee')]

describe('memoOptions — 메모 목록의 거르기 항목(목록에 있는 메모의 것만)', () => {
  it('공정은 전체에서, 모델은 고른 공정 안에서, 설비는 고른 공정·모델 안에서 — 오름차순·중복 없이', () => {
    expect(memoOptions(ITEMS, {})).toEqual({ processes: ['CVD', 'ETCH'], models: ['M1', 'M2'], eqpIds: ['C1', 'C2', 'E3'] })
    expect(memoOptions(ITEMS, { process: 'CVD' })).toEqual({ processes: ['CVD', 'ETCH'], models: ['M1', 'M2'], eqpIds: ['C1', 'C2'] })
    expect(memoOptions(ITEMS, { process: 'CVD', model: 'M2' })).toEqual({ processes: ['CVD', 'ETCH'], models: ['M1', 'M2'], eqpIds: ['C2'] })
    expect(memoOptions(ITEMS, { process: 'ETCH' }).models).toEqual(['M2'])
    expect(memoOptions(null, {})).toEqual({ processes: [], models: [], eqpIds: [] })
  })
})

describe('filterMemos', () => {
  it('공정·모델·설비·내 메모만 — 준 것만 건다. 받은 순서를 지킨다', () => {
    expect(filterMemos(ITEMS, {})).toEqual(ITEMS)
    expect(filterMemos(ITEMS, { process: 'CVD' }).map((x) => x.eqpId)).toEqual(['C1', 'C2', 'C1'])
    expect(filterMemos(ITEMS, { process: 'CVD', model: 'M1' }).map((x) => x.memo.author)).toEqual(['kim', 'lee'])
    expect(filterMemos(ITEMS, { eqpId: 'C2' })).toHaveLength(1)
    expect(filterMemos(ITEMS, { mine: true, me: 'kim' }).map((x) => x.eqpId)).toEqual(['E3', 'C1'])
    expect(filterMemos(ITEMS, { mine: true, me: '' })).toEqual([])
    expect(filterMemos(ITEMS, { mine: false, me: 'kim' })).toHaveLength(4)
    expect(filterMemos(null, {})).toEqual([])
  })
})
