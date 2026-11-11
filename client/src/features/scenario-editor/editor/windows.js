// 창 조건(대상 창·숨길 창) 화면 모델 — P2-F 전처리 설정(설계 §3·§6·§7). 순수 함수만 둔다(창·바·저장 창이 함께 쓴다).
// 값 = { text, className, checkRect, left, top, right, bottom }, 숨길 창 줄은 origin(출처 판 목록의 자리, 새 줄은 null)을 더 가진다.
// 판정은 서버 domain/targetWindow.js·windowsModel.js 와 같은 표다(ARSAgent ControlMSWindow.scala — 사내와 같음, 2026-11-11).
export const HIDING_LIMIT = 20 // 추가·붙여넣기 모두 합계 20개까지(41 DC-145)
export const UNCHECKED = -18 // 위치 확인을 끌 때 좌표 칸에 들어가는 값(사내 전처리 창과 같다)
const INT32_MIN = -2147483648
const INT32_MAX = 2147483647
const FIXED_SIZE_LEFT = -218
const FIELDS = ['text', 'className', 'checkRect', 'left', 'top', 'right', 'bottom']
const COORDS = ['left', 'top', 'right', 'bottom']

export const blankWindow = () => ({ text: '', className: '', checkRect: false, left: 0, top: 0, right: 0, bottom: 0 })
export const blankWindows = () => ({ target: blankWindow(), hiding: [] })
const pick = (w) => Object.fromEntries(FIELDS.map((k) => [k, w[k]]))

// 대상 창: 제목·클래스가 둘 다 있고 제목이 '*' 가 아닐 때만 찾는다. 제목 끝이 '*' 면 부분 일치.
// level: ok(찾음) · warn(값이 있는데 찾지 않음) · none(정하지 않음)
export function targetState(w) {
  const text = String(w?.text ?? '')
  const cls = String(w?.className ?? '')
  let reasonCode = null
  if (text.trim() === '') reasonCode = 'TEXT_EMPTY'
  else if (text.trim() === '*') reasonCode = 'TEXT_STAR'
  else if (cls.trim() === '') reasonCode = 'CLASS_EMPTY'
  if (reasonCode === null) return { level: 'ok', reasonCode: null, matchMode: text.endsWith('*') ? 'partial' : 'exact' }
  return { level: text.trim() === '' && cls.trim() === '' ? 'none' : 'warn', reasonCode, matchMode: null }
}

// 숨길 창: 클래스가 비면 찾지 않는다(bad). 제목이 비면 제목은 보지 않는다. 앞뒤 공백·고정 크기(-218)는 확인할 값(warn).
export function hidingState(w) {
  const text = String(w?.text ?? '')
  const cls = String(w?.className ?? '')
  if (cls.trim() === '') return { level: 'bad', code: 'CLASS_EMPTY' }
  if (text !== text.trim() || cls !== cls.trim()) return { level: 'warn', code: 'SPACE' }
  if (w.checkRect === true && w.left === FIXED_SIZE_LEFT) return { level: 'warn', code: 'FIXED_SIZE' }
  return { level: 'ok', code: text === '' ? 'ANY_TITLE' : 'FOUND' }
}

export const sameWindow = (a, b) => FIELDS.every((k) => a[k] === b[k])
// 같은 숨길 창인가(중복): 앞뒤 공백을 뺀 제목·클래스와 위치 확인, 위치 확인이 켜졌으면 좌표 넷
export function sameCondition(a, b) {
  if (a.text.trim() !== b.text.trim() || a.className.trim() !== b.className.trim() || a.checkRect !== b.checkRect) return false
  return !a.checkRect || COORDS.every((k) => a[k] === b[k])
}

// 좌표 칸 글자 → Int32 정수 또는 null
export function parseCoord(v) {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!/^-?\d+$/.test(s)) return null
  const n = Number(s)
  return n >= INT32_MIN && n <= INT32_MAX ? n : null
}

// 위치 확인을 끄면 좌표 넷이 -18, 켜면 값은 그대로
export function setCheck(w, on) {
  return on ? { ...w, checkRect: true } : { ...w, checkRect: false, left: UNCHECKED, top: UNCHECKED, right: UNCHECKED, bottom: UNCHECKED }
}

// 넣거나 고칠 때 제목·클래스 앞뒤 공백을 지운다(41 DC-147)
export const cleanWindow = (w) => ({ ...w, text: w.text.trim(), className: w.className.trim() })

// 입력 칸 검사. form = { text, className, checkRect, coords: [글자 넷] }. 숨길 창은 클래스 필수(41 DC-144), 좌표는 위치 확인이 켜졌을 때만 본다(DC-146).
export function windowErrors(form, { hiding }) {
  const out = {}
  if (hiding && String(form.className ?? '').trim() === '') out.className = 'SEW_PP_ERR_CLASS'
  if (form.checkRect && form.coords.some((c) => parseCoord(c) === null)) out.coords = 'SEW_PP_ERR_COORD'
  return out
}

// 붙여넣기: 같은 조건(목록·묶음 안)은 건너뛰고(same), 한도를 넘는 만큼은 붙이지 않는다(over). 붙은 줄은 새 줄이다.
export function pasteHiding(list, clip) {
  const out = [...list]
  let added = 0
  let same = 0
  let over = 0
  for (const c of clip) {
    if (out.some((x) => sameCondition(x, c))) { same++; continue }
    if (out.length >= HIDING_LIMIT) { over++; continue }
    out.push({ origin: null, ...pick(c) })
    added++
  }
  return { list: out, added, same, over }
}

// 저장 기준점과 견준 변경. 같은 출처면 자리(origin)로 맞춰 고침을 가르고, 출처가 다르면(되돌려 연 세션 — origin 이 옛 판의 자리) 내용으로만 견준다.
// → { target: null | { before, after }, hiding: null | { added, removed, changed: [{ before, after }] } }
export function windowChanges(now, base, { byOrigin }) {
  if (!now || !base) return { target: null, hiding: null }
  const target = sameWindow(now.target, base.target) ? null : { before: base.target, after: now.target }
  const added = []
  const changed = []
  const used = new Set()
  if (byOrigin) {
    const at = new Map(base.hiding.map((b, i) => [b.origin ?? i, i]))
    for (const h of now.hiding) {
      const i = h.origin === null || h.origin === undefined ? undefined : at.get(h.origin)
      if (i === undefined || used.has(i)) { added.push(h); continue }
      used.add(i)
      if (!sameWindow(h, base.hiding[i])) changed.push({ before: base.hiding[i], after: h })
    }
  } else {
    for (const h of now.hiding) {
      const i = base.hiding.findIndex((b, k) => !used.has(k) && sameWindow(b, h))
      if (i < 0) added.push(h)
      else used.add(i)
    }
  }
  const removed = base.hiding.filter((_, i) => !used.has(i))
  return { target, hiding: added.length || removed.length || changed.length ? { added, removed, changed } : null }
}

// 바 요약: 대상 창 상태, 숨길 창 수, 확인할 줄 수(찾지 않음·앞뒤 공백·고정 크기)
export function windowsSummary(w) {
  if (!w) return null
  return { target: targetState(w.target).level, hiding: w.hiding.length, attention: w.hiding.filter((h) => hidingState(h).level !== 'ok').length }
}

// 작업본에 넣을 값: 일곱 칸과 origin 만 남긴 복사본
export function normalizeWindows(w) {
  return { target: pick(w.target), hiding: w.hiding.map((h) => ({ origin: h.origin ?? null, ...pick(h) })) }
}

// 편집 세션이 없을 때(뼈대만 있는 화면) 바가 쓰는 값: 뼈대 머리의 대상 창 저장값(targetWindow.raw)·숨길 창 저장 목록(hidingWindows)에서 만든다.
// 서버 windowsModel.viewOf 와 같은 규칙(null·빠진 키 → 빈 값). 대상 창 해석값이 없는 뼈대(새 시나리오·원본이 지워진 초안)는 값을 모른다 → null.
const rawView = (r) => {
  const o = r && typeof r === 'object' && !Array.isArray(r) ? r : {}
  const str = (v) => (typeof v === 'string' ? v : '')
  const int = (v) => (Number.isInteger(v) && v >= INT32_MIN && v <= INT32_MAX ? v : 0)
  return { text: str(o.Text), className: str(o.ClassName), checkRect: o.IsCheckRectEqual === true, left: int(o.Left), top: int(o.Top), right: int(o.Right), bottom: int(o.Bottom) }
}
export function windowsFromHeader(header) {
  if (!header?.targetWindow) return null
  const list = Array.isArray(header.hidingWindows) ? header.hidingWindows : []
  return { target: rawView(header.targetWindow.raw), hiding: list.map((r, i) => ({ origin: i, ...rawView(r) })) }
}

// 한 줄 글(저장 창 "바뀐 것"): 제목 / 클래스 [좌표]. 빈 제목·빈 클래스 자리는 부르는 쪽이 준 글로 채운다.
export function windowLabel(w, { anyTitle, noClass }) {
  const rect = w.checkRect ? ` [${[w.left, w.top, w.right, w.bottom].join(', ')}]` : ''
  return `${w.text.trim() || anyTitle} / ${w.className.trim() || noClass}${rect}`
}

