'use strict'
// 창 조건(대상 창 TargetWindowCondition·숨길 창 HidingWindowConditionList) — P2-F 전처리 설정(설계 §4~§6).
// 저장값(raw) = C# WindowSearchCondition { Text, ClassName, IsCheckRectEqual, Left, Top, Right, Bottom },
// 편집 값(view) = { text, className, checkRect, left, top, right, bottom }(숨길 창은 origin = 저장 목록의 자리, 새 줄은 null).
// 고치지 않은 조건은 저장값을 그대로 다시 쓴다(null 글자 포함) — "같은 뜻" 비교로 가른다.
const HIDING_LIMIT = 20 // 사내 문구 Exception99("최대 20개"). 웹은 추가·붙여넣기 모두 이 값 하나로 본다(41 DC-145)
const INT32_MIN = -2147483648
const INT32_MAX = 2147483647
const FIXED_SIZE_LEFT = -218 // 에이전트 RemoveWindow: 위치 확인 + Left -218 이면 고정 크기 800×508 창을 찾는다(옛 특수 분기)

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const str = (v) => (typeof v === 'string' ? v : '')
const int = (v) => (Number.isInteger(v) && v >= INT32_MIN && v <= INT32_MAX ? v : 0)

// 저장값 → 편집 값. null·빠진 키·형이 틀린 값은 C# 기본값과 같은 빈 값("", 거짓, 0)으로 보인다.
function viewOf(raw) {
  const r = isObject(raw) ? raw : {}
  return { text: str(r.Text), className: str(r.ClassName), checkRect: r.IsCheckRectEqual === true, left: int(r.Left), top: int(r.Top), right: int(r.Right), bottom: int(r.Bottom) }
}

const FIELDS = ['text', 'className', 'checkRect', 'left', 'top', 'right', 'bottom']
// 편집 값이 저장값과 같은 뜻인가: null 과 "" 를, 빠진 키와 기본값을 같게 본다. 글자는 공백까지 그대로 견준다.
function sameMeaning(view, raw) {
  const b = viewOf(raw)
  return FIELDS.every((k) => view[k] === b[k])
}

// 새로 쓰는 저장값: C# 필드 순서, 빈 칸은 ""(사내 전처리 창이 닫을 때 쓰는 값과 같다)
function freshOf(view) {
  return { Text: view.text, ClassName: view.className, IsCheckRectEqual: view.checkRect, Left: view.left, Top: view.top, Right: view.right, Bottom: view.bottom }
}

// 뼈대의 저장값(header.raw) → 편집 형식 header.windows
function windowsOf(headerRaw) {
  const raw = isObject(headerRaw) ? headerRaw : {}
  const list = Array.isArray(raw.HidingWindowConditionList) ? raw.HidingWindowConditionList : []
  return { target: viewOf(raw.TargetWindowCondition), hiding: list.map((r, i) => ({ origin: i, ...viewOf(r) })) }
}

// 조립이 쓸 대상 창. undefined = 저장값을 그대로 둔다(키가 없었으면 없는 채로 — C# 기본값이 채운다).
function targetRawFor(view, raw) {
  return sameMeaning(view, raw) ? undefined : freshOf(view)
}

// 조립이 쓸 숨길 창 목록. undefined = 저장값(배열이 아닌 null 등)을 그대로 둔다 — 편집 목록이 비었을 때만.
// 줄마다: origin 이 가리키는 저장 줄과 같은 뜻이면 그 저장값(복사본), 아니면 새로 쓴다. 순서는 편집 목록.
function hidingRawFor(views, rawList) {
  const stored = Array.isArray(rawList) ? rawList : null
  if (!stored && views.length === 0) return undefined
  return views.map((v) => {
    const r = stored && Number.isInteger(v.origin) && v.origin >= 0 && v.origin < stored.length ? stored[v.origin] : undefined
    return r !== undefined && sameMeaning(v, r) ? clone(r) : freshOf(v)
  })
}

// 에이전트가 이 숨길 창을 찾는가(ARSAgent ControlMSWindow.RemoveWindow · MSWindow.getEnumWindows — 2026-11-11 사내와 같음).
// - 제목·클래스가 null(또는 조건이 객체가 아님): trim 에서 예외 → VALUE_NULL
// - 클래스가 공백뿐: 찾기를 건너뛴다 → CLASS_EMPTY
// - 제목이 비면 제목은 견주지 않는다(anyTitle). 제목·클래스 모두 부분 일치이고 처음 맞는 창 하나만 옮긴다.
// - untrimmed: 앞뒤 공백 — 제목 끝이 '*' 면 잘못 자르거나 범위 예외(41 DC-147). fixedSize: 위치 확인 + Left -218.
function judgeHiding(raw) {
  const r = isObject(raw) ? raw : {}
  const text = r.Text
  const cls = r.ClassName
  let reasonCode = null
  if (typeof text !== 'string' || typeof cls !== 'string') reasonCode = 'VALUE_NULL'
  else if (cls.trim() === '') reasonCode = 'CLASS_EMPTY'
  const t = str(text)
  const c = str(cls)
  return {
    finds: reasonCode === null,
    reasonCode,
    anyTitle: reasonCode === null && t.trim() === '',
    untrimmed: t !== t.trim() || c !== c.trim(),
    fixedSize: r.IsCheckRectEqual === true && r.Left === FIXED_SIZE_LEFT
  }
}

// 같은 숨길 창인가(중복 판정): 앞뒤 공백을 뺀 제목·클래스와 위치 확인이 같고, 위치 확인이 켜졌으면 좌표 넷도 같다.
function sameCondition(a, b) {
  if (a.text.trim() !== b.text.trim() || a.className.trim() !== b.className.trim() || a.checkRect !== b.checkRect) return false
  return !a.checkRect || (a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom)
}

module.exports = { HIDING_LIMIT, INT32_MIN, INT32_MAX, viewOf, sameMeaning, freshOf, windowsOf, targetRawFor, hidingRawFor, judgeHiding, sameCondition }
