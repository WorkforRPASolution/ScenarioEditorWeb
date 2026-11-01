'use strict'
const { seError } = require('../errors')

// 시나리오 해시 {공정}-{모델} (Redis DB0, REDIS_URL). 읽기만.
function createScenarioHashRepository(getRedis) {
  return {
    async hkeys(key) {
      const r = getRedis()
      if (!r) throw seError(503, 'UPSTREAM_DOWN', 'Redis 에 연결되지 않았습니다')
      try {
        return await r.hkeys(key)
      } catch {
        throw seError(503, 'UPSTREAM_DOWN', 'Redis 를 읽지 못했습니다')
      }
    }
  }
}

module.exports = { createScenarioHashRepository }
