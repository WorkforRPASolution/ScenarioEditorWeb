import { LABELS } from './messages'

export function targetLabel(t) {
  if (!t) return '—'
  if (t.kind === 'next') return 'NEXT'
  if (t.kind === 'end') return t.value
  if (t.kind === 'step') return `→${t.no}`
  if (t.kind === 'unresolved') return t.value === undefined || t.value === null ? '미해결' : `미해결 ${t.value}`
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

const joinList = (v) => (Array.isArray(v) ? v.join(', ') : '') || '(없음)'

export function actionDetails(a) {
  const rows = [['종류', actionLabel(a.typeName)]]
  if (a.click) rows.push(['좌표', `${a.click.x}:${a.click.y}`], ['기준', LABELS.clickBasis[a.click.basis] ?? String(a.click.basis)])
  if (a.wheel) rows.push(['칸 수', String(a.wheel.notches)], ['대기', `${a.wheel.delaySec}초`])
  if (a.keyboard) {
    rows.push(['입력 문자열', a.keyboard.text || '(없음)'], ['기능 키', a.keyboard.keys.map((k) => k.name).join(' ') || '(없음)'])
    if (a.keyboard.unknownCodes.length) rows.push(['모르는 코드', a.keyboard.unknownCodes.join(', ')])
  }
  if (a.waitSec !== undefined) rows.push(['시간', `${a.waitSec}초`])
  if (a.oiCommand) {
    rows.push(['명령', a.oiCommand.command])
    if (a.oiCommand.code) rows.push(['다운 코드', a.oiCommand.code])
    if (a.oiCommand.chamber) rows.push(['챔버', a.oiCommand.chamber])
  }
  if (a.fap) rows.push(['SSB 메시지', a.fap.ssbMessage], ['PM 코드', a.fap.pmCode], ['메인 챔버', a.fap.mainChamber], ['ESOP 매크로', a.fap.esopMacroId])
  if (a.native) rows.push(['함수', a.native.functionName ?? '(null)'], ['인자', joinList(a.native.params)], ['출력', joinList(a.native.outputs)])
  rows.push(['저장 값', a.raw ? a.raw : '(빈 값)'])
  return rows
}
