'use strict'
// 스텝 값 검사. 사내 저장 검사(늘 막힘)와 웹이 더한 값 검사(고친 스텝만 막힘)를 함께 낸다 — 가르는 일은 index 가 RULES 로 한다.
const { CAN_FAIL_ACTIONS } = require('../enums')
const { encodeAction } = require('../conditionCodec')
const { editedFromSkeleton } = require('../editedScenario')
const { issue, needsBase, isRef } = require('./scenarioRules')

const isInt = (v) => typeof v === 'number' && Number.isInteger(v)
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v)
const COUNT_RE = /^\d+$/
const PRESERVE_ONLY = new Set([7, 8, 13, 14, 15])
const TEXT_OPS = new Set([1, 2, 3, 4])
const NUMBER_OPS = new Set([5, 6, 9, 10])
const RANGE_OPS = new Set([7, 8])

// 저장될 값이 빈 문자열인가(동작 1~6). 구조화 값이 있으면 조립 결과로, 없으면 저장된 원본으로 본다.
function storedValueEmpty(action) {
  try { return encodeAction(action, { Type: action.type, Value: action.raw ?? '', NativeFunction: null }).Value === '' } catch (e) { return (action.raw ?? '') === '' }
}

function conditionIssues(s, out) {
  const c = s.condition
  const u = s.uid
  const act = s.action && s.action.type
  if (needsBase(c) && !isRef(s.images && s.images.base)) out.push(issue('BASE_IMAGE_MISSING', u))
  if (c.kind === 'ocr' && [1, 2, 3].includes(act)) out.push(issue('OCR_MOUSE_CLICK', u))
  if (c.kind === 'none' && [1, 2, 3].includes(act)) out.push(issue('NONE_MOUSE_CLICK', u))
  if (c.kind === 'eqpState' && (c.skipPreprocessing === true || c.eqpState === null)) out.push(issue('EQPSTATE_SKIP', u))
  if (c.kind !== 'image' && c.kind !== 'ocr') return
  const a = c.searchArea
  if (!a || !(a.w >= 1) || !(a.h >= 1)) out.push(issue('AREA_INVALID', u))
  const multi = (c.kind === 'image' ? c.image && c.image.multi : c.ocr && c.ocr.multi) || { count: '1', op: 0 }
  const countOk = typeof multi.count === 'string' && COUNT_RE.test(multi.count) && Number(multi.count) >= (c.kind === 'image' ? 1 : 0) && Number(multi.count) <= 20
  if (!countOk || ![0, 1, 2].includes(multi.op)) out.push(issue('MULTI_RANGE', u))
  if (c.kind === 'image') {
    const acc = c.image && c.image.accept
    if (isFiniteNum(acc) && acc < 0.5) out.push(issue('ACCEPT_TOO_LOW', u))
    else if (!isFiniteNum(acc) || acc > 1) out.push(issue('ACCEPT_TOO_HIGH', u))
    if (!Object.values((s.images && s.images.train) || {}).some(isRef)) out.push(issue('TRAIN_IMAGE_MISSING', u))
    if (countOk && Number(multi.count) > 1 && act !== 0) out.push(issue('MULTI_WITH_ACTION', u))
  } else {
    const o = c.ocr || {}
    if (!(isInt(o.op) && o.op >= 1 && o.op <= 10)) out.push(issue('OCR_OP_REQUIRED', u))
    else {
      if (TEXT_OPS.has(o.op) && (typeof o.text !== 'string' || o.text === '' || o.text.includes('@@@@'))) out.push(issue('OCR_TEXT_FORMAT', u))
      if (NUMBER_OPS.has(o.op) && !isFiniteNum(o.number)) out.push(issue('OCR_NUMBER_REQUIRED', u))
      if (RANGE_OPS.has(o.op) && !(isFiniteNum(o.min) && isFiniteNum(o.max))) out.push(issue('OCR_NUMBER_REQUIRED', u))
    }
  }
}

function customScriptOk(cs) {
  if (!cs || typeof cs.name !== 'string' || cs.name === '' || cs.name.includes(';')) return false
  const args = Array.isArray(cs.args) ? cs.args : null
  if (!args || args.some((a) => typeof a !== 'string' || a.includes(';') || a.startsWith('@@'))) return false
  if (cs.timeout !== null && cs.timeout !== undefined) {
    if (!isInt(cs.timeout.value) || cs.timeout.value < 1 || !['seconds', 'minutes', 'hours'].includes(cs.timeout.unit)) return false
  }
  return Array.isArray(cs.email) ? cs.email.every((e) => e === 'success' || e === 'fail') : false
}

function actionIssues(s, source, out) {
  const a = s.action
  const u = s.uid
  const t = a.type
  if (!(isInt(t) && t >= 0 && t <= 15)) { out.push(issue('ACTION_TYPE_INVALID', u, { type: t })); return }
  if (t >= 1 && t <= 6 && storedValueEmpty(a)) out.push(issue('INHOUSE_VALUE_EMPTY', u))
  if (t >= 1 && t <= 3 && !(a.click && isInt(a.click.x) && isInt(a.click.y))) out.push(issue('CLICK_FORMAT', u))
  if (t === 4 && !(a.wheel && isInt(a.wheel.notches) && isInt(a.wheel.delaySec) && a.wheel.delaySec >= 0)) out.push(issue('WHEEL_FORMAT', u))
  if (t === 6 && !(isInt(a.waitSec) && a.waitSec >= 1)) out.push(issue('WAIT_FORMAT', u))
  if (t === 5) {
    const k = a.keyboard
    const codes = k ? [...(Array.isArray(k.keys) ? k.keys.map((x) => x && x.code) : [undefined]), ...(Array.isArray(k.unknownCodes) ? k.unknownCodes : [])] : []
    if (!k || typeof k.text !== 'string' || k.text.includes('@@') || codes.some((c) => !isInt(c))) out.push(issue('KEY_FORMAT', u))
  }
  if (t === 9) {
    const w = a.findWindow
    if (!w) out.push(issue(a.raw === '' || a.raw == null ? 'VALUE_REQUIRED' : 'FINDWINDOW_FORMAT', u))
    else {
      const bad = (v) => typeof v !== 'string' || v === '' || v.includes('@')
      const xs = w.x !== null && w.x !== undefined
      const ys = w.y !== null && w.y !== undefined
      if (bad(w.title) || bad(w.className) || xs !== ys || (xs && !(isInt(w.x) && isInt(w.y)))) out.push(issue('FINDWINDOW_FORMAT', u))
    }
  }
  if (t === 11 && (typeof a.command === 'string' ? a.command === '' : (a.raw ?? '') === '')) out.push(issue('VALUE_REQUIRED', u))
  if (t === 12) {
    if (!a.customScript) { if ((a.raw ?? '') === '') out.push(issue('VALUE_REQUIRED', u)); else out.push(issue('SCRIPT_FORMAT', u)) }
    else if (!customScriptOk(a.customScript)) out.push(issue('SCRIPT_FORMAT', u))
  }
  if (PRESERVE_ONLY.has(t)) {
    const old = s.origin !== null && source && editedFromSkeleton(source).steps[s.origin]
    const same = old && old.action.type === t && (old.action.raw ?? '') === (a.raw ?? '') && JSON.stringify(old.action.native ?? null) === JSON.stringify(a.native ?? null)
    if (!same) out.push(issue('ACTION_NOT_CREATABLE', u, { type: t }))
  }
}

function otherIssues(s, ctx, out) {
  const u = s.uid
  const max = ctx.user && [1, 2].includes(ctx.user.authorityManager) ? 200 : 20
  const r = s.retry || {}
  if (!(isInt(r.limit) && r.limit >= 0 && r.limit <= max) || !(isInt(r.intervalMs) && r.intervalMs >= 2000)) out.push(issue('RETRY_RANGE', u, { max }))
  const d = s.descriptionToEmail
  if (typeof d !== 'string' || d.trim() === '') out.push(issue('STEP_DESC_EMPTY', u))
  else if (d.includes('@') || d.includes('$')) out.push(issue('STEP_DESC_CHARS', u))
  if (s.next && s.next.onFalse && s.next.onFalse.kind === 'next' && CAN_FAIL_ACTIONS.has(s.action.type)) out.push(issue('FALSE_NEXT_WITH_ACTION', u))
}

function stepRules(edited, source, ctx) {
  const out = []
  for (const s of edited.steps) {
    conditionIssues(s, out)
    actionIssues(s, source, out)
    otherIssues(s, ctx, out)
  }
  return out
}

module.exports = { stepRules }
