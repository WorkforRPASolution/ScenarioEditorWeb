'use strict'
// Redis 해시 {공정}-{모델} 의 필드 "{이름}.{crtime}" 해석과 고르기(Q-010 ③④). 사내 StartsWith 앞부분 일치(DC-013)를 고친다.
function parseField(field) {
  if (typeof field !== 'string') return null
  const i = field.lastIndexOf('.')
  if (i <= 0 || i === field.length - 1) return null
  const crtime = field.slice(i + 1)
  if (!/^\d+$/.test(crtime)) return null
  return { name: field.slice(0, i), crtime: Number(crtime) }
}

function currentVersions(fields) {
  const m = new Map()
  for (const f of fields) {
    const p = parseField(f)
    if (!p) continue
    if (!m.has(p.name) || p.crtime > m.get(p.name)) m.set(p.name, p.crtime)
  }
  return m
}

function pickCurrent(fields, name) {
  return currentVersions(fields).get(name) ?? null
}

const toNumber = (v) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : v && typeof v.toNumber === 'function' ? v.toNumber() : NaN)

function uniqueDesc(values) {
  return [...new Set(values.map(toNumber).filter((n) => Number.isFinite(n)))].sort((a, b) => b - a)
}

module.exports = { parseField, currentVersions, pickCurrent, uniqueDesc }
