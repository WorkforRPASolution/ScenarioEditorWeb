// 운영 속성 칸 검사(브라우저, P2-D Task 4). 서버 domain/rules/propertyRules.js 와 같은 code·같은 규칙이다:
// 사용자가 바꾼 키만 본다(옛 값은 보존하므로 막지 않는다). 기준(prev)이 없으면(새 시나리오) 모든 키가 바뀐 것이다.
// 결과는 칸별 { [칸]: { code, params? } } — 후속 시나리오는 이름·설명 칸이 따로다(`NextScenarioIfSuccess.Name`·`.Text`).
import { canonicalJson } from './diff'

export const FOLLOW_KEYS = [['success', 'NextScenarioIfSuccess'], ['fail', 'NextScenarioIfFail']]
const isInt = (v) => typeof v === 'number' && Number.isInteger(v)
const inRange = (v, lo, hi) => isInt(v) && v >= lo && v <= hi
const isSet = (f) => f !== null && f !== undefined && typeof f === 'object'

// 서버 changeDetect.changedPropertyKeys 와 같다(Owners 는 배포가 정한다).
function changedKeys(next, prev) {
  const e = next || {}
  const s = prev || {}
  const out = new Set()
  for (const k of new Set([...Object.keys(e), ...Object.keys(s)])) {
    if (k !== 'Owners' && (prev == null || canonicalJson(e[k]) !== canonicalJson(s[k]))) out.add(k)
  }
  return out
}

export function checkPropertyFields(next, prev) {
  const p = next || {}
  const changed = changedKeys(p, prev)
  const out = {}
  if (changed.has('StartDelay') && !(p.StartDelay === 0 || inRange(p.StartDelay, 10, 14400))) out.StartDelay = { code: 'START_DELAY_RANGE' }
  if (changed.has('RetryInterval') && !inRange(p.RetryInterval, 10, 14400)) out.RetryInterval = { code: 'RETRY_INTERVAL_RANGE' }
  if (changed.has('RetryCnt') && !inRange(p.RetryCnt, 0, 9)) out.RetryCnt = { code: 'RETRY_CNT_RANGE' }
  if (changed.has('Priority') && ![1, 5, 10].includes(p.Priority)) out.Priority = { code: 'PRIORITY_VALUE' }
  if (changed.has('ExecutingLevel') && ![0, 1].includes(p.ExecutingLevel)) out.ExecutingLevel = { code: 'EXECUTING_LEVEL_VALUE' }
  for (const [which, key] of FOLLOW_KEYS) {
    const f = p[key]
    if (changed.has(key) && isSet(f) && (typeof f.Name !== 'string' || f.Name.trim() === '')) out[`${key}.Name`] = { code: 'FOLLOW_NAME_REQUIRED', params: { which } }
  }
  // 한쪽 후속만 바꿔도 있는 쪽 둘 다 본다(서버와 같다 — 옛 짧은 설명도 이때 함께 잡힌다, SE-014).
  if (FOLLOW_KEYS.some(([, key]) => changed.has(key))) {
    for (const [which, key] of FOLLOW_KEYS) {
      const f = p[key]
      if (isSet(f) && !(typeof f.Text === 'string' && f.Text.length >= 3)) out[`${key}.Text`] = { code: 'FOLLOW_DESC_SHORT', params: { which } }
    }
  }
  return out
}

// 저장 창의 운영 속성 줄(서버 검사 code) → 운영 속성 창에서 초점을 줄 칸. 운영 속성 code 가 아니면 null.
const CODE_FIELD = {
  START_DELAY_RANGE: 'StartDelay', RETRY_INTERVAL_RANGE: 'RetryInterval', RETRY_CNT_RANGE: 'RetryCnt', PRIORITY_VALUE: 'Priority',
  EXECUTING_LEVEL_VALUE: 'ExecutingLevel', TYPE_UNSET: 'Type', FAP_TYPE_MISMATCH: 'Type'
}
const FOLLOW_PART = { FOLLOW_NAME_REQUIRED: 'Name', FOLLOW_DESC_SHORT: 'Text', FOLLOW_MISSING: 'Name', FOLLOW_SELF: 'Name', FOLLOW_CYCLE: 'Name' }
export function propertyFieldOf(issue) {
  const code = issue?.code
  if (CODE_FIELD[code]) return CODE_FIELD[code]
  if (!FOLLOW_PART[code]) return null
  return `${issue.params?.which === 'fail' ? 'NextScenarioIfFail' : 'NextScenarioIfSuccess'}.${FOLLOW_PART[code]}`
}
