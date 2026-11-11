// 설비 고르기 규칙(P3 설계 §4.2). items = GET /equipment 의 { eqpId, process, model, line }.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const uniq = (values) => [...new Set(values.filter((v) => typeof v === 'string' && v !== ''))].sort(cmp)

export const processesOf = (items) => uniq((items ?? []).map((e) => e.process))
export const modelsOf = (items, process = '') => uniq((items ?? []).filter((e) => !process || e.process === process).map((e) => e.model))

// q = 설비 ID 의 부분 글자(앞뒤 공백 지움·대소문자 무시). prefer = { process, model } 인 설비(열린 시나리오의 것)가 먼저, 그 안에서 ID 순.
// 그리는 수(limit)까지만 주고 맞는 전체 수(total)를 함께 준다.
export function filterEquipment(items, { q = '', process = '', model = '', prefer = null } = {}, limit = 50) {
  if (!Array.isArray(items)) return { items: [], total: 0 }
  const needle = String(q ?? '').trim().toLowerCase()
  const first = (e) => (prefer && e.process === prefer.process && e.model === prefer.model ? 0 : 1)
  const hit = items
    .filter((e) => (!process || e.process === process) && (!model || e.model === model) && (!needle || String(e.eqpId).toLowerCase().includes(needle)))
    .sort((a, b) => first(a) - first(b) || cmp(a.eqpId, b.eqpId))
  return { items: hit.slice(0, limit), total: hit.length }
}
