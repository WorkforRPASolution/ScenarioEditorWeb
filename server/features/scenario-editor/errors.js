'use strict'
const { ApiError } = require('../../shared/middleware/errorHandler')

// WebManager ApiError 에 code 를 붙인다(errorHandler 가 { error, code } 로 낸다).
// details 는 ApiError.details 로 실려 응답 { error, code, details } 로 나간다.
function seError(status, code, message, details = null) {
  const e = new ApiError(status, message, details)
  e.code = code
  return e
}

// 드라이버 오류 이름(mongodb 6~7). 질의 도중 끊겨도 500 이 아니라 503 이 되게 한다(설계 오류 표).
// 뒤 다섯 개(풀 비움 둘·서버 닫힘·풀 닫힘·대기열 시간 초과)는 한 연결이 끊긴 뒤 같이 돌던 질의가 받는다.
const MONGO_DOWN = new Set([
  'MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoServerSelectionError', 'MongoNotConnectedError', 'MongoTopologyClosedError',
  'MongoPoolClearedError', 'PoolClearedOnNetworkError', 'MongoServerClosedError', 'MongoPoolClosedError', 'MongoWaitQueueTimeoutError'
])
// 서버가 내려가거나 주 노드가 바뀌는 중에 서버가 돌려주는 MongoServerError 코드.
// 91 ShutdownInProgress, 11600 InterruptedAtShutdown, 189 PrimarySteppedDown, 10107 NotWritablePrimary, 13435 NotPrimaryNoSecondaryOk
const MONGO_DOWN_CODES = new Set([91, 11600, 189, 10107, 13435])
const MAX_TIME_EXPIRED = 50

// db 는 문구에 넣을 DB 이름 — 운영 EARS(기본)와 웹 전용 DB(초안·배포 기록)가 같은 드라이버 오류를 낸다. 읽기·쓰기 모두라 "닿지 못했습니다".
function mapMongoError(e, db = 'EARS DB') {
  if (e && e.code && typeof e.code === 'string') return e
  if (e && (MONGO_DOWN.has(e.name) || MONGO_DOWN_CODES.has(e.code))) return seError(503, 'UPSTREAM_DOWN', `${db} 에 닿지 못했습니다`)
  if (e && (e.code === MAX_TIME_EXPIRED || e.name === 'MongoOperationTimeoutError')) return seError(504, 'UPSTREAM_TIMEOUT', `${db} 응답이 늦습니다`)
  return e
}

function withMongoErrors(repo, db) {
  const out = {}
  for (const [k, fn] of Object.entries(repo)) {
    out[k] = async (...args) => {
      try {
        return await fn(...args)
      } catch (e) {
        throw mapMongoError(e, db)
      }
    }
  }
  return out
}

// GridFS 본문을 읽는 도중의 오류. 조각이 빠졌거나 크기가 틀리면 저장 데이터 문제, 그 사이 파일이 지워졌으면 없는 판이다.
function mapGridfsError(e) {
  if (e && e.name === 'MongoGridFSChunkError') return seError(422, 'FILE_DAMAGED', 'GridFS 파일 조각이 빠졌거나 깨졌습니다')
  if (e && e.code === 'ENOENT') return seError(404, 'NOT_FOUND', '그 버전이 없습니다')
  return mapMongoError(e)
}

module.exports = { seError, withMongoErrors, mapGridfsError }
