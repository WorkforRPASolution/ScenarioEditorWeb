import { LABELS } from './messages'

export function targetLabel(t) {
  if (!t) return '—'
  if (t.kind === 'next') return 'NEXT'
  if (t.kind === 'end') return t.value
  if (t.kind === 'step') return `→${t.no}`
  return `? ${t.value}`
}

export function targetKind(t) {
  if (!t) return 'raw'
  if (t.kind === 'end') return `end-${t.value.toLowerCase()}`
  return t.kind
}

const OPS = ['==', '>=', '<=']
export function multiLabel(multi) {
  if (!multi) return '—'
  return `${multi.count}개 ${multi.op === null || multi.op === undefined ? '?' : OPS[multi.op] ?? `?${multi.op}`}`
}

const pad = (n) => String(n).padStart(2, '0')
export function formatCrtime(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export const intervalSec = (ms) => Math.trunc(ms / 1000)
export const actionLabel = (typeName) => (typeName ? LABELS.action[typeName] ?? typeName : '알 수 없는 동작')
export const conditionLabel = (kind) => LABELS.condition[kind] ?? kind

// ScenarioType enum 순서(사내 DataStruct). 운영 속성 Type 숫자 → 라벨.
export const SCENARIO_TYPE_KEYS = ['NOT_DEFINED', 'ALARM_RECOVERY', 'PM_MACRO', 'CONDITION_CHECK', 'SILENT_DOWN_INFORM', 'GLASS_DEFECT', 'SOP_INFORM', 'FAP', 'ACCIDENT_PREVENTION']
export const scenarioTypeLabel = (n) => LABELS.scenarioType[SCENARIO_TYPE_KEYS[n]] ?? String(n)
export const enabledLabel = (v) => LABELS.enabled[v === true ? 'true' : v === false ? 'false' : 'unknown']
