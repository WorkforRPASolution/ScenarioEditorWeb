'use strict'
// 흐름 경고(설계 §5.6 표). 사내 저장 검사(Exception23·24·154)에 걸릴 값을 미리 알린다.
const { note } = require('./conditionCodec')
const { NEXT_STEP, CAN_FAIL_ACTIONS } = require('./enums')
const { judgeHiding } = require('./windowsModel')

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
    if (t.onFalse.kind === 'next' && st.Script && CAN_FAIL_ACTIONS.has(st.Script.Type)) out.push(note('warning', 'FALSE_NEXT_WITH_ACTION'))
    if (!seen[i]) out.push(note('warning', 'UNREACHABLE'))
    return out
  })
}

function scenarioNotes({ rawSteps, property, targetWindow, hidingWindows }) {
  const out = []
  if (!rawSteps.some((s) => asObject(s).NextStepIfTrue === NEXT_STEP.SUCCESS || asObject(s).NextStepIfFalse === NEXT_STEP.SUCCESS)) out.push(note('warning', 'NO_SUCCESS'))
  if (property && ![1, 5, 10].includes(property.Priority)) out.push(note('info', 'PRIORITY_NONSTANDARD', { priority: property.Priority }))
  if (targetWindow && targetWindow.agentFinds !== targetWindow.inHouseShowsSet) out.push(note('info', 'TARGET_WINDOW_DIFFERS', { reasonCode: targetWindow.reasonCode }))
  // 숨길 창(P2-F 설계 §6): 에이전트가 찾지 않는 줄·앞뒤 공백(제목 끝이 '*' 면 실행 중단, DC-147)은 경고, 고정 크기(-218)는 알림
  const judged = (Array.isArray(hidingWindows) ? hidingWindows : []).map(judgeHiding)
  const count = (pick) => judged.filter(pick).length
  const notFound = count((j) => !j.finds)
  const spaced = count((j) => j.finds && j.untrimmed)
  const fixed = count((j) => j.fixedSize)
  if (notFound) out.push(note('warning', 'HIDING_WINDOW_NOT_FOUND', { count: notFound }))
  if (spaced) out.push(note('warning', 'HIDING_WINDOW_SPACE', { count: spaced }))
  if (fixed) out.push(note('info', 'HIDING_WINDOW_FIXED_SIZE', { count: fixed }))
  return out
}

// scenarioNotes 가 낼 수 있는 코드 전부. 현재 운영 속성·대상 창·SUCCESS 연결에서 다시 계산되는 알림이라 버전 알림(skeleton.versionNotes)과 갈린다.
const SCENARIO_NOTE_CODES = Object.freeze(['NO_SUCCESS', 'PRIORITY_NONSTANDARD', 'TARGET_WINDOW_DIFFERS', 'HIDING_WINDOW_NOT_FOUND', 'HIDING_WINDOW_SPACE', 'HIDING_WINDOW_FIXED_SIZE'])

module.exports = { graphNotes, scenarioNotes, SCENARIO_NOTE_CODES }
