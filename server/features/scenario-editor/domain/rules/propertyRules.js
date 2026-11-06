'use strict'
// 운영 속성 검사(막힘). 사용자가 바꾼 키만 본다 — 옛 값은 보존하므로 막지 않는다(기준이 없으면 모든 키가 바뀐 것).
// 후속 시나리오 설명은 성공·실패 양쪽 3자 이상(SE-014: 사내는 성공 쪽만 검사).
const { changedPropertyKeys } = require('../changeDetect')

const FOLLOW_KEYS = [['success', 'NextScenarioIfSuccess'], ['fail', 'NextScenarioIfFail']]
const isInt = (v) => typeof v === 'number' && Number.isInteger(v)
const inRange = (v, lo, hi) => isInt(v) && v >= lo && v <= hi
const issue = (code, params) => (params === undefined ? { code } : { code, params })
const isSet = (f) => f !== null && f !== undefined && typeof f === 'object'

function checkProperty(property, sourceProperty) {
  const p = property || {}
  const changed = changedPropertyKeys(p, sourceProperty == null ? null : sourceProperty)
  const out = []
  if (changed.has('StartDelay') && !(p.StartDelay === 0 || inRange(p.StartDelay, 10, 14400))) out.push(issue('START_DELAY_RANGE'))
  if (changed.has('RetryInterval') && !inRange(p.RetryInterval, 10, 14400)) out.push(issue('RETRY_INTERVAL_RANGE'))
  if (changed.has('RetryCnt') && !inRange(p.RetryCnt, 0, 9)) out.push(issue('RETRY_CNT_RANGE'))
  if (changed.has('Priority') && ![1, 5, 10].includes(p.Priority)) out.push(issue('PRIORITY_VALUE'))
  if (changed.has('ExecutingLevel') && ![0, 1].includes(p.ExecutingLevel)) out.push(issue('EXECUTING_LEVEL_VALUE'))
  for (const [which, key] of FOLLOW_KEYS) {
    const f = p[key]
    if (changed.has(key) && isSet(f) && (typeof f.Name !== 'string' || f.Name.trim() === '')) out.push(issue('FOLLOW_NAME_REQUIRED', { which }))
  }
  // 한쪽 후속만 바꿔도 있는 쪽 둘 다 본다(옛 짧은 설명도 이때 함께 잡힌다).
  if (FOLLOW_KEYS.some(([, key]) => changed.has(key))) {
    for (const [which, key] of FOLLOW_KEYS) {
      const f = p[key]
      if (isSet(f) && !(typeof f.Text === 'string' && f.Text.length >= 3)) out.push(issue('FOLLOW_DESC_SHORT', { which }))
    }
  }
  return out
}

module.exports = { checkProperty }
