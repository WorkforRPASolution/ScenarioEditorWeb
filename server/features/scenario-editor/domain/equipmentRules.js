'use strict'
// 사내 GetEquipmentInfoTable(MongoQuery.cs:342-465) 규칙. 분석 02 §2.3, 05 §3.4.
// 사내와 다른 점: 필수 필드가 없거나 같은 설비가 겹쳐도 목록 전체가 실패하지 않고 그 설비만 빼서 기록한다(Q-020·Q-089).
const { allowsProcess } = require('./processPermission')

const REQUIRED_FIELDS = ['eqpId', 'category', 'process', 'line', 'lineDesc', 'eqpModel', 'ipAddr', 'osVer', 'emailcategory', 'onoff']
const NON_EMPTY_FIELDS = ['eqpId', 'category', 'process', 'line', 'eqpModel']

const isDoc = (d) => d !== null && typeof d === 'object'

function joinEquipment(agentDocs, eqpDocs) {
  const agentCount = new Map()
  for (const a of agentDocs ?? []) {
    if (isDoc(a)) agentCount.set(a.eqpId, (agentCount.get(a.eqpId) || 0) + 1)
  }
  const out = []
  const sorted = (eqpDocs ?? []).filter(isDoc).sort((x, y) => (String(x.eqpId) < String(y.eqpId) ? -1 : String(x.eqpId) > String(y.eqpId) ? 1 : 0))
  for (const e of sorted) {
    const n = agentCount.get(e.eqpId) || 0
    for (let i = 0; i < n; i++) out.push(e)
  }
  return out
}

function applyEquipmentRules(joined, user) {
  const valid = []
  const duplicateEqpIds = []
  const invalid = []
  const proxyIpDuplicates = []
  const placed = new Set()
  const agentKeys = new Map()
  for (const doc of joined ?? []) {
    const e = isDoc(doc) ? doc : {}
    if (!allowsProcess(user, e.process)) continue
    const missing = REQUIRED_FIELDS.filter((f) => !(f in e) || e[f] === null || e[f] === undefined)
    if (missing.length) { invalid.push({ eqpId: e.eqpId ?? null, reason: 'REQUIRED_MISSING', fields: missing }); continue }
    if (placed.has(e.eqpId)) { if (!duplicateEqpIds.includes(e.eqpId)) duplicateEqpIds.push(e.eqpId); continue }
    if (String(e.emailcategory).split('-').length !== 4) { invalid.push({ eqpId: e.eqpId, reason: 'WRONG_EMAIL_CATEGORY' }); continue }
    if (NON_EMPTY_FIELDS.some((f) => String(e[f]) === '')) { invalid.push({ eqpId: e.eqpId, reason: 'REQUIRED_EMPTY' }); continue }
    valid.push(e)
    placed.add(e.eqpId)
    const local = Number(e.localpc ?? 0) === 1
    const key = local ? `${e.ipAddr}_${e.ipAddrL ?? ''}` : String(e.ipAddr)
    if (!agentKeys.has(key)) agentKeys.set(key, e.eqpId)
    else if (key.includes('_')) proxyIpDuplicates.push({ eqpId: e.eqpId, sameAs: agentKeys.get(key) })
  }
  return { valid, duplicateEqpIds, invalid, proxyIpDuplicates }
}

function allowedPairs(valid) {
  const byProcess = new Map()
  for (const e of valid ?? []) {
    if (e.process === 'Unknown') continue
    if (!byProcess.has(e.process)) byProcess.set(e.process, new Map())
    const models = byProcess.get(e.process)
    models.set(e.eqpModel, (models.get(e.eqpModel) || 0) + 1)
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  return [...byProcess.keys()].sort(cmp).map((process) => ({
    process,
    models: [...byProcess.get(process).entries()].sort((a, b) => cmp(a[0], b[0])).map(([model, eqpCount]) => ({ model, eqpCount }))
  }))
}

module.exports = { REQUIRED_FIELDS, joinEquipment, applyEquipmentRules, allowedPairs }
