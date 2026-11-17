// 검색(OCR) 영역을 패널에서 숫자로 넣기(2026-11-17 사내 요청) — 순수 함수. 좌표는 기준 화면 픽셀이다.
// 초안의 영역(condition.searchArea)은 늘 마지막 바른 값으로 남긴다 — 큰 화면·영역 그림·[다시 잡기]·Vision 시험이 그 사각형을 쓰므로
// 오타 하나로 영역이 사라지면 안 된다. 영역에 넣을 수 없는 글자(정수가 아님·비움·폭 높이 1 미만·음수·한도 초과, 영역이 없을 때는
// 다 채워지기 전의 칸)는 condition.areaTyped = { [칸]: 친 글자 } 에 따로 쥐고, 칸 검사(fieldRules → areaIssue)가 그것을 오류로 잡아
// [적용]·[넣기]를 막는다(쥔 글자가 있으면 늘 오류라 작업본·서버로 나가지 않는다).
export const AREA_KEYS = Object.freeze(['x', 'y', 'w', 'h'])
// 한 칸의 한도. 기준 화면 크기를 모를 때(그림을 읽기 전·기준 화면이 없는 옛 스텝)도 터무니없는 값이 들어가지 않게 늘 본다 —
// 서버는 정수인지만 보고, 에이전트·데스크톱 편집기는 32비트 정수로 읽는다. 여러 모니터를 이은 화면보다 넉넉하다.
export const AREA_MAX = 65535
const NAMES = { x: 'X', y: 'Y', w: 'W', h: 'H' }
const MIN = { x: 0, y: 0, w: 1, h: 1 }

// 칸에 친 글자 → 값. 빈 칸은 null, 숫자로만 된 글자(앞에 +·- 하나까지, 전각 숫자는 반각으로)는 수, 그 밖(소수점·글자·지수 꼴)은 친 글자 그대로.
// Number() 는 '1e3'·'0x10'·'12.' 도 수로 읽으므로 쓰지 않는다. 자릿수가 아주 많아도 수로 돌려준다(한도 검사가 잡는다).
export function areaIn(text) {
  const raw = String(text ?? '').trim()
  if (raw === '') return null
  const s = raw.normalize('NFKC').replace(/\u2212/g, '-')
  if (!/^[+-]?\d+$/.test(s)) return raw
  const n = Number(s)
  return Number.isFinite(n) ? n : Number.MAX_VALUE * Math.sign(n)
}
const isInt = (v) => typeof v === 'number' && Number.isInteger(v)
// 그 칸에 넣을 수 있는 값인가: 정수, X·Y 는 0 이상, W·H 는 1 이상, 한도 이하
const fits = (k, v) => isInt(v) && v >= MIN[k] && v <= AREA_MAX
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
// - 영역이 있으면: 넣을 수 있는 값(fits)은 그 칸에 바로 넣고, 아니면 영역은 그대로 두고 친 글자를 쥔다.
// - 영역이 없으면(새 스텝): 친 글자를 쥐고 있다가 네 칸이 모두 넣을 수 있는 값이 되면 영역으로 만든다. 빈 칸은 쥐지 않는다.
export function typeArea(condition, key, text) {
  const s = String(text ?? '').trim()
  const v = areaIn(s)
  const area = condition.searchArea ?? null
  const typed = { ...(typedOf(condition) ?? {}) }
  if (area) {
    if (!fits(key, v)) return build(condition, area, { ...typed, [key]: s })
    delete typed[key]
    return build(condition, area[key] === v ? area : { ...area, [key]: v }, typed)
  }
  if (s === '') delete typed[key]
  else typed[key] = s
  const vals = AREA_KEYS.map((k) => areaIn(typed[k]))
  if (AREA_KEYS.every((k, i) => fits(k, vals[i]))) return build(condition, Object.fromEntries(AREA_KEYS.map((k, i) => [k, vals[i]])), {})
  return build(condition, null, typed)
}

// 마우스로 잡거나 끌어 옮긴 영역을 넣은 조건 — 쥐고 있던 글자는 버린다(잡은 값이 칸에 보인다).
export function withArea(condition, area) {
  const { areaTyped, ...rest } = condition ?? {}
  return { ...rest, searchArea: area }
}

const issue = (code, keys, params = {}) => ({ code, params: { names: keys.map((k) => NAMES[k]).join('·'), keys, ...params } })

// 쥔 글자의 이유. 쥔 글자가 있으면 반드시 하나를 돌려준다(null 이 아니다).
function typedIssue(typed, hasArea) {
  const held = AREA_KEYS.filter((k) => k in typed)
  const val = Object.fromEntries(held.map((k) => [k, areaIn(typed[k])]))
  const notInt = held.filter((k) => typed[k] !== '' && !isInt(val[k]))
  if (notInt.length) return issue('AREA_NOT_INTEGER', notInt)
  const small = held.filter((k) => MIN[k] === 1 && isInt(val[k]) && val[k] < 1)
  if (small.length) return issue('AREA_SIZE_MIN', small)
  const neg = held.filter((k) => MIN[k] === 0 && isInt(val[k]) && val[k] < 0)
  if (neg.length) return issue('AREA_NEGATIVE', neg)
  const large = held.filter((k) => isInt(val[k]) && val[k] > AREA_MAX)
  if (large.length) return issue('AREA_TOO_LARGE', large, { max: AREA_MAX })
  // 영역이 있으면 쥔 칸 = 비운 칸, 없으면 아직 치지 않은 칸
  const empty = hasArea ? held.filter((k) => typed[k] === '') : AREA_KEYS.filter((k) => !(k in typed))
  if (empty.length) return issue('AREA_FIELD_EMPTY', empty)
  return hasArea ? issue('AREA_NOT_INTEGER', held) : null // 올 수 없는 갈래 — 그래도 쥔 글자를 통과시키지 않는다
}

// 조건의 영역 검사 → { code, params } 또는 null. 한 번에 하나이고 params.keys = 걸린 칸.
// 순서: 쥔 글자(정수 아님 → 폭·높이 1 미만 → 음수 → 한도 초과 → 빈 칸) → 영역 없음 → 영역 값(빈 칸 → 정수 아님 → 폭·높이 1 미만) → 고친 칸만(화면 밖).
// - AREA_INVALID 만 서버 code 다(영역 없음). 나머지는 서버의 AREA_INVALID(정수·폭 높이 1 이상)를 칸마다 풀어 쓴 것과 화면만 아는 것.
// - 음수·한도 초과는 칠 때만 잡는다(쥔 글자). 영역에 이미 들어 있는 값(저장돼 있던 것·붙여 온 스텝)은 서버가 받는 값이라 막지 않는다.
// - 화면 밖은 그 방향의 칸을 고쳤을 때만 본다: changed = 고친 칸 이름들(true = 모두 — 새 스텝, false = 없음). X·W → 오른쪽, Y·H → 아래.
// - screen = 기준 화면 크기 { w, h }. 모르면(그림을 아직 못 읽음·기준 화면 없음) 화면 밖을 보지 않는다.
export function areaIssue(condition, { screen = null, changed = false } = {}) {
  const area = condition?.searchArea
  const typed = typedOf(condition)
  const hasArea = !!area && typeof area === 'object'
  if (typed && Object.keys(typed).length) {
    const bad = typedIssue(typed, hasArea)
    if (bad) return bad
  }
  if (!hasArea) return { code: 'AREA_INVALID', params: {} }
  const empty = AREA_KEYS.filter((k) => area[k] === null || area[k] === undefined || area[k] === '')
  if (empty.length) return issue('AREA_FIELD_EMPTY', empty)
  const notInt = AREA_KEYS.filter((k) => !isInt(area[k]))
  if (notInt.length) return issue('AREA_NOT_INTEGER', notInt)
  const small = ['w', 'h'].filter((k) => area[k] < 1)
  if (small.length) return issue('AREA_SIZE_MIN', small)
  const touched = changed === true ? AREA_KEYS : Array.isArray(changed) ? changed : []
  if (!touched.length || !screen || !(screen.w > 0 && screen.h > 0)) return null
  const size = { w: screen.w, h: screen.h }
  const hit = (keys) => keys.some((k) => touched.includes(k))
  if (hit(['x', 'w']) && area.x + area.w > screen.w) return { code: 'AREA_OUT_RIGHT', params: { ...size, sum: area.x + area.w, keys: ['x', 'w'] } }
  if (hit(['y', 'h']) && area.y + area.h > screen.h) return { code: 'AREA_OUT_BOTTOM', params: { ...size, sum: area.y + area.h, keys: ['y', 'h'] } }
  return null
}

// 패널이 연 때의 영역(applied)과 견줘 고친 칸
export const changedAreaKeys = (applied, area) => AREA_KEYS.filter((k) => (applied?.[k] ?? null) !== (area?.[k] ?? null))
