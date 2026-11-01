'use strict'
// 저장 형식 문자열을 구조화 값으로 푼다(브라우저는 문자열을 직접 풀지 않는다 — P1-3 결정).
// 형식 근거: 분석 01 §3.6·§3.8, 11 §2.4~§2.9.
const { OCR_OPERATION_NAMES, SCRIPT_TYPE_NAMES, KEY_CODE_NAMES, nameOf } = require('./enums')

const note = (level, code, params = {}) => ({ level, code, params })
const INT = /^-?\d+$/

function parseImageMulti(textValue, notes) {
  const raw = textValue ?? ''
  if (raw === '') return { count: '1', op: 0, raw }
  const t = raw.split('-')
  if (t.length !== 2 || !/^\d+$/.test(t[1])) {
    notes.push(note('warning', 'PARSE_FAILED', { field: 'imageMulti', raw }))
    return { count: t[0], op: null, raw }
  }
  return { count: t[0], op: Number(t[1]), raw }
}

function parseOcrText(textValue, notes) {
  const v = textValue ?? ''
  const i = v.indexOf('@@@@')
  if (i < 0) return { text: v, multi: null }
  const tail = v.slice(i + 4)
  const t = tail.split('-')
  const ok = t.length === 2 && /^\d+$/.test(t[1])
  if (!ok) notes.push(note('warning', 'PARSE_FAILED', { field: 'ocrMulti', raw: tail }))
  return { text: v.slice(0, i), multi: { count: t[0] ?? '', op: ok ? Number(t[1]) : null, raw: tail } }
}

function parseEqpState(expr, notes) {
  const raw = expr ?? ''
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

function parseAction(step, conditionKind) {
  const notes = []
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
      if (m) action.click = { x: Number(m[1]), y: Number(m[2]), basis: conditionKind === 'image' ? 'trainImage' : 'absolute' }
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

module.exports = { note, parseCondition, parseAction, parseImageMulti, parseOcrText, parseEqpState }
