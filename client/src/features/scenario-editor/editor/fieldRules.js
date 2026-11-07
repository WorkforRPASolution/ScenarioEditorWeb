// 스텝 칸 검사 — 서버 규칙(server/.../domain/rules/stepRules.js)의 빠른 사전 검사. code·기준값은 서버와 같고, 서버가 권위다.
// 결과: { [칸]: { code, params, level: 'error' | 'notice' } }. notice = 옛 값이라 칸 오류가 아니라 패널 안내로만 보인다(적용을 막지 않는다).
// 문구는 messages.js 의 RULE_<code>. 저장 형식 문자열은 만들지 않고 구조화 값만 본다.
import { sameStep } from './diff'

const isInt = (v) => typeof v === 'number' && Number.isInteger(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const CLICKS = [1, 2, 3]
const TEXT_OPS = [1, 2, 3, 4]
const NUMBER_OPS = [5, 6, 9, 10]
const RANGE_OPS = [7, 8]
// 서버 hasImage 의 브라우저판: 참조 또는 공백을 뺀 길이 4 초과의 base64 literal
const isRef = (b) => !!b && typeof b === 'object' && 'from' in b
const hasImage = (b) => isRef(b) || (!!b && typeof b === 'object' && typeof b.literal === 'string' && b.literal.replace(/\s+/g, '').length > 4)

// 조립이 쓸 키 코드 목록(서버 keyboardCodes 와 같은 고르기)
function keyboardCodes(k) {
  if (k.codes !== undefined) return Array.isArray(k.codes) ? k.codes : null
  if (!Array.isArray(k.keys) || !Array.isArray(k.unknownCodes)) return null
  return [...k.keys.map((x) => x && x.code), ...k.unknownCodes]
}

function customScriptOk(cs) {
  if (!cs || typeof cs.name !== 'string' || cs.name === '' || cs.name.includes(';')) return false
  const args = Array.isArray(cs.args) ? cs.args : null
  if (!args || args.some((a) => typeof a !== 'string' || a.includes(';') || a.startsWith('@@'))) return false
  const hasOptions = (cs.timeout !== null && cs.timeout !== undefined) || (Array.isArray(cs.email) && cs.email.length > 0)
  if (cs.legacy && !hasOptions && (cs.name.includes('@') || args.some((a) => a.includes('@')))) return false
  if (cs.timeout !== null && cs.timeout !== undefined) {
    if (!isInt(cs.timeout.value) || cs.timeout.value < 1 || !['seconds', 'minutes', 'hours'].includes(cs.timeout.unit)) return false
  }
  return Array.isArray(cs.email) ? cs.email.every((e) => e === 'success' || e === 'fail') : false
}

// 정확도 0.5~1. 숫자가 아니면 서버도 ACCEPT_TOO_HIGH(문구 "0.5~1 사이 숫자"). 표 칸 바로 고치기도 쓴다.
export function acceptCode(acc) {
  if (isNum(acc) && acc < 0.5) return 'ACCEPT_TOO_LOW'
  if (!isNum(acc) || acc > 1) return 'ACCEPT_TOO_HIGH'
  return null
}

export function checkStepFields(step, { working, isNew, base, user } = {}) {
  const e = {}
  const put = (field, code, params = {}, level = 'error') => { if (!e[field]) e[field] = { code, params, level } }
  const c = step.condition || {}
  const a = step.action || {}
  const t = a.type

  const d = step.descriptionToEmail
  if (typeof d !== 'string' || d.trim() === '') put('desc', 'STEP_DESC_EMPTY')
  else if (d.includes('@') || d.includes('$')) put('desc', 'STEP_DESC_CHARS')

  if (c.kind === 'image' || c.kind === 'ocr') {
    const r = c.searchArea
    if (!r || ![r.x, r.y, r.w, r.h].every(isInt) || r.w < 1 || r.h < 1) put('area', 'AREA_INVALID')
    const multi = c.kind === 'image' ? c.image?.multi : c.ocr?.multi
    const ok = multi && typeof multi === 'object'
    const n = ok && typeof multi.count === 'string' && /^\d+$/.test(multi.count) ? Number(multi.count) : null
    const countOk = n !== null && n >= (c.kind === 'image' ? 1 : 0) && n <= 20
    if (!countOk || ![0, 1, 2].includes(multi.op)) put('multi', 'MULTI_RANGE')
    if (c.kind === 'image') {
      const accErr = acceptCode(c.image?.accept)
      if (accErr) put('accept', accErr)
      if (!Object.values(step.images?.train || {}).some(hasImage)) put('train', 'TRAIN_IMAGE_MISSING')
      if (countOk && n > 1 && t !== 0) put('action', 'MULTI_WITH_ACTION')
    } else {
      const o = c.ocr || {}
      if (!(isInt(o.op) && o.op >= 1 && o.op <= 10)) put('ocrOp', 'OCR_OP_REQUIRED')
      else {
        if (TEXT_OPS.includes(o.op) && (typeof o.text !== 'string' || o.text === '' || o.text.includes('@@@@') || o.text.endsWith('@'))) put('ocrVal', 'OCR_TEXT_FORMAT')
        if (NUMBER_OPS.includes(o.op) && !isNum(o.number)) put('ocrVal', 'OCR_NUMBER_REQUIRED')
        if (RANGE_OPS.includes(o.op) && !(isNum(o.min) && isNum(o.max))) put('ocrVal', 'OCR_NUMBER_REQUIRED')
      }
    }
  }

  // OCR·조건 없음 + 클릭: 그 스텝을 바꾸지 않았으면 옛 값이라 안내만(목업 !same(S.base, d))
  if ((c.kind === 'ocr' || c.kind === 'none') && CLICKS.includes(t)) {
    put('action', c.kind === 'ocr' ? 'OCR_MOUSE_CLICK' : 'NONE_MOUSE_CLICK', {}, base && sameStep(base, step) ? 'notice' : 'error')
  }
  if (CLICKS.includes(t) && !(a.click && isInt(a.click.x) && isInt(a.click.y))) put('click', 'CLICK_FORMAT')
  if (t === 4 && !(a.wheel && isInt(a.wheel.notches) && isInt(a.wheel.delaySec) && a.wheel.delaySec >= 0)) put('wheel', 'WHEEL_FORMAT')
  if (t === 6 && !(isInt(a.waitSec) && a.waitSec >= 1)) put('wait', 'WAIT_FORMAT')
  if (t === 5) {
    const k = a.keyboard
    const codes = k ? keyboardCodes(k) : null
    if (!k || typeof k.text !== 'string' || k.text.includes('@@') || !codes || codes.some((x) => !isInt(x)) || (codes.length > 0 && k.text.endsWith('@'))) put('key', 'KEY_FORMAT')
    else if (k.text === '' && codes.length === 0) put('key', 'INHOUSE_VALUE_EMPTY')
  }
  if (t === 9) {
    const w = a.findWindow
    if (!w) put('fw', a.raw === '' || a.raw == null ? 'VALUE_REQUIRED' : 'FINDWINDOW_FORMAT')
    else {
      const bad = (v) => typeof v !== 'string' || v === '' || v.includes('@')
      const xs = w.x !== null && w.x !== undefined
      const ys = w.y !== null && w.y !== undefined
      if (bad(w.title) || bad(w.className) || xs !== ys || (xs && !(isInt(w.x) && isInt(w.y)))) put('fw', 'FINDWINDOW_FORMAT')
    }
  }
  if (t === 11 && (typeof a.command !== 'string' || a.command === '')) put('cmd', 'VALUE_REQUIRED')
  if (t === 12) {
    if (!a.customScript) put('script', (a.raw ?? '') === '' ? 'VALUE_REQUIRED' : 'SCRIPT_FORMAT')
    else if (!customScriptOk(a.customScript)) put('script', 'SCRIPT_FORMAT')
  }

  // 갈 곳. 새 스텝은 아직 목록에 없어 마지막이 아니다(목업 idx = isNew ? -1).
  const steps = working?.steps || []
  const idx = isNew ? -1 : steps.findIndex((s) => s.uid === step.uid)
  const known = new Set(steps.map((s) => s.uid))
  for (const which of ['onTrue', 'onFalse']) {
    const tg = step.next?.[which]
    if (!tg) continue
    if (tg.kind === 'step' && tg.uid === step.uid) put(which, 'NEXT_SELF', { which })
    else if (tg.kind === 'step' && !known.has(tg.uid)) put(which, 'NEXT_UNRESOLVED', { which })
    // 다른 시나리오에서 붙여 온 미해결은 원래 번호를 실어 칸 문구가 "원래 N번" 을 보이게 한다(목업 validate). 모르면 싣지 않는다.
    else if (tg.kind === 'unresolved') put(which, 'NEXT_UNRESOLVED', tg.value === undefined || tg.value === null ? { which } : { which, value: tg.value })
    else if (tg.kind === 'next' && idx >= 0 && idx === steps.length - 1) put(which, 'LAST_STEP_NEXT', { which })
  }

  const max = user && [1, 2].includes(user.authorityManager) ? 200 : 20
  const r = step.retry || {}
  if (!(isInt(r.limit) && r.limit >= 0 && r.limit <= max) || !(isInt(r.intervalMs) && r.intervalMs >= 2000)) put('retry', 'RETRY_RANGE', { max })
  return e
}
