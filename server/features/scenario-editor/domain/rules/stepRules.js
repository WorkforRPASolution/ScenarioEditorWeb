'use strict'
// 스텝 값 검사. 사내 저장 검사(늘 막힘)와 웹이 더한 값 검사(고친 스텝만 막힘)를 함께 낸다 — 가르는 일은 index 가 RULES 로 한다.
const { CAN_FAIL_ACTIONS } = require('../enums')
const { encodeAction } = require('../conditionCodec')
const { editedFromSkeleton } = require('../editedScenario')
const { resolveOrigins } = require('../changeDetect')
const { issue, needsBase, isRef } = require('./scenarioRules')

const isInt = (v) => typeof v === 'number' && Number.isInteger(v)
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v)
const COUNT_RE = /^\d+$/
const PRESERVE_ONLY = new Set([7, 8, 13, 14, 15])
const TEXT_OPS = new Set([1, 2, 3, 4])
const NUMBER_OPS = new Set([5, 6, 9, 10])
const RANGE_OPS = new Set([7, 8])
const KEPT_CONDITIONS = new Set(['eqpState', 'unknown']) // 고칠 수 없어 저장값을 그대로 쓰는 조건 — 바탕 스텝이 있어야 조립할 수 있다

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
  // 네 값 모두 정수여야 한다 — 소수는 직렬화가 던지고, 빠진 x·y 는 C# 기본값(-18)으로 채워져 배포된다
  if (!a || ![a.x, a.y, a.w, a.h].every(isInt) || a.w < 1 || a.h < 1) out.push(issue('AREA_INVALID', u))
  // 다중 검사 값이 없거나 객체가 아니면 막는다 — 조립(encodeCondition)이 count·op 를 읽다 던지지 않게(해석은 늘 객체를 준다)
  const multi = c.kind === 'image' ? c.image && c.image.multi : c.ocr && c.ocr.multi
  const multiOk = multi !== null && typeof multi === 'object'
  const countOk = multiOk && typeof multi.count === 'string' && COUNT_RE.test(multi.count) && Number(multi.count) >= (c.kind === 'image' ? 1 : 0) && Number(multi.count) <= 20
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
      // 저장 형식 `문자열@@@@개수-연산` 을 첫 @@@@ 로 자른다 — 문자열이 @@@@ 를 품거나 @ 로 끝나면 다시 읽을 때 문자열·개수가 달라진다
      if (TEXT_OPS.has(o.op) && (typeof o.text !== 'string' || o.text === '' || o.text.includes('@@@@') || o.text.endsWith('@'))) out.push(issue('OCR_TEXT_FORMAT', u))
      if (NUMBER_OPS.has(o.op) && !isFiniteNum(o.number)) out.push(issue('OCR_NUMBER_REQUIRED', u))
      if (RANGE_OPS.has(o.op) && !(isFiniteNum(o.min) && isFiniteNum(o.max))) out.push(issue('OCR_NUMBER_REQUIRED', u))
    }
  }
}

// 조립이 쓸 키 코드 목록(encodeAction 과 같은 고르기): codes 가 있으면 그것(배열이 아니면 null), 없으면 keys 다음 unknownCodes.
function keyboardCodes(k) {
  if (k.codes !== undefined) return Array.isArray(k.codes) ? k.codes : null
  if (!Array.isArray(k.keys) || !Array.isArray(k.unknownCodes)) return null
  return [...k.keys.map((x) => x && x.code), ...k.unknownCodes]
}

function customScriptOk(cs) {
  if (!cs || typeof cs.name !== 'string' || cs.name === '' || cs.name.includes(';')) return false
  const args = Array.isArray(cs.args) ? cs.args : null
  if (!args || args.some((a) => typeof a !== 'string' || a.includes(';') || a.startsWith('@@'))) return false
  // 옵션 없는 옛 형식은 `이름@인자…` 로 쓰므로 이름·인자의 @ 는 다시 읽을 때 토큰을 가른다(옵션이 있으면 ; 형식으로 바뀌어 상관없다)
  const hasOptions = (cs.timeout !== null && cs.timeout !== undefined) || (Array.isArray(cs.email) && cs.email.length > 0)
  if (cs.legacy && !hasOptions && (cs.name.includes('@') || args.some((a) => a.includes('@')))) return false
  if (cs.timeout !== null && cs.timeout !== undefined) {
    if (!isInt(cs.timeout.value) || cs.timeout.value < 1 || !['seconds', 'minutes', 'hours'].includes(cs.timeout.unit)) return false
  }
  return Array.isArray(cs.email) ? cs.email.every((e) => e === 'success' || e === 'fail') : false
}

// 설계 §1: 설비 상태 스텝은 새로 만들지 않는다(알 수 없는 조건도 같다 — 조립할 바탕이 없다). §4.2: 조건 종류는 바꿀 수 없다.
// 기준이 없는 스텝(새·붙여 넣기·중복 origin 은 resolveOrigins 가 null)과 기준 스텝을 같은 해석으로 본다.
function conditionKindIssues(s, baseSteps, origins, out) {
  const o = origins.get(s.uid)
  const old = o === null || o === undefined ? null : baseSteps[o]
  if (!old) { if (KEPT_CONDITIONS.has(s.condition.kind)) out.push(issue('CONDITION_NOT_CREATABLE', s.uid, { kind: s.condition.kind })) }
  else if (old.condition.kind !== s.condition.kind) out.push(issue('CONDITION_KIND_CHANGED', s.uid, { from: old.condition.kind, to: s.condition.kind }))
}

function actionIssues(s, baseSteps, origins, out) {
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
    const codes = k ? keyboardCodes(k) : null
    // 저장 형식 `문자열@@코드@@코드…` — 문자열의 @@ 나, 코드가 있을 때 끝 @(user@ + 10 → user@@@10 → 코드 "@10") 는 다시 읽을 때 갈림이 달라진다
    if (!k || typeof k.text !== 'string' || k.text.includes('@@') || !codes || codes.some((c) => !isInt(c)) || (codes.length > 0 && k.text.endsWith('@'))) out.push(issue('KEY_FORMAT', u))
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
  // 값 필요 동작(9·11·12)은 구조화 값으로 본다(조립은 raw 를 쓰지 않는다). 9·12 는 구조화 값이 없으면 raw 가 비었는지로 VALUE_REQUIRED·형식 오류를 가를 뿐 늘 막는다.
  if (t === 11 && (typeof a.command !== 'string' || a.command === '')) out.push(issue('VALUE_REQUIRED', u))
  if (t === 12) {
    if (!a.customScript) { if ((a.raw ?? '') === '') out.push(issue('VALUE_REQUIRED', u)); else out.push(issue('SCRIPT_FORMAT', u)) }
    else if (!customScriptOk(a.customScript)) out.push(issue('SCRIPT_FORMAT', u))
  }
  if (PRESERVE_ONLY.has(t)) {
    const o = origins.get(s.uid)
    const old = o !== null && o !== undefined && baseSteps[o]
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
  const baseSteps = source ? editedFromSkeleton(source).steps : []
  const origins = resolveOrigins(edited.steps, baseSteps.length)
  for (const s of edited.steps) {
    conditionIssues(s, out)
    conditionKindIssues(s, baseSteps, origins, out)
    actionIssues(s, baseSteps, origins, out)
    otherIssues(s, ctx, out)
  }
  return out
}

module.exports = { stepRules }
