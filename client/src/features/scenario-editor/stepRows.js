import { targetLabel, targetKind, intervalSec, actionLabel, conditionLabel } from './format'
import { t, fieldMessage } from './messages'

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const fixed2 = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '')

// edit(편집 중일 때만): marks = uid → 'nw'|'ch'|'pending'(바뀐 줄 표시), moved = 번호가 바뀐 갈 곳 `${uid}:${key}`, cut = 잘라 둔 uid,
// insert = 만드는 새 스텝을 넣을 자리 { before: uid | null } — 그 줄에 ins 'before', null(맨 끝)이면 마지막 줄에 ins 'after'.
export function toRows(steps, edit = null) {
  const insertUid = edit?.insert ? (steps.some((s) => s.uid === edit.insert.before) ? edit.insert.before : null) : undefined
  const lastUid = steps.length ? steps[steps.length - 1].uid : null
  return steps.map((s) => {
    const warn = s.notes.some((n) => n.level === 'warning')
    const row = {
      uid: s.uid, no: s.no, warn, info: !warn && s.notes.some((n) => n.level === 'info'),
      condition: conditionLabel(s.condition.kind),
      accept: s.condition.kind === 'image' && s.condition.image ? fixed2(s.condition.image.accept) : '',
      retry: finite(s.retry?.limit) ? s.retry.limit : '', interval: finite(s.retry?.intervalMs) ? intervalSec(s.retry.intervalMs) : '',
      skip: s.condition.skipPreprocessing,
      onTrue: targetLabel(s.next.onTrue), onTrueTarget: s.next.onTrue,
      onFalse: targetLabel(s.next.onFalse), onFalseTarget: s.next.onFalse,
      action: actionLabel(s.action.typeName), desc: s.descriptionToEmail ?? ''
    }
    if (!edit) return row
    return {
      ...row, kind: s.condition.kind, mark: edit.marks?.get(s.uid) ?? '',
      onTrueMoved: !!edit.moved?.has(`${s.uid}:onTrue`), onFalseMoved: !!edit.moved?.has(`${s.uid}:onFalse`),
      cut: !!edit.cut?.has(s.uid),
      ins: insertUid === undefined ? '' : insertUid === s.uid ? 'before' : insertUid === null && s.uid === lastUid ? 'after' : ''
    }
  })
}

// AG Grid 셀 렌더러 — textContent 만 쓴다(이름·설명의 HTML 글자를 그대로 보이게).
// 편집 중(context.editable)이면 갈 곳은 고르기 버튼(data-pick), 아니면 P1 처럼 그 스텝으로 가는 표시(data-go).
export function renderTarget(params) {
  const field = params.colDef.field
  const target = params.data[`${field}Target`]
  const editable = !!params.context?.editable
  const el = document.createElement(editable ? 'button' : 'span')
  el.textContent = params.value
  el.className = `se-pill se-pill-${targetKind(target)}`
  // 다른 시나리오에서 붙여 온 미해결 갈 곳 — 짚으면 할 일(원래 번호를 알면 함께)
  if (target?.kind === 'unresolved') el.title = fieldMessage({ code: 'NEXT_UNRESOLVED', params: target.value == null ? {} : { value: target.value } })
  if (editable) {
    el.type = 'button'
    el.dataset.pick = `${params.data.uid}:${field}`
    if (params.data[`${field}Moved`]) el.classList.add('se-pill-moved')
  } else if (target && target.kind === 'step') el.dataset.go = target.uid
  return el
}

const MARK_TITLE = { nw: 'SEW_EDIT_ROW_NEW', ch: 'SEW_EDIT_ROW_CHANGED', pending: 'SEW_EDIT_ROW_PENDING' }
export function renderNo(params) {
  const el = document.createElement('span')
  const mark = params.data.mark
  if (mark) {
    const dot = document.createElement('span')
    dot.className = `se-mark se-mark-${mark}`
    dot.title = t(MARK_TITLE[mark])
    dot.dataset.mark = mark
    el.appendChild(dot)
  }
  el.appendChild(document.createTextNode(`${params.data.warn ? '⚠ ' : params.data.info ? 'ⓘ ' : ''}${params.value}`))
  if (params.data.warn) el.className = 'text-amber-600'
  return el
}

// 정확도 칸 바로 고치기(이미지 스텝만). 바뀌면 context.onAccept(uid, 글자) → 오류 문구(있으면 칸에 오류, 작업본 그대로) 또는 null.
export function renderAccept(params) {
  if (params.data.kind !== 'image') return document.createTextNode(params.value ?? '')
  const input = document.createElement('input')
  input.className = 'se-cellnum'
  input.inputMode = 'decimal'
  input.value = params.value ?? ''
  input.dataset.cell = 'accept'
  input.setAttribute('aria-label', t('SEW_EDIT_CELL_ACCEPT', { no: params.data.no }))
  input.addEventListener('change', () => {
    const err = params.context.onAccept(params.data.uid, input.value)
    if (!err) { input.classList.remove('se-cellnum-bad'); input.removeAttribute('aria-invalid'); input.title = ''; return }
    input.classList.add('se-cellnum-bad')
    input.setAttribute('aria-invalid', 'true')
    input.title = err
    // 목업처럼 잠깐 보인 뒤 작업본 값으로 돌린다(이유는 알림에 남는다).
    setTimeout(() => {
      if (!input.classList.contains('se-cellnum-bad')) return
      input.value = params.value ?? ''
      input.classList.remove('se-cellnum-bad'); input.removeAttribute('aria-invalid'); input.title = ''
    }, 1500)
  })
  // 칸 안의 키는 칸이 처리한다 — AG Grid 가 Enter 등을 받으면 칸을 다시 그려 오류 표시가 사라진다(표 단축키도 듣지 않게).
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') input.blur()
    if (e.key === 'Escape') { input.value = params.value ?? ''; input.blur() }
  })
  return input
}

// 전처리 스킵 체크(설비 상태·값이 참거짓이 아닌 스텝은 칸 없음 —).
export function renderSkip(params) {
  if (params.data.kind === 'eqpState' || typeof params.value !== 'boolean') return document.createTextNode('—')
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.className = 'se-cellcheck'
  box.checked = params.value
  box.dataset.cell = 'skip'
  box.setAttribute('aria-label', t('SEW_EDIT_CELL_SKIP', { no: params.data.no }))
  box.addEventListener('keydown', (e) => e.stopPropagation())
  box.addEventListener('change', () => params.context.onSkip(params.data.uid, box.checked))
  return box
}
