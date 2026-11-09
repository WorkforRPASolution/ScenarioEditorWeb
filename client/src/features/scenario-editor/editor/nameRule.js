// 시나리오 이름 규칙(분석 10 §3.4, Q-026 — 이름 만들기 규칙은 하나). 저장 창 [이름 만들기]와 새 시나리오 창이 함께 쓴다.
// - 이름 규칙 컬렉션(SC_NAME_RULE)이 있으면 "{대}_{중}" + 3번 칸(5자 이상, 머리가 AUTO_DATABACKUP 이면 비워도 됨) + 4번 칸(있으면 "_값").
//   사내 저장 창의 다른 규칙(3번 칸 검사 없음, DC-061)은 따르지 않고 새 시나리오 창 규칙으로 맞춘다.
// - 규칙이 없으면(컬렉션이 없거나 대·중분류 가운데 고를 것이 없으면) 직접 입력: 영문·숫자·밑줄, 50자 이하.
// 문구는 돌려주지 않는다 — code 만(직접 입력은 서버 검사와 같은 RULE_NAME_*, 이름 만들기는 SEW_NAME_*).

export const NAME_MAX = 50
export const FREE_HEAD = 'AUTO_DATABACKUP'
export const PART3_MIN = 5
const NAME_RE = /^[0-9A-Za-z_]+$/
const PART_RE = /^[0-9A-Za-z_]*$/

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

// 서버 GET /name-rule 의 { exists, rules }(rules = 문서 { groupLevel, name, description }) → { major, middle } 또는 null(직접 입력).
// groupLevel 은 1(대분류)·2(중분류)만 쓰고(사내 groupLevel.ToString()), 이름이 없는 문서는 버린다. 이름 오름차순.
export function nameRuleOf(res) {
  if (!res || res.exists !== true || !Array.isArray(res.rules)) return null
  const level = (lv) => res.rules
    .filter((r) => r && String(r.groupLevel) === lv && typeof r.name === 'string' && r.name !== '')
    .map((r) => ({ name: r.name, description: typeof r.description === 'string' ? r.description : '' }))
    .sort(byName)
  const major = level('1')
  const middle = level('2')
  return major.length && middle.length ? { major, middle } : null
}

// 직접 입력한 이름 → null 이거나 { code, params }(서버 NAME_EMPTY·NAME_TOO_LONG·NAME_CHARS 와 같은 판정)
export function checkName(name) {
  const v = typeof name === 'string' ? name : ''
  if (v === '') return { code: 'NAME_EMPTY', params: {} }
  if (v.length > NAME_MAX) return { code: 'NAME_TOO_LONG', params: { max: NAME_MAX } }
  if (!NAME_RE.test(v)) return { code: 'NAME_CHARS', params: {} }
  return null
}

// 이름 만들기. parts = { major, middle, part3, part4 } → { name, errors: { [칸]: { code, params } } }.
// name 은 대·중분류를 둘 다 골랐을 때만 만든다(미리 보기). errors 가 비어야 쓸 수 있다.
export function buildName({ major = '', middle = '', part3 = '', part4 = '' } = {}) {
  const errors = {}
  if (!major) errors.major = { code: 'MAJOR_REQUIRED', params: {} }
  if (!middle) errors.middle = { code: 'MIDDLE_REQUIRED', params: {} }
  const free = `${major}_${middle}` === FREE_HEAD
  if (!PART_RE.test(part3)) errors.part3 = { code: 'PART_CHARS', params: {} }
  else if (!free && part3.length < PART3_MIN) errors.part3 = { code: 'PART_SHORT', params: { min: PART3_MIN, n: part3.length } }
  if (!PART_RE.test(part4)) errors.part4 = { code: 'PART_CHARS', params: {} }
  const name = major && middle ? [major, middle, part3, part4].filter(Boolean).join('_') : ''
  if (name) {
    if (name.length > NAME_MAX) errors.name = { code: 'BUILT_TOO_LONG', params: { max: NAME_MAX, n: name.length } }
    else if (!errors.part3 && !errors.part4 && !NAME_RE.test(name)) errors.name = { code: 'BUILT_CHARS', params: {} }
  }
  return { name, errors }
}
