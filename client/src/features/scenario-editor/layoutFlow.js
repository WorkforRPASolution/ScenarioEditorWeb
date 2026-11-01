// 순서도 배치(설계 §6.5): 범용 자동 배치 없이 번호 순서대로 가로. 정해진 좌표라 시험할 수 있다.
import { targetLabel, targetKind } from './format'
import { LABELS } from './messages'

export const FLOW = { CW: 220, CH: 72, GAP: 80, CHIP_W: 76 }
const GREEN = '#16a34a'
const RED = '#dc2626'
const edgeStyle = (branch) => {
  const color = branch === 'onTrue' ? GREEN : RED
  return { style: { stroke: color, strokeWidth: 1.6 }, markerEnd: { type: 'arrowclosed', color }, labelStyle: { fill: color, fontWeight: 600, fontSize: 10 } }
}

export function layoutFlow(steps) {
  const nodes = []
  const edges = []
  const X = (i) => i * (FLOW.CW + FLOW.GAP)
  const index = new Map(steps.map((s, i) => [s.uid, i]))
  steps.forEach((s, i) => nodes.push({ id: s.uid, type: 'step', position: { x: X(i), y: 0 }, data: { step: s } }))

  const chip = (s, i, branch, label, kind) => {
    const id = `${s.uid}-${branch}`
    const position = branch === 'onTrue' ? { x: X(i) + FLOW.CW + 12, y: 8 } : { x: X(i) + FLOW.CW / 2 - FLOW.CHIP_W / 2, y: FLOW.CH + 40 }
    nodes.push({ id, type: 'chip', position, data: { label, kind } })
    edges.push({ id: `e-${id}`, source: s.uid, target: id, sourceHandle: branch === 'onTrue' ? 'r' : 'b', targetHandle: branch === 'onTrue' ? 'l' : 't', type: 'straight', ...edgeStyle(branch) })
  }

  const jumps = []
  steps.forEach((s, i) => {
    const adj = []
    for (const branch of ['onTrue', 'onFalse']) {
      const t = s.next[branch]
      const j = t.kind === 'step' ? index.get(t.uid) : t.kind === 'next' ? (i + 1 < steps.length ? i + 1 : null) : undefined
      if (t.kind === 'next' && j === null) chip(s, i, branch, LABELS.flowChip.lastNext, 'raw')
      else if (j === i) chip(s, i, branch, LABELS.flowChip.self, 'raw')
      else if (j === i + 1) adj.push(branch)
      else if (j !== undefined && j !== null) jumps.push({ from: i, to: j, branch })
      else chip(s, i, branch, targetLabel(t), targetKind(t))
    }
    if (adj.length) {
      const both = adj.length === 2
      edges.push({ id: `e-${s.uid}-adj`, source: s.uid, target: steps[i + 1].uid, sourceHandle: 'r', targetHandle: 'l', type: 'straight',
        label: both ? '✓✗' : adj[0] === 'onTrue' ? '✓' : '✗', ...edgeStyle(both ? 'onTrue' : adj[0]) })
    }
  })

  // 짧은 점프부터 낮은 층에. 같은 층에서 범위가 겹치면 다음 층.
  const levels = []
  const order = jumps.map((j, k) => ({ ...j, k, lo: Math.min(j.from, j.to), hi: Math.max(j.from, j.to) }))
    .sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo) || a.lo - b.lo)
  const assigned = new Map()
  for (const j of order) {
    let level = 0
    while ((levels[level] || []).some(([lo, hi]) => !(j.hi < lo || j.lo > hi))) level++
    ;(levels[level] = levels[level] || []).push([j.lo, j.hi])
    assigned.set(j.k, level)
  }
  jumps.forEach((j, k) => {
    edges.push({ id: `e-${steps[j.from].uid}-${j.branch}`, source: steps[j.from].uid, target: steps[j.to].uid, sourceHandle: 'b', targetHandle: 'bt',
      type: 'smoothstep', pathOptions: { offset: 24 + assigned.get(k) * 18, borderRadius: 8 }, label: j.branch === 'onTrue' ? '✓' : '✗', ...edgeStyle(j.branch) })
  })
  return { nodes, edges }
}
