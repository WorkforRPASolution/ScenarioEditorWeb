'use strict'
const { parseUser } = require('../domain/processPermission')

// ARS_USER_INFO 를 요청마다 읽되 TTL 캐시(설계 §5.2). 같은 아이디가 여럿이면 첫 문서(사내 FirstOrDefault) + 문서 수.
function createUserService({ repo, ttlMs, now }) {
  const cache = new Map()
  return {
    async getUser(singleid) {
      const hit = cache.get(singleid)
      if (hit && now() - hit.at < ttlMs) return hit.value
      const docs = await repo.findUsers(singleid)
      const value = docs.length ? { ...parseUser(docs[0]), duplicateUserDocs: docs.length } : null
      cache.set(singleid, { at: now(), value })
      return value
    },
    clear() { cache.clear() }
  }
}

module.exports = { createUserService }
