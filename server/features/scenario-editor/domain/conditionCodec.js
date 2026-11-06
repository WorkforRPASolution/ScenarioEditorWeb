'use strict'
// 저장 형식 문자열을 구조화 값으로 푼다(브라우저는 문자열을 직접 풀지 않는다 — P1-3 결정).
// 형식 근거: 분석 01 §3.6·§3.8, 11 §2.4~§2.9.
const { OCR_OPERATION_NAMES, SCRIPT_TYPE_NAMES, KEY_CODE_NAMES, nameOf } = require('./enums')
const { newRawStep } = require('./csDefaults')

const note = (level, code, params = {}) => ({ level, code, params })
const INT = /^-?\d+$/
const DEFAULT_MULTI = Object.freeze({ count: '1', op: 0, raw: '' }) // 사내 기본값(MainWindow.xaml.cs:1186-1196)

// 저장 문자열 필드를 읽는다. null·없음은 빈 값, 문자열이 아닌 값은 빈 값으로 보되 해석 실패 경고를 단다.
function stringField(value, field, notes) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  notes.push(note('warning', 'PARSE_FAILED', { field }))
  return ''
}

function parseImageMulti(textValue, notes) {
  const raw = stringField(textValue, 'TextValue', notes)
  if (raw === '') return { ...DEFAULT_MULTI }
  const t = raw.split('-')
  if (t.length !== 2 || !/^\d+$/.test(t[1])) {
    notes.push(note('warning', 'PARSE_FAILED', { field: 'imageMulti', raw }))
    return { count: t[0], op: null, raw }
  }
  return { count: t[0], op: Number(t[1]), raw }
}

function parseOcrText(textValue, notes) {
  const v = stringField(textValue, 'TextValue', notes)
  const i = v.indexOf('@@@@')
  if (i < 0) return { text: v, multi: { ...DEFAULT_MULTI } }
  const tail = v.slice(i + 4)
  const t = tail.split('-')
  const ok = t.length === 2 && /^\d+$/.test(t[1])
  if (!ok) notes.push(note('warning', 'PARSE_FAILED', { field: 'ocrMulti', raw: tail }))
  return { text: v.slice(0, i), multi: { count: t[0] ?? '', op: ok ? Number(t[1]) : null, raw: tail } }
}

function parseEqpState(expr, notes) {
  const raw = stringField(expr, 'ConditionExpression', notes)
  const t = raw.split(',')
  if (t.length !== 3) {
    notes.push(note('warning', 'PARSE_FAILED', { field: 'eqpState', raw }))
    return { target: null, targetKind: 'unknown', state: null, code: null, raw }
  }
  const blank = (s) => (s === '_' ? '' : s)
  const target = t[0]
  const targetKind = target === 'MAIN' ? 'main'
    : target.length === 1 ? 'chamber'
      : target.length >= 2 && target.startsWith('B') ? 'loadport' : 'unknown'
  return { target, targetKind, state: blank(t[1]), code: blank(t[2]), raw }
}

function parseCondition(step) {
  const notes = []
  if (!step || typeof step !== 'object') {
    notes.push(note('warning', 'PARSE_FAILED', { field: 'step' }))
    return { condition: { kind: 'unknown', operationRaw: null, skipPreprocessing: null }, notes }
  }
  const op = step.Operation
  const kind = op === 0 ? 'none' : op === 1 ? 'image' : op === 2 ? 'ocr' : op === 4 ? 'eqpState' : 'unknown'
  if (kind === 'unknown') notes.push(note('warning', 'CONDITION_UNKNOWN', { operation: op }))
  const condition = { kind, operationRaw: op, skipPreprocessing: null }
  const md = step.Metadata
  if (!md || typeof md !== 'object') {
    notes.push(note('warning', 'PARSE_FAILED', { field: 'metadata' }))
    return { condition, notes }
  }
  const expr = md.ConditionExpression
  if (kind !== 'eqpState') condition.skipPreprocessing = expr === 'SkipPreprocessing'
  if (kind === 'image' || kind === 'ocr') {
    const a = md.SearchArea || {}
    condition.searchArea = { x: a.X, y: a.Y, w: a.Width, h: a.Height }
  }
  if (kind === 'image') {
    const isp = md.ImageSearchParam || {}
    const map = isp.TrainImageMap || {}
    condition.image = {
      accept: isp.AcceptThreshold, maxFind: isp.MaximumNumberToFind, timeoutEnabled: isp.TimeoutEnabled, timeout: isp.Timeout,
      trainImages: Object.entries(map).map(([k, ti]) => ({ key: Number(k), type: ti ? ti.Type : null })),
      multi: parseImageMulti(md.OcrParamInfo ? md.OcrParamInfo.TextValue : '', notes)
    }
  }
  if (kind === 'ocr') {
    const o = md.OcrParamInfo || {}
    const { text, multi } = parseOcrText(o.TextValue, notes)
    condition.ocr = {
      op: o.Operation, opName: nameOf(OCR_OPERATION_NAMES, o.Operation), type: o.Type, text,
      number: o.NumberValue, min: o.NumberRangeMin, max: o.NumberRangeMax, minMatching: o.MinMatchingValue, multi, raw: o.TextValue
    }
    if (o.Operation === 0) notes.push(note('warning', 'OCR_OP_NONE'))
  }
  if (kind === 'eqpState') {
    if (expr === 'SkipPreprocessing') {
      notes.push(note('info', 'EQPSTATE_SKIP_PREPROCESSING'))
      condition.eqpState = null
    } else {
      condition.eqpState = parseEqpState(expr, notes)
    }
  }
  return { condition, notes }
}

const NEEDS_VALUE = new Set([9, 11, 12]) // FindWindow·RunCommand·CustomScript (Q-016)
const NOT_IN_COMBO = new Set([7, 8, 13, 14, 15]) // Variable·OICommand·FAP·ACS·NativeFunction (사내 콤보에 없거나 비활성)

// 클릭 좌표 기준: 이미지는 학습 이미지 왼쪽 위, 조건 없음은 판정 서버가 (0,0) 을 돌려줘 화면 왼쪽 위(SE-023)
const CLICK_BASIS = { image: 'trainImage', none: 'screenOrigin' }
const TIMEOUT_UNITS = ['seconds', 'minutes', 'hours']
const EMAIL_VALUES = ['success', 'fail']

// 사용자 스크립트(12): `이름;인자…[;@@옵션]` 또는 옛 형식 `이름@인자…`. 에이전트 ScenarioManager.scala:236-288.
// 에이전트는 옵션 값이 틀리면 예외를 내므로 웹은 해석 실패로 둔다.
function parseCustomScript(v) {
  if (!v.includes(';')) {
    const [name, ...args] = v.split('@')
    return { name, args, timeout: null, email: [], legacy: true }
  }
  const tokens = v.split(';')
  const name = tokens.shift()
  let timeout = null
  const email = []
  if (tokens[tokens.length - 1].startsWith('@@')) {
    for (const opt of tokens.pop().slice(2).split(',')) {
      const [key, val, ...extra] = opt.split(':')
      const m = key === 'timeout' && extra.length === 0 ? /^(\d+) (\w+)$/.exec(val || '') : null
      if (m && TIMEOUT_UNITS.includes(m[2])) timeout = { value: Number(m[1]), unit: m[2] }
      else if (key === 'email' && extra.length === 0 && EMAIL_VALUES.includes(val)) email.push(val)
      else return null
    }
  }
  if (tokens.length === 1 && tokens[0] === '') tokens.length = 0 // `이름;` 은 인자 없음
  return { name, args: tokens, timeout, email, legacy: false }
}

function parseAction(step, conditionKind) {
  const notes = []
  if (!step || typeof step !== 'object') {
    notes.push(note('warning', 'PARSE_FAILED', { field: 'step' }))
    return { action: { type: null, typeName: null, raw: null }, notes }
  }
  const s = step.Script
  if (!s || typeof s !== 'object') {
    notes.push(note('warning', 'PARSE_FAILED', { field: 'script' }))
    return { action: { type: null, typeName: null, raw: null }, notes }
  }
  const t = s.Type
  const v = typeof s.Value === 'string' ? s.Value : ''
  const action = { type: t, typeName: nameOf(SCRIPT_TYPE_NAMES, t), raw: v }
  if (action.typeName === null) {
    notes.push(note('warning', 'ACTION_INVALID', { type: t }))
    return { action, notes }
  }
  if (NOT_IN_COMBO.has(t)) notes.push(note('info', 'ACTION_NOT_IN_COMBO', { type: t }))
  if (NEEDS_VALUE.has(t) && v === '') notes.push(note('warning', 'VALUE_EMPTY', { type: t }))
  const fail = (field) => notes.push(note('warning', 'PARSE_FAILED', { field, raw: v }))
  switch (t) {
    case 1: case 2: case 3: {
      const m = /^(-?\d+):(-?\d+)$/.exec(v)
      if (m) action.click = { x: Number(m[1]), y: Number(m[2]), basis: CLICK_BASIS[conditionKind] || 'unknown' }
      else fail('click')
      if (conditionKind === 'ocr') notes.push(note('warning', 'OCR_WITH_MOUSE_CLICK'))
      break
    }
    case 4: {
      const m = /^([+-]?\d+)@@(\d+)$/.exec(v)
      if (m) action.wheel = { notches: Number(m[1]), delaySec: Number(m[2]) }
      else fail('wheel')
      break
    }
    case 5: {
      const [text, ...codes] = v.split('@@')
      const keys = []
      const unknownCodes = []
      let bad = false
      for (const c of codes) {
        if (!INT.test(c)) { bad = true; continue }
        const code = Number(c)
        if (KEY_CODE_NAMES[code]) keys.push({ code, name: KEY_CODE_NAMES[code] })
        else unknownCodes.push(code)
      }
      if (bad) fail('keyboard')
      if (unknownCodes.length) notes.push(note('info', 'KEY_CODE_UNKNOWN', { codes: unknownCodes }))
      action.keyboard = { text, keys, unknownCodes }
      break
    }
    case 6:
      if (/^\d+$/.test(v)) action.waitSec = Number(v) / 1000
      else fail('wait')
      break
    case 8: {
      const body = v.split('@COMMENT:')[0]
      const tk = body.split('@')
      if (tk[0] === 'EQP_DOWN') action.oiCommand = { command: 'EQP_DOWN', code: tk[1] ?? null, chamber: tk[2] ?? null }
      else if (tk[0] === 'RUNDOWN_RELEASE') action.oiCommand = { command: 'RUNDOWN_RELEASE', code: null, chamber: tk[1] ?? null }
      else action.oiCommand = { command: body, code: null, chamber: null }
      break
    }
    case 9: {
      // 에이전트(scala:290-301)는 4토큰일 때만 좌표를 쓰고 아니면 200·200 — 웹은 그 밖을 해석 실패로 보여 고칠 때 다시 입력받는다
      const tk = v.split('@')
      if (v === '') break
      if (tk.length === 2) action.findWindow = { title: tk[0], className: tk[1], x: null, y: null }
      else if (tk.length === 4 && INT.test(tk[2]) && INT.test(tk[3])) action.findWindow = { title: tk[0], className: tk[1], x: Number(tk[2]), y: Number(tk[3]) }
      else fail('findWindow')
      break
    }
    case 11:
      action.command = v
      break
    case 12: {
      if (v === '') break
      const cs = parseCustomScript(v)
      if (cs) action.customScript = cs
      else fail('customScript')
      break
    }
    case 13: {
      const tk = v.split('@')
      if (tk.length === 4) action.fap = { ssbMessage: tk[0], pmCode: tk[1], mainChamber: tk[2], esopMacroId: tk[3] }
      else fail('fap')
      break
    }
    case 15: {
      const nf = s.NativeFunction
      if (nf && typeof nf === 'object') action.native = { functionName: nf.FunctionName, params: nf.Params || [], outputs: nf.Outputs || [] }
      else fail('native')
      break
    }
    default:
      break
  }
  return { action, notes }
}

// ---- 조립 방향: 구조화 값 → 저장 형식. 고치지 않은 스텝은 저장된 원본을 그대로 쓰므로 여기를 지나지 않는다. ----
const clone = (o) => JSON.parse(JSON.stringify(o))
const exprOf = (c) => (c.skipPreprocessing ? 'SkipPreprocessing' : '')
const TEXT_OPS = new Set([1, 2, 3, 4])
const RANGE_OPS = new Set([7, 8])

// base = 고치기 전 스텝의 Metadata(새 스텝이면 newRawStep(kind).Metadata). base 는 바꾸지 않는다.
function encodeCondition(condition, base, trainEntries) {
  const kind = condition.kind
  // image·ocr·none 밖(설비 상태는 보존 전용 Q-025, 알 수 없는 종류)은 고칠 수 없으므로 base 를 그대로 둔다
  if (kind !== 'image' && kind !== 'ocr' && kind !== 'none') return { Operation: kind === 'eqpState' ? 4 : condition.operationRaw, Metadata: base }
  const md = clone(base || newRawStep(kind === 'none' ? 'none' : kind).Metadata)
  md.ConditionExpression = exprOf(condition)
  if (kind === 'none') return { Operation: 0, Metadata: md }
  const a = condition.searchArea
  md.SearchArea = { X: a.x, Y: a.y, Width: a.w, Height: a.h }
  if (kind === 'image') {
    md.ImageSearchParam.AcceptThreshold = condition.image.accept
    md.ImageSearchParam.TrainImageMap = trainEntries
    md.OcrParamInfo.TextValue = `${condition.image.multi.count}-${condition.image.multi.op}`
    return { Operation: 1, Metadata: md }
  }
  const { op, text, number, min, max, multi } = condition.ocr
  const o = md.OcrParamInfo
  o.Operation = op
  o.Type = TEXT_OPS.has(op) ? 1 : 2
  o.TextValue = `${TEXT_OPS.has(op) ? text : ''}@@@@${multi.count}-${multi.op}`
  if (RANGE_OPS.has(op)) { o.NumberRangeMin = min; o.NumberRangeMax = max } else if (!TEXT_OPS.has(op)) o.NumberValue = number
  return { Operation: 2, Metadata: md }
}

function encodeCustomScript(cs) {
  const opts = []
  if (cs.timeout) opts.push(`timeout:${cs.timeout.value} ${cs.timeout.unit}`)
  for (const e of cs.email) opts.push(`email:${e}`)
  if (cs.legacy && opts.length === 0) return [cs.name, ...cs.args].join('@') // 옵션이 생기면 ; 형식으로 바뀐다
  if (cs.args.length === 0 && opts.length === 0) return `${cs.name};`
  return [cs.name, ...cs.args, ...(opts.length ? [`@@${opts.join(',')}`] : [])].join(';')
}

const KEEP_AS_IS = new Set([7, 8, 13, 14, 15]) // 보존 전용(사내 콤보에 없거나 비활성)

function encodeAction(action, base) {
  const t = action.type
  if (KEEP_AS_IS.has(t)) {
    return { Type: t, Value: base?.Value ?? '', NativeFunction: t === 15 ? base?.NativeFunction ?? null : null }
  }
  // 해석 실패·빈 값으로 구조화 값이 없거나 모르는 종류면 고칠 수 없다 — 같은 종류 base 를 보존하고 없으면 오류
  const FIELD = { 1: 'click', 2: 'click', 3: 'click', 4: 'wheel', 5: 'keyboard', 9: 'findWindow', 12: 'customScript' }
  const missing = (t in FIELD && !action[FIELD[t]]) || (t === 6 && typeof action.waitSec !== 'number') || (t === 11 && typeof action.command !== 'string') ||
    !(Number.isInteger(t) && t >= 0 && t <= 15)
  if (missing) {
    if (base && base.Type === t) return base
    throw new Error('ACTION_UNSTRUCTURED')
  }
  let value = ''
  switch (t) {
    case 1: case 2: case 3: value = `${action.click.x}:${action.click.y}`; break
    case 4: value = `${action.wheel.notches}@@${action.wheel.delaySec}`; break
    case 5: {
      // 알려진 키·모르는 코드 순서로 쓴다 — 둘이 섞여 저장된 값은 순서가 바뀐다(해석이 둘을 따로 모으므로)
      const k = action.keyboard
      value = k.text + [...k.keys.map((x) => x.code), ...k.unknownCodes].map((c) => `@@${c}`).join('')
      break
    }
    case 6: value = String(Math.round(action.waitSec * 1000)); break
    case 9: {
      const w = action.findWindow
      value = `${w.title}@${w.className}` + (w.x !== null && w.y !== null ? `@${w.x}@${w.y}` : '')
      break
    }
    case 10: value = base?.Value ?? ''; break
    case 11: value = action.command; break
    case 12: value = encodeCustomScript(action.customScript); break
    default: break
  }
  return { Type: t, Value: value, NativeFunction: null }
}

module.exports = { note, parseCondition, parseAction, encodeCondition, encodeAction, parseImageMulti, parseOcrText, parseEqpState }
