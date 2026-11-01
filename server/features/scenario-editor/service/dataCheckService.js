'use strict'
function createDataCheckService({ repo, scopes }) {
  return {
    async check(user) {
      const s = await scopes.scopeFor(user)
      const pairs = s.pairs.flatMap((p) => p.models.map((m) => ({ process: p.process, model: m.model })))
      return {
        duplicateUsers: user.duplicateUserDocs > 1 ? [{ singleid: user.singleid, count: user.duplicateUserDocs }] : [],
        duplicateEqpIds: s.duplicateEqpIds,
        invalidEquipment: s.invalid,
        proxyIpDuplicates: s.proxyIpDuplicates,
        duplicateProperties: await repo.findDuplicateKeys(pairs)
      }
    }
  }
}

module.exports = { createDataCheckService }
