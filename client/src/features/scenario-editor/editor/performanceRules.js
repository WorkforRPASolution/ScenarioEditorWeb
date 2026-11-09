// 성과 입력 검사와 완료 판정(설계 §7). 서버 domain/rules/performanceRules.js 와 같은 code·params·완료 식을 브라우저에 둔다
// (서버 파일을 import 하지 않는다 — 완료 판정은 두 시험이 같은 경우표를 쓴다). 순수 함수만.
const GRADE_NA = 0
export const GRADE_NOT_USED = 6
const TRIGGER_NA = 0
export const NOT_SELECTABLE_TRIGGERS = [2, 3] // RV·EqState — 저장된 값일 때만 둘 수 있다(서버 previous 규칙)
export const EFFECT_KEYS = ['ManWorkLoss', 'EqpStopLoss', 'WaferLoss', 'InvestCostLoss']
const EFFECT_MAX = 2147483647
const COMMENT_MIN = 5
const CONTRIBUTION_MAX = 100
const GROUP_RE = /^[0-9A-Z_]+$/

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
export const isIntText = (v) => /^\d+$/.test(String(v ?? '').trim())
const intOf = (v) => Number(String(v).trim())
const hasEffect = (perf) => EFFECT_KEYS.some((k) => num(perf[k]) !== 0) || perf.AccidentType !== 0

// 완료 = 등급 NotUsed, 또는 (등급 ≠ N/A · 트리거 ≠ NA · 효과나 사고 유형 있음). 입력은 BSON 키(서버와 같은 모양).
export function isPerformanceComplete(perf) {
  if (!perf || typeof perf !== 'object') return false
  if (perf.Grade === GRADE_NOT_USED) return true
  return perf.Grade !== GRADE_NA && perf.Trigger !== TRIGGER_NA && hasEffect(perf)
}

// 미완료일 때 남은 것(창 머리 "남은 것: …"): 'grade'·'trigger'·'effect'
export function missingOf(perf) {
  const p = perf || {}
  if (p.Grade === GRADE_NOT_USED) return []
  return [p.Grade === GRADE_NA && 'grade', p.Trigger === TRIGGER_NA && 'trigger', !hasEffect(p) && 'effect'].filter(Boolean)
}

// 작업본(editor/performanceForm formOf 모양) 검사 — 서버 checkPerformance 와 같은 순서·code·params.
// 화면만의 차이: 효과는 "체크 + 값" 이라 체크한 칸만 1 이상을 본다(끈 칸은 0 을 보낸다).
// 원개발자는 고쳤을 때만 본다(서버도 목록을 보낼 때만 본다). registered(id) = 등록 사용자인가(모르면 true).
export function checkPerformanceForm(f, { savedTrigger, registered = () => true, devsChanged = false } = {}) {
  const out = []
  const add = (code, params) => out.push(params === undefined ? { code } : { code, params })
  if (f.trig === TRIGGER_NA) add('TRIGGER_REQUIRED')
  if (NOT_SELECTABLE_TRIGGERS.includes(f.trig) && f.trig !== savedTrigger) add('TRIGGER_NOT_SELECTABLE')
  if (f.grade === GRADE_NA) add('GRADE_REQUIRED')
  if (String(f.comment ?? '').trim().length < COMMENT_MIN) add('COMMENT_SHORT')
  if (f.grade !== GRADE_NOT_USED && EFFECT_KEYS.every((k) => !f.eff[k].on) && f.acc === 0) add('EFFECT_REQUIRED')
  for (const k of EFFECT_KEYS) {
    const e = f.eff[k]
    if (e.on && !(isIntText(e.v) && intOf(e.v) >= 1 && intOf(e.v) <= EFFECT_MAX)) add('EFFECT_VALUE', { field: k })
  }
  if (f.acc !== 0 && !String(f.accInfo ?? '').trim()) add('ACCIDENT_INFO_REQUIRED')
  if (f.type === 2 && !GROUP_RE.test(f.group ?? '')) add('GROUP_FORMAT')
  if (devsChanged) {
    const seen = new Set()
    let total = 0
    f.devs.forEach((d, index) => {
      if (!registered(d.id)) add('DEV_UNKNOWN', { index })
      if (seen.has(d.id)) add('DEV_DUPLICATE', { index })
      seen.add(d.id)
      const ok = isIntText(d.p) && intOf(d.p) >= 1 && intOf(d.p) <= CONTRIBUTION_MAX
      if (!ok) add('DEV_CONTRIBUTION_RANGE', { index })
      total += isIntText(d.p) ? intOf(d.p) : 0
    })
    if (total > CONTRIBUTION_MAX) add('DEV_TOTAL', { total })
  }
  return out
}

// 검사 결과(브라우저 검사·서버 422 blocks)가 보일 자리. 효과 값은 칸마다, 원개발자는 줄(dev:i)·기여도 칸(devp:i)마다.
const AT = {
  TRIGGER_REQUIRED: 'trigger', TRIGGER_NOT_SELECTABLE: 'trigger', GRADE_REQUIRED: 'grade', COMMENT_SHORT: 'comment',
  EFFECT_REQUIRED: 'effects', ACCIDENT_INFO_REQUIRED: 'accInfo', GROUP_FORMAT: 'group', DEV_TOTAL: 'devs'
}
export function atOf({ code, params = {} } = {}) {
  if (code === 'EFFECT_VALUE') return `eff:${params.field}`
  if (code === 'DEV_CONTRIBUTION_RANGE') return `devp:${params.index}`
  if (code === 'DEV_UNKNOWN' || code === 'DEV_DUPLICATE') return `dev:${params.index}`
  return AT[code] ?? 'other'
}
// 손댄 칸 묶음(오류를 빨갛게 보이는 단위). 원개발자 자리는 하나로 묶는다.
export const groupOf = (at) => (at === 'devs' || at.startsWith('dev:') || at.startsWith('devp:') ? 'devs' : at)
