import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const D = '../../../server/features/scenario-editor/domain/'
const { parseUser } = require(D + 'processPermission')
const { joinEquipment, applyEquipmentRules, allowedPairs } = require(D + 'equipmentRules')
const { equipment, agents } = require('../data/equipment')
const users = require('../data/users')
const expected = require('../data/expected-scopes')

describe('시험 데이터 기대값', () => {
  const joined = joinEquipment(agents, equipment)
  it.each(users.map((u) => [u.singleid, u]))('%s', (id, u) => {
    const doc = { ...u, authorityManager: u.authorityManager && u.authorityManager.long !== undefined ? { toNumber: () => u.authorityManager.long } : u.authorityManager }
    const r = applyEquipmentRules(joined, parseUser(doc))
    expect(allowedPairs(r.valid)).toEqual(expected[id].processes)
    expect(r.invalid.length + r.duplicateEqpIds.length).toBe(expected[id].excludedEqpCount)
  })
})
