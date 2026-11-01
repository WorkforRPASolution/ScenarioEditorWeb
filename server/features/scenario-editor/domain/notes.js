'use strict'
// 흐름 경고(설계 §5.6 표). 사내 저장 검사(Exception23·24·154)에 걸릴 값을 미리 알린다.
const { note } = require('./conditionCodec')
const { NEXT_STEP } = require('./enums')

// 저장된 스텝이 객체가 아니면(깨진 데이터) 빈 객체로 본다 — 그 스텝의 해석 실패는 conditionCodec 가 따로 알린다.
const asObject = (v) => (v && typeof v === 'object' ? v : {})

function graphNotes(rawSteps, targets, uids) {
  const n = rawSteps.length
  const index = new Map(uids.map((u, i) => [u, i]))
  const go = (t, i) => (t.kind === 'step' ? index.get(t.uid) : t.kind === 'next' ? (i + 1 < n ? i + 1 : null) : null)
  const seen = new Array(n).fill(false)
  const stack = n ? [0] : []
  while (stack.length) {
    const i = stack.pop()
    if (seen[i]) continue
    seen[i] = true
    for (const t of [targets[i].onTrue, targets[i].onFalse]) {
      const j = go(t, i)
      if (j !== null && j !== undefined && !seen[j]) stack.push(j)
    }
  }
  return rawSteps.map((raw, i) => {
    const st = asObject(raw)
    const out = []
    const t = targets[i]
    if (t.onTrue.kind === 'raw' || t.onFalse.kind === 'raw') out.push(note('warning', 'NEXT_OUT_OF_RANGE', { onTrue: st.NextStepIfTrue, onFalse: st.NextStepIfFalse }))
    if (st.NextStepIfTrue === i || st.NextStepIfFalse === i) out.push(note('warning', 'NEXT_SELF'))
    if (i === n - 1 && (t.onTrue.kind === 'next' || t.onFalse.kind === 'next')) out.push(note('warning', 'LAST_STEP_NEXT'))
    if (t.onFalse.kind === 'next' && st.Script && st.Script.Type !== 0) out.push(note('warning', 'FALSE_NEXT_WITH_ACTION'))
    if (!seen[i]) out.push(note('warning', 'UNREACHABLE'))
    return out
  })
}

function scenarioNotes({ rawSteps, property, targetWindow }) {
  const out = []
  if (!rawSteps.some((s) => asObject(s).NextStepIfTrue === NEXT_STEP.SUCCESS || asObject(s).NextStepIfFalse === NEXT_STEP.SUCCESS)) out.push(note('warning', 'NO_SUCCESS'))
  if (property && ![1, 5, 10].includes(property.Priority)) out.push(note('info', 'PRIORITY_NONSTANDARD', { priority: property.Priority }))
  if (targetWindow && targetWindow.agentFinds !== targetWindow.inHouseShowsSet) out.push(note('info', 'TARGET_WINDOW_DIFFERS', { reasonCode: targetWindow.reasonCode }))
  return out
}

module.exports = { graphNotes, scenarioNotes }
