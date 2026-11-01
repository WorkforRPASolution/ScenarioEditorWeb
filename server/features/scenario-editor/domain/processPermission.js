'use strict'
// 사내 사용자 문서 해석(MongoQuery.cs:294-319)과 공정 거르기(:367-385). 분석 31 §1.4·§4.1.
const { AUTHORITY_NAMES, nameOf } = require('./enums')

function toAuthorityManager(v) {
  if (v === undefined) return { value: 0, valid: true }
  if (typeof v === 'number' && Number.isInteger(v)) return { value: v, valid: true }
  if (v && typeof v === 'object' && typeof v.toNumber === 'function') {
    try {
      const n = v.toNumber()
      if (Number.isInteger(n)) return { value: n, valid: true }
    } catch (e) { /* 저장 값이 이상하면 아래에서 무효로 처리 */ }
    return { value: 0, valid: false }
  }
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return { value: Number(v), valid: true }
  return { value: 0, valid: false }
}

function parseUser(doc) {
  const d = doc !== null && typeof doc === 'object' ? doc : {}
  const processRaw = typeof d.process === 'string' ? d.process : null
  const hasMulti = processRaw !== null && processRaw.includes(';')
  const processes = processRaw === null ? [] : hasMulti ? processRaw.split(';') : [processRaw]
  const process = processes[0] ?? ''
  const am = toAuthorityManager(d.authorityManager)
  return {
    singleid: d.singleid,
    name: typeof d.name === 'string' && d.name !== '' ? d.name : d.singleid,
    processRaw,
    processes,
    multiProcess: hasMulti ? processes : null,
    process,
    isMaster: process === 'MASTER',
    authority: typeof d.authority === 'string' ? d.authority : '',
    canWrite: d.authority === 'WRITE',
    authorityManager: am.value,
    authorityManagerValid: am.valid,
    authorityName: nameOf(AUTHORITY_NAMES, am.value) ?? String(am.value)
  }
}

function allowsProcess(user, process) {
  if (user.multiProcess) return user.multiProcess.includes(process)
  if (!user.isMaster) return user.process !== '' && process === user.process
  return true
}

module.exports = { parseUser, allowsProcess, toAuthorityManager }
