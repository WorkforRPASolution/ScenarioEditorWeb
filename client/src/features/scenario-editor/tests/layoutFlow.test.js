import { describe, it, expect } from 'vitest'
import { layoutFlow, FLOW } from '../layoutFlow'

const S = (i, onTrue, onFalse) => ({ uid: `s${i}`, no: i + 1, notes: [], next: { onTrue, onFalse } })
const NEXT = { kind: 'next' }
const FAIL = { kind: 'end', value: 'FAIL' }
const SUCCESS = { kind: 'end', value: 'SUCCESS' }
const to = (i) => ({ kind: 'step', uid: `s${i}`, no: i + 1 })

describe('layoutFlow', () => {
  it('번호 순서대로 가로, 정해진 좌표', () => {
    const { nodes } = layoutFlow([S(0, NEXT, FAIL), S(1, SUCCESS, FAIL)])
    const steps = nodes.filter((n) => n.type === 'step')
    expect(steps.map((n) => [n.id, n.position])).toEqual([['s0', { x: 0, y: 0 }], ['s1', { x: FLOW.CW + FLOW.GAP, y: 0 }]])
  })
  it('NEXT 는 옆 카드로 직선, 끝 상태는 칩', () => {
    const { nodes, edges } = layoutFlow([S(0, NEXT, FAIL), S(1, SUCCESS, FAIL)])
    expect(edges.find((e) => e.source === 's0' && e.target === 's1')).toMatchObject({ sourceHandle: 'r', targetHandle: 'l', type: 'straight', label: '✓' })
    const chips = nodes.filter((n) => n.type === 'chip').map((n) => [n.id, n.data.label, n.data.kind])
    expect(chips).toEqual([['s0-onFalse', 'FAIL', 'end-fail'], ['s1-onTrue', 'SUCCESS', 'end-success'], ['s1-onFalse', 'FAIL', 'end-fail']])
  })
  it('✓ 끝 상태 칩은 다음 카드 앞에서 끝난다(4px 이상 띄움)', () => {
    const { nodes } = layoutFlow([S(0, SUCCESS, FAIL), S(1, SUCCESS, FAIL)])
    const chip = nodes.find((n) => n.id === 's0-onTrue')
    const next = nodes.find((n) => n.id === 's1')
    expect(chip.position.x).toBeGreaterThanOrEqual(FLOW.CW) // 카드 오른쪽에서 시작
    expect(chip.position.x + FLOW.CHIP_W).toBeLessThanOrEqual(next.position.x - 4)
  })
  it('양쪽이 모두 다음 카드면 화살표 하나', () => {
    const { edges } = layoutFlow([S(0, NEXT, NEXT), S(1, SUCCESS, FAIL)])
    const adj = edges.filter((e) => e.source === 's0' && e.target === 's1')
    expect(adj).toHaveLength(1)
    expect(adj[0].label).toBe('✓✗')
  })
  it('먼 스텝은 아래로 돌리고 겹치면 층을 늘린다', () => {
    const { edges } = layoutFlow([S(0, to(3), FAIL), S(1, to(3), FAIL), S(2, NEXT, to(0)), S(3, SUCCESS, FAIL)])
    const jumps = edges.filter((e) => e.type === 'smoothstep').map((e) => [e.source, e.target, e.pathOptions.offset])
    expect(jumps).toEqual([['s0', 's3', 60], ['s1', 's3', 42], ['s2', 's0', 24]])
  })
  it('자기 참조·범위 밖·마지막 NEXT 는 칩', () => {
    const { nodes } = layoutFlow([S(0, to(0), { kind: 'raw', value: -2 }), S(1, NEXT, FAIL)])
    const chips = Object.fromEntries(nodes.filter((n) => n.type === 'chip').map((n) => [n.id, [n.data.label, n.data.kind]]))
    expect(chips['s0-onTrue']).toEqual(['↺ 자기 자신', 'raw'])
    expect(chips['s0-onFalse']).toEqual(['? -2', 'raw'])
    expect(chips['s1-onTrue']).toEqual(['NEXT (다음 없음)', 'raw'])
  })
  it('스텝 0개', () => {
    expect(layoutFlow([])).toEqual({ nodes: [], edges: [] })
  })
})
