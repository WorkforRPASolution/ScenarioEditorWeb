'use strict'
const { ApiError } = require('../../shared/middleware/errorHandler')

// WebManager ApiError 에 code 를 붙인다(errorHandler 가 { error, code } 로 낸다).
function seError(status, code, message) {
  const e = new ApiError(status, message)
  e.code = code
  return e
}

// 드라이버 오류 이름(mongodb 6~7). 질의 도중 끊겨도 500 이 아니라 503 이 되게 한다(설계 오류 표).
const MONGO_DOWN = new Set(['MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoServerSelectionError', 'MongoNotConnectedError', 'MongoTopologyClosedError'])
const MAX_TIME_EXPIRED = 50

function withMongoErrors(repo) {
  const out = {}
  for (const [k, fn] of Object.entries(repo)) {
    out[k] = async (...args) => {
      try {
        return await fn(...args)
      } catch (e) {
        if (e && e.code && typeof e.code === 'string') throw e
        if (e && MONGO_DOWN.has(e.name)) throw seError(503, 'UPSTREAM_DOWN', 'EARS DB 를 읽지 못했습니다')
        if (e && e.code === MAX_TIME_EXPIRED) throw seError(504, 'UPSTREAM_TIMEOUT', 'EARS DB 응답이 늦습니다')
        throw e
      }
    }
  }
  return out
}

module.exports = { seError, withMongoErrors }
