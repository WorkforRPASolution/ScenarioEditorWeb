'use strict'
// 대상 창 표시(Q-013): 에이전트 동작 기준(ARSAgent utils/ControlMSWindow.scala:27-36) + 사내 편집기 표시(ClassName != "", null 도 설정).
function judgeTargetWindow(w) {
  const text = w ? w.Text ?? null : null
  const cls = w ? w.ClassName ?? null : null
  const blank = (s) => s === null || String(s).trim() === ''
  let reasonCode = null
  if (blank(text)) reasonCode = 'TEXT_EMPTY'
  else if (String(text).trim() === '*') reasonCode = 'TEXT_STAR'
  else if (blank(cls)) reasonCode = 'CLASS_EMPTY'
  const agentFinds = reasonCode === null
  return {
    raw: w ?? null,
    agentFinds,
    matchMode: agentFinds ? (String(text).endsWith('*') ? 'partial' : 'exact') : null,
    reasonCode,
    inHouseShowsSet: cls !== ''
  }
}

module.exports = { judgeTargetWindow }
