import { targetLabel, targetKind, intervalSec, actionLabel, conditionLabel } from './format'

export function toRows(steps) {
  return steps.map((s) => {
    const warn = s.notes.some((n) => n.level === 'warning')
    return {
      uid: s.uid, no: s.no, warn, info: !warn && s.notes.some((n) => n.level === 'info'),
      condition: conditionLabel(s.condition.kind),
      accept: s.condition.kind === 'image' && s.condition.image ? Number(s.condition.image.accept).toFixed(2) : '',
      retry: s.retry.limit, interval: intervalSec(s.retry.intervalMs), skip: s.condition.skipPreprocessing,
      onTrue: targetLabel(s.next.onTrue), onTrueTarget: s.next.onTrue,
      onFalse: targetLabel(s.next.onFalse), onFalseTarget: s.next.onFalse,
      action: actionLabel(s.action.typeName), desc: s.descriptionToEmail ?? ''
    }
  })
}

// AG Grid 셀 렌더러 — textContent 만 쓴다(이름·설명의 HTML 글자를 그대로 보이게).
export function renderTarget(params) {
  const target = params.data[`${params.colDef.field}Target`]
  const el = document.createElement('span')
  el.textContent = params.value
  el.className = `se-pill se-pill-${targetKind(target)}`
  if (target && target.kind === 'step') el.dataset.go = target.uid
  return el
}

export function renderNo(params) {
  const el = document.createElement('span')
  el.textContent = `${params.data.warn ? '⚠ ' : params.data.info ? 'ⓘ ' : ''}${params.value}`
  if (params.data.warn) el.className = 'text-amber-600'
  return el
}
