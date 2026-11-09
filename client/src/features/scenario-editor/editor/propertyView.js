// 운영 속성 창의 보이는 값(목업 v2 human·typeName·priName·diffs). 저장 값은 바꾸지 않고 글로만 바꾼다.
import { LABELS, t } from '../messages'
import { canonicalJson } from './diff'

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

export const typeName = (v) => (v === 0 ? P.typeNone : P.types.find(([k]) => k === v)?.[1] ?? t('SEW_PROP_STORED', { value: v }))
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
  EDMLink: (v) => v || P.none
}
const ORDER = Object.keys(DIFF_TEXT)

export function propertyDiffs(before, after) {
  const a = before || {}
  const b = after || {}
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== 'Owners' && canonicalJson(a[k]) !== canonicalJson(b[k]))
  keys.sort((x, y) => (ORDER.indexOf(x) + 1 || 99) - (ORDER.indexOf(y) + 1 || 99))
  return keys.map((key) => {
    const text = DIFF_TEXT[key] ?? ((v) => (v == null ? P.none : typeof v === 'object' ? JSON.stringify(v) : String(v)))
    return { key, label: P.keys[key] ?? LABELS.propertyKey[key] ?? key, from: text(a[key]), to: text(b[key]) }
  })
}

// 칸 입력 → 저장 값. 정수 글이면 숫자, 아니면 친 글 그대로(칸 검사가 막는다).
export const parseIntInput = (v) => (/^\s*-?\d+\s*$/.test(v) ? Number(v) : v)
