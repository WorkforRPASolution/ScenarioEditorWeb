// 스냅샷 메모 규칙(P3 설계 §4.4·§4.5·§7) — 글 검사와 메모 목록 창의 거르기. 글 규칙은 서버(domain/memoRules.js)가 정본이고 여기는 같은 규칙이다.
// 메모 = { text, author(아이디), authorName, writtenAt, editedBy, editedAt }. 메모 목록 줄 = { eqpId, process, model, fileName, date, time, daysLeft, memo }.
export const MEMO_MAX = 128

// 저장할 글 — 앞뒤 공백을 지운 뒤 본다. empty 면 저장이 아니라 지우기다. error 는 서버 code 와 같은 이름.
export function checkMemo(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  const error = text.includes("'") ? 'MEMO_QUOTE' : text.length > MEMO_MAX ? 'MEMO_TOO_LONG' : null
  return { text, empty: text === '', error }
}

// 내가 쓴 메모인가 — 남의 메모는 고치거나 지우기 전에 알린다
export const isMine = (memo, me) => !!memo && typeof memo.author === 'string' && memo.author !== '' && memo.author === me

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const uniq = (values) => [...new Set(values.filter((v) => typeof v === 'string' && v !== ''))].sort(cmp)

// 거르기 항목 — 목록에 있는 메모의 것만. 모델은 고른 공정 안에서, 설비는 고른 공정·모델 안에서.
export function memoOptions(items, { process = '', model = '' } = {}) {
  const all = Array.isArray(items) ? items : []
  const inProcess = process ? all.filter((m) => m.process === process) : all
  const inModel = model ? inProcess.filter((m) => m.model === model) : inProcess
  return { processes: uniq(all.map((m) => m.process)), models: uniq(inProcess.map((m) => m.model)), eqpIds: uniq(inModel.map((m) => m.eqpId)) }
}

// 공정·모델·설비·내 메모만 — 준 것만 건다
export function filterMemos(items, { process = '', model = '', eqpId = '', mine = false, me = '' } = {}) {
  if (!Array.isArray(items)) return []
  return items.filter((m) => (!process || m.process === process) && (!model || m.model === model) && (!eqpId || m.eqpId === eqpId) && (!mine || isMine(m.memo, me)))
}
