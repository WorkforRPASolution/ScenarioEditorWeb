'use strict'
// 성과 입력 검사와 완료 판정. 입력은 BSON performance 키 모양(사내 C# 이름). 배포 관문이 아니라 성과 창 전용이므로 RULES 에 넣지 않는다.
const { GRADE_NAMES, TRIGGER_NAMES } = require('../enums')

const GRADE_NOT_USED = GRADE_NAMES.indexOf('NotUsed')
const TRIGGER_RV = TRIGGER_NAMES.indexOf('RV')
const TRIGGER_EQSTATE = TRIGGER_NAMES.indexOf('EqState')
const EFFECT_KEYS = ['ManWorkLoss', 'EqpStopLoss', 'WaferLoss', 'InvestCostLoss']
const EFFECT_MAX = 2147483647
const COMMENT_MIN = 5
const PERFORMANCE_CODES = Object.freeze([
  'TRIGGER_REQUIRED', 'TRIGGER_NOT_SELECTABLE', 'GRADE_REQUIRED', 'COMMENT_SHORT', 'EFFECT_REQUIRED', 'EFFECT_VALUE',
  'ACCIDENT_INFO_REQUIRED', 'GROUP_FORMAT', 'DEV_UNKNOWN', 'DEV_DUPLICATE', 'DEV_CONTRIBUTION_RANGE', 'DEV_TOTAL'
])
const issue = (code, params) => (params === undefined ? { code } : { code, params })
const isInt = (v) => typeof v === 'number' && Number.isInteger(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const blank = (v) => typeof v !== 'string' || v.trim() === ''

function checkPerformance(input, { previous, registeredIds } = {}) {
  const p = input || {}
  const out = []
  if (p.Trigger === 0) out.push(issue('TRIGGER_REQUIRED'))
  if ((p.Trigger === TRIGGER_RV || p.Trigger === TRIGGER_EQSTATE) && !(previous && previous.Trigger === p.Trigger)) out.push(issue('TRIGGER_NOT_SELECTABLE'))
  if (p.Grade === 0) out.push(issue('GRADE_REQUIRED'))
  if (typeof p.SupervisorComment !== 'string' || p.SupervisorComment.trim().length < COMMENT_MIN) out.push(issue('COMMENT_SHORT'))
  if (p.Grade !== GRADE_NOT_USED && EFFECT_KEYS.every((k) => num(p[k]) === 0) && p.AccidentType === 0) out.push(issue('EFFECT_REQUIRED'))
  for (const k of EFFECT_KEYS) {
    if (!(isInt(p[k]) && p[k] >= 0 && p[k] <= EFFECT_MAX)) out.push(issue('EFFECT_VALUE', { field: k }))
  }
  if (p.AccidentType !== 0 && blank(p.AccidentInfo)) out.push(issue('ACCIDENT_INFO_REQUIRED'))
  if (p.PerformType === 2 && !(typeof p.Group === 'string' && /^[0-9A-Z_]+$/.test(p.Group))) out.push(issue('GROUP_FORMAT'))
  if (Array.isArray(p.CitizenDeveloper)) {
    const seen = new Set()
    let total = 0
    p.CitizenDeveloper.forEach((d, index) => {
      const id = d && d.KnoxId
      if (!(registeredIds && registeredIds.has(id))) out.push(issue('DEV_UNKNOWN', { index }))
      if (seen.has(id)) out.push(issue('DEV_DUPLICATE', { index }))
      seen.add(id)
      const c = d && d.Contribution
      if (!(isInt(c) && c >= 1 && c <= 100)) out.push(issue('DEV_CONTRIBUTION_RANGE', { index }))
      total += num(c)
    })
    if (total > 100) out.push(issue('DEV_TOTAL', { total }))
  }
  return out
}

// 성과 완료 판정(SE-034, 설계 §7): 성과 창과 목록 화면이 이 함수 하나를 쓴다.
function isPerformanceComplete(perf) {
  if (!perf || typeof perf !== 'object') return false
  if (perf.Grade === GRADE_NOT_USED) return true
  return perf.Grade !== 0 && perf.Trigger !== 0 && (EFFECT_KEYS.some((k) => num(perf[k]) !== 0) || perf.AccidentType !== 0)
}

module.exports = { checkPerformance, isPerformanceComplete, PERFORMANCE_CODES }
