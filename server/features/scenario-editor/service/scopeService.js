'use strict'
const { joinEquipment, applyEquipmentRules, allowedPairs } = require('../domain/equipmentRules')
const { seError } = require('../errors')

// 설비 조인은 모든 사용자 공용 TTL 캐시, 공정 거르기·무효 규칙은 요청마다(설계 §5.2·§5.4).
function createScopeService({ repo, ttlMs, now }) {
  let cache = null
  async function joined() {
    if (cache && now() - cache.at < ttlMs) return cache.value
    const [agents, eqps] = await Promise.all([repo.findAgents(), repo.findEquipment()])
    cache = { at: now(), value: joinEquipment(agents, eqps) }
    return cache.value
  }
  async function scopeFor(user) {
    const r = applyEquipmentRules(await joined(), user)
    return { ...r, pairs: allowedPairs(r.valid) }
  }
  async function assertAllowed(user, process, model) {
    const { pairs } = await scopeFor(user)
    const ok = pairs.some((p) => p.process === process && p.models.some((m) => m.model === model))
    if (!ok) throw seError(403, 'PROCESS_FORBIDDEN', '공정 권한 밖의 공정·모델입니다')
  }
  return { scopeFor, assertAllowed, clear() { cache = null } }
}

module.exports = { createScopeService }
