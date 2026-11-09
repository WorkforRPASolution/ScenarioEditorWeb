'use strict'
// 단독판 전용: Mongo 연결 주소의 DB 이름. 웹 전용 DB(SE_WEB_DB_URI)가 운영 EARS 와 같은 DB 를 가리키면 서버가 뜨지 않게 하는 데 쓴다
// (webManagerDb.connectWebDbOnly, 사내 쓰기 시험 사전 점검 tools/inhouse/preflight.js). 편입 때 함께 사라진다.

// mongodb[+srv]://[계정@]호스트[,호스트…]/DB?옵션 → DB(퍼센트 인코딩 풂). DB 가 없거나 Mongo 주소가 아니면 빈 글.
function mongoDbName(uri) {
  const m = /^mongodb(?:\+srv)?:\/\/(.*)$/.exec(String(uri ?? '').trim())
  if (!m) return ''
  const rest = m[1].split('?')[0]
  const afterAuth = rest.slice(rest.lastIndexOf('@') + 1)
  const slash = afterAuth.indexOf('/')
  if (slash < 0) return ''
  try { return decodeURIComponent(afterAuth.slice(slash + 1)) } catch { return afterAuth.slice(slash + 1) }
}

// 같은 DB 인가 — 경로의 DB 이름만 보고(호스트·옵션 무시) 대소문자를 가리지 않는다(Mongo 는 대소문자만 다른 DB 를 한 서버에 두지 못한다).
// 이름이 없는 주소는 같다고 하지 않는다.
function sameDbName(a, b) {
  const x = mongoDbName(a).toLowerCase()
  return x !== '' && x === mongoDbName(b).toLowerCase()
}

module.exports = { mongoDbName, sameDbName }
