'use strict'
// 시나리오 단위 검사: 스텝 수·참조(다음 스텝)·머리·대상·크기·후속·운영 속성. 값은 Issue { code, uid?, params? } 뿐이다.
const { graphNotes } = require('../notes')

const STEP_MAX = 200
const NAME_MAX = 50
const TIMEOUT_MAX = 2147483647
const issue = (code, uid, params) => {
  const out = { code }
  if (uid !== undefined) out.uid = uid
  if (params !== undefined) out.params = params
  return out
}
const needsBase = (c) => c && (c.kind === 'image' || c.kind === 'ocr')
const isRef = (b) => !!b && typeof b === 'object' && 'from' in b

function stepCount(edited, source) {
  const out = []
  const n = edited.steps.length
  if (n === 0) out.push(issue('NO_STEPS'))
  const sourceCount = source ? source.steps.length : 0
  // grew 는 index 가 막힘·경고를 가르는 값이다(기준 판보다 늘었으면 막힘).
  if (n > STEP_MAX) out.push(issue('STEP_LIMIT', undefined, { count: n, max: STEP_MAX, sourceCount, grew: n > sourceCount }))
  return out
}

function sourceChecks(edited, source) {
  const out = []
  if (source && (source.notes || []).some((x) => x.code === 'PARSE_FAILED' && x.params && (x.params.field === 'body' || x.params.field === 'steps'))) {
    out.push(issue('SOURCE_PARSE_FAILED'))
  }
  for (const s of edited.steps) {
    const b = s.images && s.images.base
    if (b === null || b === undefined) { out.push(issue('BI_COUNT_MISMATCH', s.uid, { reason: 'missing' })); continue }
    if (source && source.biCount === null && isRef(b) && b.from === 'source') out.push(issue('BI_COUNT_MISMATCH', s.uid, { reason: 'sourceBroken' }))
  }
  return out
}

function references(edited) {
  const out = []
  const steps = edited.steps
  const known = new Set(steps.map((s) => s.uid))
  let hasSuccess = false
  steps.forEach((s, i) => {
    for (const which of ['onTrue', 'onFalse']) {
      const t = s.next[which]
      if (t.kind === 'step') {
        if (t.uid === s.uid) out.push(issue('NEXT_SELF', s.uid, { which }))
        else if (!known.has(t.uid)) out.push(issue('NEXT_UNRESOLVED', s.uid, { which }))
      } else if (t.kind === 'raw') out.push(issue('NEXT_OUT_OF_RANGE', s.uid, { which, value: t.value }))
      else if (t.kind === 'unresolved') out.push(issue('NEXT_UNRESOLVED', s.uid, { which }))
      else if (t.kind === 'end' && t.value === 'SUCCESS') hasSuccess = true
      else if (t.kind === 'next' && i === steps.length - 1) out.push(issue('LAST_STEP_NEXT', s.uid, { which }))
    }
  })
  if (steps.length > 0 && !hasSuccess) out.push(issue('NO_SUCCESS'))
  return out
}

// 흐름 경고는 편집본에서 다시 계산한다(대상은 uid, NEXT 는 다음 위치).
function flow(edited) {
  const out = []
  const steps = edited.steps
  const notes = graphNotes(steps.map(() => ({})), steps.map((s) => s.next), steps.map((s) => s.uid))
  steps.forEach((s, i) => {
    if (notes[i].some((x) => x.code === 'UNREACHABLE')) out.push(issue('UNREACHABLE', s.uid))
  })
  return out
}

function header(edited) {
  const out = []
  const d = edited.header.description
  if (typeof d !== 'string' || d.trim() === '') out.push(issue('MAIL_TITLE_EMPTY'))
  else if (d.includes(':')) out.push(issue('MAIL_TITLE_COLON'))
  const t = edited.header.timeoutLimit
  if (typeof t !== 'string' || !/^[1-9][0-9]*$/.test(t) || Number(t) > TIMEOUT_MAX) out.push(issue('TIMEOUT_INVALID'))
  return out
}

function target(ctx) {
  const out = []
  const { model, name } = ctx.target || {}
  if (!model) out.push(issue('MODEL_MISSING'))
  if (typeof name !== 'string' || name === '') out.push(issue('NAME_EMPTY'))
  else {
    if (name.length > NAME_MAX) out.push(issue('NAME_TOO_LONG', undefined, { max: NAME_MAX }))
    if (!/^[0-9A-Za-z_]+$/.test(name)) out.push(issue('NAME_CHARS'))
  }
  return out
}

function sizes(ctx) {
  const out = []
  const s = ctx.sizes
  const l = ctx.limits || {}
  if (!s) return out
  if (typeof l.bodyMax === 'number' && s.bodyBytes > l.bodyMax) out.push(issue('BODY_TOO_LARGE', undefined, { bytes: s.bodyBytes, max: l.bodyMax }))
  if (typeof l.requestMax === 'number' && s.requestBytes > l.requestMax) out.push(issue('REQUEST_TOO_LARGE', undefined, { bytes: s.requestBytes, max: l.requestMax }))
  return out
}

function follow(edited, ctx) {
  const out = []
  const self = ctx.target && ctx.target.name
  const names = ctx.targetNames || new Set()
  const graph = ctx.followGraph || new Map()
  for (const [which, key] of [['success', 'NextScenarioIfSuccess'], ['fail', 'NextScenarioIfFail']]) {
    const ref = edited.property && edited.property[key]
    const name = ref && typeof ref.Name === 'string' ? ref.Name : ''
    if (name === '') continue
    if (name === self) { out.push(issue('FOLLOW_SELF', undefined, { which, name })); continue }
    if (!names.has(name)) { out.push(issue('FOLLOW_MISSING', undefined, { which, name })); continue }
    const seen = new Set()
    const stack = [name]
    let cycle = false
    while (stack.length && !cycle) {
      const cur = stack.pop()
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const nx of graph.get(cur) || []) {
        if (nx === self) { cycle = true; break }
        stack.push(nx)
      }
    }
    if (cycle) out.push(issue('FOLLOW_CYCLE', undefined, { which, name }))
  }
  return out
}

function propertyChecks(edited) {
  const out = []
  const p = edited.property || {}
  if (p.Type === 0) out.push(issue('TYPE_UNSET'))
  if (edited.steps.some((s) => s.action && s.action.type === 13) && p.Type !== 7) out.push(issue('FAP_TYPE_MISMATCH'))
  return out
}

function scenarioRules(edited, source, ctx) {
  return [
    ...stepCount(edited, source), ...sourceChecks(edited, source), ...references(edited), ...flow(edited),
    ...header(edited), ...target(ctx), ...sizes(ctx), ...follow(edited, ctx), ...propertyChecks(edited)
  ]
}

module.exports = { scenarioRules, needsBase, isRef, issue }
