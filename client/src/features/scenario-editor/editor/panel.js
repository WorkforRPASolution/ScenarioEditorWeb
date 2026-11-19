// 오른쪽 편집 패널의 순수 함수(목업 newAction·actionStation·fieldDiffs·sentence). 패널 초안은 EditedStep 그대로이고
// 동작·조건 값은 서버 conditionCodec parseAction·parseCondition 의 구조화 모양을 따른다. 저장 형식 문자열은 만들거나 풀지 않는다.
import { canonicalJson, sameStep, comparableStep } from './diff'
import { typeNameOf } from './display'
import { multiLabel } from '../format'
import { t, LABELS } from '../messages'

export const CLICK_TYPES = [1, 2, 3]
// 보존 전용(사내 콤보에 없거나 비활성): 변수·O.I. Command·FAP·ACS·에이전트 함수 — 서버 stepRules PRESERVE_ONLY
export const PRESERVE_ONLY = new Set([7, 8, 13, 14, 15])
// 고를 수 있는 동작(사내 콤보 11개, 목업 ACTION_ORDER): 없음·클릭 셋·휠·키보드·대기·창 찾기·명령 실행·사용자 스크립트·메일 보내기
export const ACTION_ORDER = [0, 1, 2, 3, 4, 5, 6, 9, 11, 12, 10]
// 실패를 돌려줄 수 있는 동작(서버 CAN_FAIL_ACTIONS)
export const CAN_FAIL = new Set([8, 9, 11, 12, 13, 14, 15])
// Java AWT KeyEvent 코드 → 이름(서버 enums KEY_CODE_NAMES 와 같다)
export const KEY_NAMES = Object.freeze({
  8: 'Backspace', 9: 'Tab', 10: 'Enter', 20: 'CapsLock', 27: 'Esc', 32: 'Space', 33: 'PgUp', 34: 'PgDn', 35: 'End', 36: 'Home',
  37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down', 112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6', 118: 'F7',
  119: 'F8', 120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12', 127: 'Delete', 154: 'PrintScreen', 155: 'Insert', 524: 'Win'
})
// 기능 키 고르기 순서(목업 KEYS)
export const FUNCTION_KEYS = [10, 9, 27, 32, 8, 127, 37, 38, 39, 40, 36, 35, 33, 34, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123]
export const KEY_MAX = 10
export const TIMEOUT_UNITS = ['seconds', 'minutes', 'hours']
// 서버 conditionCodec CLICK_BASIS
const CLICK_BASIS = { image: 'trainImage', none: 'screenOrigin' }

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isTrainKey = (k) => typeof k === 'string' && /^(0|[1-9]\d*)$/.test(k) && Number.isSafeInteger(Number(k))

// 입력 칸 글자 → 값. 빈 칸은 null, 숫자면 숫자, 아니면 친 글자 그대로(칸 검사가 형식 오류로 잡고 [적용]을 막는다).
export function numIn(text) {
  const s = String(text ?? '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : s
}
// 값 → 입력 칸 글자
export const numOut = (v) => (v === null || v === undefined ? '' : String(v))

// 동작 종류를 바꾼 초안의 동작. base = 마지막 적용 값(패널 기준) — 원래 종류로 돌아오면 원래 값을 쓴다. 클릭끼리는 좌표를 지킨다(목업 newAction).
export function newAction(type, draft, base) {
  const old = draft?.action ?? {}
  let a
  if (base?.action?.type === type) a = base.action
  else {
    const head = { type, typeName: typeNameOf(type) }
    switch (type) {
      case 1: case 2: case 3: a = { ...head, click: { x: null, y: null, basis: CLICK_BASIS[draft?.condition?.kind] ?? 'unknown' } }; break
      case 4: a = { ...head, wheel: { notches: 3, delaySec: 1 } }; break
      case 5: a = { ...head, keyboard: { text: '', keys: [], unknownCodes: [], codes: [] } }; break
      case 6: a = { ...head, waitSec: 5 }; break
      case 9: a = { ...head, findWindow: { title: '', className: '', x: null, y: null } }; break
      case 11: a = { ...head, command: '' }; break
      case 12: a = { ...head, customScript: { name: '', args: [], timeout: null, email: [], legacy: false } }; break
      default: a = head
    }
  }
  if (CLICK_TYPES.includes(type) && CLICK_TYPES.includes(old.type) && old.click && canonicalJson(old.click) !== canonicalJson(a.click)) a = { ...a, click: old.click }
  return a
}

// 키 코드 목록(누르는 순서 그대로, 조립의 정본). 없으면 옛 모양(알려진 키 다음 모르는 코드).
export const keyboardCodesOf = (k) => (Array.isArray(k?.codes) ? k.codes : [...(k?.keys ?? []).map((x) => x.code), ...(k?.unknownCodes ?? [])])
// 코드 목록을 바꾸고 보여 주기용 keys·unknownCodes 를 같은 규칙(서버 parseAction)으로 다시 만든다.
export function withCodes(keyboard, codes) {
  const keys = []
  const unknownCodes = []
  for (const code of codes) {
    if (KEY_NAMES[code]) keys.push({ code, name: KEY_NAMES[code] })
    else unknownCodes.push(code)
  }
  return { ...keyboard, codes, keys, unknownCodes }
}
export const keyName = (code) => KEY_NAMES[code] ?? String(code)

export function multiCount(condition) {
  const m = condition?.kind === 'image' ? condition.image?.multi : condition?.kind === 'ocr' ? condition.ocr?.multi : null
  return m && typeof m.count === 'string' && /^\d+$/.test(m.count) ? Number(m.count) : null
}

// 고를 수 없는 동작이면 이유 문구 키. 이미지가 아니면 마우스 클릭 셋(목업 CLICK_BLOCKED), 이미지 다중 검사 2개 이상이면 없음 밖 전부.
export function actionBlocked(type, condition) {
  const kind = condition?.kind
  if (CLICK_TYPES.includes(type) && kind !== 'image') return ['ocr', 'none', 'eqpState'].includes(kind) ? `SEW_PANEL_CLICK_BLOCKED_${kind}` : 'SEW_PANEL_CLICK_BLOCKED_other'
  if (kind === 'image' && (multiCount(condition) ?? 1) > 1 && type !== 0) return 'SEW_PANEL_MULTI_NO_ACTION'
  return null
}

// 칸 검사 결과에서 레일 순서로 첫 오류 칸. 안내(notice)는 막지 않는다.
export const FIELD_ORDER = ['desc', 'area', 'train', 'accept', 'multi', 'ocrOp', 'ocrVal', 'action', 'click', 'wheel', 'key', 'wait', 'fw', 'cmd', 'script', 'onTrue', 'onFalse', 'retry']
export function firstError(errs) {
  const bad = Object.keys(errs || {}).filter((f) => errs[f]?.level === 'error')
  if (!bad.length) return null
  return bad.sort((a, b) => (FIELD_ORDER.indexOf(a) + 1 || 99) - (FIELD_ORDER.indexOf(b) + 1 || 99))[0]
}
export const errorFields = (errs) => Object.keys(errs || {}).filter((f) => errs[f]?.level === 'error')

// 패널이 칸 오류·안내로 직접 보이는 code — 표시 스텝의 알림 가운데 이것들은 패널 알림 줄에서 뺀다(같은 말이 두 번 나오지 않게,
// 고치는 중인 값과 어긋난 낡은 알림이 남지 않게). checkStepFields 가 내는 code 와 목업 rowNotesFor 가 대신하는 서버 알림.
export const PANEL_OWN_CODES = new Set([
  'STEP_DESC_EMPTY', 'STEP_DESC_CHARS', 'AREA_INVALID', 'AREA_FIELD_EMPTY', 'AREA_NOT_INTEGER', 'AREA_SIZE_MIN', 'AREA_NEGATIVE', 'AREA_TOO_LARGE', 'AREA_OUT_RIGHT', 'AREA_OUT_BOTTOM', 'MULTI_RANGE', 'ACCEPT_TOO_LOW', 'ACCEPT_TOO_HIGH', 'TRAIN_IMAGE_MISSING', 'MULTI_WITH_ACTION',
  'OCR_OP_REQUIRED', 'OCR_TEXT_FORMAT', 'OCR_NUMBER_REQUIRED', 'OCR_MOUSE_CLICK', 'NONE_MOUSE_CLICK', 'CLICK_FORMAT', 'WHEEL_FORMAT', 'WAIT_FORMAT',
  'KEY_FORMAT', 'INHOUSE_VALUE_EMPTY', 'FINDWINDOW_FORMAT', 'VALUE_REQUIRED', 'SCRIPT_FORMAT', 'NEXT_SELF', 'NEXT_UNRESOLVED', 'LAST_STEP_NEXT', 'RETRY_RANGE',
  'OCR_WITH_MOUSE_CLICK', 'NONE_WITH_MOUSE_CLICK', 'ACTION_NOT_IN_COMBO', 'FALSE_NEXT_WITH_ACTION'
])

// R-T6a: 고친 이미지 스텝은 서버가 images.train 으로 찾을 그림 표를 다시 만든다 — 저장된 표의 정규 정수가 아닌 키·빈 값 항목은 빠진다.
// 저장된 raw 객체의 키·값만 본다(문자열을 풀지 않는다). skStep = 같은 uid 의 뼈대 스텝.
export function trainMapDropped(skStep) {
  const map = skStep?.raw?.Metadata?.ImageSearchParam?.TrainImageMap
  return isObject(map) && Object.entries(map).some(([k, v]) => !isTrainKey(k) || !isObject(v))
}
// R-T6a: 서버가 키보드 저장 값의 토큰을 해석하지 못했으면(PARSE_FAILED keyboard) 고쳐 조립할 때 그 토큰이 빠진다.
export const keyboardTokensDropped = (skStep) => (skStep?.notes ?? []).some((n) => n.code === 'PARSE_FAILED' && n.params?.field === 'keyboard')

// ── 바뀐 값(목업 fieldDiffs) ──
const FIELDS = [
  ['desc', (s) => s.descriptionToEmail],
  // 영역 칸에 잘못 쳐 따로 쥔 글자(areaTyped — editor/areaInput.js)도 영역이 바뀐 것으로 센다
  ['area', (s) => (s.condition?.areaTyped ? [s.condition.searchArea, s.condition.areaTyped] : s.condition?.searchArea)],
  ['train', (s) => s.images?.train],
  ['base', (s) => s.images?.base],
  ['accept', (s) => s.condition?.image?.accept],
  ['multi', (s) => s.condition?.image?.multi ?? s.condition?.ocr?.multi],
  ['ocr', (s) => (s.condition?.ocr ? { ...s.condition.ocr, multi: undefined } : undefined)],
  ['action', (s) => s.action],
  ['onTrue', (s) => s.next?.onTrue],
  ['onFalse', (s) => s.next?.onFalse],
  ['retry', (s) => s.retry],
  ['skip', (s) => s.condition?.skipPreprocessing]
]
// across = { baseSource, draftSource, fps }: 두 스텝의 출처 판이 다를 수 있을 때(저장 창 — 저장 기준점과 작업본) 그림을 내용 지문으로 견준다(SEW-019, editor/diff comparableStep).
// 없으면 같은 출처로 보고 참조 그대로(스텝 패널 — 연 때의 스텝과 고치는 중인 스텝).
export function changedFields(base, draft, across = null) {
  if (!base || !draft || base === draft) return []
  const a = across ? comparableStep(base, across.baseSource, across.fps) : base
  const b = across ? comparableStep(draft, across.draftSource, across.fps) : draft
  const out = FIELDS.filter(([, get]) => canonicalJson(get(a)) !== canonicalJson(get(b))).map(([f]) => f)
  if (!out.length && !sameStep(a, b)) out.push('other')
  return out
}

const none = () => t('SEW_PANEL_NONE')
const rectText = (r) => (r ? `${r.x}, ${r.y}, ${r.w}×${r.h}` : none())
const acceptText = (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : String(v ?? '') || none())
export const actionName = (a) => LABELS.action[typeNameOf(a?.type) ?? a?.typeName] ?? t('SEW_PANEL_ACT_UNKNOWN')
export function ocrText(o) {
  if (!o) return none()
  const op = LABELS.ocrOp[o.opName] ?? String(o.op ?? '')
  // 비교를 고르지 않았거나(0) 모르는 비교면 값을 붙이지 않는다 — 저장된 숫자 0 이 "선택 안 함 0" 으로 보인다
  const v = o.op >= 1 && o.op <= 4 ? o.text : o.op === 7 || o.op === 8 ? `${o.min ?? ''} ~ ${o.max ?? ''}` : o.op >= 5 && o.op <= 10 ? o.number : ''
  return `${op} ${v ?? ''}`.trim()
}
// 바뀐 값 줄의 동작 글. 패널에서 고칠 수 있는 하위 칸을 모두 싣는다 — 빠진 칸만 바꾸면 이전·지금이 같은 글이 된다("스크립트 S → 스크립트 S").
const has = (v) => v !== null && v !== undefined && v !== ''
function wheelText(name, w) {
  const head = t('SEW_PANEL_ACT_TEXT_WHEEL', { name, dir: t(typeof w?.notches === 'number' && w.notches < 0 ? 'SEW_PANEL_WHEEL_UP' : 'SEW_PANEL_WHEEL_DOWN'), n: Math.abs(Number(w?.notches)) || w?.notches })
  return has(w?.delaySec) ? `${head} · ${w.delaySec}${t('SEW_PANEL_WHEEL_DELAY_UNIT')}` : head
}
function findWindowText(name, fw) {
  const out = [`${name} ${fw?.title || none()}`]
  if (has(fw?.className)) out.push(`${t('SEW_PANEL_FW_CLASS')} ${fw.className}`)
  if (has(fw?.x) || has(fw?.y)) out.push(t('SEW_PANEL_ACT_TEXT_FW_POS', { x: has(fw.x) ? fw.x : '?', y: has(fw.y) ? fw.y : '?' }))
  return out.join(' · ')
}
function customScriptText(name, cs) {
  const out = [`${name} ${cs?.name || none()}`]
  const args = Array.isArray(cs?.args) ? cs.args : []
  if (args.length) out.push(`${t('SEW_PANEL_CS_ARGS')} ${args.map((x) => (has(x) ? x : none())).join(', ')}`)
  if (cs?.timeout) out.push(`${t('SEW_PANEL_CS_TIMEOUT')} ${cs.timeout.value ?? '?'}${TIMEOUT_UNITS.includes(cs.timeout.unit) ? t(`SEW_PANEL_CS_UNIT_${cs.timeout.unit}`) : ` ${cs.timeout.unit ?? '?'}`}`)
  const email = (Array.isArray(cs?.email) ? cs.email : []).map((e) => (e === 'success' || e === 'fail' ? t(`SEW_PANEL_CS_EMAIL_${e}`) : String(e)))
  if (email.length) out.push(`${t('SEW_PANEL_CS_EMAIL')} ${email.join(', ')}`)
  return out.join(' · ')
}
export function actionText(a) {
  const name = actionName(a)
  switch (a?.type) {
    case 1: case 2: case 3: return `${name} (${a.click?.x ?? '?'}, ${a.click?.y ?? '?'})`
    case 4: return wheelText(name, a.wheel)
    case 5: return `${name} ${[a.keyboard?.text, ...keyboardCodesOf(a.keyboard).map(keyName)].filter(Boolean).join(' + ') || none()}`
    case 6: return t('SEW_PANEL_ACT_TEXT_WAIT', { name, s: a.waitSec ?? '?' })
    case 9: return findWindowText(name, a.findWindow)
    case 11: return `${name} ${a.command || none()}`
    case 12: return customScriptText(name, a.customScript)
    default: return name
  }
}
// 갈 곳 글자(번호는 작업본 위치)
export function targetText(tg, working) {
  if (!tg) return '—'
  if (tg.kind === 'next') return 'NEXT'
  if (tg.kind === 'end') return tg.value
  if (tg.kind === 'step') {
    const n = (working?.steps ?? []).findIndex((s) => s.uid === tg.uid) + 1
    return n > 0 ? t('SEW_CMD_TARGET_STEP', { no: n }) : t('SEW_EDIT_UNRESOLVED')
  }
  if (tg.kind === 'unresolved') return tg.value === undefined || tg.value === null ? t('SEW_EDIT_UNRESOLVED') : t('SEW_EDIT_UNRESOLVED_FROM', { value: tg.value })
  return String(tg.value ?? '?')
}
const retryText = (r) => t('SEW_PANEL_DIFF_RETRY', { n: r?.limit ?? '?', sec: typeof r?.intervalMs === 'number' ? r.intervalMs / 1000 : (r?.intervalMs ?? '?') })
const hasPicture = (train) => Object.values(train || {}).some((r) => isObject(r) && ('from' in r || (typeof r.literal === 'string' && r.literal !== '')))

// 저장 줄에 보일 바뀐 값 [{ field, label, before, after }]
export function diffLines(base, draft, working, across = null) {
  return changedFields(base, draft, across).map((field) => {
    const kind = draft.condition?.kind
    const line = (label, before, after) => ({ field, label, before, after })
    switch (field) {
      case 'desc': return line(t('SEW_PANEL_DESC'), base.descriptionToEmail || none(), draft.descriptionToEmail || none())
      case 'area': return line(t(kind === 'ocr' ? 'SEW_PANEL_OCR_AREA' : 'SEW_PANEL_AREA'), rectText(base.condition?.searchArea), rectText(draft.condition?.searchArea))
      case 'train': return line(t('SEW_PANEL_TRAIN'), t('SEW_PANEL_DIFF_OLD_IMAGE'), hasPicture(draft.images?.train) ? t('SEW_PANEL_DIFF_NEW_IMAGE') : none())
      case 'base': return line(t('SEW_PANEL_BASE'), t('SEW_PANEL_DIFF_OLD_IMAGE'), t('SEW_PANEL_DIFF_NEW_IMAGE'))
      case 'accept': return line(t('SEW_PANEL_ACCEPT'), acceptText(base.condition?.image?.accept), acceptText(draft.condition?.image?.accept))
      case 'multi': {
        const m = (s) => multiLabel(s.condition?.image?.multi ?? s.condition?.ocr?.multi)
        return line(t('SEW_PANEL_MULTI'), m(base), m(draft))
      }
      case 'ocr': return line(t('SEW_PANEL_OCR_CMP'), ocrText(base.condition?.ocr), ocrText(draft.condition?.ocr))
      case 'action': return line(t('SEW_PANEL_DIFF_ACTION'), actionText(base.action), actionText(draft.action))
      case 'onTrue': return line(t('SEW_PANEL_DIFF_ON_TRUE'), targetText(base.next?.onTrue, working), targetText(draft.next?.onTrue, working))
      case 'onFalse': return line(t('SEW_PANEL_DIFF_ON_FALSE'), targetText(base.next?.onFalse, working), targetText(draft.next?.onFalse, working))
      case 'retry': return line(t('SEW_PANEL_DIFF_RETRY_LABEL'), retryText(base.retry), retryText(draft.retry))
      case 'skip': return line(t('SEW_PANEL_SKIP'), t(base.condition?.skipPreprocessing ? 'SEW_PANEL_ON' : 'SEW_PANEL_OFF'), t(draft.condition?.skipPreprocessing ? 'SEW_PANEL_ON' : 'SEW_PANEL_OFF'))
      default: return line(t('SEW_PANEL_DIFF_OTHER'), '', '')
    }
  })
}

// 읽어 주는 문장(목업 sentence): 고치는 대로 함께 바뀐다. isNew = 아직 표에 없는 새 스텝.
export function sentence(d, working, isNew = false) {
  const steps = working?.steps ?? []
  const idx = isNew ? -1 : steps.findIndex((s) => s.uid === d.uid)
  const go = (tg) => {
    if (tg?.kind === 'next') return idx >= 0 && idx < steps.length - 1 ? t('SEW_CMD_TARGET_STEP', { no: idx + 2 }) : t('SEW_PANEL_SAY_NEXT_STEP')
    return targetText(tg, working)
  }
  const type = d.action?.type
  const act = type === 0 ? '' : t('SEW_PANEL_SAY_ACT', { name: actionName(d.action) })
  const r = d.retry || {}
  const again = Number(r.limit) > 0 ? t('SEW_PANEL_SAY_AGAIN', { sec: typeof r.intervalMs === 'number' ? r.intervalMs / 1000 : r.intervalMs, n: r.limit }) : ''
  const kind = d.condition?.kind
  const ok = go(d.next?.onTrue)
  const fail = go(d.next?.onFalse)
  if ((kind === 'image' || kind === 'ocr') && !d.condition?.searchArea) return t('SEW_PANEL_SAY_NEED_AREA')
  if (kind === 'image') return t('SEW_PANEL_SAY_IMAGE', { act, ok, again, fail })
  if (kind === 'ocr') return t('SEW_PANEL_SAY_OCR', { cmp: ocrText(d.condition.ocr), act, ok, again, fail })
  if (kind === 'eqpState') return t('SEW_PANEL_SAY_EQP', { act, ok, fail })
  if (kind !== 'none') return t('SEW_PANEL_SAY_OTHER', { act, ok, fail })
  if (CLICK_TYPES.includes(type)) return t('SEW_PANEL_SAY_NONE_CLICK', { act, ok })
  const onFail = d.next?.onFalse?.kind === 'next' && CAN_FAIL.has(type) ? t('SEW_PANEL_SAY_FAIL_NONE') : t('SEW_PANEL_SAY_FAIL_GO', { fail })
  return t('SEW_PANEL_SAY_NONE', { act: act || t('SEW_PANEL_SAY_DIRECT'), ok, onFail })
}
