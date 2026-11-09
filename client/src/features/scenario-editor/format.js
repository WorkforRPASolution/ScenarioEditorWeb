import { LABELS, t as msg } from './messages'

export function targetLabel(t) {
  if (!t) return '—'
  if (t.kind === 'next') return 'NEXT'
  if (t.kind === 'end') return t.value
  if (t.kind === 'step') return `→${t.no}`
  if (t.kind === 'unresolved') return t.value === undefined || t.value === null ? msg('SEW_EDIT_UNRESOLVED') : msg('SEW_EDIT_UNRESOLVED_FROM', { value: t.value })
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

// ScenarioType enum 순서(사내 DataStruct). 운영 속성 Type 숫자 → 라벨(LABELS.scenarioType 한 표).
export const SCENARIO_TYPE_KEYS = ['NOT_DEFINED', 'ALARM_RECOVERY', 'PM_MACRO', 'CONDITION_CHECK', 'SILENT_DOWN_INFORM', 'GLASS_DEFECT', 'SOP_INFORM', 'FAP', 'ACCIDENT_PREVENTION']
const typeKeyOf = (n) => (Number.isInteger(n) ? SCENARIO_TYPE_KEYS[n] : undefined)
export const isScenarioType = (n) => typeKeyOf(n) !== undefined
export const scenarioTypeLabel = (n) => LABELS.scenarioType[typeKeyOf(n)] ?? String(n)
// 고를 수 있는 유형(사내 속성 창 콤보 순서) — 미지정(0)·PM 매크로(2)는 저장된 값을 보일 때만
export const SCENARIO_TYPE_CHOICES = [1, 3, 4, 5, 6, 7, 8]
export const scenarioTypeOptions = SCENARIO_TYPE_CHOICES.map((n) => [n, scenarioTypeLabel(n)])
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

// 사내 화면에 안 보이던 값(상세·편집 패널의 "자세히"). step = 표시 스텝(뼈대 모양, 손대지 않은 스텝만 raw 가 있다).
const shown = (v) => (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v)) ? '—' : String(v))
export function stepExtraRows(step) {
  const raw = step?.raw ?? {}
  const isp = raw.Metadata?.ImageSearchParam ?? {}
  const ocr = raw.Metadata?.OcrParamInfo ?? {}
  const train = step?.condition?.image?.trainImages ?? []
  return [
    ['MaximumNumberToFind', shown(isp.MaximumNumberToFind)], ['Timeout', shown(isp.Timeout)], ['TimeoutEnabled', shown(isp.TimeoutEnabled)], ['MinMatchingValue', shown(ocr.MinMatchingValue)],
    [msg('SEW_UI_EXTRA_TRAIN_KEYS'), train.map((x) => `${x.key}:${shown(x.type)}`).join(', ') || '—'], ['DescriptionToDialog', step?.descriptionToDialog || '—'], ['IsShowDialog', shown(step?.isShowDialog)]
  ]
}
