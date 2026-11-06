'use strict'
// 배포 뒤 "내 판" 찾기와 충돌 지문. InterfaceServer 는 저장한 판을 Redis 필드 {이름}.{crtime} 에 본문 그대로 쓴다 —
// 배포 전에 없던 새 필드 중 본문 sha256 이 같은 것이 내 판이다.
const crypto = require('node:crypto')
const { EJSON } = require('bson')
const { parseField } = require('./versionPick')

const bodySha256 = (body) => crypto.createHash('sha256').update(body, 'utf8').digest('hex')

// 이름에 '.' 가 있어도 마지막 '.' 앞이 이름과 정확히 같고 뒤가 숫자인 것만.
function newVersionFields(name, before, now) {
  const had = new Set(before)
  const out = []
  for (const field of now) {
    if (had.has(field)) continue
    const p = parseField(field)
    if (p && p.name === name) out.push({ field, crtime: p.crtime })
  }
  return out.sort((a, b) => b.crtime - a.crtime)
}

async function pickMine({ name, fieldsBefore, fieldsNow, valueOf, sha }) {
  for (const { field, crtime } of newVersionFields(name, fieldsBefore, fieldsNow)) {
    const value = await valueOf(field)
    if (typeof value === 'string' && bodySha256(value) === sha) return crtime
  }
  return null
}

// 키 순서는 저장 순서 그대로 — 같은 드라이버로 읽은 두 값은 같은 글자가 된다.
function propertyRev(sub) {
  const text = EJSON.stringify(sub ?? null, { relaxed: false })
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

const setScenarioTimeoutMs = (requestBytes) => Math.min(120000, 15000 + Math.ceil(requestBytes / 1048576) * 500)

module.exports = { bodySha256, newVersionFields, pickMine, propertyRev, setScenarioTimeoutMs }
