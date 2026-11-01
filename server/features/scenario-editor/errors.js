'use strict'
const { ApiError } = require('../../shared/middleware/errorHandler')

// WebManager ApiError 에 code 를 붙인다(errorHandler 가 { error, code } 로 낸다).
function seError(status, code, message) {
  const e = new ApiError(status, message)
  e.code = code
  return e
}

// 드라이버 오류 이름(mongodb 6~7). 질의 도중 끊겨도 500 이 아니라 503 이 되게 한다(설계 오류 표).
// 뒤 네 개(풀 비움·서버 닫힘·풀 닫힘·대기열 시간 초과)는 한 연결이 끊긴 뒤 같이 돌던 질의가 받는다.
const MONGO_DOWN = new Set([
  'MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoServerSelectionError', 'MongoNotConnectedError', 'MongoTopologyClosedError',
  'MongoPoolClearedError', 'MongoServerClosedError', 'MongoPoolClosedError', 'MongoWaitQueueTimeoutError'
])
// 서버가 내려가거나 주 노드가 바뀌는 중에 서버가 돌려주는 MongoServerError 코드.
// 91 ShutdownInProgress, 11600 InterruptedAtShutdown, 189 PrimarySteppedDown, 10107 NotWritablePrimary, 13435 NotPrimaryNoSecondaryOk
const MONGO_DOWN_CODES = new Set([91, 11600, 189, 10107, 13435])
const MAX_TIME_EXPIRED = 50

function withMongoErrors(repo) {
  const out = {}
  for (const [k, fn] of Object.entries(repo)) {
    out[k] = async (...args) => {
      try {
        return await fn(...args)
      } catch (e) {
        if (e && e.code && typeof e.code === 'string') throw e
        if (e && (MONGO_DOWN.has(e.name) || MONGO_DOWN_CODES.has(e.code))) throw seError(503, 'UPSTREAM_DOWN', 'EARS DB 를 읽지 못했습니다')
        if (e && e.code === MAX_TIME_EXPIRED) throw seError(504, 'UPSTREAM_TIMEOUT', 'EARS DB 응답이 늦습니다')
        throw e
      }
    }
  }
  return out
}

module.exports = { seError, withMongoErrors }
