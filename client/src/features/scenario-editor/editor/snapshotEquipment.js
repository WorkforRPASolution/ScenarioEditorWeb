// 설비 고르기 규칙(P3 설계 §4.2). items = GET /equipment 의 { eqpId, process, model, line, ipAddr, ipAddrL }.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const uniq = (values) => [...new Set(values.filter((v) => typeof v === 'string' && v !== ''))].sort(cmp)
const needleOf = (q) => String(q ?? '').trim().toLowerCase()
const has = (v, needle) => typeof v === 'string' && v.toLowerCase().includes(needle)
// 설비 ID · 바깥 IP(ipAddr) · 안쪽 IP(ipAddrL) 가운데 하나에 검색어가 들어 있는가
const hits = (e, needle) => has(String(e.eqpId), needle) || has(e.ipAddr, needle) || has(e.ipAddrL, needle)

export const processesOf = (items) => uniq((items ?? []).map((e) => e.process))
export const modelsOf = (items, process = '') => uniq((items ?? []).filter((e) => !process || e.process === process).map((e) => e.model))

// 검색어(설비 ID·IP 의 부분 글자, 앞뒤 공백 지움·대소문자 무시)에 맞는 설비만. 검색어가 비면 받은 배열 그대로 —
// 공정·모델 선택 상자의 항목을 이 결과로 만든다(검색하면 맞는 설비의 공정·모델만 남는다).
export function searchEquipment(items, q) {
  if (!Array.isArray(items)) return []
  const needle = needleOf(q)
  return needle ? items.filter((e) => hits(e, needle)) : items
}

// q = 설비 ID·IP 의 부분 글자. prefer = { process, model } 인 설비(열린 시나리오의 것)가 먼저, 그 안에서 ID 순.
// 그리는 수(limit)까지만 주고 맞는 전체 수(total)를 함께 준다.
export function filterEquipment(items, { q = '', process = '', model = '', prefer = null } = {}, limit = 50) {
  if (!Array.isArray(items)) return { items: [], total: 0 }
  const first = (e) => (prefer && e.process === prefer.process && e.model === prefer.model ? 0 : 1)
  const hit = searchEquipment(items, q)
    .filter((e) => (!process || e.process === process) && (!model || e.model === model))
    .sort((a, b) => first(a) - first(b) || cmp(a.eqpId, b.eqpId))
  return { items: hit.slice(0, limit), total: hit.length }
}

// 선택 상자(공정·모델) 항목을 친 글자의 일부로 좁힌다. 그리는 수(limit)까지만 주고 전체 수를 함께 준다.
export function filterOptions(options, q, limit = 100) {
  if (!Array.isArray(options)) return { items: [], total: 0 }
  const needle = needleOf(q)
  const hit = needle ? options.filter((o) => has(o, needle)) : options
  return { items: hit.slice(0, limit), total: hit.length }
}

// ↑↓ 로 목록 안 줄 옮기기 — 끝에서 멈춘다. 고른 줄이 없으면(-1) 아래는 첫 줄, 위는 마지막 줄.
export function stepActive(index, delta, count) {
  if (!(count > 0)) return -1
  if (index < 0) return delta > 0 ? 0 : count - 1
  return Math.min(count - 1, Math.max(0, index + delta))
}
