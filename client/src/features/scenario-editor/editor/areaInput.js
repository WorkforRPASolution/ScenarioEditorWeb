// 검색(OCR) 영역을 패널에서 숫자로 넣기(2026-11-17 사내 요청) — 순수 함수. 좌표는 기준 화면 픽셀이다.
// 초안의 영역(condition.searchArea)은 늘 마지막 바른 값으로 남긴다 — 큰 화면·영역 그림·[다시 잡기]·Vision 시험이 그 사각형을 쓰므로
// 오타 하나로 영역이 사라지면 안 된다. 아직 영역에 넣을 수 없는 글자(정수가 아님·비움, 영역이 없을 때는 다 채워지기 전의 칸)는
// condition.areaTyped = { [칸]: 친 글자 } 에 따로 쥐고, 칸 검사(fieldRules → areaIssue)가 그것을 오류로 잡아 [적용]·[넣기]를 막는다
// (쥔 글자가 있으면 늘 오류라 작업본·서버로 나가지 않는다).
export const AREA_KEYS = Object.freeze(['x', 'y', 'w', 'h'])
const NAMES = { x: 'X', y: 'Y', w: 'W', h: 'H' }

// 칸에 친 글자 → 값. 빈 칸은 null, 숫자로만 된 글자(앞에 - 하나까지)는 수, 그 밖(소수점·글자·지수 꼴)은 친 글자 그대로.
// Number() 는 '1e3'·'0x10'·'12.' 도 수로 읽으므로 쓰지 않는다.
export function areaIn(text) {
  const s = String(text ?? '').trim()
  if (s === '') return null
  if (!/^-?\d+$/.test(s)) return s
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : s
}
const isInt = (v) => typeof v === 'number' && Number.isInteger(v)
const typedOf = (c) => (c?.areaTyped && typeof c.areaTyped === 'object' ? c.areaTyped : null)

export const sameArea = (a, b) => (!a || !b ? (a ?? null) === (b ?? null) : AREA_KEYS.every((k) => a[k] === b[k]))

// 칸에 보일 글자: 쥔 글자가 먼저, 없으면 영역의 값
export function areaText(condition, key) {
  const typed = typedOf(condition)
  if (typed && key in typed) return typed[key]
  const v = condition?.searchArea?.[key]
  return v === null || v === undefined ? '' : String(v)
}

function build(condition, area, typed) {
  const { areaTyped, ...rest } = condition
  const keys = AREA_KEYS.filter((k) => k in typed)
  const same = !!areaTyped === !!keys.length && keys.every((k) => areaTyped[k] === typed[k]) && Object.keys(areaTyped ?? {}).length === keys.length
  if (area === (condition.searchArea ?? null) && same) return condition
  return keys.length ? { ...rest, searchArea: area, areaTyped: Object.fromEntries(keys.map((k) => [k, typed[k]])) } : { ...rest, searchArea: area }
}

// 한 칸에 친 글자를 넣은 조건. 바뀐 것이 없으면 같은 객체.
// - 영역이 있으면: 정수는 그 칸에 바로 넣고, 아니면(글자·소수점·비움) 영역은 그대로 두고 친 글자를 쥔다.
// - 영역이 없으면(새 스텝): 친 글자를 쥐고 있다가 네 칸이 모두 정수가 되면 영역으로 만든다. 빈 칸은 쥐지 않는다.
export function typeArea(condition, key, text) {
  const s = String(text ?? '').trim()
  const v = areaIn(s)
  const area = condition.searchArea ?? null
  const typed = { ...(typedOf(condition) ?? {}) }
  if (area) {
    if (!isInt(v)) return build(condition, area, { ...typed, [key]: s })
    delete typed[key]
    return build(condition, area[key] === v ? area : { ...area, [key]: v }, typed)
  }
  if (s === '') delete typed[key]
  else typed[key] = s
  const vals = AREA_KEYS.map((k) => areaIn(typed[k]))
  if (vals.every(isInt)) return build(condition, Object.fromEntries(AREA_KEYS.map((k, i) => [k, vals[i]])), {})
  return build(condition, null, typed)
}

// 마우스로 잡거나 끌어 옮긴 영역을 넣은 조건 — 쥐고 있던 글자는 버린다(잡은 값이 칸에 보인다).
export function withArea(condition, area) {
  const { areaTyped, ...rest } = condition ?? {}
  return { ...rest, searchArea: area }
}

const issue = (code, keys, params = {}) => ({ code, params: { ...params, ...(keys ? { names: keys.map((k) => NAMES[k]).join('·'), keys } : {}) } })

// 조건의 영역 검사 → { code, params } 또는 null. 한 번에 하나이고 params.keys = 걸린 칸.
// 순서: 쥔 글자(정수 아님 → 빈 칸) → 영역 없음 → 영역 값(빈 칸 → 정수 아님 → 폭·높이 1 미만) → 고친 값만(음수 → 화면 밖).
// - AREA_INVALID 만 서버 code 다(영역 없음). 나머지는 서버의 AREA_INVALID(정수·폭 높이 1 이상)를 칸마다 풀어 쓴 것과, 화면만 아는 것(음수·화면 밖).
// - 음수·화면 밖은 고친 값(changed)만 본다 — 서버는 받는 값이라 저장돼 있던 옛 영역으로 [적용]을 막지 않는다.
// - screen = 기준 화면 크기 { w, h }. 모르면(그림을 아직 못 읽음·기준 화면 없음) 화면 밖을 보지 않는다.
export function areaIssue(condition, { screen = null, changed = false } = {}) {
  const area = condition?.searchArea
  const typed = typedOf(condition)
  const hasArea = !!area && typeof area === 'object'
  if (typed && Object.keys(typed).length) {
    const notInt = AREA_KEYS.filter((k) => k in typed && typed[k] !== '' && !isInt(areaIn(typed[k])))
    if (notInt.length) return issue('AREA_NOT_INTEGER', notInt)
    const empty = AREA_KEYS.filter((k) => (hasArea ? k in typed : !(k in typed)))
    if (empty.length) return issue('AREA_FIELD_EMPTY', empty)
  }
  if (!hasArea) return { code: 'AREA_INVALID', params: {} }
  const empty = AREA_KEYS.filter((k) => area[k] === null || area[k] === undefined || area[k] === '')
  if (empty.length) return issue('AREA_FIELD_EMPTY', empty)
  const notInt = AREA_KEYS.filter((k) => !isInt(area[k]))
  if (notInt.length) return issue('AREA_NOT_INTEGER', notInt)
  const small = ['w', 'h'].filter((k) => area[k] < 1)
  if (small.length) return issue('AREA_SIZE_MIN', small)
  if (!changed) return null
  const neg = ['x', 'y'].filter((k) => area[k] < 0)
  if (neg.length) return issue('AREA_NEGATIVE', neg)
  if (!screen || !(screen.w > 0 && screen.h > 0)) return null
  const size = { w: screen.w, h: screen.h }
  if (area.x + area.w > screen.w) return { code: 'AREA_OUT_RIGHT', params: { ...size, sum: area.x + area.w, keys: ['x', 'w'] } }
  if (area.y + area.h > screen.h) return { code: 'AREA_OUT_BOTTOM', params: { ...size, sum: area.y + area.h, keys: ['y', 'h'] } }
  return null
}
