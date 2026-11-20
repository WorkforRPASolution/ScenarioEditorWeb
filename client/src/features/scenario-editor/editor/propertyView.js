// 운영 속성 창의 보이는 값(목업 v2 human·typeName·priName·diffs). 저장 값은 바꾸지 않고 글로만 바꾼다.
import { LABELS, t } from '../messages'
import { canonicalJson } from './diff'
import { isScenarioType, scenarioTypeLabel } from '../format'
import { FOLLOW_FIELDS } from './propertyRules'

// 후속 이름 — 이름이 있는 후속만. 저장된 빈 후속 {Name:''} 과 null 은 둘 다 "후속 없음"(null)이다.
export const followName = (v) => (v && typeof v === 'object' && typeof v.Name === 'string' && v.Name !== '' ? v.Name : null)

const P = LABELS.prop

// 초 → "2시간 30분"(60초 미만은 "30초"). 숫자가 아니면 글자 그대로.
export function human(sec) {
  const n = Number(sec)
  if (typeof sec !== 'number' || !Number.isFinite(n)) return String(sec ?? '')
  if (n < 60) return `${n}${P.second}`
  const h = Math.floor(n / 3600)
  const m = Math.floor((n % 3600) / 60)
  const s = n % 60
  return [h ? `${h}${P.hour}` : '', m ? `${m}${P.minute}` : '', s ? `${s}${P.second}` : ''].filter(Boolean).join(' ')
}

// 효과 단위(사내 기여 창 문구, 42 Q-121 답 2026-11-09). 사내 창은 입력값을 그대로 저장하므로 공수·정지 값은 분이다
// (사본 PerformanceItem 주석의 "단위: 초" 는 화면과 다르다). 공수절감은 Passive 면 정지LOSS 개선과 같은 분/일로 바뀐다(사내 rbType_Click).
export function effectUnit(key, performType) {
  const U = LABELS.perf.units
  if (key === 'WaferLoss') return U.wafer
  if (key === 'InvestCostLoss') return U.invest
  return key === 'EqpStopLoss' || performType === 2 ? U.perDay : U.minute
}
// 분 → "1시간 30분"(60분 미만은 빈 글)
export const minutesHuman = (min) => (min >= 60 ? human(min * 60) : '')

// 유형 이름은 모든 화면과 같은 표(format scenarioTypeLabel) — 표에 없는 저장 값은 "저장 값 N"
export const typeName = (v) => (isScenarioType(v) ? scenarioTypeLabel(v) : t('SEW_PROP_STORED', { value: v }))
export const priorityName = (v) => P.priorities.find(([k]) => k === v)?.[1] ?? t('SEW_PROP_STORED', { value: v })
export const isStandardPriority = (v) => P.priorities.some(([k]) => k === v)
// 후속: 이름이 있으면 그 이름, 저장된 빈 후속 {Name:''} 은 "빈 값", 없음(null)은 "없음"
const followText = (v) => (v == null ? P.none : typeof v.Name === 'string' && v.Name !== '' ? v.Name : P.emptyFollow)
const onOff = (v) => (v ? P.on : P.off)
const mail = (doNotSend) => (doNotSend ? P.noSend : P.send)

// 바닥 줄 "바뀐 값" 의 글(목업 diffs 순서). 목록에 없는 키는 키 이름·저장 값 그대로.
const DIFF_TEXT = {
  IsEnabled: onOff,
  Type: typeName,
  Priority: priorityName,
  StartDelay: (v) => (v === 0 ? P.none : human(v)),
  RetryCnt: (v) => (v === 0 ? P.retryOff : t('SEW_PROP_RETRY_N', { n: v })),
  RetryInterval: human,
  DoNotSendEmailWhenSuccess: mail,
  DoNotSendEmailWhenFail: mail,
  DoNotSendEmailWhenStop: mail,
  NextScenarioIfSuccess: followText,
  NextScenarioIfFail: followText,
  ExecutingLevel: (v) => (v === 1 ? P.on : v === 0 ? P.off : t('SEW_PROP_STORED', { value: v })),
  DetailedDescriptionTitle: (v) => v || P.none,
  EDMLink: (v) => v || P.none,
  // 웹에서 고치지 않는 칸 — 운영 속성 창 "그 밖의 값" 과 같은 글(초안·다른 판과 달라졌을 때만 보인다)
  ScenarioTriggerType: (v) => (v == null ? P.none : P.triggerTypes[v] ?? t('SEW_PROP_STORED', { value: v })),
  IsShowDialog: (v) => (v ? P.yes : P.no)
}
const ORDER = Object.keys(DIFF_TEXT)
const followDesc = (v) => (v && typeof v.Text === 'string' && v.Text !== '' ? v.Text : P.none)
const plain = (v) => (v == null || v === '' ? P.none : typeof v === 'object' ? JSON.stringify(v) : String(v))

export function propertyDiffs(before, after) {
  const a = before || {}
  const b = after || {}
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== 'Owners' && canonicalJson(a[k]) !== canonicalJson(b[k]))
  keys.sort((x, y) => (ORDER.indexOf(x) + 1 || 99) - (ORDER.indexOf(y) + 1 || 99))
  return keys.map((key) => {
    // 후속 이름은 그대로고 설명만 바뀌면 "A → A" 가 된다 — 설명을 보인다
    if (FOLLOW_FIELDS.has(key) && followText(a[key]) === followText(b[key])) return { key, label: P.errorFields[`${key}.Text`], from: followDesc(a[key]), to: followDesc(b[key]) }
    const text = DIFF_TEXT[key] ?? plain
    return { key, label: P.keys[key] ?? LABELS.propertyKey[key] ?? key, from: text(a[key]), to: text(b[key]) }
  })
}

// 칸 입력 → 저장 값. 정수 글이면 숫자, 아니면 친 글 그대로(칸 검사가 막는다).
export const parseIntInput = (v) => (/^\s*-?\d+\s*$/.test(v) ? Number(v) : v)
