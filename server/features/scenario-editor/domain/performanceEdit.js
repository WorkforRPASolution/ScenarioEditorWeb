'use strict'
// 성과 정보 쓰기 값(SC_PROPERTY.performance). 필드 이름·순서는 사내 C# PerformanceItem 그대로(EqpPerfornmanceLoss 오타·WaferLoss, 01 §5.10).
const { Long } = require('mongoose').mongo
const { NOT_ENTERED } = require('./enums')
const { kstDate } = require('./owners')

// 사내 new PerformanceItem() — 새 대상 저장에서 성과를 복사하지 않을 때 쓴다(13 §2.6). TriggerInfo 는 대입이 없어 null,
// 심의자는 화면 문구 Common_NotEntered(DC-049), 기여자는 빈 목록이다. 0 은 Int32 로 나간다(드라이버가 Int32 범위 정수를 Int32 로 쓴다 — 사내 C# int·enum 과 같다).
function emptyPerformance() {
  return {
    Group: '',
    Trigger: 0,
    TriggerInfo: null,
    Grade: 0,
    Supervisor: NOT_ENTERED,
    SupervisorComment: '',
    CitizenDeveloper: [],
    PerformType: 0,
    ScenarioDescription: '',
    ManWorkLoss: 0,
    EqpPerfornmanceLoss: 0,
    EqpStopLoss: 0,
    WaferLoss: 0,
    InvestCostLoss: 0,
    AdditionalEffect: '',
    AccidentType: 0,
    AccidentInfo: '',
    UpdateDate: ''
  }
}

const isLong = (v) => Long.isLong(v)
const plain = (v) => (isLong(v) ? v.toNumber() : v)
const sameValue = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]))
  if (a && b && typeof a === 'object' && typeof b === 'object' && !isLong(a) && !isLong(b)) {
    const ka = Object.keys(a)
    return ka.length === Object.keys(b).length && ka.every((k) => sameValue(a[k], b[k]))
  }
  return plain(a) === plain(b)
}

// 심의(등급·의견)만. 실제로 바뀐 것만 쓰고, 하나라도 바뀌면 심의자를 로그인 아이디로(설계 §7, 40 §2.6).
function reviewFields(current, { grade, comment }, singleid) {
  const cur = current || {}
  const out = {}
  if (grade !== undefined && !sameValue(grade, cur.Grade)) out['performance.Grade'] = grade
  if (comment !== undefined && !sameValue(comment, cur.SupervisorComment)) out['performance.SupervisorComment'] = comment
  if (Object.keys(out).length) out['performance.Supervisor'] = singleid
  return out
}

// 서버가 정하는 값(Supervisor·UpdateDate)과 건드리지 않는 값(EqpPerfornmanceLoss — SE-031·DC-003)은 입력에서 뺀다.
const IGNORED = new Set(['Supervisor', 'UpdateDate', 'EqpPerfornmanceLoss', 'Grade', 'SupervisorComment'])

// 입력(BSON 키)과 현재 값이 다른 것만 performance.<키>. 성과 필드가 바뀌면 UpdateDate(KST 날짜). 등급·의견은 reviewFields 규칙이고 UpdateDate 를 올리지 않는다.
function performanceFields(current, input, { singleid, now = new Date() }) {
  const cur = current || {}
  const src = input || {}
  const out = {}
  for (const [k, v] of Object.entries(src)) {
    if (IGNORED.has(k) || v === undefined) continue
    if (!sameValue(v, cur[k])) out[`performance.${k}`] = v
  }
  if (Object.keys(out).length) out['performance.UpdateDate'] = kstDate(now)
  return { ...out, ...reviewFields(cur, { grade: src.Grade, comment: src.SupervisorComment }, singleid) }
}

// 기여자 목록 → 저장 원소. Sdwt 는 사용자 process 의 ':' 앞부분(DC-141). Contribution 은 기존 같은 KnoxId 원소의 BSON 형(Int32 면 숫자, Int64 면 Long)을
// 지키고, 새 원소는 Long(Q-009). existing 은 Long 을 올리지 않고 읽은 값이어야 한다.
function citizenDevelopers(list, usersById, existing) {
  const old = new Map((Array.isArray(existing) ? existing : []).map((d) => [d && d.KnoxId, d && d.Contribution]))
  return list.map((d) => {
    const u = usersById.get(d.KnoxId) || {}
    const proc = typeof u.process === 'string' ? u.process : ''
    const prev = old.get(d.KnoxId)
    const asInt32 = old.has(d.KnoxId) && typeof prev === 'number'
    return {
      KnoxId: d.KnoxId,
      Sdwt: proc.includes(':') ? proc.split(':')[0] : '',
      Name: typeof u.name === 'string' ? u.name : '',
      Contribution: asInt32 ? d.Contribution : Long.fromNumber(d.Contribution)
    }
  })
}

module.exports = { emptyPerformance, reviewFields, performanceFields, citizenDevelopers }
